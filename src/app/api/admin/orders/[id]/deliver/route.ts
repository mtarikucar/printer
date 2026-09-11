import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";

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
  const noteLine = note ? formatAdminNoteLine(`Teslim edildi: ${note}`) : null;

  // Atomic status transition
  const [order] = await db
    .update(orders)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      // Appended, never overwritten (see order-status-policy.ts): an overwrite
      // wiped the [SLA] / decline flags other writers leave in adminNotes.
      ...(noteLine
        ? {
            adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${noteLine} ELSE ${orders.adminNotes} || E'\n' || ${noteLine} END`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, id), eq(orders.status, "shipped")))
    .returning();

  if (!order) {
    return NextResponse.json(
      { error: d["api.order.notShipped"] },
      { status: 400 }
    );
  }

  await db.insert(adminActions).values({
    orderId: id,
    action: "deliver",
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

  await getEmailQueue().add("delivered", {
    type: "order_delivered",
    to: order.email,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    locale,
  });

  // Faz 4: in-app notification
  await notifyCustomer({
    userId: order.userId,
    orderId: order.id,
    type: "order_delivered",
    title: "Siparişiniz teslim edildi",
    body: `${order.orderNumber} numaralı siparişiniz teslim edildi.`,
  });

  return NextResponse.json({ success: true });
}
