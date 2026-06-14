import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import {
  queryPaytrTransactionStatus,
  verifyPaytrCallback,
} from "@/lib/services/paytr";
import { findDraftByPaytrMerchantOid, promoteDraftToOrder } from "@/lib/services/order-draft";

export const runtime = "nodejs";

function okResponse() {
  // PayTR expects the literal "OK" in the response body to consider the webhook acked.
  return new Response("OK", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    console.error("[paytr.webhook] invalid form body", err);
    return new Response("PAYTR bad request", { status: 400 });
  }

  const merchantOid = String(form.get("merchant_oid") ?? "");
  const status = String(form.get("status") ?? "");
  const totalAmount = String(form.get("total_amount") ?? "");
  const hash = String(form.get("hash") ?? "");
  const failedReasonCode = form.get("failed_reason_code")?.toString() ?? null;
  const failedReasonMsg = form.get("failed_reason_msg")?.toString() ?? null;
  const paymentType = form.get("payment_type")?.toString() ?? null;
  const testMode = form.get("test_mode")?.toString() === "1";

  // Structured single-line log on every delivery — helps diagnose missed / duplicate
  // webhooks without dumping full payloads.
  console.log(
    `[paytr.webhook] received merchant_oid=${merchantOid} status=${status} ` +
      `amount=${totalAmount} payment_type=${paymentType ?? "-"} test_mode=${testMode}`
  );

  if (!merchantOid || !status || !totalAmount || !hash) {
    console.warn(
      `[paytr.webhook] missing required field — merchant_oid=${merchantOid || "MISSING"} ` +
        `status=${status || "MISSING"} amount=${totalAmount || "MISSING"} hash=${hash ? "present" : "MISSING"}`
    );
    return new Response("PAYTR missing fields", { status: 400 });
  }

  let hashValid = false;
  try {
    hashValid = verifyPaytrCallback({ merchantOid, status, totalAmount, hash });
  } catch (err) {
    // Hash verification only throws on credentials misconfiguration. Returning 500
    // tells PayTR to retry the delivery, which is what we want until ops fix env.
    console.error("[paytr.webhook] hash verification error (config?)", err);
    return new Response("PAYTR bad config", { status: 500 });
  }

  if (!hashValid) {
    console.warn(
      `[paytr.webhook] hash mismatch merchant_oid=${merchantOid} — possible salt/key drift or tampered payload`
    );
    return new Response("PAYTR bad hash", { status: 400 });
  }

  const draft = await findDraftByPaytrMerchantOid(merchantOid);
  if (!draft) {
    // No matching draft. This is a potential revenue-drop signal — the most
    // common cause now is a late webhook for an old merchant_oid after the
    // customer used retry-payment (which overwrites the column). Log at ERROR
    // severity so ops can reconcile by querying PayTR by oid manually.
    // Ack so PayTR stops retrying — we can't promote without a draft anyway.
    console.error(
      `[paytr.webhook] NO DRAFT MATCHING merchant_oid=${merchantOid} status=${status} ` +
        `total=${totalAmount} — possible late delivery after retry-payment overwrite or cross-env oid; ` +
        `manual reconciliation may be required`
    );
    return okResponse();
  }

  // Always persist the payment-type metadata so we have an audit trail even if the
  // draft is already in a terminal state. On success we DON'T zero out the prior
  // paytrFailureReason — if PayTR retried failed→succeeded, the failure history is
  // an audit signal worth keeping.
  const updates: Partial<typeof orderDrafts.$inferInsert> = {
    paytrPaymentType: paymentType,
    paytrTestMode: testMode,
    updatedAt: new Date(),
  };
  if (status === "failed") {
    updates.paytrFailureReason =
      [failedReasonCode, failedReasonMsg].filter(Boolean).join(" — ") ||
      "PayTR failed";
  }
  await db
    .update(orderDrafts)
    .set(updates)
    .where(eq(orderDrafts.id, draft.id));

  if (status === "success") {
    // Defense-in-depth: even after hash verification passes, double-check the
    // claimed success with PayTR's status-query API before promoting to an
    // order. This means a forged-webhook attack (key/salt leak) also has to
    // compromise PayTR's API response, which the attacker doesn't control.
    //
    // Only opt-out via PAYTR_WEBHOOK_STATUS_CHECK=0. We intentionally do NOT
    // gate this on `testMode` — if PAYTR_TEST_MODE=1 were ever left enabled
    // in prod (the default), bypassing the cross-check would re-open the
    // forgery vector. PayTR's status-query endpoint handles test transactions
    // correctly so there's no downside.
    if (process.env.PAYTR_WEBHOOK_STATUS_CHECK !== "0") {
      try {
        const sq = await queryPaytrTransactionStatus(merchantOid);
        if (sq.status !== "success") {
          console.warn(
            `[paytr.webhook] hash-valid success but status-query returned ` +
              `${sq.status} for merchant_oid=${merchantOid} — refusing promotion`
          );
          // Ack so PayTR stops retrying; the draft remains in pending and
          // can be reconciled manually if this was a real success blip.
          return okResponse();
        }
      } catch (err) {
        // If status query itself fails we can't reliably cross-check. Trust
        // the hash and proceed, but log loudly.
        console.warn(
          `[paytr.webhook] status-query error during cross-check for ${merchantOid}; trusting hash`,
          err
        );
      }
    }

    // Reconciliation (log-only): PayTR's hash-verified total_amount (kuruş)
    // should equal what we asked it to charge = amountKurus - giftCardAmountKurus.
    // A mismatch signals config/code drift (e.g. a stale merchant_oid mapping or
    // a retry-payment basket diverging from the draft). Never block — PayTR has
    // already collected, so refusing promotion would strand a paid order.
    const expectedPaidKurus = draft.amountKurus - (draft.giftCardAmountKurus ?? 0);
    if (Number(totalAmount) !== expectedPaidKurus) {
      console.warn(
        `[paytr.webhook] amount mismatch for ${draft.reference}: ` +
          `paytr total_amount=${totalAmount} vs expected ${expectedPaidKurus} kuruş ` +
          `(amount=${draft.amountKurus}, giftCard=${draft.giftCardAmountKurus ?? 0})`
      );
    }

    try {
      // promoteDraftToOrder is idempotent — returns the existing order if the draft was
      // already promoted by another caller (OCR worker / admin / earlier webhook retry).
      await promoteDraftToOrder(draft.id);
      console.log(
        `[paytr.webhook] promoted draft ${draft.reference} (merchant_oid=${merchantOid})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.startsWith("DRAFT_NOT_PROMOTABLE")) {
        // Draft is in a terminal non-confirmed state (expired/failed/cancelled). PayTR
        // shouldn't be calling success on it, but we ack to stop retries and log.
        console.warn(
          `[paytr.webhook] success for non-promotable draft ${draft.reference} (${msg})`
        );
        return okResponse();
      }
      console.error(
        `[paytr.webhook] promotion failed for ${draft.reference}`,
        err
      );
      // 500 → PayTR will retry; we want that until the cause is fixed.
      return new Response("PAYTR internal", { status: 500 });
    }
    return okResponse();
  }

  console.warn(
    `[paytr.webhook] draft ${draft.reference} marked failed — reason=${failedReasonCode}/${failedReasonMsg}`
  );
  // status === "failed" — leave draft in pending so the customer can retry from the
  // track page. Expiry worker / admin cleans up if abandoned.
  return okResponse();
}
