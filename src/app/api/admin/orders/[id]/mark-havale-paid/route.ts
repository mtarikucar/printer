import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { confirmOrder } from "@/lib/services/order-confirm";
import {
  getPaymentDeadlineQueue,
  havaleExpireJobId,
  havaleReminderJobId,
} from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: d["api.auth.unauthorized"] }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const order = await db.query.orders.findFirst({ where: eq(orders.id, id) });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.paymentMethod !== "bank_transfer") {
    return NextResponse.json(
      { error: "Order is not a bank transfer order" },
      { status: 400 }
    );
  }

  if (order.paymentStatus === "succeeded") {
    return NextResponse.json({ success: true, alreadyPaid: true });
  }

  if (order.status !== "pending_payment") {
    return NextResponse.json(
      { error: "Order is no longer in pending_payment status" },
      { status: 400 }
    );
  }

  try {
    await confirmOrder(id, locale);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not in pending_payment")) {
      return NextResponse.json(
        { error: "Order is not in pending_payment status" },
        { status: 400 }
      );
    }
    throw err;
  }

  await db
    .update(orders)
    .set({ paymentStatus: "succeeded", updatedAt: new Date() })
    .where(eq(orders.id, id));

  await db.insert(adminActions).values({
    orderId: id,
    action: "mark_havale_paid",
    adminEmail: session.user.email,
    notes: body.notes,
  });

  // Cancel scheduled deadline jobs.
  const q = getPaymentDeadlineQueue();
  await q.remove(havaleReminderJobId(id)).catch(() => {});
  await q.remove(havaleExpireJobId(id)).catch(() => {});

  return NextResponse.json({ success: true });
}
