import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { verifyPaytrCallback } from "@/lib/services/paytr";
import { confirmOrder } from "@/lib/services/order-confirm";
import {
  getPaymentDeadlineQueue,
  havaleExpireJobId,
  havaleReminderJobId,
} from "@/lib/queue/queues";
import type { Locale } from "@/lib/i18n/types";

export const runtime = "nodejs";

function localeOf(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "tr";
}

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

  const order = await db.query.orders.findFirst({
    where: eq(orders.paytrMerchantOid, merchantOid),
  });

  if (!order) {
    // No matching order — acknowledge so PayTR stops retrying.
    console.warn(`PayTR webhook: no order matching merchant_oid=${merchantOid}`);
    return okResponse();
  }

  // Idempotent: already processed → just acknowledge.
  if (order.paymentStatus === "succeeded") {
    return okResponse();
  }

  const locale = localeOf(order.locale);

  if (status === "success") {
    try {
      await confirmOrder(order.id, locale);
    } catch (err) {
      // If order isn't in pending_payment we still record payment metadata but skip confirm.
      const msg = err instanceof Error ? err.message : "";
      if (!msg.includes("not in pending_payment")) {
        console.error("PayTR webhook: confirmOrder failed", err);
        return new Response("PAYTR internal", { status: 500 });
      }
    }

    await db
      .update(orders)
      .set({
        paymentStatus: "succeeded",
        paytrPaymentType: paymentType,
        paytrTestMode: testMode,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    // Remove any lingering deadline jobs (defensive — card flow doesn't schedule them,
    // but if a customer switched method this would clean up).
    const q = getPaymentDeadlineQueue();
    await q.remove(havaleReminderJobId(order.id)).catch(() => {});
    await q.remove(havaleExpireJobId(order.id)).catch(() => {});

    return okResponse();
  }

  // status === "failed"
  await db
    .update(orders)
    .set({
      paymentStatus: "failed",
      paytrPaymentType: paymentType,
      paytrTestMode: testMode,
      paytrFailureReason: [failedReasonCode, failedReasonMsg].filter(Boolean).join(" — "),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  return okResponse();
}
