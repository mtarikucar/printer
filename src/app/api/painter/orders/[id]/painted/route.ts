import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { REFUNDED_ORDER_ERROR } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";

// Painter marks the figurine painted: painterStatus accepted|painting → painted.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;

  const [order] = await db
    .update(orders)
    .set({ painterStatus: "painted", paintedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.painterId, g.painterId),
        inArray(orders.painterStatus, ["accepted", "painting"]),
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
      { error: "İş bulunamadı veya bu durumda işaretlenemez" },
      { status: 400 }
    );
  }

  await db
    .insert(painterActions)
    .values({ orderId: id, painterId: g.painterId, action: "painted" })
    .catch((e) => console.error("painterActions painted failed", e));

  return NextResponse.json({ success: true });
}
