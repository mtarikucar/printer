import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { queryPaytrTransactionStatus } from "@/lib/services/paytr";
import { failDraft, promoteDraftToOrder } from "@/lib/services/order-draft";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { rateLimitAsync } from "@/lib/services/rate-limit";

/**
 * Out-of-band verification for a PayTR card draft. Queries PayTR for the canonical
 * status of the merchant_oid and reconciles the draft locally — used when the
 * customer returns to the track page after a PayTR redirect and the webhook hasn't
 * landed yet (or never will, e.g. running on localhost where PayTR can't reach the
 * webhook URL).
 *
 * Idempotent: if the draft is already promoted, returns the existing order.
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

  // Each verify call hits PayTR's status-query API. Without a rate limit a
  // customer (or rogue script) could burn through PayTR's per-merchant
  // quota and drive up costs. 12/min/user is plenty for legitimate polling.
  const rl = await rateLimitAsync(
    `verify-payment:${session.userId}`,
    12,
    60 * 1000
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many verification attempts. Please wait." },
      { status: 429 }
    );
  }

  const draft = await db.query.orderDrafts.findFirst({
    where: and(
      eq(orderDrafts.reference, orderNumber),
      eq(orderDrafts.userId, session.userId)
    ),
  });

  if (!draft) {
    return NextResponse.json(
      { error: d["api.order.notFound"] },
      { status: 404 }
    );
  }

  if (draft.status === "confirmed" && draft.promotedOrderId) {
    return NextResponse.json({
      state: "confirmed",
      orderNumber: draft.reference,
    });
  }

  if (draft.status === "expired" || draft.status === "cancelled") {
    return NextResponse.json({
      state: draft.status,
      reason: draft.paytrFailureReason,
    });
  }

  if (draft.paymentMethod !== "card") {
    return NextResponse.json(
      { error: d["api.verifyPayment.notCard"] },
      { status: 400 }
    );
  }

  if (!draft.paytrMerchantOid) {
    return NextResponse.json(
      { error: d["api.verifyPayment.noMerchantOid"] },
      { status: 400 }
    );
  }

  const result = await queryPaytrTransactionStatus(draft.paytrMerchantOid);

  if (result.status === "success") {
    try {
      const promoted = await promoteDraftToOrder(draft.id);
      return NextResponse.json({
        state: "confirmed",
        orderNumber: promoted.orderNumber,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "promotion_failed";
      console.error(
        `verify-payment: promotion failed for ${draft.reference}`,
        err
      );
      return NextResponse.json(
        { state: "verify_error", error: msg },
        { status: 500 }
      );
    }
  }

  if (result.status === "failed") {
    const reason =
      [result.failedReasonCode, result.failedReasonMsg]
        .filter(Boolean)
        .join(" — ") || "PayTR rejected the payment";
    await failDraft(draft.id, reason);
    return NextResponse.json({ state: "failed", reason });
  }

  if (result.status === "waiting") {
    return NextResponse.json({ state: "waiting" });
  }

  // status === "error" — transport / config issue. Don't mutate state; let the
  // caller retry. Surface a generic verify error.
  return NextResponse.json(
    {
      state: "verify_error",
      error: result.failedReasonMsg || d["api.verifyPayment.failed"],
    },
    { status: 502 }
  );
}
