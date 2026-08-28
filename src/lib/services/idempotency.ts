import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { idempotencyKeys } from "@/lib/db/schema";

const DEFAULT_TTL_SECONDS = 600; // 10 minutes

/**
 * Stable serialisation with sorted keys, so a client that orders its JSON
 * differently still collapses onto one key.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

export function deriveIdempotencyKey(payload: unknown, actor: string | null): string {
  return createHash("sha256")
    .update(`${actor ?? "guest"}|${canonical(payload)}`)
    .digest("hex");
}

export type IdempotencyOutcome<T> =
  | { status: "fresh"; value: T }
  | { status: "replayed"; value: T }
  | { status: "in_progress" };

/**
 * Run `run` at most once per (scope, key) within the TTL.
 *  - "fresh"       we ran it; the result is also stored for replays
 *  - "replayed"    a previous run's stored result
 *  - "in_progress" another caller holds the claim; the caller should 409
 */
export async function withIdempotency<T>(args: {
  scope: string;
  key: string;
  ttlSeconds?: number;
  run: () => Promise<T>;
}): Promise<IdempotencyOutcome<T>> {
  const ttl = args.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  // Opportunistic sweep so the table stays small without a cron.
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));

  // Claim with ON CONFLICT DO NOTHING + RETURNING. We never catch 23505:
  // drizzle 0.45 hides the pg error code on `.cause`, so code that catches it
  // is latently broken (see the gift-card path).
  const claimed = await db
    .insert(idempotencyKeys)
    .values({ scope: args.scope, key: args.key, status: "in_flight", expiresAt })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  if (claimed.length === 0) {
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(eq(idempotencyKeys.scope, args.scope), eq(idempotencyKeys.key, args.key))
      )
      .limit(1);
    if (existing?.status === "done") {
      return { status: "replayed", value: existing.responseJson as T };
    }
    return { status: "in_progress" };
  }

  try {
    const value = await args.run();
    await db
      .update(idempotencyKeys)
      .set({ status: "done", responseJson: value as never })
      .where(
        and(eq(idempotencyKeys.scope, args.scope), eq(idempotencyKeys.key, args.key))
      );
    return { status: "fresh", value };
  } catch (err) {
    // Release the claim so a retry can proceed; the failure is the caller's.
    await db
      .delete(idempotencyKeys)
      .where(
        and(eq(idempotencyKeys.scope, args.scope), eq(idempotencyKeys.key, args.key))
      );
    throw err;
  }
}

/** Drop a claim so a corrected retry can proceed immediately. */
export async function releaseIdempotencyKey(scope: string, key: string): Promise<void> {
  await db
    .delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
}
