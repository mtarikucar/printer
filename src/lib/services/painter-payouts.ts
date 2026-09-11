import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterEarnings, painterPayouts } from "@/lib/db/schema";
import { computeEarning } from "@/lib/services/finance";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import type { AccrualOutcome } from "@/lib/services/payouts";

// Painter earnings + payouts — mirrors src/lib/services/payouts.ts (manufacturer
// side) against the painter_earnings / painter_payouts tables. The painter's
// gross is the professional-painting add-on price (orders.paintingPriceKurus);
// the platform keeps the same commission %, the painter is paid the remainder.

/**
 * Accrue the painter's earning for a completed (shipped) painting job.
 * Idempotent on orderId (one painter earning per order). The single choke point
 * for painter money: no other module inserts painter_earnings.
 *
 * The rate comes from `orders.commissionRateBps` — the rate frozen when the
 * manufacturer accepted — NOT the live constant. This mirrors `accrueEarning`
 * on the manufacturer side and is what makes the painter agreement's promise
 * ("komisyon oranı, işi kabul ettiğiniz anda sabitlenir", painter-onboarding.ts)
 * true. Reading the live constant instead meant a rate change silently repriced
 * every in-flight painting job at ship time — and `painterEarnings.orderId` is
 * UNIQUE with onConflictDoNothing, so that first accrual is final.
 *
 * A painter hand-off is only reachable from `manufacturerStatus = 'qc_approved'`,
 * which only the manufacturer accept route can set, so the column is populated
 * on every painting order; the constant is a fallback for pre-freeze rows.
 *
 * A refunded order never accrues: the refund check and the insert share one
 * transaction with the order row read FOR SHARE. Why the lock, and why here as
 * well as in the ship route, is explained on accrueEarning (payouts.ts).
 */
export async function accruePainterEarning(
  orderId: string,
  painterId: string,
  grossKurus: number
): Promise<AccrualOutcome> {
  const outcome = await db.transaction(async (tx): Promise<AccrualOutcome> => {
    // Bounded lock wait, for the reason given on accrueEarning.
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

    const [row] = await tx
      .select({
        rate: orders.commissionRateBps,
        amountKurus: orders.amountKurus,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), notRefundedGuard()))
      .for("share");
    if (!row) {
      const [exists] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.id, orderId));
      return exists ? "skipped_refunded" : "order_not_found";
    }
    const rateBps = row.rate ?? PLATFORM_COMMISSION_RATE_BPS;

    // Mirror of the manufacturer-side tripwire: the painter's base can never
    // exceed the order, and must be the painting kalem total. Log, never throw —
    // a shipped-but-unpaid painting job is worse than a visible mis-amount.
    if (grossKurus > row.amountKurus) {
      console.error(
        `[kalem] order ${orderId}: painter gross ${grossKurus} exceeds order amount ${row.amountKurus}`
      );
    }

    const e = computeEarning(grossKurus, rateBps);
    const inserted = await tx
      .insert(painterEarnings)
      .values({
        orderId,
        painterId,
        grossKurus: e.grossKurus,
        commissionKurus: e.commissionKurus,
        netKurus: e.netKurus,
        commissionRateBps: e.commissionRateBps,
      })
      .onConflictDoNothing({ target: painterEarnings.orderId })
      .returning({ id: painterEarnings.id });
    return inserted.length > 0 ? "accrued" : "already_accrued";
  });

  if (outcome === "skipped_refunded") {
    console.warn(
      `[accrual] order ${orderId}: skipped: refunded — no painter earning for ${painterId}`
    );
  } else if (outcome === "order_not_found") {
    console.error(`[accrual] order ${orderId}: not found — no painter earning accrued`);
  }
  return outcome;
}

/** Reverse a painter's (still-pending/unpaid) earning on refund/clawback. */
export async function reversePainterEarning(orderId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const toReverse = await tx
      .select({ id: painterEarnings.id, payoutId: painterEarnings.payoutId, netKurus: painterEarnings.netKurus })
      .from(painterEarnings)
      .where(
        and(
          eq(painterEarnings.orderId, orderId),
          ne(painterEarnings.status, "reversed"),
          ne(painterEarnings.status, "paid")
        )
      );
    if (toReverse.length === 0) return;
    for (const e of toReverse) {
      if (e.payoutId) {
        const [p] = await tx
          .select({ status: painterPayouts.status, totalKurus: painterPayouts.totalKurus, earningCount: painterPayouts.earningCount })
          .from(painterPayouts)
          .where(eq(painterPayouts.id, e.payoutId));
        if (p && p.status === "pending") {
          await tx
            .update(painterPayouts)
            .set({ totalKurus: p.totalKurus - e.netKurus, earningCount: Math.max(0, p.earningCount - 1) })
            .where(eq(painterPayouts.id, e.payoutId));
        }
      }
      await tx
        .update(painterEarnings)
        .set({ status: "reversed", payoutId: null, updatedAt: new Date() })
        .where(eq(painterEarnings.id, e.id));
    }
  });
}

/** Batch a painter's pending earnings into a single payout. Returns null if none. */
export async function createPayoutForPainter(
  painterId: string,
  adminEmail: string
): Promise<{ payoutId: string; totalKurus: number; count: number } | null> {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select({ id: painterEarnings.id, netKurus: painterEarnings.netKurus })
      .from(painterEarnings)
      .where(
        and(
          eq(painterEarnings.painterId, painterId),
          eq(painterEarnings.status, "pending"),
          isNull(painterEarnings.payoutId)
        )
      );
    if (pending.length === 0) return null;
    const totalKurus = pending.reduce((s, e) => s + e.netKurus, 0);
    const [payout] = await tx
      .insert(painterPayouts)
      .values({ painterId, totalKurus, earningCount: pending.length, adminEmail, status: "pending" })
      .returning({ id: painterPayouts.id });
    await tx
      .update(painterEarnings)
      .set({ payoutId: payout.id, updatedAt: new Date() })
      .where(
        and(
          eq(painterEarnings.painterId, painterId),
          eq(painterEarnings.status, "pending"),
          isNull(painterEarnings.payoutId)
        )
      );
    return { payoutId: payout.id, totalKurus, count: pending.length };
  });
}

/** Mark a pending painter payout paid → its earnings flip to "paid". Idempotent. */
export async function markPainterPayoutPaid(
  payoutId: string,
  reference: string | null
): Promise<{ painterId: string; totalKurus: number } | null> {
  return db.transaction(async (tx) => {
    const [payout] = await tx
      .update(painterPayouts)
      .set({ status: "paid", paidAt: new Date(), reference })
      .where(and(eq(painterPayouts.id, payoutId), eq(painterPayouts.status, "pending")))
      .returning({ id: painterPayouts.id, painterId: painterPayouts.painterId, totalKurus: painterPayouts.totalKurus });
    if (!payout) return null;
    await tx
      .update(painterEarnings)
      .set({ status: "paid", updatedAt: new Date() })
      .where(and(eq(painterEarnings.payoutId, payoutId), ne(painterEarnings.status, "reversed")));
    return { painterId: payout.painterId, totalKurus: payout.totalKurus };
  });
}
