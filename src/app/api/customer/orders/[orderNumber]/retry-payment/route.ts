import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { createPaytrToken, queryPaytrTransactionStatus } from "@/lib/services/paytr";
import { promoteDraftToOrder } from "@/lib/services/order-draft";
import { getClientIp } from "@/lib/utils/request";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Retry a failed card payment on an existing draft (the customer pressed "try again"
 * on the track page). Only operates on drafts in `pending` status with paymentMethod=card.
 * The request body is currently ignored — card is the only supported retry path; if we
 * ever allow switching methods on retry, parse + validate the body here.
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

  const draft = await db.query.orderDrafts.findFirst({
    where: and(
      eq(orderDrafts.reference, orderNumber),
      eq(orderDrafts.userId, session.userId)
    ),
  });

  if (!draft) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }

  if (draft.status !== "pending") {
    return NextResponse.json(
      { error: "Order is not in a retryable state" },
      { status: 400 }
    );
  }
  if (draft.paymentMethod !== "card") {
    return NextResponse.json(
      { error: "Only card payments can be retried" },
      { status: 400 }
    );
  }

  // Before minting ANOTHER PayTR charge, ask PayTR the canonical fate of the
  // prior attempt's oid (still on the draft — retry hasn't overwritten it yet).
  // Without this, a first attempt that actually SUCCEEDED but whose webhook was
  // lost/delayed would be orphaned (we overwrite its oid, so the late webhook
  // can't map back) and the customer could be charged a second time.
  if (draft.paytrMerchantOid) {
    const sq = await queryPaytrTransactionStatus(draft.paytrMerchantOid);
    if (sq.status === "success") {
      // The earlier payment went through — reconcile (idempotent) instead of
      // re-charging, and tell the client the order is already paid.
      await promoteDraftToOrder(draft.id).catch((e) =>
        console.error("retry-payment reconcile promote failed", draft.reference, e)
      );
      return NextResponse.json({ reference: draft.reference, alreadyPaid: true });
    }
    if (sq.status === "waiting" || sq.status === "error") {
      // waiting: an authorized attempt is still in flight — a retry would
      // double-charge. error: we could not verify, so fail safe rather than risk
      // a duplicate charge. Either way ask the customer to try again shortly.
      return NextResponse.json(
        {
          error:
            "Önceki ödemeniz kontrol ediliyor, lütfen birazdan tekrar deneyin.",
        },
        { status: 409 }
      );
    }
    // sq.status === "failed" → the prior attempt truly failed; safe to retry.
  }

  const addr = draft.shippingAddress;
  const userIp = await getClientIp();
  const paymentAmountKurus = draft.amountKurus - draft.giftCardAmountKurus;
  const sizeLabel = d[`sizes.${draft.figurineSize}` as keyof typeof d] || draft.figurineSize;

  // PayTR rejects duplicate merchant_oids — once they've issued any token (even
  // for a transaction that didn't complete) the same oid can't be re-used.
  // Append a millisecond-precision suffix so each retry uses a fresh value.
  const retrySuffix = `R${Date.now().toString(36)}`;

  try {
    const paytrResult = await createPaytrToken({
      orderNumber: draft.reference,
      email: draft.email,
      amountKurus: paymentAmountKurus,
      userName: draft.customerName,
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
      locale: draft.locale,
      merchantOidSuffix: retrySuffix,
    });

    await db
      .update(orderDrafts)
      .set({
        paytrMerchantOid: paytrResult.merchantOid,
        paytrTestMode: paytrResult.testMode,
        // Don't blank the prior failure reason — admin recon and the webhook
        // audit trail both rely on seeing failure history across retries.
        updatedAt: new Date(),
      })
      .where(eq(orderDrafts.id, draft.id));

    return NextResponse.json({
      reference: draft.reference,
      iframeUrl: paytrResult.iframeUrl,
      finalAmountKurus: paymentAmountKurus,
    });
  } catch (err) {
    console.error("Retry PayTR token failed for", draft.reference, err);
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
