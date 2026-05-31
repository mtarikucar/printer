import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { createShipOrderSchema } from "@/lib/validators/order";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";

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

  try {
    const body = await request.json();
    const validated = createShipOrderSchema(locale).parse(body);

    // Atomic status transition
    const [order] = await db
      .update(orders)
      .set({
        status: "shipped",
        trackingNumber: validated.trackingNumber,
        shippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, id), eq(orders.status, "printing"), isNull(orders.manufacturerId)))
      .returning();

    if (!order) {
      return NextResponse.json(
        { error: "Order is not in printing status or is managed by a manufacturer" },
        { status: 400 }
      );
    }

    await db.insert(adminActions).values({
      orderId: id,
      action: "ship",
      adminEmail: session.user.email,
      notes: `Tracking: ${validated.trackingNumber}`,
    });

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: order.status,
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
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: (error as Error & { errors?: unknown }).errors }, { status: 400 });
    }
    console.error("Ship order failed:", error);
    return NextResponse.json(
      { error: d["api.order.shipFailed"] },
      { status: 500 }
    );
  }
}
