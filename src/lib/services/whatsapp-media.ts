import { nanoid } from "nanoid";
import { saveFile } from "./storage";
import { validateImageMagicBytes } from "./file-validation";
import {
  ALLOWED_INBOUND_IMAGE_TYPES,
  GRAPH_BASE,
  MAX_INBOUND_IMAGE_BYTES,
} from "@/lib/config/whatsapp";

/**
 * Download a customer-sent photo from Meta.
 *
 * Two steps, and the order matters:
 *   1. GET /{media-id}?phone_number_id=…   → { url, mime_type, file_size, ... }
 *   2. GET <url>  with the SAME Bearer token (host is lookaside.fbsbx.com; the
 *      URL is not pre-signed and a bare fetch gets nothing).
 *
 * The URL from step 1 dies after FIVE MINUTES. That is why only the media id
 * is ever put in a job payload and the resolve happens inside the worker: a job
 * that waits behind a queue for six minutes would otherwise resolve to a dead
 * link with no obvious cause.
 *
 * NOTE: no `import "server-only"` — this runs inside the BullMQ worker.
 */

export type MediaFailure =
  | "no_credentials"
  | "resolve_failed"
  | "download_failed"
  | "too_large"
  | "bad_type";

export type MediaResult =
  | { ok: true; key: string; mimeType: string; bytes: number }
  | { ok: false; reason: MediaFailure };

export async function downloadInboundImage(
  mediaId: string,
  conversationId: string
): Promise<MediaResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false, reason: "no_credentials" };

  let url: string;
  let declaredType: string;
  let declaredSize: number;
  try {
    const res = await fetch(
      `${GRAPH_BASE}/${mediaId}?phone_number_id=${encodeURIComponent(phoneNumberId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) return { ok: false, reason: "resolve_failed" };
    const json = (await res.json()) as {
      url?: string;
      mime_type?: string;
      file_size?: string | number;
    };
    if (!json.url) return { ok: false, reason: "resolve_failed" };
    url = json.url;
    declaredType = json.mime_type ?? "";
    declaredSize = Number(json.file_size ?? 0);
  } catch {
    return { ok: false, reason: "resolve_failed" };
  }

  // Reject on the declared size before spending bandwidth on the body.
  if (declaredSize > MAX_INBOUND_IMAGE_BYTES) return { ok: false, reason: "too_large" };
  if (
    declaredType &&
    !(ALLOWED_INBOUND_IMAGE_TYPES as readonly string[]).includes(declaredType)
  ) {
    return { ok: false, reason: "bad_type" };
  }

  let buffer: Buffer;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Some edge configurations answer a bare fetch with 403; the docs do
        // not require a UA but sending one is free insurance.
        "User-Agent": "figurunica/1.0",
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, reason: "download_failed" };
    buffer = Buffer.from(await res.arrayBuffer());
  } catch {
    return { ok: false, reason: "download_failed" };
  }

  if (buffer.length > MAX_INBOUND_IMAGE_BYTES) return { ok: false, reason: "too_large" };

  // Never trust the declared MIME type: check the bytes.
  const actualType = validateImageMagicBytes(buffer);
  if (!actualType || !(ALLOWED_INBOUND_IMAGE_TYPES as readonly string[]).includes(actualType)) {
    return { ok: false, reason: "bad_type" };
  }

  // The `photos/` prefix is load-bearing: POST /api/orders validates that a
  // submitted photoKey starts with it, so a WhatsApp photo has to be
  // indistinguishable from a web upload for the rest of the pipeline.
  const extension = actualType === "image/png" ? "png" : "jpg";
  const key = await saveFile(
    buffer,
    `photos/wa/${conversationId}`,
    `${nanoid(12)}.${extension}`
  );

  return { ok: true, key, mimeType: actualType, bytes: buffer.length };
}
