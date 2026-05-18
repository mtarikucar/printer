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
 * landed yet.
 *
 * Idempotent: if the draft is already promoted, returns the existing order.
 *
 * Security:
 *   - Origin/Referer same-origin check (defense vs. CSRF — sameSite=lax alone
 *     doesn't block hidden-form POSTs which classify as simple requests).
 *   - Per-user 12/min rate limit + per-orderNumber 6/min rate limit. The
 *     second bucket prevents a flood against a single draft even from the
 *     legitimate owner (e.g. XSS / repeated nav).
 *   - `failedReasonMsg` from PayTR is logged server-side but NOT echoed in
 *     responses — if PayTR ever included unexpected content in that field
 *     we don't want it landing in customer browsers / Sentry.
 *
 * Observability: every entry + outcome branch emits a `[verify-payment]`
 * single-line log. orderNumber is sanitized for safe log-line interpolation.
 */

// Strip CR/LF/tab and clamp length — protects against log-line forgery via
// crafted URL paths. orderNumber comes from the path and DB lookup happens
// later, so the early-entry log could otherwise be polluted.
function safeForLog(s: string): string {
  return s.replace(/[\r\n\t]/g, "_").slice(0, 64);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { orderNumber } = await params;
  const safeOid = safeForLog(orderNumber);

  // CSRF: same-origin check mirrors the receipt upload route. The session
  // cookie is sameSite=lax which blocks XHR cross-site but NOT a form POST
  // from an attacker site (form posts are "simple" requests).
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const expectedHost = request.headers.get("host");
  const isSameOrigin = (() => {
    if (origin) {
      try {
        return new URL(origin).host === expectedHost;
      } catch {
        return false;
      }
    }
    if (referer) {
      try {
        return new URL(referer).host === expectedHost;
      } catch {
        return false;
      }
    }
    return false;
  })();
  if (!isSameOrigin) {
    console.warn(`[verify-payment] outcome orderNumber=${safeOid} action=csrf_blocked`);
    return NextResponse.json(
      { error: d["api.receipt.crossOrigin"] },
      { status: 403 }
    );
  }

  const session = await getSessionUser();
  console.log(
    `[verify-payment] enter orderNumber=${safeOid} userId=${session?.userId ?? "unauth"}`
  );
  if (!session) {
    console.log(`[verify-payment] outcome orderNumber=${safeOid} action=unauth`);
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  // Two-tier rate limit. Per-user (12/min) caps overall abuse; per-orderNumber
  // (6/min) protects PayTR's per-merchantOid quota even from one logged-in
  // user spamming a single draft (e.g. multiple tabs, XSS).
  const rlUser = await rateLimitAsync(
    `verify-payment:user:${session.userId}`,
    12,
    60 * 1000
  );
  if (!rlUser.success) {
    console.log(`[verify-payment] outcome orderNumber=${safeOid} action=rate_limited scope=user`);
    return NextResponse.json(
      { error: "Too many verification attempts. Please wait." },
      { status: 429 }
    );
  }
  const rlOid = await rateLimitAsync(
    `verify-payment:oid:${orderNumber}`,
    6,
    60 * 1000
  );
  if (!rlOid.success) {
    console.log(`[verify-payment] outcome orderNumber=${safeOid} action=rate_limited scope=oid`);
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
    console.log(`[verify-payment] outcome orderNumber=${safeOid} action=not_found`);
    return NextResponse.json(
      { error: d["api.order.notFound"] },
      { status: 404 }
    );
  }

  if (draft.status === "confirmed" && draft.promotedOrderId) {
    console.log(`[verify-payment] outcome orderNumber=${safeOid} action=already_confirmed`);
    return NextResponse.json({
      state: "confirmed",
      orderNumber: draft.reference,
    });
  }

  if (draft.status === "expired" || draft.status === "cancelled") {
    console.log(
      `[verify-payment] outcome orderNumber=${safeOid} action=draft_${draft.status}`
    );
    return NextResponse.json({
      state: draft.status,
      reason: draft.paytrFailureReason,
    });
  }

  if (draft.paymentMethod !== "card") {
    console.log(`[verify-payment] outcome orderNumber=${safeOid} action=not_card_payment`);
    return NextResponse.json(
      { error: d["api.verifyPayment.notCard"] },
      { status: 400 }
    );
  }

  if (!draft.paytrMerchantOid) {
    console.log(`[verify-payment] outcome orderNumber=${safeOid} action=no_merchant_oid`);
    return NextResponse.json(
      { error: d["api.verifyPayment.noMerchantOid"] },
      { status: 400 }
    );
  }

  const result = await queryPaytrTransactionStatus(draft.paytrMerchantOid);
  console.log(
    `[verify-payment] paytr orderNumber=${safeOid} merchantOid=${draft.paytrMerchantOid} ` +
      `paytrStatus=${result.status} failedReasonCode=${result.failedReasonCode ?? "-"}`
  );

  if (result.status === "success") {
    try {
      const promoted = await promoteDraftToOrder(draft.id);
      console.log(
        `[verify-payment] outcome orderNumber=${safeOid} action=promoted orderId=${promoted.orderId}`
      );
      return NextResponse.json({
        state: "confirmed",
        orderNumber: promoted.orderNumber,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "promotion_failed";
      console.error(
        `[verify-payment] outcome orderNumber=${safeOid} action=promotion_error reason=${safeForLog(msg)}`,
        err
      );
      // Don't echo internal error message to client — generic state only.
      return NextResponse.json(
        { state: "verify_error" },
        { status: 500 }
      );
    }
  }

  if (result.status === "failed") {
    // Internal reason: full PayTR detail for the admin/ops audit trail.
    const internalReason =
      [result.failedReasonCode, result.failedReasonMsg]
        .filter(Boolean)
        .join(" — ") || "PayTR rejected the payment";
    await failDraft(draft.id, internalReason);
    console.log(
      `[verify-payment] outcome orderNumber=${safeOid} action=failed reason=${safeForLog(internalReason)}`
    );
    // Client response: only the well-controlled reason code, NEVER the raw
    // failedReasonMsg (third-party input we don't fully trust to be PII-free).
    return NextResponse.json({
      state: "failed",
      code: result.failedReasonCode ?? null,
    });
  }

  if (result.status === "waiting") {
    console.log(
      `[verify-payment] outcome orderNumber=${safeOid} action=waiting`
    );
    return NextResponse.json({ state: "waiting" });
  }

  // status === "error" — transport / config issue. Don't mutate state.
  console.log(
    `[verify-payment] outcome orderNumber=${safeOid} action=verify_error reason=${safeForLog(result.failedReasonMsg ?? "unknown")}`
  );
  return NextResponse.json(
    {
      state: "verify_error",
      error: d["api.verifyPayment.failed"],
    },
    { status: 502 }
  );
}
