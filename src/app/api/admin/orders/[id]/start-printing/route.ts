import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
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

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: d["api.auth.unauthorized"] }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  // Atomic status transition
  const [order] = await db
    .update(orders)
    .set({ status: "printing", adminNotes: body.notes, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.status, "approved"), isNull(orders.manufacturerId)))
    .returning();

  if (!order) {
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

  await getEmailQueue().add("printing", {
    type: "order_printing",
    to: order.email,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    locale,
  });

  return NextResponse.json({ success: true });
}
