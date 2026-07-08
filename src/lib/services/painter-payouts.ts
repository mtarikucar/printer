import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { painterEarnings, painterPayouts } from "@/lib/db/schema";
import { computeEarning } from "@/lib/services/finance";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";

// Painter earnings + payouts — mirrors src/lib/services/payouts.ts (manufacturer
// side) against the painter_earnings / painter_payouts tables. The painter's
// gross is the professional-painting add-on price (orders.paintingPriceKurus);
// the platform keeps the same commission %, the painter is paid the remainder.

/**
 * Accrue the painter's earning for a completed (shipped) painting job.
 * Idempotent on orderId (one painter earning per order).
 */
export async function accruePainterEarning(
  orderId: string,
  painterId: string,
  grossKurus: number
): Promise<void> {
  const e = computeEarning(grossKurus, PLATFORM_COMMISSION_RATE_BPS);
  await db
    .insert(painterEarnings)
    .values({
      orderId,
      painterId,
      grossKurus: e.grossKurus,
      commissionKurus: e.commissionKurus,
      netKurus: e.netKurus,
      commissionRateBps: e.commissionRateBps,
    })
    .onConflictDoNothing({ target: painterEarnings.orderId });
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
