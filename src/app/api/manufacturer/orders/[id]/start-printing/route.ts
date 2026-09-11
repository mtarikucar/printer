import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getEmailQueue } from "@/lib/queue/queues";
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

  // Atomic status transition: accepted -> printing
  const [order] = await db
    .update(orders)
    .set({
      manufacturerStatus: "printing",
      status: "printing",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.manufacturerId, session.manufacturerId),
        eq(orders.manufacturerStatus, "accepted"),
        // Refund-end-state: no printing (and no "printing" mail to a customer
        // who got their money back) on a refunded order still attached here.
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
      { error: "Order not found or not in accepted status" },
      { status: 400 }
    );
  }

  await db.insert(manufacturerActions).values({
    orderId: id,
    manufacturerId: session.manufacturerId,
    action: "start_printing",
  });

  // Notify customer — non-fatal: the status transition is already committed, so
  // a queue/Redis blip must not surface as a 500 that makes the manufacturer
  // retry against a guard that no longer matches.
  await getEmailQueue()
    .add("printing", {
      type: "order_printing",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
    })
    .catch((e) => console.error("printing email enqueue failed", e));

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
