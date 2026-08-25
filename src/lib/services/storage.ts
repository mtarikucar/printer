import { writeFile, readFile, mkdir, rm, access } from "fs/promises";
import { constants as fsConstants } from "fs";
import { join, resolve, relative, sep, isAbsolute, posix } from "path";
import crypto from "node:crypto";

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || "./uploads");

/**
 * Max percent-decode passes before giving up. Legitimate storage keys are
 * nanoid filenames (alphanumeric + "-"/"_", see every `saveFile` call site)
 * and never contain "%", so they reach fixpoint on the FIRST pass —
 * `decodeURIComponent` is a no-op for them. Multiple rounds only fire for an
 * attacker stacking encode layers ("%2e%2e" -> 1 layer, "%252e%252e" -> 2
 * layers, ...); 5 is generous headroom over anything a real URL path segment
 * could plausibly carry.
 */
const MAX_DECODE_ROUNDS = 5;

/**
 * Percent-decode `input` until it stops changing (or the round cap is hit),
 * rejecting (returning null) the moment ANY intermediate form contains a
 * traversal marker (`..` or a backslash) or fails to decode.
 *
 * Why loop instead of decoding once: Next's router decodes a URL path segment
 * exactly once before handing it to a route handler, so a SINGLE-encoded
 * "%2e%2e" already arrives as a literal ".." and a one-shot `.includes("..")`
 * check on the raw string catches it. But a DOUBLE-encoded "%252e%252e"
 * arrives at the handler as the literal string "%2e%2e" — one decode short of
 * ".." — so a one-shot check misses it entirely (`isPublicUnsignedKey` had
 * exactly this hole before this fix). Nothing downstream is guaranteed to
 * stop at exactly one decode forever (a future refactor, or a CDN/proxy that
 * normalizes encodings), so we decode to a fixpoint and inspect every layer,
 * not just the first.
 */
function decodeToFixpoint(input: string): string | null {
  let current = input;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    if (current.includes("..") || current.includes("\\")) return null;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      // Malformed %-escape (e.g. a lone "%" or a truncated sequence). An
      // undecodable path is never provably safe — fail closed.
      return null;
    }
    if (next === current) return current; // fixpoint: nothing left to unwrap
    current = next;
  }
  // Didn't stabilize within the round cap — treat as an attempt to bury a
  // traversal marker under more encode layers than we're willing to peel.
  return null;
}

export async function saveFile(
  buffer: Buffer,
  subdir: string,
  filename: string
): Promise<string> {
  const dir = join(UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);
  await writeFile(filePath, buffer);
  return `${subdir}/${filename}`;
}

/**
 * Absolute path for a stored key, for tools that must read the file from disk
 * (the python geometry pass) instead of through a Buffer.
 */
export function absoluteFilePath(relativePath: string): string {
  const full = join(UPLOAD_DIR, relativePath);
  assertSafePath(full);
  return full;
}

function assertSafePath(fullPath: string): void {
  // Defence against:
  //  1. POSIX `..` traversal      → relative starts with `..`
  //  2. Windows `..\` traversal   → relative contains `..\`
  //  3. Absolute path on a foreign drive (Windows-only)
  //     `relative('D:\\uploads', 'C:\\foo')` → `'C:\\foo'` which is
  //     absolute and contains no `..`. The old check passed it through.
  //     Block by rejecting any `relative` output that's absolute (different
  //     drive or root) as well as the explicit `..` cases.
  //  4. Empty relative (`fullPath === UPLOAD_DIR`) — reject, you can't
  //     readFile a directory anyway.
  const rel = relative(UPLOAD_DIR, fullPath);
  if (rel === "") throw new Error("Invalid file path");
  if (isAbsolute(rel)) throw new Error("Invalid file path");
  if (rel.startsWith("..")) throw new Error("Invalid file path");
  if (rel.includes(`..${sep}`)) throw new Error("Invalid file path");
  // Same class of bug as `isPublicUnsignedKey`: `resolve`/`relative` only
  // collapse LITERAL ".." segments. A caller that hands this function a still
  // percent-encoded segment (e.g. "%2e%2e", or double-encoded "%252e%252e")
  // sails through every check above because the string never contains a
  // literal "..", and only becomes one after a decode this function never
  // performed. Every real storage key is nanoid-generated (see
  // `MAX_DECODE_ROUNDS` comment) and never contains "%", so decoding here
  // cannot reject a legitimate key — it only closes the encoded-traversal gap.
  if (decodeToFixpoint(rel) === null) throw new Error("Invalid file path");
}

