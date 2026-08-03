import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  manufacturerActions,
  painterActions,
  manufacturerEarnings,
} from "@/lib/db/schema";
import { reverseEarning, accrueEarning } from "@/lib/services/payouts";

/**
 * Admin pulls a painting order all the way back from the painter to the
 * manufacturer-assignment queue.
 *
 * The gap this closes: once an order is handed to a painter, `revoke-manufacturer`
 * refuses it (`handed_to_painter`) because the manufacturer's print-portion
 * earning has already accrued at send-to-painter. There was no admin path to
 * unwind a bad hand-off short of a full refund.
 *
 * What it does, in one shot: detaches the painter AND the manufacturer and
 * resets the order to the assignment stage (`approved`, or `paid` for a
 * marketplace/seller order).
 *
 * MONEY SAFETY — why this is NOT just painter-decline with a bigger blast
 * radius. painter-decline keeps the SAME manufacturer, so leaving a settled
 * earning row is harmless. Here we DETACH the manufacturer and re-queue for a
 * DIFFERENT one, and `manufacturer_earnings.order_id` is UNIQUE with
 * `accrueEarning` using onConflictDoNothing — so ANY surviving earning row
 * (even one already 'paid') would silently make the next manufacturer's accrual
 * a no-op and pay them ₺0. Therefore we reverse the earning FIRST and only
 * detach once we have PROVEN zero earning rows remain for the order:
 *  - a 'pending'/batched row reverses + deletes cleanly -> proceed;
 *  - a 'paid' (settled) row cannot be clawed back -> we refuse (`earning_settled`)
 *    and leave the order untouched so the admin uses the refund/dispute flow;
 *  - a reversal failure aborts before any detach (`reverse_failed`), order intact.
 * If the atomic detach then loses a race (painter shipped meanwhile) after we
 * already reversed, we re-accrue so the manufacturer is not underpaid.
 */
export const PAINTER_REVOCABLE_STATUSES = [
  "assigned",
  "accepted",
  "painting",
  "painted",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
] as const;

export type RevokeAfterPainterResult =
  | {
      code: "ok";
      prevManufacturerId: string | null;
      prevPainterId: string;
      prevManufacturerStatus: string | null;
      prevPainterStatus: string;
      orderNumber: string;
      userId: string;
      orderStatus: string;
    }
  | { code: "not_found" }
  | { code: "not_handed_to_painter" }
  | { code: "already_shipped" }
  | { code: "wrong_status"; status: string }
  | { code: "earning_settled" }
  | { code: "reverse_failed" }
  | { code: "lost_race" };

