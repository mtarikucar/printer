import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { waMediaCache } from "@/lib/db/schema";
import { getFileBuffer } from "./storage";
import {
  APPROVAL_BUTTONS,
  GRAPH_BASE,
  MAX_BUTTONS,
  MAX_BUTTON_TITLE,
  MAX_TEXT_LENGTH,
  WA_ERRORS,
} from "@/lib/config/whatsapp";

/**
 * The ONLY module in this codebase that talks to graph.facebook.com.
 *
 * Everything funnels through here so the kill switch, the 24-hour window and
 * the per-recipient rate limit have exactly one place to live. It is called
 * only from the `whatsapp-outbound` worker — never from a route handler, so a
 * slow Graph call can never hold an HTTP request open.
 *
 * NOTE: no `import "server-only"` — this runs inside the BullMQ worker.
 */

const SEND_TIMEOUT_MS = 20_000;

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly detail?: string
  ) {
    super(message);
    this.name = "WhatsAppError";
  }

  /** Outside the 24h service window: the caller must fall back to a template. */
  get isOutsideWindow(): boolean {
    return this.code === WA_ERRORS.outsideWindow;
  }

  /** Too fast to one recipient. Back off; retrying immediately makes it worse. */
  get isPairRateLimited(): boolean {
    return this.code === WA_ERRORS.pairRateLimit;
  }
}

function credentials(): { token: string; phoneNumberId: string } {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new WhatsAppError("WhatsApp credentials are not configured", null);
  }
  return { token, phoneNumberId };
}

async function graphPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const { token } = credentials();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = json.error as { code?: number; message?: string } | undefined;
    throw new WhatsAppError(
      error?.message ?? `WhatsApp ${path} failed (${res.status})`,
      error?.code ?? null,
      JSON.stringify(json).slice(0, 500)
    );
  }
  return json;
}

function messageId(json: Record<string, unknown>): string | null {
  const messages = json.messages as Array<{ id?: string }> | undefined;
  return messages?.[0]?.id ?? null;
}

/** Free-form text. Only valid inside the 24h window. */
export async function sendText(to: string, body: string): Promise<string | null> {
  const { phoneNumberId } = credentials();
  const json = await graphPost(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: true, body: body.slice(0, MAX_TEXT_LENGTH) },
  });
  return messageId(json);
}

/**
 * Upload a local file to Meta and return its media id.
 *
 * We always send our OWN media by id rather than by link. Two reasons: a `link`
 * asks Meta to fetch a URL off our single box on every send, and that URL would
 * be a signed bearer capability pointing at a photo of someone's child. A media
 * id lives 30 days, so re-sends are free and expose nothing.
 */
export async function uploadMedia(localKey: string, mimeType: string): Promise<string> {
  const [cached] = await db
    .select()
    .from(waMediaCache)
    .where(eq(waMediaCache.localKey, localKey))
    .limit(1);
  // Meta ids expire at 30 days; refresh anything older than 25 to be safe.
  if (cached && Date.now() - cached.uploadedAt.getTime() < 25 * 24 * 60 * 60 * 1000) {
    return cached.metaMediaId;
  }

  const { token, phoneNumberId } = credentials();
  const bytes = await getFileBuffer(localKey);

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
    localKey.split("/").pop() ?? "upload"
  );

  const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { code?: number; message?: string } };
  if (!res.ok || !json.id) {
    throw new WhatsAppError(
      json.error?.message ?? `media upload failed (${res.status})`,
      json.error?.code ?? null
    );
  }

  await db
    .insert(waMediaCache)
    .values({ localKey, metaMediaId: json.id, mimeType, uploadedAt: new Date() })
    .onConflictDoUpdate({
      target: waMediaCache.localKey,
      set: { metaMediaId: json.id, mimeType, uploadedAt: new Date() },
    });

  return json.id;
}

export async function sendImage(
  to: string,
  localKey: string,
  caption?: string
): Promise<string | null> {
  const { phoneNumberId } = credentials();
  const mediaId = await uploadMedia(localKey, "image/png");
  const json = await graphPost(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "image",
    image: { id: mediaId, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
  });
  return messageId(json);
}

export async function sendVideo(
  to: string,
  localKey: string,
  caption?: string
): Promise<string | null> {
  const { phoneNumberId } = credentials();
  const mediaId = await uploadMedia(localKey, "video/mp4");
  const json = await graphPost(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "video",
    video: { id: mediaId, ...(caption ? { caption: caption.slice(0, 1024) } : {}) },
  });
  return messageId(json);
}

export interface ReplyButton {
  id: string;
  title: string;
}

/**
 * Interactive reply buttons. Meta caps this at three buttons with 20-character
 * titles; both are asserted here rather than left to the API to reject, because
 * a rejection at send time means a customer waiting on a message that never came.
 */
export async function sendButtons(
  to: string,
  bodyText: string,
  buttons: readonly ReplyButton[],
  header?: { type: "video" | "image"; localKey: string }
): Promise<string | null> {
  if (buttons.length === 0 || buttons.length > MAX_BUTTONS) {
    throw new WhatsAppError(`WhatsApp allows 1-${MAX_BUTTONS} reply buttons`, null);
  }
  for (const button of buttons) {
    if (button.title.length > MAX_BUTTON_TITLE) {
      throw new WhatsAppError(`button title too long: ${button.title}`, null);
    }
  }

  const { phoneNumberId } = credentials();
  let headerPayload: Record<string, unknown> | undefined;
  if (header) {
    const mediaId = await uploadMedia(
      header.localKey,
      header.type === "video" ? "video/mp4" : "image/png"
    );
    headerPayload = { type: header.type, [header.type]: { id: mediaId } };
  }

  const json = await graphPost(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      ...(headerPayload ? { header: headerPayload } : {}),
      body: { text: bodyText.slice(0, 1024) },
      action: {
        buttons: buttons.map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
  return messageId(json);
}

/**
 * A pre-approved template. The only thing that can be sent once the 24-hour
 * window has closed.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  bodyParams: string[] = [],
  languageCode = "tr"
): Promise<string | null> {
  const { phoneNumberId } = credentials();
  const json = await graphPost(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(bodyParams.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: bodyParams.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  });
  return messageId(json);
}

export { APPROVAL_BUTTONS };
