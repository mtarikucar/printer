import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, disputes, orderRefundRecords, orderRefundAllocations } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { openDispute } from "@/lib/services/dispute-resolution";
import { DisputePolicyError, normalizeOpenDisputeInput } from "@/lib/config/dispute-resolution";
import { handleRouteFailure, CUSTOMER_ACTION_FAILED_ERROR, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

type Context = { params: Promise<{ orderNumber: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const session = await getSessionUser();
    if (!session) return NextResponse.json({ error: "Devam etmek için giriş yapın." }, { status: 401 });
    const { orderNumber } = await params;
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.orderNumber, orderNumber), eq(orders.userId, session.userId)),
      columns: { id: true, status: true },
    });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });

    const [dispute, open] = await Promise.all([
      db.query.disputes.findFirst({
        where: and(eq(disputes.orderId, order.id), eq(disputes.userId, session.userId)),
        orderBy: [desc(disputes.createdAt), desc(disputes.id)],
        columns: { category: true, description: true, status: true, resolution: true,
          createdAt: true, resolvedAt: true, refundRecordId: true, decisionOperationKey: true },
      }),
      // Legacy duplicates are retained: an older open complaint still blocks a
      // new opening even when the latest customer-visible complaint is closed.
      db.query.disputes.findFirst({
        where: and(eq(disputes.orderId, order.id), eq(disputes.status, "open")),
        columns: { id: true },
      }),
    ]);
    let refund: { cashKurus: number; giftKurus: number } | null = null;
    if (dispute?.status === "resolved" && dispute.refundRecordId && dispute.decisionOperationKey) {
      const record = await db.query.orderRefundRecords.findFirst({
        where: and(eq(orderRefundRecords.id, dispute.refundRecordId),
          eq(orderRefundRecords.operationKey, dispute.decisionOperationKey), eq(orderRefundRecords.kind, "refund")),
        columns: { id: true },
      });
      if (record) {
        const allocation = await db.query.orderRefundAllocations.findFirst({
          where: and(eq(orderRefundAllocations.refundId, record.id),
            eq(orderRefundAllocations.orderId, order.id), eq(orderRefundAllocations.kind, "refund")),
          columns: { cashKurus: true, giftKurus: true },
        });
        if (allocation) refund = { cashKurus: allocation.cashKurus, giftKurus: allocation.giftKurus };
      }
    }
    return NextResponse.json({
      canOpen: ["shipped", "delivered"].includes(order.status) && !open,
      dispute: dispute ? {
        category: dispute.category, description: dispute.description, status: dispute.status,
        resolution: dispute.resolution, createdAt: dispute.createdAt.toISOString(),
        resolvedAt: dispute.resolvedAt?.toISOString() ?? null, refund,
      } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleRouteFailure(error, "GET /api/customer/orders/[orderNumber]/dispute", CUSTOMER_READ_FAILED_ERROR);
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const session = await getSessionUser();
    if (!session) return NextResponse.json({ error: "Devam etmek için giriş yapın." }, { status: 401 });
    const { orderNumber } = await params;
    const input = normalizeOpenDisputeInput(await request.json().catch(() => null));
    // The service locks the owned order and handles shipped/delivered policy,
    // matching retries, insertion and durable notices in one transaction.
    const result = await openDispute(orderNumber, session.userId, input);
    return NextResponse.json(result, { status: result.ok ? 200 : result.status });
  } catch (error) {
    if (error instanceof DisputePolicyError) {
      return NextResponse.json({ error: `Anlaşmazlık açılamadı: ${error.message}`, code: error.code }, { status: error.status });
    }
    return handleRouteFailure(error, "POST /api/customer/orders/[orderNumber]/dispute", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
