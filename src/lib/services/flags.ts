import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformFlags } from "@/lib/db/schema";
import { getRedisConnection } from "@/lib/queue/connection";
import {
  FLAG_DEFAULTS,
  FLAG_KEYS,
  killAllEngaged,
  type FlagKey,
} from "@/lib/config/flags";

const CACHE_TTL_SECONDS = 10;

function cacheKey(key: FlagKey): string {
  return `flag:${key}`;
}

function redisOrNull() {
  if (!process.env.REDIS_URL) return null;
  try {
    return getRedisConnection();
  } catch {
    return null;
  }
}

/**
 * A 10s Redis TTL cache in front of the DB, so a flipped flag reaches every
 * process within ten seconds without a redeploy. Both a Redis outage and a DB
 * outage degrade to the compiled default — never to "enabled".
 */
export async function isFlagEnabled(key: FlagKey): Promise<boolean> {
  if (killAllEngaged()) return false;

  const redis = redisOrNull();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey(key));
      if (cached === "1") return true;
      if (cached === "0") return false;
    } catch {
      // fall through to the DB
    }
  }

  let enabled = FLAG_DEFAULTS[key];
  try {
    const [row] = await db
      .select({ enabled: platformFlags.enabled })
      .from(platformFlags)
      .where(eq(platformFlags.key, key))
      .limit(1);
    if (row) enabled = row.enabled;
  } catch (err) {
    console.error(`[flags] read failed for ${key}; using compiled default`, err);
    enabled = FLAG_DEFAULTS[key];
  }

  if (redis) {
    try {
      await redis.set(cacheKey(key), enabled ? "1" : "0", "EX", CACHE_TTL_SECONDS);
    } catch {
      // the cache is best-effort
    }
  }
  return enabled;
}

export async function setFlag(
  key: FlagKey,
  enabled: boolean,
  updatedBy: string
): Promise<void> {
  await db
    .insert(platformFlags)
    .values({ key, enabled, updatedBy })
    .onConflictDoUpdate({
      target: platformFlags.key,
      set: { enabled, updatedBy, updatedAt: new Date() },
    });

  const redis = redisOrNull();
  if (redis) {
    try {
      await redis.del(cacheKey(key));
    } catch {
      // the next read will just miss the cache
    }
  }
}

export async function getAllFlags(): Promise<Record<FlagKey, boolean>> {
  const out = {} as Record<FlagKey, boolean>;
  for (const key of FLAG_KEYS) out[key] = FLAG_DEFAULTS[key];

  try {
    const rows = await db.select().from(platformFlags);
    const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
    for (const key of FLAG_KEYS) {
      const value = byKey.get(key);
      if (typeof value === "boolean") out[key] = value;
    }
  } catch (err) {
    console.error("[flags] bulk read failed; using compiled defaults", err);
  }

  if (killAllEngaged()) for (const key of FLAG_KEYS) out[key] = false;
  return out;
}
