import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts } from "@/lib/db/schema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check if this order has a succeeded generation with STL
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.isPublic, true)),
  });

  if (!order) {
    return NextResponse.json({ available: false });
  }

  const attempt = await db.query.generationAttempts.findFirst({
    where: and(
      eq(generationAttempts.orderId, order.id),
      eq(generationAttempts.status, "succeeded")
    ),
  });

  return NextResponse.json({
    available: !!attempt?.outputStlUrl,
    orderId: order.id,
  });
}
