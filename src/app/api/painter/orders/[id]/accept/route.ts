import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { REFUNDED_ORDER_ERROR } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// Painter accepts an assigned painting job: painterStatus assigned → accepted.
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
      .set({ painterStatus: "accepted", updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.painterId, g.painterId),
          eq(orders.painterStatus, "assigned"),
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
        { error: "İş bulunamadı veya kabul edilebilir durumda değil" },
        { status: 400 }
      );
    }

    await db
      .insert(painterActions)
      .values({ orderId: id, painterId: g.painterId, action: "accept" })
      .catch((e) => console.error("painterActions accept failed", e));

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/painter/orders/[id]/accept", PARTNER_ACTION_FAILED_ERROR);
  }
}
