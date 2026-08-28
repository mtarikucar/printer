import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta webhook authentication. Two mechanisms, two different secrets — this is
 * the most common way a WhatsApp integration ends up either unverifiable or
 * wide open:
 *
 *   GET  handshake  → WHATSAPP_VERIFY_TOKEN (a string you typed into the App
 *                     Dashboard). Used ONLY here.
 *   POST signature  → META_APP_SECRET (App Dashboard → Settings → Basic).
 *                     Used ONLY here. NOT the access token.
 *
 * NOTE: no `import "server-only"` — kept importable from the worker for tests.
 */

/**
 * Answer Meta's subscription handshake.
 *
 * Returns the raw challenge string to echo back as PLAIN TEXT with a 200 — no
 * JSON wrapper, no quotes. Anything else and Meta refuses to save the callback
 * URL, with no useful error.
 */
export function verifyWebhookHandshake(params: URLSearchParams): string | null {
  const mode = params.get("hub.mode");
  const challenge = params.get("hub.challenge");
  const token = params.get("hub.verify_token");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode !== "subscribe" || !challenge || !token || !expected) return null;
  if (!safeEqual(token, expected)) return null;
  return challenge;
}

/**
 * Verify `X-Hub-Signature-256` over the RAW request body.
 *
 * The signature covers the exact bytes Meta sent. In a Next.js route handler
 * the first thing the handler must do is `await request.text()` — calling
 * `request.json()` consumes the stream and any later re-serialisation produces
 * a different byte string, so the digest can never match again.
 *
 * Meta historically also sent a legacy SHA-1 `X-Hub-Signature`. Ignore it.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  appSecret = process.env.META_APP_SECRET
): boolean {
  if (!appSecret) return false;
  if (!header || !header.startsWith("sha256=")) return false;

  const expected =
    "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(header, expected);
}

/** Length-checked constant-time compare (timingSafeEqual throws on mismatch). */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
