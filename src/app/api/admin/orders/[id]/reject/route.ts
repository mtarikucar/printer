import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, and, sql } from "drizzle-orm";
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
import {
  REJECTABLE_STATUSES,
  formatAdminNoteLine,
} from "@/lib/config/order-status-policy";

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

  // One list for this API and the admin "Reddet" button (order-status-policy.ts).
  // They used to be separate copies and drifted: the button offered reject at
  // awaiting_model and this route refused it. Narrowed to the enum for inArray.
  const rejectable = REJECTABLE_STATUSES as readonly (typeof orders.$inferSelect)["status"][];
  const note = typeof body.notes === "string" ? body.notes.trim() : "";
  const noteLine = note ? formatAdminNoteLine(`Reddedildi: ${note}`) : null;

  // Atomic status transition
  const [order] = await db
    .update(orders)
    .set({
      status: "rejected",
      failureReason: body.reason || d["api.order.rejectedDefault"],
      // Appended, never overwritten (see order-status-policy.ts): an overwrite
      // wiped the [SLA] / decline flags other writers leave in adminNotes.
      ...(noteLine
        ? {
            adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${noteLine} ELSE ${orders.adminNotes} || E'\n' || ${noteLine} END`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, id), inArray(orders.status, [...rejectable])))
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
  //
  // `refundedNow`: only the request whose guarded flip actually moved the order
  // to refunded runs those side-effects and emails the customer.
  // REJECTABLE_STATUSES is status-only, so an already-refunded order can still
  // be rejected; that used to email "refunded" a second time. refundOrder()
  // (order-refund.ts) flips paymentStatus under the same kind of guard, so when
  // a refund races this reject exactly one of them reverses the earnings,
  // records the refund and emails the customer. The gift card was never at risk
  // of a double restore: refundGiftCardForOrder() only claims redemptions whose
  // refundedAt is still NULL, so a second call restores nothing.
  let refundedNow = false;
  if (order.paymentStatus === "succeeded") {
    const [flipped] = await db
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
      .where(and(eq(orders.id, id), eq(orders.paymentStatus, "succeeded")))
      .returning({ id: orders.id });
    refundedNow = !!flipped;
  }

  // Reject closes the order, so no partner may stay attached to it. The flip
  // above detaches as part of the refund. An order refunded BEFORE this reject
  // skips the flip and used to keep its partners: a legacy row from before
  // refunds detached, still counted as a new assignment on the manufacturer's
  // panel and kept in its list. Detach here, outside the refund branch, with no
  // refund side effect: that refund already reversed the earnings, restored the
  // gift card and emailed the customer, and must not do any of it twice. A
  // failure is logged, not thrown: the order is already rejected, and a 500
  // would read as "nothing happened".
  let partnersDetached = refundedNow;
  if (!refundedNow && (order.manufacturerId || order.painterId)) {
    const detached = await db
      .update(orders)
      .set({
        manufacturerId: null,
        manufacturerStatus: "unassigned",
        painterId: null,
        painterStatus: "unassigned",
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, id), eq(orders.status, "rejected")))
      .returning({ id: orders.id })
      .catch((e) => {
        console.error("reject: partner detach failed", e);
        return [];
      });
    partnersDetached = detached.length > 0;
  }

  if (refundedNow) {
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

    // Email customer about refund
    await getEmailQueue().add("refund", {
      type: "order_refunded",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      locale,
    });
  }

  // `order` is the row before any detach, so its manufacturerId still reaches
  // the dropped manufacturer's panel topic.
  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
    manufacturerStatus: partnersDetached ? "unassigned" : order.manufacturerStatus,
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
