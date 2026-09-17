import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import type { EmailJobData } from "../queues";
import { sendEmail } from "../../services/email";
import { db } from "../../db";
import { manufacturerNotifications, orders } from "../../db/schema";
import { ensureJourneyToken } from "../../services/order-journey";
import { deliverRefundRecordNotices, recoverRefundRecordNotices } from "../../services/refund-record-notices";
import { deliverRefundRecordAnalytics, recoverRefundRecordAnalytics } from "../../services/refund-record-analytics";
import { deliverDisputeNotices, recoverDisputeNotices } from "../../services/dispute-notices";

async function processJob(job: Job<EmailJobData>) {
  if (job.data.type === "dispute_email") {
    await deliverDisputeNotices(job.data.disputeId, job.data.phase);
    return;
  }
  if (job.data.type === "dispute_email_recover") {
    await recoverDisputeNotices();
    return;
  }
  if (job.data.type === "refund_record_analytics") {
    await deliverRefundRecordAnalytics(job.data.refundId);
    return;
  }
  if (job.data.type === "refund_record_analytics_recover") {
    await recoverRefundRecordAnalytics();
    return;
  }
  if (job.data.type === "refund_record_email") {
    await deliverRefundRecordNotices(job.data.refundId);
    return;
  }
  if (job.data.type === "refund_record_email_recover") {
    await recoverRefundRecordNotices();
    return;
  }
  const {
    type, to, orderNumber, customerName, trackingNumber, locale,
    adminEmail, manufacturerEmail, companyName, cancelReason,
    photoUrl, glbUrl, revisionNote,
    giftCardCode, giftCardAmount, giftCardMessage, senderName,
    customSubject, customBody,
    bankName, bankAccountHolder, bankIban, bankBranch,
    paymentAmountKurus, paymentDeadline,
    ocrConfidence, ocrSummary,
    manufacturerNotificationId,
    notificationSubject, notificationBody, notificationType,
  } = job.data;

  // The journey link rides on the shipped mail. Resolved here rather than in
  // each ship route because five different actors can ship an order (admin,
  // admin+kargo, manufacturer, painter, and the painter's second path) and a
  // sixth would silently ship without it. Non-eligible orders resolve to
  // undefined and the template omits the block.
  let journeyToken: string | undefined;
  if (type === "order_shipped" && orderNumber) {
    try {
      const [row] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, orderNumber))
        .limit(1);
      if (row) journeyToken = (await ensureJourneyToken(row.id)) ?? undefined;
    } catch (err) {
      // A missing journey link must never hold up the shipping notification.
      console.error("email.worker: journey token lookup failed", err);
    }
  }

  try {
    await sendEmail({
      type, to, orderNumber, customerName, trackingNumber, locale, journeyToken,
      adminEmail, manufacturerEmail, companyName, cancelReason,
      photoUrl, glbUrl, revisionNote,
      giftCardCode, giftCardAmount, giftCardMessage, senderName,
      customSubject, customBody,
      bankName, bankAccountHolder, bankIban, bankBranch,
      paymentAmountKurus, paymentDeadline,
      ocrConfidence, ocrSummary,
      notificationSubject, notificationBody, notificationType,
    });

    if (manufacturerNotificationId) {
      await db
        .update(manufacturerNotifications)
        .set({ emailSentAt: new Date() })
        .where(eq(manufacturerNotifications.id, manufacturerNotificationId));
    }
  } catch (err) {
    if (manufacturerNotificationId) {
      await db
        .update(manufacturerNotifications)
        .set({ emailFailedReason: err instanceof Error ? err.message : "send failed" })
        .where(eq(manufacturerNotifications.id, manufacturerNotificationId));
    }
    throw err;
  }

  job.log(`Sent ${type} email to ${to} for order ${orderNumber}`);
}

export function startEmailWorker() {
  const worker = new Worker<EmailJobData>("email", processJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  });

  worker.on("completed", (job) => {
    console.log(`Email job completed: ${job.data.type}${"to" in job.data ? ` to ${job.data.to}` : ""}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Email job failed: ${job?.data.type}:`, error.message);
  });

  return worker;
}
