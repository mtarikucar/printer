import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { reverseEarning } from "@/lib/services/payouts";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { getEmailQueue } from "@/lib/queue/queues";

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
      updatedAt: new Date(),
    })
    .where(eq(orders.id, id));

  await reverseEarning(id).catch((e) => console.error("reverseEarning failed", e));

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

  return NextResponse.json({ ok: true });
}
