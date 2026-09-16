import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { markChannelRead } from "@/lib/services/order-chat";
import { handleRouteFailure, CUSTOMER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orderNumber } = await params;
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.orderNumber, orderNumber), eq(orders.userId, session.userId)),
    columns: { id: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  await markChannelRead(order.id, "customer_admin", "counterparty");
  return NextResponse.json({ success: true });
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
    return handleRouteFailure(e, "POST /api/customer/orders/[orderNumber]/messages/read", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