export async function revokeAfterPainterHandoff(args: {
  orderId: string;
  adminEmail: string;
  reason: string;
  /** Keep the ranker from handing the order back to the same manufacturer. */
  blocklistManufacturer?: boolean;
  /** Add the painter to the order's painter blocklist. Default off. */
  blocklistPainter?: boolean;
}): Promise<RevokeAfterPainterResult> {
  const { orderId, adminEmail, reason } = args;
  const blocklistManufacturer = args.blocklistManufacturer !== false;
  const blocklistPainter = args.blocklistPainter === true;

  // Read + validate first (the atomic UPDATE below carries the concurrency
  // guard, mirroring painter-decline; we deliberately avoid an outer
  // transaction so reverseEarning's own transaction does not nest).
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });
  if (!order) return { code: "not_found" as const };
  if (order.shippedAt != null) return { code: "already_shipped" as const };
  if (
    !order.painterId ||
    !order.painterStatus ||
    order.painterStatus === "unassigned"
  ) {
    return { code: "not_handed_to_painter" as const };
  }
  if (order.painterStatus === "shipped") {
    // Belt-and-suspenders: painter-ship sets shippedAt too, so the guard above
    // already caught this — but never revoke a shipped-by-painter order.
    return { code: "already_shipped" as const };
  }
  if (
    !(PAINTER_REVOCABLE_STATUSES as readonly string[]).includes(
      order.painterStatus
    )
  ) {
    return { code: "wrong_status" as const, status: order.painterStatus };
  }

  const prevManufacturerId = order.manufacturerId;
  const prevPainterId = order.painterId;
  const prevManufacturerStatus = order.manufacturerStatus;
  const prevPainterStatus = order.painterStatus;
  const printBaseKurus = Math.max(
    0,
    order.amountKurus - order.paintingPriceKurus
  );

  // ── Money reconciliation BEFORE the detach ──────────────────────────────
  // Reverse the manufacturer's print-portion earning (accrued at send-to-painter)
  // and delete the reversed row so a future manufacturer can re-accrue. Do this
  // first so a failure aborts with the order UNTOUCHED (never a detached order
  // sitting over a stranded earning that would zero-pay the next manufacturer).
  try {
    await reverseEarning(orderId);
    await db
      .delete(manufacturerEarnings)
      .where(
        and(
          eq(manufacturerEarnings.orderId, orderId),
          eq(manufacturerEarnings.status, "reversed")
        )
      );
  } catch (e) {
    console.error("revoke-after-painter: earning reversal failed", e);
    return { code: "reverse_failed" as const };
  }

  // INVARIANT: after the reversal, NO manufacturer_earnings row may remain for
  // this order — the UNIQUE(order_id) constraint + onConflictDoNothing means any
  // survivor (a settled 'paid' row reverseEarning can't claw back) would block
  // the next manufacturer's accrual. If one survives, refuse and leave the order
  // intact; nothing was mutated (reverse/delete are no-ops on a 'paid' row).
  const surviving = await db
    .select({ id: manufacturerEarnings.id })
    .from(manufacturerEarnings)
    .where(eq(manufacturerEarnings.orderId, orderId))
    .limit(1);
  if (surviving.length > 0) {
    return { code: "earning_settled" as const };
  }

  const restoredStatus =
    order.orderType === "marketplace" && order.sellerManufacturerId
      ? "paid"
      : "approved";

  const declinedMfg = Array.isArray(order.declinedManufacturerIds)
    ? (order.declinedManufacturerIds as string[])
    : [];
  const declinedPainter = Array.isArray(order.declinedPainterIds)
    ? (order.declinedPainterIds as string[])
    : [];

  const note = `[BOYACIDAN GERİ ALMA] Admin ${adminEmail} siparişi boyacıdan geri aldı (üretici: ${prevManufacturerStatus ?? "-"}, boyacı: ${prevPainterStatus}). Sebep: ${reason}`;

  const [updated] = await db
    .update(orders)
    .set({
      // Detach the manufacturer.
      manufacturerId: null,
      manufacturerStatus: "unassigned",
      assignedToManufacturerAt: null,
      manufacturerAcceptedAt: null,
      manufacturerPrintedAt: null,
      // Detach the painter and wipe every hand-off breadcrumb so the next
      // hand-off starts clean.
      painterId: null,
      painterStatus: "unassigned",
      assignedToPainterAt: null,
      sentToPainterAt: null,
      receivedByPainterAt: null,
      paintedAt: null,
      painterHandoffCarrier: null,
      painterHandoffTrackingNumber: null,
      // Back to the assignment stage.
      status: restoredStatus as typeof order.status,
      // Bump both QC rounds so neither partner's photos leak to the next ones.
      qcRound: sql`${orders.qcRound} + 1`,
      painterQcRound: sql`${orders.painterQcRound} + 1`,
      ...(blocklistManufacturer && prevManufacturerId
        ? {
            declinedManufacturerIds: Array.from(
              new Set([...declinedMfg, prevManufacturerId])
            ),
          }
        : {}),
      ...(blocklistPainter
        ? {
            declinedPainterIds: Array.from(
              new Set([...declinedPainter, prevPainterId])
            ),
          }
        : {}),
      adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                      THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, orderId),
        // Concurrency lock: if the painter shipped / declined or another admin
        // acted between the read and here, this matches 0 rows.
        eq(orders.painterId, prevPainterId),
        inArray(orders.painterStatus, [...PAINTER_REVOCABLE_STATUSES]),
        isNull(orders.shippedAt)
      )
    )
    .returning();

  if (!updated) {
    // We already reversed the earning but lost the detach race (painter shipped
    // or another admin acted). Restore the print earning so the manufacturer is
    // not left unpaid for an order that progressed instead of coming back.
    if (prevManufacturerId) {
      await accrueEarning(orderId, prevManufacturerId, printBaseKurus).catch(
        (e) =>
          console.error(
            "revoke-after-painter: re-accrue after lost race failed",
            e
          )
      );
    }
    return { code: "lost_race" as const };
  }

  // Audit trail on both partner ledgers. Deliberately "admin_revoked" (not
  // "decline") so the ranker's reliability scoring is untouched.
  if (prevManufacturerId) {
    await db
      .insert(manufacturerActions)
      .values({
        orderId,
        manufacturerId: prevManufacturerId,
        action: "admin_revoked",
        notes: `[Admin boyacıdan geri aldı] ${reason}`.slice(0, 500),
      })
      .catch((e) =>
        console.error("revoke-after-painter: manufacturerActions insert failed", e)
      );
  }
  await db
    .insert(painterActions)
    .values({
      orderId,
      painterId: prevPainterId,
      action: "admin_revoked",
      notes: `[Admin boyacıdan geri aldı] ${reason}`.slice(0, 500),
    })
    .catch((e) =>
      console.error("revoke-after-painter: painterActions insert failed", e)
    );

  return {
    code: "ok" as const,
    prevManufacturerId,
    prevPainterId,
    prevManufacturerStatus,
    prevPainterStatus,
    orderNumber: order.orderNumber,
    userId: order.userId,
    orderStatus: restoredStatus,
  };
}