export async function getFileBuffer(relativePath: string): Promise<Buffer> {
  const fullPath = resolve(UPLOAD_DIR, relativePath);
  assertSafePath(fullPath);
  return readFile(fullPath);
}

/**
 * Cheap existence check — does NOT read the file's bytes. Use this when you
 * only need to know "is the file on disk" (idempotency checks, sanity gating).
 * Reading the entire file just to verify presence allocates the whole buffer
 * and can OOM the worker on multi-MB GLBs during retry storms.
 */
export async function fileExists(relativePath: string): Promise<boolean> {
  const fullPath = resolve(UPLOAD_DIR, relativePath);
  try {
    assertSafePath(fullPath);
    await access(fullPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function deleteFile(relativePath: string): Promise<void> {
  const fullPath = resolve(UPLOAD_DIR, relativePath);
  assertSafePath(fullPath);
  await rm(fullPath, { force: true });
}

/**
 * Build a public file URL with a signature + expiry. Anyone with the URL has
 * read access for the lifetime of the signature. Used for any file URL we
 * embed in emails, share with manufacturers, or pass to the customer client.
 *
 * NOTE: For backward compat with already-emailed URLs, `/api/files/*` still
 * serves files without a valid signature when `FILES_REQUIRE_SIGNATURE` is
 * unset. Flip that env var to "1" before relying on signing for security.
 */
const SIGNED_URL_DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h

function getSignSecret(): string {
  const secret = process.env.FILES_SIGNING_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    // Fail loudly in PROD RUNTIME so we don't silently mint HMACs with an
    // empty key (producer side would happily sign, but every verify would 401
    // and the customer wouldn't know why).
    //
    // Skip the throw during `next build` (NODE_ENV=production but secrets are
    // not injected at build time) and during dev. The runtime check still
    // fires when the production server starts and a file URL is signed.
    const isBuild =
      process.env.NEXT_PHASE === "phase-production-build" ||
      process.env.NEXT_PHASE === "phase-export";
    if (process.env.NODE_ENV === "production" && !isBuild) {
      throw new Error(
        "FILES_SIGNING_SECRET (or AUTH_SECRET fallback) is required for URL signing"
      );
    }
    return "";
  }
  return secret;
}

export function signFilePath(
  relativePath: string,
  ttlSeconds: number = SIGNED_URL_DEFAULT_TTL_SECONDS
): { exp: number; sig: string } {
  const secret = getSignSecret();
  // Quantize `exp` to the TTL boundary instead of `now + ttl`. A time-varying
  // exp changes the `?exp=&sig=` query on every render, so the browser keys its
  // cache on a different URL each page load and re-downloads every image —
  // defeating the `immutable, max-age=1y` header on /api/files. Aligning exp to
  // the window makes every render within the same window emit the SAME URL, so
  // the cache actually hits. The verify path is unchanged. URL rotates at most
  // once per window. The `+2` (not `+1`) guarantees the signature stays valid
  // for at least one full ttl even for a render right before a window boundary,
  // while keeping exp constant within each window (cache key stays stable).
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = (Math.floor(nowSec / ttlSeconds) + 2) * ttlSeconds;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${relativePath}:${exp}`)
    .digest("base64url");
  return { exp, sig };
}

export function verifyFileSignature(
  relativePath: string,
  exp: number,
  sig: string
): boolean {
  const secret = getSignSecret();
  if (!secret) return false;
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${relativePath}:${exp}`)
    .digest("base64url");
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export function getPublicUrl(relativePath: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === "production" ? "https://figurunica.com" : "http://localhost:3000");
  const { exp, sig } = signFilePath(relativePath);
  return `${appUrl}/api/files/${relativePath}?exp=${exp}&sig=${sig}`;
}

/**
 * Storage key prefixes served WITHOUT a signature, from `/media/...`.
 *
 * Only storefront product photos. They are already shown to every anonymous
 * visitor, so a signature adds no confidentiality — but it does add an
 * expiry, and an expiring URL is fatal for crawlers: Google/Bing re-fetch
 * images days-to-weeks after the crawl and got a 401 every time, so
 * `Product.image` and `og:image` were unusable.
 *
 * Everything else — customer photos (PII), GLB/STL meshes, chat attachments,
 * bank receipts — stays signed. Do NOT add a prefix here without checking that
 * every file under it is already public to anonymous visitors.
 */
export const PUBLIC_UNSIGNED_PREFIXES = ["products/"] as const;

/** True when `relativePath` may be served unsigned from `/media`. */
export function isPublicUnsignedKey(relativePath: string): boolean {
  // Reject traversal — including percent-encoded and DOUBLE-percent-encoded
  // traversal — before prefix matching: "products/../uploads/pii.webp" starts
  // with "products/" but resolves outside it, and so does
  // "products/%252e%252e/uploads/pii.webp" once unwrapped twice.
  const decoded = decodeToFixpoint(relativePath);
  if (decoded === null) return false;
  // Second, independent layer: collapse `.`/`..`/repeated separators and
  // re-check the PREFIX on the collapsed form. `decoded` is already
  // guaranteed free of ".."/"\\" by `decodeToFixpoint`, but this catches any
  // future change to that function (or a caller that skips it) before it can
  // turn into a prefix-match bypass.
  const normalized = posix.normalize(decoded);
  if (normalized.includes("..") || normalized.startsWith("/")) return false;
  return PUBLIC_UNSIGNED_PREFIXES.some((p) => normalized.startsWith(p));
}

/**
 * URL for an image that may be embedded in JSON-LD, `og:image`, or a sitemap —
 * i.e. anywhere a crawler will re-fetch it later. Product keys get a stable
 * unsigned `/media` URL; anything else falls back to the signed URL.
 */
export function getPublicImageUrl(relativePath: string): string {
  if (!isPublicUnsignedKey(relativePath)) return getPublicUrl(relativePath);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === "production"
      ? "https://figurunica.com"
      : "http://localhost:3000");
  return `${appUrl}/media/${relativePath}`;
}

/**
 * Rewrite any file URL to use the current app origin and freshly-signed
 * params. Handles old URLs pointing to previous domains (e.g.
 * printer.muhammedtarikucar.com) by extracting the path and re-signing.
 */
export function normalizeFileUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/api\/files\/([^?#]+)/);
  if (match) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === "production" ? "https://figurunica.com" : "http://localhost:3000");
    const relativePath = match[1];
    const { exp, sig } = signFilePath(relativePath);
    return `${appUrl}/api/files/${relativePath}?exp=${exp}&sig=${sig}`;
  }
  return url;
}

/**
 * Recover the storage key from a URL this app produced.
 *
 * Signed file URLs look like `<origin>/api/files/<key>?exp=..&sig=..`. Several
 * tables (previews.selectedStyledImageUrl among them) persist only the URL, so
 * anything that needs the BYTES has to get back to the key.
 *
 * Returns null for anything that is not one of our own file URLs, and refuses
 * traversal — the caller must be able to trust the result as a key.
 */
export function fileKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/api/files/";
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const withoutQuery = url.slice(at + marker.length).split("?")[0];
  let key: string;
  try {
    key = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  if (!key || key.includes("..") || key.startsWith("/")) return null;
  return key;
}
