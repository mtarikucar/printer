import { writeFile, readFile, mkdir, rm, access } from "fs/promises";
import { constants as fsConstants } from "fs";
import { join, resolve, relative, sep, isAbsolute } from "path";
import crypto from "node:crypto";

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || "./uploads");

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
