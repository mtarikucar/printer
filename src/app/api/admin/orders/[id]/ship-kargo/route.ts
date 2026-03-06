import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { createShipment } from "@/lib/services/yurtici-kargo";
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
    return NextResponse.json(
      { error: d["api.auth.unauthorized"] },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
    });

    if (!order) {
      return NextResponse.json(
        { error: d["api.order.notFound"] },
        { status: 404 }
      );
    }

    if (order.status !== "printing") {
      return NextResponse.json(
        { error: d["api.order.notInPrinting"] },
        { status: 400 }
      );
    }

    const addr = order.shippingAddress as TurkishAddress;

    const result = await createShipment({
      cargoKey: order.orderNumber,
      receiverName: order.customerName,
      receiverAddress: addr.mahalle ? `${addr.mahalle} ${addr.adres}` : addr.adres,
      receiverPhone: addr.telefon,
      receiverCity: addr.il,
      receiverDistrict: addr.ilce,
      receiverPostalCode: addr.postaKodu,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: d["api.kargo.createFailed"], detail: result.errorMessage },
        { status: 502 }
      );
    }

    await db
      .update(orders)
      .set({
        status: "shipped",
        trackingNumber: order.orderNumber,
        shippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id));

    await db.insert(adminActions).values({
      orderId: id,
      action: "ship",
      adminEmail: session.user.email,
      notes: `Yurtici Kargo — key: ${order.orderNumber}`,
    });

    await getEmailQueue().add("shipped", {
      type: "order_shipped",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      trackingNumber: order.orderNumber,
      locale,
    });

    return NextResponse.json({ success: true, cargoKey: order.orderNumber });
  } catch (error) {
    console.error("Yurtici Kargo ship failed:", error);
    return NextResponse.json(
      { error: d["api.kargo.shipFailed"] },
      { status: 500 }
    );
  }
}
