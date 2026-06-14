import { eq, and, ne, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerEarnings, payouts, invoices } from "@/lib/db/schema";
import { computeEarning, computeKdv } from "@/lib/services/finance";
import { PLATFORM_COMMISSION_RATE_BPS, KDV_RATE_BPS } from "@/lib/config/prices";
import { eInvoiceProvider } from "@/lib/services/e-invoice";

// Accrue a manufacturer's earning for a shipped order. Idempotent on orderId
// (the unique constraint + onConflictDoNothing makes a double-ship a no-op).
export async function accrueEarning(
  orderId: string,
  manufacturerId: string,
  grossKurus: number
): Promise<void> {
  const e = computeEarning(grossKurus, PLATFORM_COMMISSION_RATE_BPS);
  await db
    .insert(manufacturerEarnings)
    .values({
      orderId,
      manufacturerId,
      grossKurus: e.grossKurus,
      commissionKurus: e.commissionKurus,
      netKurus: e.netKurus,
      commissionRateBps: e.commissionRateBps,
    })
    .onConflictDoNothing({ target: manufacturerEarnings.orderId });
}

// Clawback — used when an order is refunded / a dispute is resolved against the
// manufacturer. Only un-reversed, not-yet-paid earnings are reversed. Crucially
// payout-aware: if a reversed earning was already BATCHED into a still-pending
// payout, we deduct its net from that payout's total/count and clear its
// payoutId, so the admin doesn't later transfer (and the earning isn't flipped
// back to "paid" for) money on a refunded order.
export async function reverseEarning(orderId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const toReverse = await tx
      .select({
        id: manufacturerEarnings.id,
        netKurus: manufacturerEarnings.netKurus,
        payoutId: manufacturerEarnings.payoutId,
      })
      .from(manufacturerEarnings)
      .where(
        and(
          eq(manufacturerEarnings.orderId, orderId),
          ne(manufacturerEarnings.status, "reversed"),
          ne(manufacturerEarnings.status, "paid")
        )
      );
    if (toReverse.length === 0) return;

    // Back out each earning from any still-pending payout it was batched into.
    for (const e of toReverse) {
      if (!e.payoutId) continue;
      const [p] = await tx
        .select({
          status: payouts.status,
          totalKurus: payouts.totalKurus,
          earningCount: payouts.earningCount,
        })
        .from(payouts)
        .where(eq(payouts.id, e.payoutId));
      if (p && p.status === "pending") {
        await tx
          .update(payouts)
          .set({
            totalKurus: Math.max(0, p.totalKurus - e.netKurus),
            earningCount: Math.max(0, p.earningCount - 1),
          })
          .where(eq(payouts.id, e.payoutId));
      }
    }

    await tx
      .update(manufacturerEarnings)
      .set({ status: "reversed", payoutId: null, updatedAt: new Date() })
      .where(
        and(
          eq(manufacturerEarnings.orderId, orderId),
          ne(manufacturerEarnings.status, "reversed"),
          ne(manufacturerEarnings.status, "paid")
        )
      );
  });
}

// Batch a manufacturer's not-yet-batched pending earnings into one payout.
// Returns null if nothing is owed.
export async function createPayoutForManufacturer(
  manufacturerId: string,
  adminEmail: string
): Promise<{ payoutId: string; totalKurus: number; count: number } | null> {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select({
        id: manufacturerEarnings.id,
        netKurus: manufacturerEarnings.netKurus,
      })
      .from(manufacturerEarnings)
      .where(
        and(
          eq(manufacturerEarnings.manufacturerId, manufacturerId),
          eq(manufacturerEarnings.status, "pending"),
          isNull(manufacturerEarnings.payoutId)
        )
      );
    if (pending.length === 0) return null;
    const totalKurus = pending.reduce((s, e) => s + e.netKurus, 0);
    const [payout] = await tx
      .insert(payouts)
      .values({
        manufacturerId,
        totalKurus,
        earningCount: pending.length,
        adminEmail,
        status: "pending",
      })
      .returning({ id: payouts.id });
    await tx
      .update(manufacturerEarnings)
      .set({ payoutId: payout.id, updatedAt: new Date() })
      .where(
        and(
          eq(manufacturerEarnings.manufacturerId, manufacturerId),
          eq(manufacturerEarnings.status, "pending"),
          isNull(manufacturerEarnings.payoutId)
        )
      );
    return { payoutId: payout.id, totalKurus, count: pending.length };
  });
}

// Mark a pending payout paid → its earnings flip to "paid". Idempotent.
// Returns the manufacturerId + total on success (for notification), or null if
// the payout was not found / already paid.
export async function markPayoutPaid(
  payoutId: string,
  reference: string | null
): Promise<{ manufacturerId: string; totalKurus: number } | null> {
  return db.transaction(async (tx) => {
    const [payout] = await tx
      .update(payouts)
      .set({ status: "paid", paidAt: new Date(), reference })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, "pending")))
      .returning({
        id: payouts.id,
        manufacturerId: payouts.manufacturerId,
        totalKurus: payouts.totalKurus,
      });
    if (!payout) return null;
    // Never resurrect an earning that was reversed (refund/clawback) after it
    // was batched — only flip the still-pending ones to paid.
    await tx
      .update(manufacturerEarnings)
      .set({ status: "paid", updatedAt: new Date() })
      .where(
        and(
          eq(manufacturerEarnings.payoutId, payoutId),
          ne(manufacturerEarnings.status, "reversed")
        )
      );
    return { manufacturerId: payout.manufacturerId, totalKurus: payout.totalKurus };
  });
}

// Get-or-create the customer invoice for a paid order (KDV-inclusive). Calls the
// pluggable e-invoice provider once to obtain a provider reference.
export async function getOrCreateInvoice(order: {
  id: string;
  orderNumber: string;
  amountKurus: number;
  customerName: string;
  email: string;
}) {
  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.orderId, order.id),
  });
  if (existing) return existing;

  const k = computeKdv(order.amountKurus, KDV_RATE_BPS);
  const invoiceNumber = `FAT-${order.orderNumber}`;
  let providerRef: string | null = null;
  try {
    const issued = await eInvoiceProvider.issue({
      invoiceNumber,
      totalKurus: k.totalKurus,
      subtotalKurus: k.subtotalKurus,
      kdvKurus: k.kdvKurus,
      customerName: order.customerName,
      customerEmail: order.email,
    });
    providerRef = issued.providerRef;
  } catch (err) {
    console.error("e-invoice issue failed (non-fatal)", err);
  }

  const [row] = await db
    .insert(invoices)
    .values({
      orderId: order.id,
      invoiceNumber,
      subtotalKurus: k.subtotalKurus,
      kdvKurus: k.kdvKurus,
      totalKurus: k.totalKurus,
      kdvRateBps: k.kdvRateBps,
      status: "issued",
      providerRef,
    })
    .onConflictDoNothing({ target: invoices.orderId })
    .returning();

  return row ?? db.query.invoices.findFirst({ where: eq(invoices.orderId, order.id) });
}
