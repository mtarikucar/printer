import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  orderDrafts,
  previews,
  giftCards,
  giftCardRedemptions,
  users,
} from "@/lib/db/schema";
import { createOrderSchema } from "@/lib/validators/order";
import {
  PRICES_KURUS,
  UPSELL_PRICES_KURUS,
  calculateUpsellAmount,
} from "@/lib/config/prices";
import { getSessionUser } from "@/lib/services/customer-auth";
import { validateGiftCard } from "@/lib/services/gift-card";
import {
  buildDraftReference,
  promoteDraftToOrder,
} from "@/lib/services/order-draft";
import { createPaytrToken, buildMerchantOid } from "@/lib/services/paytr";
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

    if (!validated.photoKey.startsWith("photos/") || validated.photoKey.includes("..")) {
      return NextResponse.json({ error: d["api.order.createFailed"] }, { status: 400 });
    }

    const reference = buildDraftReference();
    // Dedupe upsells here so the DB row, gift-card math, and PayTR basket
    // all see the same canonical list (server-trusted, not client-trusted).
    const upsellKeys = Array.from(new Set(validated.upsells));
    const upsellAmountKurus = calculateUpsellAmount(upsellKeys);
    const amountKurus = PRICES_KURUS[validated.figurineSize] + upsellAmountKurus;

    let giftCardId: string | undefined;
    if (validated.giftCardCode) {
      const gcResult = await validateGiftCard(validated.giftCardCode);
      if (!gcResult.valid) {
        const errorKey = `giftCard.error.${gcResult.error}` as keyof typeof d;
        return NextResponse.json({ error: d[errorKey] || d["common.error"] }, { status: 400 });
      }
      giftCardId = gcResult.card!.id;
    }

    // Reserve gift-card balance and create the draft atomically. The order row only
    // appears after payment is verified (PayTR webhook / OCR auto-confirm / admin).
    const deadlineCandidate = new Date(Date.now() + HAVALE_DEADLINE_HOURS * 3600 * 1000);

    const {
      draft,
      fullyCovered,
      giftCardAmountKurus,
      havaleDiscountKurus,
      bankTransferDeadline,
    } = await db.transaction(async (tx) => {
      if (previewId) {
        const [preview] = await tx
          .select()
          .from(previews)
          .where(
            and(
              eq(previews.id, previewId),
              or(eq(previews.userId, session.userId), isNull(previews.userId))
            )
          )
          .for("update");

        if (!preview || (preview.status !== "ready" && preview.status !== "approved")) {
          throw new Error("INVALID_PREVIEW");
        }

        await tx
          .update(previews)
          .set({ userId: session.userId, status: "approved", updatedAt: new Date() })
          .where(eq(previews.id, previewId));
      }

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
      }

      const finalPaymentMethod: "card" | "bank_transfer" | "gift_card_full" = isCovered
        ? "gift_card_full"
        : validated.paymentMethod === "bank_transfer"
        ? "bank_transfer"
        : "card";

      let havaleDiscountKurus = 0;
      let bankTransferDeadline: Date | null = null;
      let paytrMerchantOid: string | null = null;

      if (!isCovered && finalPaymentMethod === "bank_transfer") {
        havaleDiscountKurus = calculateHavaleDiscount(amountKurus - giftCardAmountKurus);
        bankTransferDeadline = deadlineCandidate;
      }
      if (!isCovered && finalPaymentMethod === "card") {
        paytrMerchantOid = buildMerchantOid(reference);
      }

      const [newDraft] = await tx
        .insert(orderDrafts)
        .values({
          reference,
          userId: user.id,
          previewId: previewId || null,
          email: user.email,
          customerName: user.fullName,
          phone: validated.shippingAddress.telefon,
          figurineSize: validated.figurineSize,
          style: validated.style,
          modifiers: validated.modifiers.length > 0 ? validated.modifiers : null,
          shippingAddress: validated.shippingAddress,
          photoKey: validated.photoKey,
          locale,
          amountKurus,
          giftCardId: giftCardId || null,
          giftCardAmountKurus,
          havaleDiscountKurus,
          upsells: upsellKeys.length > 0 ? upsellKeys : null,
          upsellAmountKurus,
          paymentMethod: finalPaymentMethod,
          status: "pending",
          paytrMerchantOid,
          bankTransferDeadline,
        })
        .returning();

      if (giftCardId && giftCardAmountKurus > 0) {
        await tx.insert(giftCardRedemptions).values({
          giftCardId,
          draftId: newDraft.id,
          amountKurus: giftCardAmountKurus,
          redeemedByUserId: user.id,
        });
      }

      return {
        draft: newDraft,
        fullyCovered: isCovered,
        giftCardAmountKurus,
        havaleDiscountKurus,
        bankTransferDeadline,
      };
    });

    // ─── Fully covered by gift card → promote immediately ────────
    if (fullyCovered) {
      try {
        const promoted = await promoteDraftToOrder(draft.id);
        return NextResponse.json({
          reference: draft.reference,
          orderNumber: promoted.orderNumber,
          paymentMethod: "gift_card_full",
          autoConfirmed: true,
        });
      } catch (err) {
        console.error("Auto-promote failed for draft", draft.reference, err);
        return NextResponse.json({
          reference: draft.reference,
          autoConfirmed: false,
          error: "Auto-confirm failed, please contact support",
        });
      }
    }

    // ─── Bank transfer (havale/EFT) ──────────────────────────────
    if (draft.paymentMethod === "bank_transfer") {
      const finalAmountKurus = amountKurus - giftCardAmountKurus - havaleDiscountKurus;
      const bank = getBankDetails();

      const paymentQueue = getPaymentDeadlineQueue();
      await paymentQueue.add(
        "havale-reminder",
        { draftId: draft.id, reference: draft.reference, type: "havale_reminder" },
        {
          jobId: havaleReminderJobId(draft.id),
          delay: HAVALE_REMINDER_HOURS * 3600 * 1000,
        }
      );
      await paymentQueue.add(
        "havale-expire",
        { draftId: draft.id, reference: draft.reference, type: "havale_expire" },
        {
          jobId: havaleExpireJobId(draft.id),
          delay: HAVALE_DEADLINE_HOURS * 3600 * 1000,
        }
      );

      await getEmailQueue().add("send-email", {
        type: "bank_transfer_instructions",
        to: user.email,
        orderNumber: draft.reference,
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
        reference: draft.reference,
        paymentMethod: "bank_transfer",
        bankDetails: bank,
        finalAmountKurus,
        havaleDiscountKurus,
        giftCardAmountKurus,
        deadline: bankTransferDeadline?.toISOString(),
        redirectUrl: `/havale/${draft.reference}`,
      });
    }

    // ─── Card via PayTR ──────────────────────────────────────────
    const addr = validated.shippingAddress;
    const userIp = await getClientIp();
    const paymentAmountKurus = amountKurus - giftCardAmountKurus;
    const sizeLabel =
      d[`sizes.${validated.figurineSize}` as keyof typeof d] || validated.figurineSize;

    // PayTR basket entries — the figurine itself plus one row per upsell so
    // the customer's PayTR statement (and our refund-flow logs) show what
    // was actually paid for. The first row covers the figurine net of the
    // upsell total to keep the basket sum equal to paymentAmountKurus.
    const figurineRowKurus = paymentAmountKurus - upsellAmountKurus;
    const upsellBasketRows = upsellKeys.map((key) => ({
      name:
        d[`upsell.${key}.label` as keyof typeof d] || key,
      priceTRY: (UPSELL_PRICES_KURUS[key] / 100).toFixed(2),
      quantity: 1,
    }));

    try {
      const paytrResult = await createPaytrToken({
        orderNumber: draft.reference,
        email: user.email,
        amountKurus: paymentAmountKurus,
        userName: user.fullName,
        userAddress: `${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il}`,
        userPhone: addr.telefon,
        userIp,
        basket: [
          {
            name: `Figurin (${sizeLabel})`,
            priceTRY: (figurineRowKurus / 100).toFixed(2),
            quantity: 1,
          },
          ...upsellBasketRows,
        ],
        locale,
      });

      await db
        .update(orderDrafts)
        .set({
          paytrMerchantOid: paytrResult.merchantOid,
          paytrTestMode: paytrResult.testMode,
          updatedAt: new Date(),
        })
        .where(eq(orderDrafts.id, draft.id));

      return NextResponse.json({
        reference: draft.reference,
        paymentMethod: "card",
        iframeUrl: paytrResult.iframeUrl,
        paytrToken: paytrResult.token,
        finalAmountKurus: paymentAmountKurus,
      });
    } catch (err) {
      console.error("PayTR token creation failed for", draft.reference, err);
      const failureMessage = err instanceof Error ? err.message : "unknown";

      // Keep the draft in `pending` (not `failed`) so the customer can retry
      // via /api/customer/orders/[orderNumber]/retry-payment. The failure
      // reason is recorded for diagnostics.
      await db
        .update(orderDrafts)
        .set({
          paytrFailureReason: `PayTR token error: ${failureMessage}`,
          updatedAt: new Date(),
        })
        .where(eq(orderDrafts.id, draft.id));

      return NextResponse.json(
        {
          error:
            d["payment.paytr.tokenFailed"] ||
            "Ödeme başlatılamadı, lütfen tekrar deneyin.",
          reference: draft.reference,
          retryable: true,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      const errors = (error as Error & { errors?: unknown }).errors;
      // Return the structured Zod issues array; never fall back to
      // `error.message`, which can leak internal validation details.
      return NextResponse.json(
        { error: errors ?? d["api.order.createFailed"] },
        { status: 400 }
      );
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
