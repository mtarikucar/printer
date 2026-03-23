import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos } from "@/lib/db/schema";
import { PRICES_KURUS } from "@/lib/config/prices";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { orderNumber } = await params;

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.orderNumber, orderNumber),
      eq(orders.userId, session.userId)
    ),
    with: {
      photos: true,
    },
  });

  if (!order) {
    return NextResponse.json(
      { error: d["api.order.notFound"] },
      { status: 404 }
    );
  }

  const NON_REORDERABLE = ["pending_payment", "rejected"];
  if (NON_REORDERABLE.includes(order.status)) {
    return NextResponse.json(
      { error: d["api.order.notReorderable"] },
      { status: 400 }
    );
  }

  const newOrderNumber = `FIG-${nanoid(8).toUpperCase()}`;
  const amountKurus = PRICES_KURUS[order.figurineSize];

  const newOrder = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(orders)
      .values({
        orderNumber: newOrderNumber,
        userId: session.userId,
        email: order.email,
        customerName: order.customerName,
        phone: order.phone,
        figurineSize: order.figurineSize,
        style: order.style,
        modifiers: order.modifiers,
        shippingAddress: order.shippingAddress,
        amountKurus,
        status: "pending_payment",
      })
      .returning();

    if (order.photos.length > 0) {
      await tx.insert(orderPhotos).values({
        orderId: created.id,
        originalUrl: order.photos[0].originalUrl,
      });
    }

    return created;
  });

  const sizeLabel = d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize;
  const priceFormatted = `\u20BA${(amountKurus / 100).toLocaleString("tr-TR")}`;
  const addr = order.shippingAddress;
  const messageParts = [
    `Sipari\u015F No: ${newOrderNumber}`,
    `Boyut: ${sizeLabel}`,
    `Fiyat: ${priceFormatted}`,
    `Isim: ${order.customerName}`,
    `Telefon: ${addr.telefon}`,
    `Adres: ${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il} ${addr.postaKodu}`,
  ];

  const phone = process.env.WHATSAPP_PHONE;
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(messageParts.join("\n"))}`;

  return NextResponse.json({ orderNumber: newOrderNumber, whatsappUrl });
}
