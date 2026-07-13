import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { reverseEarning } from "@/lib/services/payouts";
import { reversePainterEarning } from "@/lib/services/painter-payouts";
import { refundGiftCardForOrder } from "@/lib/services/order-draft";
import { recordRefund } from "@/lib/analytics/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const a = await requireAdmin();


  if ("response" in a) return a.response;


  const session = { user: { email: a.session.user.email } };

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const rejectableStatuses = ["review", "approved", "failed_generation", "failed_mesh", "generating", "processing_mesh", "paid"] as const;

  // Atomic status transition
  const [order] = await db
    .update(orders)
    .set({
      status: "rejected",
      failureReason: body.reason || d["api.order.rejectedDefault"],
      adminNotes: body.notes,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, id), inArray(orders.status, [...rejectableStatuses])))
    .returning();

  if (!order) {
    return NextResponse.json(
      { error: d["api.order.invalidStatusForReject"] },
      { status: 400 }
    );
  }

  await db.insert(adminActions).values({
    orderId: id,
    action: "reject",
    adminEmail: session.user.email,
    notes: body.notes,
  });

  // Rejecting a PAID order (rejectableStatuses includes "paid") is a refund: the
  // customer is emailed "refunded" below, so the money side-effects MUST actually
  // run, exactly as the dedicated refund route does — otherwise the gift-card
  // credit is lost, partner earnings stay payable, paymentStatus stays succeeded,
  // and reported revenue is never backed out. Skip for a never-paid order.
  if (order.paymentStatus === "succeeded") {
    await db
      .update(orders)
      .set({
        paymentStatus: "refunded",
        // Halt fulfillment: detach partners so a rejected order can't be shipped
        // for a fresh earning.
        manufacturerId: null,
        manufacturerStatus: "unassigned",
        painterId: null,
        painterStatus: "unassigned",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id));
    await reverseEarning(id).catch((e) =>
      console.error("reverseEarning (reject) failed", e)
    );
    await reversePainterEarning(id).catch((e) =>
      console.error("reversePainterEarning (reject) failed", e)
    );
    await refundGiftCardForOrder(id).catch((e) =>
      console.error("refundGiftCardForOrder (reject) failed", e)
    );
    // Gross basis to match the purchase event (see refund route) so a full
    // refund nets reported revenue to zero.
    void recordRefund({
      orderNumber: order.orderNumber,
      valueKurus: order.amountKurus,
      userId: order.userId,
      productId: order.productId,
      attribution: order.attribution,
    }).catch(() => {});
  }

  // Email customer about refund
  await getEmailQueue().add("refund", {
    type: "order_refunded",
    to: order.email,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    locale,
  });

  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
  });

  // If the order was assigned to a manufacturer, tell them it's cancelled
  // (inbox + email + realtime) so an offline manufacturer doesn't keep working.
  if (order.manufacturerId) {
    await notifyManufacturer({
      manufacturerId: order.manufacturerId,
      type: "order_cancelled",
      subject: `Sipariş ${order.orderNumber} iptal edildi`,
      body: order.failureReason || "Sipariş yönetici tarafından iptal edildi.",
      orderId: id,
    }).catch((e) => console.error("notifyManufacturer (reject) failed", e));
  }

  return NextResponse.json({ success: true });
}
