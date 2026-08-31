import { getAppUrl } from "@/lib/seo/organization";

/**
 * IndexNow — tell search engines a URL changed instead of waiting to be
 * recrawled.
 *
 * Why it is worth having here specifically: ChatGPT's retrieval runs on Bing's
 * index, and Bing is an IndexNow participant. The path from "we published a
 * product" to "an AI answer can cite it" runs IndexNow → Bing → ChatGPT.
 * Yandex, Seznam, Naver and Yep also consume it. Google does NOT participate,
 * so this complements the sitemap rather than replacing it.
 *
 * Fire-and-forget by design: indexing is never worth failing a user's request
 * for. Every failure is logged and swallowed.
 *
 * NOTE: no `import "server-only"` — a worker may want to submit too.
 */

const ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 8_000;
/** The spec caps a single submission at 10,000 URLs. */
const MAX_URLS = 10_000;

export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";

export function getIndexNowKey(): string | null {
  const key = process.env.INDEXNOW_KEY?.trim();
  // The spec requires 8-128 hex-ish characters; a short or empty value is a
  // misconfiguration, not something to send.
  if (!key || key.length < 8 || key.length > 128) return null;
  return key;
}

export type IndexNowResult =
  | { ok: true; submitted: number }
  | { ok: false; reason: "no_key" | "no_urls" | "http_error" | "network_error" };

/**
 * Submit changed URLs. Absolute URLs on our own host only — IndexNow rejects a
 * payload whose host does not match the key's host, and sending someone else's
 * URL is how a key gets revoked.
 */
export async function submitToIndexNow(urls: string[]): Promise<IndexNowResult> {
  const key = getIndexNowKey();
  if (!key) return { ok: false, reason: "no_key" };

  const appUrl = getAppUrl();
  const host = new URL(appUrl).host;
  const clean = Array.from(
    new Set(
      urls
        .map((u) => (u.startsWith("http") ? u : `${appUrl}${u.startsWith("/") ? "" : "/"}${u}`))
        .filter((u) => {
          try {
            return new URL(u).host === host;
          } catch {
            return false;
          }
        })
    )
  ).slice(0, MAX_URLS);

  if (clean.length === 0) return { ok: false, reason: "no_urls" };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${appUrl}${INDEXNOW_KEY_PATH}`,
        urlList: clean,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 200 and 202 both mean accepted; 202 means "key validation pending".
    if (!res.ok && res.status !== 202) {
      console.warn(`[indexnow] ${res.status} for ${clean.length} urls`);
      return { ok: false, reason: "http_error" };
    }
    return { ok: true, submitted: clean.length };
  } catch (err) {
    console.warn("[indexnow] submit failed", err);
    return { ok: false, reason: "network_error" };
  }
}

/** Never awaited by a request handler. */
export function submitToIndexNowInBackground(urls: string[]): void {
  void submitToIndexNow(urls).catch(() => {});
}
