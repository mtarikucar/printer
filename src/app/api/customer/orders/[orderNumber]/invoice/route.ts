import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getOrCreateInvoice } from "@/lib/services/payouts";
import { handleRouteFailure, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

// Customer fetches (lazily creating) the KDV invoice for their paid order.
async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orderNumber } = await params;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.orderNumber, orderNumber), eq(orders.userId, session.userId)),
    columns: {
      id: true,
      orderNumber: true,
      amountKurus: true,
      customerName: true,
      email: true,
      status: true,
      paymentStatus: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Only paid orders get an invoice.
  if (order.paymentStatus !== "succeeded") {
    return NextResponse.json({ error: "Invoice not available yet" }, { status: 400 });
  }

  const invoice = await getOrCreateInvoice(order);
  if (!invoice) {
    return NextResponse.json({ error: "Fatura şu anda oluşturulamadı. Birkaç dakika sonra tekrar deneyin; sorun sürerse bizimle iletişime geçin." }, { status: 500 });
  }
  return NextResponse.json({
    invoiceNumber: invoice.invoiceNumber,
    subtotalKurus: invoice.subtotalKurus,
    kdvKurus: invoice.kdvKurus,
    totalKurus: invoice.totalKurus,
    kdvRateBps: invoice.kdvRateBps,
    issuedAt: invoice.createdAt,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
  });
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
    return handleRouteFailure(e, "GET /api/customer/orders/[orderNumber]/invoice", CUSTOMER_READ_FAILED_ERROR);
  }
}
