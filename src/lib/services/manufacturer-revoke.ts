import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturerActions } from "@/lib/db/schema";

/**
 * Admin takes an order back from a manufacturer.
 *
 * The gap this closes: an assigned manufacturer who never answers (neither
 * accept nor decline) used to freeze the order forever — `assign-manufacturer`
 * only matches `manufacturer_status IS NULL | 'unassigned'`, and the
 * manufacturer's own decline path is the only thing that could move it.
 *
 * This is NOT `declineOrder()` with a different caller:
 *  - declineOrder refuses anything past `assigned`,
 *  - it picks the next manufacturer itself (the admin wants to choose),
 *  - it writes action="decline", which zeroes the manufacturer's reliability
 *    score — wrong label for "did not answer", and a penalty the admin should
 *    opt into explicitly (see `strike`),
 *  - and it consumes the 3-decline auto-assignment budget.
 */
export const REVOCABLE_MFG_STATUSES = [
  "assigned",
  "accepted",
  "printing",
  "printed",
  "qc_pending",
  "qc_rejected",
  // Safe to revoke even after admin QC approval, AS LONG AS the order has not
  // yet shipped and has not been handed to a painter. No earning has accrued at
  // `qc_approved` itself — accrual happens only at ship (→ manufacturer_status
  // "shipped" + shippedAt) and send-to-painter (→ painter_status set), and the
  // `shippedAt IS NULL` + painter-unassigned guards below exclude both. So a
  // bare `qc_approved` order has no manufacturer_earnings row to strand.
  "qc_approved",
] as const;

export type RevokeResult =
  | {
      code: "ok";
      prevManufacturerId: string;
      prevStatus: string;
      orderNumber: string;
      userId: string;
      orderType: string;
      orderStatus: string;
    }
  | { code: "not_found" }
  | { code: "not_assigned" }
  | { code: "wrong_status"; status: string }
  | { code: "handed_to_painter" }
  | { code: "already_shipped" }
  | { code: "lost_race" };

/**
 * Money boundary: `accrueEarning` is only ever called from the ship and
 * send-to-painter routes. `manufacturer_earnings.order_id` is UNIQUE and
 * `accrueEarning` uses onConflictDoNothing, so revoking after an earning row
 * exists would silently pay a re-assigned manufacturer ₺0. The two accrual
 * points each move the order out of a revocable state: ship sets
 * `manufacturer_status = "shipped"` + `shippedAt`, and send-to-painter sets
 * `painter_status`. The `shippedAt IS NULL` + painter-unassigned guards below
 * therefore keep this function strictly before any accrual — `qc_approved` on
 * its own (pre-ship, pre-painter) is safe and revocable; ship / hand-off is not.
 */
export async function revokeManufacturerAssignment(args: {
  orderId: string;
  adminEmail: string;
  reason: string;
  /** Stop the ranker handing the order straight back. Default true. */
  blocklist?: boolean;
}): Promise<RevokeResult> {
  const { orderId, adminEmail, reason } = args;
  const blocklist = args.blocklist !== false;

  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");

    if (!order) return { code: "not_found" as const };
    if (
      !order.manufacturerId ||
      !order.manufacturerStatus ||
      order.manufacturerStatus === "unassigned"
    ) {
      return { code: "not_assigned" as const };
    }
    if (order.shippedAt != null) return { code: "already_shipped" as const };
    if (order.painterStatus != null && order.painterStatus !== "unassigned") {
      return { code: "handed_to_painter" as const };
    }
    if (
      !(REVOCABLE_MFG_STATUSES as readonly string[]).includes(
        order.manufacturerStatus
      )
    ) {
      return { code: "wrong_status" as const, status: order.manufacturerStatus };
    }

    // Read the previous manufacturer BEFORE the update — .returning() gives the
    // post-update row, where manufacturerId is already null.
    const prevManufacturerId = order.manufacturerId;
    const prevStatus = order.manufacturerStatus;

    // The order must land back in a state the assign endpoint accepts
    // (status "approved", or "paid" for marketplace orders).
    const restoredStatus =
      order.orderType === "marketplace" && order.sellerManufacturerId
        ? "paid"
        : "approved";
    const needsStatusReset = ["printing", "quality_check"].includes(order.status);

    const declined = Array.isArray(order.declinedManufacturerIds)
      ? (order.declinedManufacturerIds as string[])
      : [];

    const note = `[GERİ ALMA] Admin ${adminEmail} atamayı geri aldı (önceki durum: ${prevStatus}). Sebep: ${reason}`;

    const [updated] = await tx
      .update(orders)
      .set({
        manufacturerId: null,
        manufacturerStatus: "unassigned",
        assignedToManufacturerAt: null,
        manufacturerAcceptedAt: null,
        // Left behind, this would pollute the next manufacturer's on-time score.
        manufacturerPrintedAt: null,
        ...(needsStatusReset
          ? { status: restoredStatus as typeof order.status }
          : {}),
        ...(blocklist
          ? {
              declinedManufacturerIds: Array.from(
                new Set([...declined, prevManufacturerId])
              ),
            }
          : {}),
        // Bump the QC round so the previous manufacturer's photos are not shown
        // to the new one. The rows stay for the audit trail.
        qcRound: sql`${orders.qcRound} + 1`,
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                        THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, orderId),
          // Concurrency lock: if the manufacturer accepted (or another admin
          // revoked) between the SELECT and here, this matches 0 rows.
          eq(orders.manufacturerId, prevManufacturerId),
          inArray(orders.manufacturerStatus, [...REVOCABLE_MFG_STATUSES]),
          or(
            isNull(orders.painterStatus),
            eq(orders.painterStatus, "unassigned")
          ),
          isNull(orders.shippedAt)
        )
      )
      .returning();

    if (!updated) return { code: "lost_race" as const };

    await tx.insert(manufacturerActions).values({
      orderId,
      manufacturerId: prevManufacturerId,
      // free-text column — no migration needed. Deliberately NOT "decline":
      // that string is in the ranker's "bad" bucket.
      action: "admin_revoked",
      notes: `[Admin geri aldı] ${reason}`.slice(0, 500),
    });

    return {
      code: "ok" as const,
      prevManufacturerId,
      prevStatus,
      orderNumber: order.orderNumber,
      userId: order.userId,
      orderType: order.orderType,
      orderStatus: needsStatusReset ? restoredStatus : order.status,
    };
  });
}
