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
import { createPaytrToken } from "@/lib/services/paytr";
import {
  calculateHavaleDiscount,
  HAVALE_DEADLINE_HOURS,
  HAVALE_REMINDER_HOURS,
  getBankDetails,
} from "@/lib/config/payment";
import {
  getEmailQueue,
  getPaymentDeadlineQueue,
  havaleExpireJobId,
  havaleReminderJobId,
} from "@/lib/queue/queues";
import { getClientIp } from "@/lib/utils/request";
import { users } from "@/lib/db/schema";
import { eq, and, or, isNull, count } from "drizzle-orm";
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

    const body = await request.json();
    const validated = createOrderSchema(locale).parse(body);
    const previewId: string | undefined = body.previewId;

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });
    if (!user) {
      return NextResponse.json({ error: d["api.auth.userNotFound"] }, { status: 401 });
    }

    if (previewId && typeof previewId !== "string") {
      return NextResponse.json({ error: d["api.order.createFailed"] }, { status: 400 });
    }

    const orderNumber = `FIG-${nanoid(8).toUpperCase()}`;

    if (!validated.photoKey.startsWith("photos/") || validated.photoKey.includes("..")) {
      return NextResponse.json({ error: d["api.order.createFailed"] }, { status: 400 });
    }
    const photoUrl = getPublicUrl(validated.photoKey);
    const amountKurus = PRICES_KURUS[validated.figurineSize];

    let giftCardId: string | undefined;
    if (validated.giftCardCode) {
      const gcResult = await validateGiftCard(validated.giftCardCode);
      if (!gcResult.valid) {
        const errorKey = `giftCard.error.${gcResult.error}` as keyof typeof d;
        return NextResponse.json({ error: d[errorKey] || d["common.error"] }, { status: 400 });
      }
      giftCardId = gcResult.card!.id;
    }

    // Compute everything that depends on gift-card outcome inside a single transaction.
    // Final paymentMethod / paymentStatus / bank deadline is decided here so the order
    // never sits in an inconsistent state between the transaction commit and follow-up updates.
    const deadlineCandidate = new Date(Date.now() + HAVALE_DEADLINE_HOURS * 3600 * 1000);

    const {
      order,
      fullyCovered,
      giftCardAmountKurus,
      havaleDiscountKurus,
      bankTransferDeadline,
    } = await db.transaction(async (tx) => {
      if (previewId) {
        const [preview] = await tx
          .select()
          .from(previews)
          .where(and(
            eq(previews.id, previewId),
            or(eq(previews.userId, session.userId), isNull(previews.userId))
          ))
          .for("update");

        if (!preview || (preview.status !== "ready" && preview.status !== "approved")) {
          throw new Error("INVALID_PREVIEW");
        }

        await tx
          .update(previews)
          .set({ userId: session.userId, status: "approved", updatedAt: new Date() })
          .where(eq(previews.id, previewId));
      }

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
          style: validated.style,
          modifiers: validated.modifiers.length > 0 ? validated.modifiers : null,
          shippingAddress: validated.shippingAddress,
          amountKurus,
          giftCardAmountKurus: 0,
          status: "pending_payment",
          locale,
          paymentMethod: null,
          paymentStatus: "pending",
        })
        .returning();

      await tx.insert(orderPhotos).values({
        orderId: newOrder.id,
        originalUrl: photoUrl,
      });

      let giftCardAmountKurus = 0;
      let isCovered = false;

      if (giftCardId) {
        const [card] = await tx
          .select()
          .from(giftCards)
          .where(eq(giftCards.id, giftCardId))
          .for("update");

        if (!card || card.balanceKurus <= 0) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        if (
          card.status === "expired" ||
          card.status === "fully_used" ||
          card.status === "pending_payment"
        ) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        if (card.expiresAt < new Date()) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        if (card.maxRedemptions !== null) {
          const [{ value: redemptionCount }] = await tx
            .select({ value: count() })
            .from(giftCardRedemptions)
            .where(eq(giftCardRedemptions.giftCardId, card.id));
          if (redemptionCount >= card.maxRedemptions) {
            throw new Error("LIMIT_REACHED");
          }
        }

        giftCardAmountKurus = Math.min(card.balanceKurus, amountKurus);
        isCovered = giftCardAmountKurus >= amountKurus;

        const newBalance = card.balanceKurus - giftCardAmountKurus;
        const newStatus = newBalance === 0 ? "fully_used" : "partially_used";

        await tx
          .update(giftCards)
          .set({
            balanceKurus: newBalance,
            status: newStatus as "fully_used" | "partially_used",
            updatedAt: new Date(),
          })
          .where(eq(giftCards.id, giftCardId));

        await tx.insert(giftCardRedemptions).values({
          giftCardId,
          orderId: newOrder.id,
          amountKurus: giftCardAmountKurus,
          redeemedByUserId: user.id,
        });
      }

      // Final paymentMethod + paymentStatus + havale fields, all in this transaction.
      let havaleDiscountKurus = 0;
      let bankTransferDeadline: Date | null = null;

      if (isCovered) {
        await tx
          .update(orders)
          .set({
            giftCardAmountKurus,
            paymentMethod: "gift_card_full",
            paymentStatus: "succeeded",
            updatedAt: new Date(),
          })
          .where(eq(orders.id, newOrder.id));
      } else if (validated.paymentMethod === "bank_transfer") {
        havaleDiscountKurus = calculateHavaleDiscount(amountKurus - giftCardAmountKurus);
        bankTransferDeadline = deadlineCandidate;
        await tx
          .update(orders)
          .set({
            giftCardAmountKurus,
            havaleDiscountKurus,
            paymentMethod: "bank_transfer",
            paymentStatus: "awaiting_transfer",
            bankTransferDeadline,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, newOrder.id));
      } else {
        await tx
          .update(orders)
          .set({
            giftCardAmountKurus,
            paymentMethod: "card",
            paymentStatus: "pending",
            updatedAt: new Date(),
          })
          .where(eq(orders.id, newOrder.id));
      }

      return {
        order: newOrder,
        fullyCovered: isCovered,
        giftCardAmountKurus,
        havaleDiscountKurus,
        bankTransferDeadline,
      };
    });

    // ─── Fully covered by gift card → auto-confirm ───────────────
    if (fullyCovered) {
      try {
        await confirmOrder(order.id, locale);
        return NextResponse.json({
          orderNumber,
          paymentMethod: "gift_card_full",
          autoConfirmed: true,
        });
      } catch (err) {
        console.error("Auto-confirm failed for order", orderNumber, err);
        return NextResponse.json({
          orderNumber,
          autoConfirmed: false,
          error: "Auto-confirm failed, please contact support",
        });
      }
    }

    // ─── Bank transfer (havale/EFT) ──────────────────────────────
    if (validated.paymentMethod === "bank_transfer") {
      const finalAmountKurus = amountKurus - giftCardAmountKurus - havaleDiscountKurus;
      const bank = getBankDetails();

      const paymentQueue = getPaymentDeadlineQueue();
      await paymentQueue.add(
        "havale-reminder",
        { orderId: order.id, orderNumber, type: "havale_reminder" },
        {
          jobId: havaleReminderJobId(order.id),
          delay: HAVALE_REMINDER_HOURS * 3600 * 1000,
        }
      );
      await paymentQueue.add(
        "havale-expire",
        { orderId: order.id, orderNumber, type: "havale_expire" },
        {
          jobId: havaleExpireJobId(order.id),
          delay: HAVALE_DEADLINE_HOURS * 3600 * 1000,
        }
      );

      await getEmailQueue().add("send-email", {
        type: "bank_transfer_instructions",
        to: user.email,
        orderNumber,
        customerName: user.fullName,
        bankName: bank.bankName,
        bankAccountHolder: bank.accountHolder,
        bankIban: bank.iban,
        bankBranch: bank.branch,
        paymentAmountKurus: finalAmountKurus,
        paymentDeadline: bankTransferDeadline?.toISOString(),
        locale,
      });

      return NextResponse.json({
        orderNumber,
        paymentMethod: "bank_transfer",
        bankDetails: bank,
        finalAmountKurus,
        havaleDiscountKurus,
        giftCardAmountKurus,
        deadline: bankTransferDeadline?.toISOString(),
      });
    }

    // ─── Card via PayTR ──────────────────────────────────────────
    const addr = validated.shippingAddress;
    const userIp = await getClientIp();
    const paymentAmountKurus = amountKurus - giftCardAmountKurus;
    const sizeLabel =
      d[`sizes.${validated.figurineSize}` as keyof typeof d] || validated.figurineSize;

    try {
      const paytrResult = await createPaytrToken({
        orderNumber,
        email: user.email,
        amountKurus: paymentAmountKurus,
        userName: user.fullName,
        userAddress: `${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il}`,
        userPhone: addr.telefon,
        userIp,
        basket: [
          {
            name: `Figurin (${sizeLabel})`,
            priceTRY: (paymentAmountKurus / 100).toFixed(2),
            quantity: 1,
          },
        ],
        locale,
      });

      await db
        .update(orders)
        .set({
          paytrMerchantOid: paytrResult.merchantOid,
          paytrTestMode: paytrResult.testMode,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      return NextResponse.json({
        orderNumber,
        paymentMethod: "card",
        iframeUrl: paytrResult.iframeUrl,
        paytrToken: paytrResult.token,
        finalAmountKurus: paymentAmountKurus,
      });
    } catch (err) {
      console.error("PayTR token creation failed for", orderNumber, err);
      const failureMessage = err instanceof Error ? err.message : "unknown";

      // Orphan order would block any retry; mark it rejected so the
      // customer can start a fresh checkout. Gift card stays consumed —
      // admin can refund manually if needed (separate flow).
      await db
        .update(orders)
        .set({
          status: "rejected",
          paymentStatus: "failed",
          failureReason: `PayTR token error: ${failureMessage}`,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      return NextResponse.json(
        {
          error:
            d["payment.paytr.tokenFailed"] ||
            "Ödeme başlatılamadı, lütfen tekrar deneyin.",
        },
        { status: 502 }
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      // ZodError is an Error; `errors` is on the actual instance.
      const errors = (error as Error & { errors?: unknown }).errors;
      return NextResponse.json({ error: errors ?? error.message }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : "";
    if (msg === "INVALID_PREVIEW") {
      return NextResponse.json(
        { error: d["api.order.createFailed"] },
        { status: 400 }
      );
    }
    if (msg === "INSUFFICIENT_BALANCE") {
      return NextResponse.json(
        { error: d["giftCard.error.insufficient"] },
        { status: 400 }
      );
    }
    if (msg === "LIMIT_REACHED") {
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
