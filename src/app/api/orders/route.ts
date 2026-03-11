import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews, giftCards, giftCardRedemptions } from "@/lib/db/schema";
import { createOrderSchema } from "@/lib/validators/order";
import { PRICES_KURUS } from "@/lib/config/prices";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
import { validateGiftCard } from "@/lib/services/gift-card";
import { confirmOrder } from "@/lib/services/order-confirm";
import { users } from "@/lib/db/schema";
import { eq, and, or, isNull, count } from "drizzle-orm";
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

    // Validate gift card if provided (quick check before transaction)
    let giftCardId: string | undefined;
    let giftCardAmountKurus = 0;
    let fullyCovered = false;

    if (validated.giftCardCode) {
      const gcResult = await validateGiftCard(validated.giftCardCode);
      if (!gcResult.valid) {
        const errorKey = `giftCard.error.${gcResult.error}` as keyof typeof d;
        return NextResponse.json({ error: d[errorKey] || d["common.error"] }, { status: 400 });
      }
      giftCardId = gcResult.card!.id;
      giftCardAmountKurus = Math.min(gcResult.card!.balanceKurus, amountKurus);
      fullyCovered = giftCardAmountKurus >= amountKurus;
    }

    // Create order + apply gift card atomically
    const order = await db.transaction(async (tx) => {
      const [newOrder] = await tx
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
          giftCardAmountKurus: 0,
          status: "pending_payment",
        })
        .returning();

      await tx.insert(orderPhotos).values({
        orderId: newOrder.id,
        originalUrl: photoUrl,
      });

      // Apply gift card inside same transaction (row lock prevents race condition)
      if (giftCardId && giftCardAmountKurus > 0) {
        const [card] = await tx
          .select()
          .from(giftCards)
          .where(eq(giftCards.id, giftCardId))
          .for('update');
        if (!card || card.balanceKurus < giftCardAmountKurus) {
          throw new Error("INSUFFICIENT_BALANCE");
        }

        // Check redemption limit
        if (card.maxRedemptions !== null) {
          const [{ value: redemptionCount }] = await tx
            .select({ value: count() })
            .from(giftCardRedemptions)
            .where(eq(giftCardRedemptions.giftCardId, card.id));
          if (redemptionCount >= card.maxRedemptions) {
            throw new Error("LIMIT_REACHED");
          }
        }

        const newBalance = card.balanceKurus - giftCardAmountKurus;
        const newStatus = newBalance === 0 ? "fully_used" : "partially_used";

        await tx.update(giftCards).set({
          balanceKurus: newBalance,
          status: newStatus as "fully_used" | "partially_used",
          updatedAt: new Date(),
        }).where(eq(giftCards.id, giftCardId));

        await tx.insert(giftCardRedemptions).values({
          giftCardId,
          orderId: newOrder.id,
          amountKurus: giftCardAmountKurus,
          redeemedByUserId: user.id,
        });

        await tx.update(orders).set({
          giftCardAmountKurus: giftCardAmountKurus,
          updatedAt: new Date(),
        }).where(eq(orders.id, newOrder.id));
      }

      return newOrder;
    });

    // If fully covered by gift card, auto-confirm
    if (fullyCovered) {
      try {
        await confirmOrder(order.id, locale);
      } catch (err) {
        console.error("Auto-confirm failed for order", orderNumber, err);
      }
      return NextResponse.json({ orderNumber, autoConfirmed: true });
    }

    // Build WhatsApp message with remaining amount
    const sizeLabel = d[`sizes.${validated.figurineSize}` as keyof typeof d] || validated.figurineSize;
    const remainingKurus = amountKurus - giftCardAmountKurus;
    const priceFormatted = `₺${(remainingKurus / 100).toLocaleString("tr-TR")}`;
    const addr = validated.shippingAddress;
    const messageParts = [
      `Sipariş No: ${orderNumber}`,
      `Boyut: ${sizeLabel}`,
      `Fiyat: ${priceFormatted}`,
    ];
    if (giftCardAmountKurus > 0) {
      messageParts.push(`Hediye Kartı: -₺${(giftCardAmountKurus / 100).toLocaleString("tr-TR")}`);
    }
    messageParts.push(
      `Isim: ${user.fullName}`,
      `Telefon: ${addr.telefon}`,
      `Adres: ${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il} ${addr.postaKodu}`
    );

    const phone = process.env.WHATSAPP_PHONE;
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(messageParts.join("\n"))}`;

    return NextResponse.json({
      orderNumber,
      whatsappUrl,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    if (error.message === "INSUFFICIENT_BALANCE") {
      return NextResponse.json(
        { error: d["giftCard.error.insufficient"] },
        { status: 400 }
      );
    }
    if (error.message === "LIMIT_REACHED") {
      return NextResponse.json(
        { error: d["giftCard.error.limit_reached"] },
        { status: 400 }
      );
    }
    console.error("Order creation failed:", error);
    return NextResponse.json(
      { error: d["api.order.createFailed"] },
      { status: 500 }
    );
  }
}
