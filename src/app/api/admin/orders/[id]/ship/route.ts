import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { createShipOrderSchema } from "@/lib/validators/order";
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

  try {
    const body = await request.json();
    const validated = createShipOrderSchema(locale).parse(body);

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
    });

    if (!order) {
      return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
    }

    if (order.status !== "printing") {
      return NextResponse.json(
        { error: d["api.order.notInPrinting"] },
        { status: 400 }
      );
    }

    await db
      .update(orders)
      .set({
        status: "shipped",
        trackingNumber: validated.trackingNumber,
        shippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id));

    await db.insert(adminActions).values({
      orderId: id,
      action: "ship",
      adminEmail: session.user.email,
      notes: `Tracking: ${validated.trackingNumber}`,
    });

    // Send shipping email
    await getEmailQueue().add("shipped", {
      type: "order_shipped",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      trackingNumber: validated.trackingNumber,
      locale,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("Ship order failed:", error);
    return NextResponse.json(
      { error: d["api.order.shipFailed"] },
      { status: 500 }
    );
  }
}
