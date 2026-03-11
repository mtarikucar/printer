import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/services/customer-auth";
import { db } from "@/lib/db";
import { users, orders, generationAttempts, digitalOrders, giftCards, giftCardRedemptions } from "@/lib/db/schema";
import { createDigitalOrderSchema } from "@/lib/validators/digital-order";
import { validateGiftCard } from "@/lib/services/gift-card";
import { confirmDigitalOrder } from "@/lib/services/digital-order";
import { DIGITAL_PRICE_KURUS } from "@/lib/config/prices";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: d["api.auth.required"] }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    if (!user) {
      return NextResponse.json({ error: d["api.auth.userNotFound"] }, { status: 401 });
    }

    const body = await request.json();
    const validated = createDigitalOrderSchema(locale).parse(body);

    // Verify source order belongs to user and has STL
    const order = await db.query.orders.findFirst({
      where: and(
        eq(orders.id, validated.sourceOrderId),
        eq(orders.userId, session.userId)
      ),
    });
    if (!order) {
      return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
    }

    // Check if user already purchased this as digital order
    const existingDigital = await db.query.digitalOrders.findFirst({
      where: and(
        eq(digitalOrders.sourceOrderId, validated.sourceOrderId),
        eq(digitalOrders.userId, session.userId)
      ),
    });
    if (existingDigital) {
      return NextResponse.json(
        { error: d["api.digital.alreadyPurchased"] },
        { status: 400 }
      );
    }

    // Find succeeded generation attempt with STL
    const attempt = await db.query.generationAttempts.findFirst({
      where: and(
        eq(generationAttempts.orderId, order.id),
        eq(generationAttempts.status, "succeeded")
      ),
    });
    if (!attempt?.outputStlUrl) {
      return NextResponse.json({ error: d["api.digital.noStl"] }, { status: 400 });
    }

    // Handle gift card
    let giftCardAmountKurus = 0;
    let giftCardId: string | undefined;
    let fullyCovered = false;

    if (validated.giftCardCode) {
      const gcResult = await validateGiftCard(validated.giftCardCode);
      if (!gcResult.valid) {
        const errorKey = `giftCard.error.${gcResult.error}` as keyof typeof d;
        return NextResponse.json({ error: d[errorKey] || d["common.error"] }, { status: 400 });
      }
      giftCardId = gcResult.card!.id;
      giftCardAmountKurus = Math.min(gcResult.card!.balanceKurus, DIGITAL_PRICE_KURUS);
      fullyCovered = giftCardAmountKurus >= DIGITAL_PRICE_KURUS;
    }

    // Create digital order + apply gift card atomically
    const orderNumber = `DIG-${nanoid(8).toUpperCase()}`;

    const digitalOrder = await db.transaction(async (tx) => {
      const stlUrl = new URL(attempt.outputStlUrl!);
      const stlFileKey = stlUrl.pathname.replace(/^\/api\/files\//, "");
      if (stlFileKey === stlUrl.pathname) {
        throw new Error("INVALID_STL_URL");
      }

      const [newDigitalOrder] = await tx
        .insert(digitalOrders)
        .values({
          orderNumber,
          userId: user.id,
          email: user.email,
          customerName: user.fullName,
          sourceOrderId: validated.sourceOrderId,
          generationAttemptId: attempt.id,
          amountKurus: DIGITAL_PRICE_KURUS,
          giftCardAmountKurus,
          stlFileKey,
        })
        .returning();

      // Apply gift card inside same transaction
      if (giftCardId && giftCardAmountKurus > 0) {
        const card = await tx.query.giftCards.findFirst({
          where: eq(giftCards.id, giftCardId),
        });
        if (!card || card.balanceKurus < giftCardAmountKurus) {
          throw new Error("INSUFFICIENT_BALANCE");
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
          digitalOrderId: newDigitalOrder.id,
          amountKurus: giftCardAmountKurus,
          redeemedByUserId: user.id,
        });
      }

      return newDigitalOrder;
    });

    // Auto-confirm if fully covered
    if (fullyCovered) {
      await confirmDigitalOrder(digitalOrder.id, locale);
      return NextResponse.json({
        orderNumber: digitalOrder.orderNumber,
        digitalOrderId: digitalOrder.id,
        autoConfirmed: true,
      });
    }

    // Build WhatsApp URL
    const remaining = DIGITAL_PRICE_KURUS - giftCardAmountKurus;
    const priceFormatted = `₺${(remaining / 100).toLocaleString("tr-TR")}`;
    const message = [
      `Dijital STL Siparişi`,
      `Sipariş No: ${orderNumber}`,
      `Tutar: ${priceFormatted}`,
      `Müşteri: ${user.fullName}`,
    ].join("\n");
    const phone = process.env.WHATSAPP_PHONE;
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    return NextResponse.json({
      orderNumber: digitalOrder.orderNumber,
      digitalOrderId: digitalOrder.id,
      whatsappUrl,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    if (error.message === "INVALID_STL_URL") {
      return NextResponse.json(
        { error: d["api.digital.noStl"] },
        { status: 400 }
      );
    }
    if (error.message === "INSUFFICIENT_BALANCE") {
      return NextResponse.json(
        { error: d["giftCard.error.insufficient"] },
        { status: 400 }
      );
    }
    console.error("Digital order creation failed:", error);
    return NextResponse.json(
      { error: d["api.digital.createFailed"] },
      { status: 500 }
    );
  }
}
