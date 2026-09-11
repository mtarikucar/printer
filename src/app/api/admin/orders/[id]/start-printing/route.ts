import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";
import {
  REFUNDED_ORDER_ERROR,
  formatAdminNoteLine,
} from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";

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
  const note = typeof body.notes === "string" ? body.notes.trim() : "";
  const noteLine = note ? formatAdminNoteLine(`Baskı başlatıldı: ${note}`) : null;

  // Atomic status transition. notRefundedGuard(): a refund detaches the
  // manufacturer, so a refunded order that was assigned looks exactly like an
  // admin-fulfilled one here — printing it would produce goods whose money
  // already went back (refund-end-state).
  const [order] = await db
    .update(orders)
    .set({
      status: "printing",
      // Appended, never overwritten (see order-status-policy.ts): an overwrite
      // wiped the [SLA] / decline flags other writers leave in adminNotes.
      // Joined in SQL so a flag written concurrently is not lost.
      ...(noteLine
        ? {
            adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${noteLine} ELSE ${orders.adminNotes} || E'\n' || ${noteLine} END`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.status, "approved"),
        isNull(orders.manufacturerId),
        notRefundedGuard()
      )
    )
    .returning();

  if (!order) {
    // Name the refund when it is the reason; the generic 400 would send the
    // admin hunting for a status problem that is not there.
    if (await isOrderRefunded(id)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Order is not in approved status or is managed by a manufacturer" },
      { status: 400 }
    );
  }

  await db.insert(adminActions).values({
    orderId: id,
    action: "print",
    adminEmail: session.user.email,
    notes: body.notes,
  });

  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
  });

  await getEmailQueue().add("printing", {
    type: "order_printing",
    to: order.email,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    locale,
  });

  return NextResponse.json({ success: true });
}
