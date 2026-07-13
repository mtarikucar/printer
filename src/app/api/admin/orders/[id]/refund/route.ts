import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { reverseEarning } from "@/lib/services/payouts";
import { reversePainterEarning } from "@/lib/services/painter-payouts";
import { refundGiftCardForOrder } from "@/lib/services/order-draft";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { getEmailQueue } from "@/lib/queue/queues";
import { recordRefund } from "@/lib/analytics/server";

// Faz 7: mark an order refunded. Flips paymentStatus, reverses any manufacturer
// earning, records the admin action, and notifies the customer (in-app + email).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      id: true,
      userId: true,
      orderNumber: true,
      email: true,
      customerName: true,
      paymentStatus: true,
      status: true,
      manufacturerId: true,
      locale: true,
      amountKurus: true,
      giftCardAmountKurus: true,
      havaleDiscountKurus: true,
      productId: true,
      attribution: true,
    },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (order.paymentStatus === "refunded") {
    return NextResponse.json({ error: "already_refunded" }, { status: 400 });
  }

  await db
    .update(orders)
    .set({
      paymentStatus: "refunded",
      adminNotes: reason ?? undefined,
      // Halt fulfillment: detach the partners so a refunded order can no longer
      // be shipped for a fresh earning. The manufacturer/painter ship routes gate
      // on manufacturerId/painterId matching the session, so clearing them (and
      // resetting the sub-statuses) removes the order from every partner queue and
      // makes any further ship attempt a no-op. reverseEarning below backs out
      // anything already accrued; detaching stops it re-accruing.
      manufacturerId: null,
      manufacturerStatus: "unassigned",
      painterId: null,
      painterStatus: "unassigned",
      updatedAt: new Date(),
    })
    .where(eq(orders.id, id));

  await reverseEarning(id).catch((e) => console.error("reverseEarning failed", e));
  // Also claw back the painter's earning for a refunded painting order.
  await reversePainterEarning(id).catch((e) =>
    console.error("reversePainterEarning failed", e)
  );
  // Restore any gift-card credit the order consumed — the spent balance must go
  // back on the card when the order is refunded (idempotent; no-op if none).
  await refundGiftCardForOrder(id).catch((e) =>
    console.error("refundGiftCardForOrder failed", e)
  );

  await db.insert(adminActions).values({
    orderId: id,
    action: "refund",
    adminEmail: a.session.user.email,
    notes: reason,
  });

  if (order.userId) {
    await notifyCustomer({
      userId: order.userId,
      orderId: id,
      type: "order_refunded",
      title: "Siparişin iade edildi",
      body: `${order.orderNumber} numaralı siparişin için iade işlendi.`,
    });
  }
  await getEmailQueue()
    .add("send-email", {
      type: "order_refunded",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      locale: order.locale === "en" ? "en" : "tr",
    })
    .catch((e) => console.error("refund email enqueue failed", e));

  await emitOrderChanged({
    orderId: id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
  });

  // Server-side refund conversion (keeps GA4 revenue/ROAS honest). Fire-and-forget.
  void recordRefund({
    orderNumber: order.orderNumber,
    valueKurus:
      order.amountKurus - order.giftCardAmountKurus - order.havaleDiscountKurus,
    userId: order.userId,
    productId: order.productId,
    attribution: order.attribution,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
