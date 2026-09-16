import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, disputes } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { handleRouteFailure, CUSTOMER_ACTION_FAILED_ERROR, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

const schema = z.object({
  category: z.enum(["not_as_described", "damaged", "not_received", "other"]),
  description: z.string().trim().min(5).max(2000),
});

async function handleGET(
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

async function handlePOST(
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

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ orderNumber: string }> }) {
  try {
    return await handleGET(request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/customer/orders/[orderNumber]/dispute", CUSTOMER_READ_FAILED_ERROR);
  }
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePOST` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ orderNumber: string }> }) {
  try {
    return await handlePOST(request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/customer/orders/[orderNumber]/dispute", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
