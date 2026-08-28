import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  verifyWebhookHandshake,
  verifyWebhookSignature,
} from "@/lib/services/whatsapp-verify";
import { recordInboundEvent } from "@/lib/services/whatsapp-conversation";
import { getWaInboundQueue } from "@/lib/queue/queues";
import { isFlagEnabled } from "@/lib/services/flags";

// Node runtime: the signature is an HMAC over the raw body and the queue client
// is an ioredis connection. Neither works on the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta's subscription handshake. Must echo the RAW challenge as plain text.
 */
export async function GET(request: NextRequest) {
  const challenge = verifyWebhookHandshake(request.nextUrl.searchParams);
  if (!challenge) {
    return new NextResponse("forbidden", { status: 403 });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * Inbound webhook.
 *
 * Shape notes that matter:
 *  - The FIRST thing we do is read the raw text. Calling `request.json()` would
 *    consume the stream and any re-serialisation changes the bytes, after which
 *    the signature can never be verified again.
 *  - A bad signature is a 401, not a 200. Returning 200 would mean queueing work
 *    for a request we cannot attribute.
 *  - A parseable payload is a 200 even if we ignore it, because Meta retries for
 *    up to 36 hours and a retry storm helps nobody.
 *  - We return 500 ONLY when a retry would genuinely help (our datastore is
 *    down). An unconditional "always 200" would permanently discard a
 *    customer's message during a database outage.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    // Signed but unparseable: nothing to retry.
    return NextResponse.json({ ok: true });
  }

  if (!(await isFlagEnabled("wa_bot_enabled"))) {
    // Acknowledge and drop: the channel is off. Meta must not keep retrying.
    return NextResponse.json({ ok: true, ignored: "channel_disabled" });
  }

  const ourPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  try {
    const eventHash = createHash("sha256").update(rawBody).digest("hex");
    const isNew = await recordInboundEvent(eventHash, payload);
    if (!isNew) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const queue = getWaInboundQueue();

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        // Webhooks arrive for the whole WhatsApp Business Account, so a payload
        // may belong to a different number entirely. `entry.id` is the WABA id,
        // NOT the phone number id — the number is here.
        if (
          ourPhoneNumberId &&
          value.metadata?.phone_number_id &&
          value.metadata.phone_number_id !== ourPhoneNumberId
        ) {
          continue;
        }

        for (const message of value.messages ?? []) {
          const contact = value.contacts?.[0];
          await queue.add(
            "inbound",
            {
              waMessageId: message.id,
              from: message.from,
              waId: contact?.wa_id ?? message.from,
              profileName: contact?.profile?.name ?? null,
              type: message.type,
              text: message.text?.body ?? null,
              imageId: message.image?.id ?? null,
              buttonReplyId: message.interactive?.button_reply?.id ?? null,
              buttonReplyTitle: message.interactive?.button_reply?.title ?? null,
              timestamp: message.timestamp ?? null,
            },
            // Third dedupe layer, after the delivery hash and the wamid unique.
            { jobId: `wa-in:${message.id}` }
          );
        }

        for (const status of value.statuses ?? []) {
          await queue.add(
            "status",
            {
              waMessageId: status.id,
              status: status.status,
              errorCode: status.errors?.[0]?.code ?? null,
            },
            { jobId: `wa-st:${status.id}:${status.status}` }
          );
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Redis or Postgres is unreachable. Ask Meta to retry rather than swallow
    // the customer's message.
    console.error("[whatsapp.webhook] enqueue failed; asking Meta to retry", err);
    return NextResponse.json({ error: "temporary" }, { status: 500 });
  }
}

interface WebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id: string;
          from: string;
          timestamp?: string;
          type: string;
          text?: { body?: string };
          image?: { id?: string; mime_type?: string };
          interactive?: { button_reply?: { id?: string; title?: string } };
        }>;
        statuses?: Array<{
          id: string;
          status: string;
          errors?: Array<{ code?: number }>;
        }>;
      };
    }>;
  }>;
}
