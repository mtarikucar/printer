import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

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

  // Atomic status transition
  const [order] = await db
    .update(orders)
    .set({ status: "delivered", adminNotes: body.notes, updatedAt: new Date() })
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

  await getEmailQueue().add("delivered", {
    type: "order_delivered",
    to: order.email,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    locale,
  });

  return NextResponse.json({ success: true });
}
