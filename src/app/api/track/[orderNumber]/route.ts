import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts } from "@/lib/db/schema";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const { orderNumber } = await params;

  const order = await db.query.orders.findFirst({
    where: eq(orders.orderNumber, orderNumber),
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputGlbUrl: true },
        orderBy: [desc(generationAttempts.createdAt)],
        limit: 1,
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    trackingNumber: order.trackingNumber,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    createdAt: order.createdAt,
    isPublic: order.isPublic,
    publicDisplayName: order.publicDisplayName,
    glbUrl: order.generationAttempts[0]?.outputGlbUrl ?? null,
  });
}
