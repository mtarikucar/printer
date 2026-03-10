import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews } from "@/lib/db/schema";
import { createOrderSchema } from "@/lib/validators/order";
import { PRICES_KURUS } from "@/lib/config/prices";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { users } from "@/lib/db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    // Require authentication
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: d["api.auth.required"] }, { status: 401 });
    }

    const body = await request.json();
    const validated = createOrderSchema(locale).parse(body);
    const previewId: string | undefined = body.previewId;

    // Get user info
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    if (!user) {
      return NextResponse.json({ error: d["api.auth.userNotFound"] }, { status: 401 });
    }

    // Validate previewId if provided
    if (previewId) {
      const preview = await db.query.previews.findFirst({
        where: and(
          eq(previews.id, previewId),
          or(
            eq(previews.userId, session.userId),
            isNull(previews.userId)
          )
        ),
      });
      if (!preview || (preview.status !== "ready" && preview.status !== "approved")) {
        return NextResponse.json(
          { error: d["api.order.createFailed"] },
          { status: 400 }
        );
      }
      // Assign anonymous preview to the current user and mark as approved
      await db
        .update(previews)
        .set({ userId: session.userId, status: "approved", updatedAt: new Date() })
        .where(eq(previews.id, previewId));
    }

    const orderNumber = `FIG-${nanoid(8).toUpperCase()}`;
    const photoUrl = getPublicUrl(validated.photoKey);
    const amountKurus = PRICES_KURUS[validated.figurineSize];

    const [order] = await db
      .insert(orders)
      .values({
        orderNumber,
        userId: user.id,
        previewId: previewId || null,
        email: user.email,
        customerName: user.fullName,
        phone: validated.shippingAddress.telefon,
        figurineSize: validated.figurineSize,
        shippingAddress: validated.shippingAddress,
        amountKurus,
        status: "pending_payment",
      })
      .returning();

    await db.insert(orderPhotos).values({
      orderId: order.id,
      originalUrl: photoUrl,
    });

    // Build WhatsApp message
    const sizeLabel = d[`sizes.${validated.figurineSize}` as keyof typeof d] || validated.figurineSize;
    const priceFormatted = `₺${(amountKurus / 100).toLocaleString("tr-TR")}`;
    const addr = validated.shippingAddress;
    const message = [
      `Siparis No: ${orderNumber}`,
      `Boyut: ${sizeLabel}`,
      `Fiyat: ${priceFormatted}`,
      `Isim: ${user.fullName}`,
      `Telefon: ${addr.telefon}`,
      `Adres: ${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il} ${addr.postaKodu}`,
    ].join("\n");

    const phone = process.env.WHATSAPP_PHONE;
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    return NextResponse.json({
      orderNumber,
      whatsappUrl,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("Order creation failed:", error);
    return NextResponse.json(
      { error: d["api.order.createFailed"] },
      { status: 500 }
    );
  }
}
