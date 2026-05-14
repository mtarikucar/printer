import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { verifyPaytrCallback } from "@/lib/services/paytr";
import { findDraftByPaytrMerchantOid, promoteDraftToOrder } from "@/lib/services/order-draft";

export const runtime = "nodejs";

function okResponse() {
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
    console.error("PayTR webhook: invalid form body", err);
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

  if (!merchantOid || !status || !totalAmount || !hash) {
    return new Response("PAYTR missing fields", { status: 400 });
  }

  let hashValid = false;
  try {
    hashValid = verifyPaytrCallback({ merchantOid, status, totalAmount, hash });
  } catch (err) {
    console.error("PayTR webhook: hash verification error", err);
    return new Response("PAYTR bad config", { status: 500 });
  }

  if (!hashValid) {
    console.warn("PayTR webhook: hash mismatch for", merchantOid);
    return new Response("PAYTR bad hash", { status: 400 });
  }

  const draft = await findDraftByPaytrMerchantOid(merchantOid);
  if (!draft) {
    // No matching draft — ack so PayTR stops retrying.
    console.warn(`PayTR webhook: no draft matching merchant_oid=${merchantOid}`);
    return okResponse();
  }

  // Always persist the payment-type metadata so we have an audit trail even if the
  // draft is already in a terminal state.
  await db
    .update(orderDrafts)
    .set({
      paytrPaymentType: paymentType,
      paytrTestMode: testMode,
      paytrFailureReason:
        status === "failed"
          ? [failedReasonCode, failedReasonMsg].filter(Boolean).join(" — ") || "PayTR failed"
          : null,
      updatedAt: new Date(),
    })
    .where(eq(orderDrafts.id, draft.id));

  if (status === "success") {
    try {
      // promoteDraftToOrder is idempotent — returns the existing order if the draft was
      // already promoted by another caller (OCR worker / admin / earlier webhook retry).
      await promoteDraftToOrder(draft.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.startsWith("DRAFT_NOT_PROMOTABLE")) {
        // Draft is in a terminal non-confirmed state (expired/failed/cancelled). PayTR
        // shouldn't be calling success on it, but we ack to stop retries and log.
        console.warn(
          `PayTR webhook: draft ${draft.reference} succeeded but not promotable (${msg})`
        );
        return okResponse();
      }
      console.error("PayTR webhook: promoteDraftToOrder failed", err);
      return new Response("PAYTR internal", { status: 500 });
    }
    return okResponse();
  }

  // status === "failed" — leave draft in pending so the customer can retry from the
  // track page. Expiry worker / admin cleans up if abandoned.
  return okResponse();
}
