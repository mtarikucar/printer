import { Worker, Job } from "bullmq";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { getEmailQueue, type PaymentDeadlineJobData } from "../queues";
import { db } from "../../db";
import { orderDrafts } from "../../db/schema";
import { getBankDetails } from "../../config/payment";
import { expireDraft } from "../../services/order-draft";
import type { Locale } from "../../i18n/types";

function localeOf(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "tr";
}

/**
 * Serialize deadline extension with the final expiry decision. A plain reread
 * still races: extension could commit immediately before expireDraft's lock.
 * Do NOT lock the draft row in this outer transaction: expireDraft locks it on
 * another connection. Admin extension takes this same advisory lock first.
 */
export async function expireDraftAtCurrentDeadline(
  draftId: string,
  expire: (id: string) => Promise<void> = expireDraft,
  expectedDeadline?: string,
): Promise<"processed" | "extended" | "closed" | "superseded"> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`draft-deadline:${draftId}`}, 0))`);
    const draft = await tx.query.orderDrafts.findFirst({ where: eq(orderDrafts.id, draftId) });
    if (!draft || !["pending", "awaiting_review"].includes(draft.status) || draft.promotedOrderId) return "closed";
    // An extension job may have been queued before its DB transaction failed.
    // Only the precise committed deadline can authorize that job to expire.
    if (expectedDeadline && draft.bankTransferDeadline?.toISOString() !== expectedDeadline) return "superseded";
    if (draft.bankTransferDeadline && draft.bankTransferDeadline.getTime() > Date.now()) return "extended";
    await expire(draftId);
    return "processed";
  });
}

async function processJob(job: Job<PaymentDeadlineJobData & { expectedDeadline?: string }>) {
  const { draftId, reference, type } = job.data;

  const draft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.id, draftId),
  });

  if (!draft) {
    job.log(`Draft ${draftId} not found — skipping ${type}`);
    return;
  }

  if (draft.status !== "pending" && draft.status !== "awaiting_review") {
    job.log(`Draft ${reference} status=${draft.status} — skipping ${type}`);
    return;
  }

  const locale = localeOf(draft.locale);

  if (type === "havale_reminder") {
    // Atomic claim — only the first runner sends the reminder.
    // Both `pending` and `awaiting_review` (uploaded but unverified receipt) deserve
    // a reminder; the customer still hasn't paid in admin's view.
    const [claimed] = await db
      .update(orderDrafts)
      .set({ bankTransferReminderSentAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(orderDrafts.id, draftId),
          isNull(orderDrafts.bankTransferReminderSentAt),
          inArray(orderDrafts.status, ["pending", "awaiting_review"])
        )
      )
      .returning({ id: orderDrafts.id });

    if (!claimed) {
      job.log(`Reminder already sent or draft no longer eligible: ${reference}`);
      return;
    }

    const bank = getBankDetails();
    const finalAmountKurus =
      draft.amountKurus - draft.giftCardAmountKurus - draft.havaleDiscountKurus;

    await getEmailQueue().add("send-email", {
      type: "bank_transfer_reminder",
      to: draft.email,
      orderNumber: draft.reference,
      customerName: draft.customerName,
      bankName: bank.bankName,
      bankAccountHolder: bank.accountHolder,
      bankIban: bank.iban,
      bankBranch: bank.branch,
      paymentAmountKurus: finalAmountKurus,
      paymentDeadline: draft.bankTransferDeadline?.toISOString(),
      locale,
    });
    job.log(`Reminder sent for ${reference}`);
    return;
  }

  // Both havale and card use the same terminal expiry: release any reserved
  // gift-card balance and move the draft to `expired`. For card this is the
  // backstop that stops an abandoned checkout from holding the credit forever —
  // and, for a workshop join, from holding the SEAT forever.
  // expireDraft is idempotent and only acts on still-pending/awaiting_review
  // drafts, so a promoted (paid) card draft is unaffected.
  //
  // The workshop seat is released inside expireDraft, not here: the admin
  // force-expire route calls expireDraft directly too, and a seat released in
  // only one of the two callers would leak on the other.
  if (type === "havale_expire" || type === "card_expire") {
    const result = await expireDraftAtCurrentDeadline(draftId, expireDraft, job.data.expectedDeadline);
    job.log(`Draft ${reference}: expiry ${result}`);
  }
}

export function startPaymentDeadlineWorker() {
  const worker = new Worker<PaymentDeadlineJobData>("payment-deadline", processJob, {
    connection: getRedisConnection(),
    concurrency: 2,
  });

  worker.on("completed", (job) => {
    console.log(`Payment deadline job done: ${job.data.type} for ${job.data.reference}`);
  });

  worker.on("failed", (job, error) => {
    console.error(
      `Payment deadline job failed: ${job?.data.type} for ${job?.data.reference}:`,
      error.message
    );
  });

  return worker;
}
