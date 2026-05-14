import { Worker, Job } from "bullmq";
import { and, eq, inArray, isNull } from "drizzle-orm";
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

async function processJob(job: Job<PaymentDeadlineJobData>) {
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

  if (type === "havale_expire") {
    await expireDraft(draftId);
    job.log(`Draft ${reference} expired and refunded`);
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
