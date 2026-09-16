import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { REFUNDED_ORDER_ERROR } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Painter confirms the base print physically arrived.
 *
 * The hand-off used to be a database flag only: nobody could tell whether the
 * parcel had actually reached the painter, so a lost print surfaced days later
 * with no owner. The agreement gives the painter a defect-reporting window that
 * starts from this timestamp.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const g = await requireActivePainter();
    if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
    const { id } = await params;

    const [order] = await db
      .update(orders)
      .set({ receivedByPainterAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.painterId, g.painterId),
          // Only before painting starts, and only once.
          inArray(orders.painterStatus, ["assigned", "accepted"]),
          isNull(orders.receivedByPainterAt),
          // Refund-end-state: a refunded order still attached to this painter
          // (legacy row, or a refund racing this click) must not move forward.
          // In the UPDATE, not a pre-read, so a refund landing mid-request wins.
          notRefundedGuard()
        )
      )
      .returning({ id: orders.id });
    if (!order) {
      if (await isPartnerOrderRefunded(id, { painterId: g.painterId })) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json(
        { error: "İş bulunamadı veya teslim alındı olarak işaretlenemez" },
        { status: 400 }
      );
    }

    await db
      .insert(painterActions)
      .values({ orderId: id, painterId: g.painterId, action: "received" })
      .catch((e) => console.error("painterActions received failed", e));

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/painter/orders/[id]/received", PARTNER_ACTION_FAILED_ERROR);
  }
}
