import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, disputes } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";

const schema = z.object({
  category: z.enum(["not_as_described", "damaged", "not_received", "other"]),
  description: z.string().trim().min(5).max(2000),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orderNumber } = await params;
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.orderNumber, orderNumber), eq(orders.userId, session.userId)),
    columns: { id: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const dispute = await db.query.disputes.findFirst({
    where: eq(disputes.orderId, order.id),
    orderBy: [desc(disputes.createdAt)],
  });
  return NextResponse.json({
    canOpen: ["shipped", "delivered"].includes(order.status),
    dispute: dispute
      ? {
          category: dispute.category,
          description: dispute.description,
          status: dispute.status,
          resolution: dispute.resolution,
          createdAt: dispute.createdAt.toISOString(),
        }
      : null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orderNumber } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid dispute" }, { status: 400 });
  }

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.orderNumber, orderNumber), eq(orders.userId, session.userId)),
    columns: { id: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!["shipped", "delivered"].includes(order.status)) {
    return NextResponse.json(
      { error: "Disputes can be opened only after the order ships" },
      { status: 400 }
    );
  }

  const open = await db.query.disputes.findFirst({
    where: and(eq(disputes.orderId, order.id), eq(disputes.status, "open")),
  });
  if (open) {
    return NextResponse.json({ error: "A dispute is already open" }, { status: 400 });
  }

  await db.insert(disputes).values({
    orderId: order.id,
    userId: session.userId,
    category: parsed.data.category,
    description: parsed.data.description,
  });
  return NextResponse.json({ success: true });
}
