import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, orderDrafts } from "@/lib/db/schema";
import { figurinePriceKurus } from "@/lib/config/prices";
import { getSessionUser } from "@/lib/services/customer-auth";
import { buildDraftReference } from "@/lib/services/order-draft";
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
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const reorderSchema = z.object({
  paymentMethod: z.enum(["card", "bank_transfer"]).default("card"),
});

const PHOTO_KEY_REGEX = /\/(photos\/[^?#]+)$/;

/**
 * Reorder = create a new draft using a confirmed order's snapshot data, then route the
 * customer through the same payment flow as a fresh checkout.
 *
 * Note: gift cards are NOT carried over from the original order. If the customer wants to
 * redeem a gift code they must use the regular `/api/orders` flow (which validates and
 * locks the code). Reordering deliberately stays a simple "buy again at full price"
 * action — otherwise we'd need to re-validate the code, handle expired/used cards, and
 * leak gift-card balance from a paid order's snapshot.
 */
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

  const body = await request.json().catch(() => ({}));
  const { paymentMethod } = reorderSchema.parse(body);

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.orderNumber, orderNumber),
      eq(orders.userId, session.userId)
    ),
    with: { photos: true },
  });

  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  const NON_REORDERABLE = ["rejected"];
  if (NON_REORDERABLE.includes(order.status)) {
    return NextResponse.json(
      { error: d["api.order.notReorderable"] },
      { status: 400 }
    );
  }

  // This route reconstructs a CUSTOM figurine draft. Marketplace orders have no
  // figurineSize/photo — to re-buy, the customer goes back to the product page.
  if (order.orderType === "marketplace" || !order.figurineSize) {
    return NextResponse.json(
      { error: d["api.order.notReorderable"] },
      { status: 400 }
    );
  }

  const reference = buildDraftReference();
  const amountKurus = figurinePriceKurus(order.figurineSize, order.material);

  const havaleDiscountKurus =
    paymentMethod === "bank_transfer" ? calculateHavaleDiscount(amountKurus) : 0;
  const bankTransferDeadline =
    paymentMethod === "bank_transfer"
      ? new Date(Date.now() + HAVALE_DEADLINE_HOURS * 3600 * 1000)
      : null;

  // We need a photoKey to seed the draft. originalUrl is `/api/files/photos/...`;
  // extract the storage key from it. If the regex doesn't match we cannot reorder
  // safely — the alternative (passing the full URL through getPublicUrl) would
  // double-prefix and produce a broken image.
  const firstPhoto = order.photos[0];
  const photoMatch = firstPhoto?.originalUrl?.match(PHOTO_KEY_REGEX);
  if (!photoMatch) {
    return NextResponse.json(
      { error: d["api.order.notReorderable"] },
      { status: 400 }
    );
  }
  const photoKey = photoMatch[1];
  // Defense-in-depth: mirror the guard in /api/orders so an unexpected URL
  // shape (future schema migration) can't slip a traversal through.
  if (!photoKey.startsWith("photos/") || photoKey.includes("..")) {
    return NextResponse.json(
      { error: d["api.order.notReorderable"] },
      { status: 400 }
    );
  }

  const paytrMerchantOid =
    paymentMethod === "card" ? buildMerchantOid(reference) : null;

  const draft = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(orderDrafts)
      .values({
        reference,
        userId: session.userId,
        email: order.email,
        customerName: order.customerName,
        phone: order.phone,
        figurineSize: order.figurineSize,
        style: order.style,
        material: order.material,
        modifiers: order.modifiers,
        shippingAddress: order.shippingAddress,
        photoKey,
        locale,
        amountKurus,
        havaleDiscountKurus,
        paymentMethod,
        status: "pending",
        paytrMerchantOid,
        bankTransferDeadline,
      })
      .returning();
    return created;
  });

  // orderPhotos rows are inserted when the draft is promoted (order-draft.ts).

  if (paymentMethod === "bank_transfer") {
    const finalAmountKurus = amountKurus - havaleDiscountKurus;
    const bank = getBankDetails();

    const queue = getPaymentDeadlineQueue();
    await queue.add(
      "havale-reminder",
      { draftId: draft.id, reference, type: "havale_reminder" },
      {
        jobId: havaleReminderJobId(draft.id),
        delay: HAVALE_REMINDER_HOURS * 3600 * 1000,
      }
    );
    await queue.add(
      "havale-expire",
      { draftId: draft.id, reference, type: "havale_expire" },
      {
        jobId: havaleExpireJobId(draft.id),
        delay: HAVALE_DEADLINE_HOURS * 3600 * 1000,
      }
    );

    await getEmailQueue().add("send-email", {
      type: "bank_transfer_instructions",
      to: order.email,
      orderNumber: reference,
      customerName: order.customerName,
      bankName: bank.bankName,
      bankAccountHolder: bank.accountHolder,
      bankIban: bank.iban,
      bankBranch: bank.branch,
      paymentAmountKurus: finalAmountKurus,
      paymentDeadline: bankTransferDeadline?.toISOString(),
      locale,
    });

    return NextResponse.json({
      reference,
      orderNumber: reference,
      paymentMethod: "bank_transfer",
      bankDetails: bank,
      finalAmountKurus,
      havaleDiscountKurus,
      deadline: bankTransferDeadline?.toISOString(),
      redirectUrl: `/havale/${reference}`,
    });
  }

  // Card flow
  const addr = order.shippingAddress;
  const userIp = await getClientIp();
  const sizeLabel = d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize;
  const materialLabel = d[`material.${order.material}` as keyof typeof d] || order.material;

  try {
    const paytrResult = await createPaytrToken({
      orderNumber: reference,
      email: order.email,
      amountKurus,
      userName: order.customerName,
      userAddress: `${addr.mahalle ? addr.mahalle + ", " : ""}${addr.adres}, ${addr.ilce}/${addr.il}`,
      userPhone: addr.telefon,
      userIp,
      basket: [
        {
          name: `Figurin (${sizeLabel} · ${materialLabel})`,
          priceTRY: (amountKurus / 100).toFixed(2),
          quantity: 1,
        },
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
      reference,
      orderNumber: reference,
      paymentMethod: "card",
      iframeUrl: paytrResult.iframeUrl,
    });
  } catch (err) {
    console.error("Reorder PayTR token failed for", reference, err);
    const failureMessage = err instanceof Error ? err.message : "unknown";
    await db
      .update(orderDrafts)
      .set({
        status: "failed",
        paytrFailureReason: `PayTR token error: ${failureMessage}`,
        updatedAt: new Date(),
      })
      .where(eq(orderDrafts.id, draft.id));

    return NextResponse.json(
      {
        error:
          d["payment.paytr.tokenFailed"] ||
          "Ödeme başlatılamadı, lütfen tekrar deneyin.",
      },
      { status: 502 }
    );
  }
}
