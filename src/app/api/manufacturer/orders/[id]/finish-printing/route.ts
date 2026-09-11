import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify manufacturer is active
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });

  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json(
      { error: "Your account is not active" },
      { status: 403 }
    );
  }

  const { id } = await params;

  // Atomic status transition: printing -> printed
  const [order] = await db
    .update(orders)
    .set({
      manufacturerStatus: "printed",
      manufacturerPrintedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.manufacturerId, session.manufacturerId),
        eq(orders.manufacturerStatus, "printing"),
        // Refund-end-state: a refunded order still attached to this partner
        // (legacy row, or a refund racing this click) must not move forward.
        // In the UPDATE, not a pre-read, so a refund landing mid-request wins.
        notRefundedGuard()
      )
    )
    .returning();

  if (!order) {
    if (await isPartnerOrderRefunded(id, { manufacturerId: session.manufacturerId })) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Order not found or not in printing status" },
      { status: 400 }
    );
  }

  await db.insert(manufacturerActions).values({
    orderId: id,
    manufacturerId: session.manufacturerId,
    action: "finish_printing",
  });

  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
    manufacturerStatus: order.manufacturerStatus,
  });

  return NextResponse.json({ success: true });
}
