import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { confirmOrder } from "@/lib/services/order-confirm";
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

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
  });

  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  if (order.status !== "pending_payment") {
    return NextResponse.json(
      { error: "Order is not in pending_payment status" },
      { status: 400 }
    );
  }

  await confirmOrder(id, locale);

  await db.insert(adminActions).values({
    orderId: id,
    action: "confirm",
    adminEmail: session.user.email,
    notes: body.notes,
  });

  return NextResponse.json({ success: true });
}
