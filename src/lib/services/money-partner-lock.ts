import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import type { PartnerKind } from "@/lib/config/partner-adjustments";

export type MoneyTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type { PartnerKind } from "@/lib/config/partner-adjustments";

/**
 * Acquire before any order, earning, adjustment or payout row lock. The lock
 * belongs to this transaction/connection and is released on commit/rollback.
 * Never call a public service opening another transaction while holding it.
 * Callers needing multiple partners must acquire all keys in sorted order.
 */
export async function lockPartnerMoney(tx: MoneyTx, kind: PartnerKind, id: string): Promise<void> {
  if (kind !== "manufacturer" && kind !== "painter") throw new TypeError("Invalid money partner kind");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new TypeError("Invalid money partner ID");
  }
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  // A hash collision can only serialize unrelated partners; it cannot let two
  // operations for the same partner proceed together. Normalize UUID case.
  const key = `partner-money:${kind}:${id.toLowerCase()}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
