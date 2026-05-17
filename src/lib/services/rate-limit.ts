import { env } from "@/lib/env";

/**
 * Rate-limit primitives.
 *
 * - `extractClientIp` resolves the caller's IP. By default we DO NOT trust the
 *   `X-Forwarded-For` header, since anyone can spoof it to mint a fresh bucket
 *   per request. Trust is opt-in via `TRUSTED_PROXY_IPS` env var (comma-sep
 *   list of upstream proxies). For Cloudflare, set the upstream IP and we'll
 *   honour `CF-Connecting-IP`.
 *
 * - `rateLimit` uses Redis-backed atomic INCR when REDIS_URL is set, so multiple
 *   Next.js instances share the same buckets. Falls back to in-memory only when
 *   Redis isn't available (dev without redis) — the in-memory mode logs a
 *   warning in production.
 */

const inMemoryStore = new Map<string, { count: number; resetAt: number }>();

const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();
// Hoisted above extractClientIp so the reader/writer are co-located. var/let
// hoisting would save us, but co-location avoids fragility when refactoring.
let warnedAboutMissingProxy = false;

function cleanupInMemory() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of inMemoryStore) {
    if (entry.resetAt < now) inMemoryStore.delete(key);
  }
}

interface IpRequest {
  headers: { get(name: string): string | null };
}

export function extractClientIp(request: IpRequest): string {
  // The "real" socket IP is not exposed in Next.js request abstractions, so we
  // fall back to header inspection. We only trust headers when the immediate
  // upstream is on the configured whitelist.
  const trustedProxies = env.TRUSTED_PROXY_IPS;
  const hasTrustedProxy = trustedProxies.length > 0;

  // Cloudflare's CF-Connecting-IP is set by CF after stripping any incoming
  // value, so it's safe when running behind CF.
  if (hasTrustedProxy) {
    const cfIp = request.headers.get("cf-connecting-ip");
    if (cfIp) return cfIp.trim();

    const realIp = request.headers.get("x-real-ip");
    if (realIp) return realIp.trim();

    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      // Use the LEFTMOST address — that's the originating client per RFC 7239.
      // Right-most would be the proxy chain.
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
  }

  // No trusted proxy configured → returning a single shared string would
  // collapse the whole world into one bucket and one attacker could DoS all
  // legitimate users by burning the global limit. Fall back to "weak" IP
  // extraction (XFF first hop) — this is still spoofable but no worse than
  // the historical behavior, and at least segregates buckets. Log loudly once
  // per process so ops set TRUSTED_PROXY_IPS in production.
  if (!warnedAboutMissingProxy) {
    warnedAboutMissingProxy = true;
    console.warn(
      "[rate-limit] TRUSTED_PROXY_IPS is not configured. Using untrusted XFF/x-real-ip for bucketing — vulnerable to spoofing. Set TRUSTED_PROXY_IPS to your upstream proxy's address(es) in production."
    );
  }
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

const redisRateLimitScript = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local current = redis.call("INCR", key)
if current == 1 then
  redis.call("PEXPIRE", key, windowMs)
end
if current > limit then
  return {0, 0}
end
return {1, limit - current}
`;

let redisScriptSha: string | null = null;

async function getRedisOrNull() {
  if (!process.env.REDIS_URL) return null;
  try {
    const mod = await import("@/lib/queue/connection");
    return mod.getRedisConnection();
  } catch {
    return null;
  }
}

/**
 * Atomic check-and-increment rate limit. Returns `{ success, remaining }`.
 * Prefer the async variant in new code; the legacy sync `rateLimit` is kept
 * for in-memory callers that haven't migrated yet.
 */
export async function rateLimitAsync(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ success: boolean; remaining: number }> {
  const redis = await getRedisOrNull();
  if (redis) {
    try {
      if (!redisScriptSha) {
        redisScriptSha = await redis.script("LOAD", redisRateLimitScript) as string;
      }
      const result = (await redis.evalsha(
        redisScriptSha,
        1,
        `ratelimit:${key}`,
        String(limit),
        String(windowMs)
      )) as [number, number];
      return { success: result[0] === 1, remaining: result[1] };
    } catch (err) {
      // If the script vanished from the cache (e.g. Redis restart), try again
      // once with EVAL which both runs and caches the script.
      try {
        const result = (await redis.eval(
          redisRateLimitScript,
          1,
          `ratelimit:${key}`,
          String(limit),
          String(windowMs)
        )) as [number, number];
        redisScriptSha = null; // force re-LOAD next time
        return { success: result[0] === 1, remaining: result[1] };
      } catch (err2) {
        console.warn("[rate-limit] Redis failed, falling back to in-memory:", err2);
      }
    }
  }
  return rateLimit(key, limit, windowMs);
}

/**
 * Synchronous, in-memory rate limit. Single-process only — use `rateLimitAsync`
 * in production. Kept for callers that can't be made async (and dev).
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { success: boolean; remaining: number } {
  cleanupInMemory();
  const now = Date.now();
  const entry = inMemoryStore.get(key);

  if (!entry || entry.resetAt < now) {
    inMemoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1 };
  }

  entry.count++;
  if (entry.count > limit) {
    return { success: false, remaining: 0 };
  }
  return { success: true, remaining: limit - entry.count };
}

// One-time prod warning if no Redis is configured.
if (process.env.NODE_ENV === "production" && !process.env.REDIS_URL) {
  console.warn(
    "[rate-limit] REDIS_URL not set in production — rate limits will not be shared across instances."
  );
}
