import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import type { EmailJobData } from "../queues";
import { sendEmail } from "../../services/email";
import { db } from "../../db";
import { manufacturerNotifications } from "../../db/schema";

async function processJob(job: Job<EmailJobData>) {
  const {
    type, to, orderNumber, customerName, trackingNumber, locale,
    adminEmail, manufacturerEmail, companyName,
    photoUrl, glbUrl, revisionNote,
    giftCardCode, giftCardAmount, giftCardMessage, senderName,
    customSubject, customBody,
    bankName, bankAccountHolder, bankIban, bankBranch,
    paymentAmountKurus, paymentDeadline,
    ocrConfidence, ocrSummary,
    manufacturerNotificationId,
    notificationSubject, notificationBody, notificationType,
  } = job.data;

  try {
    await sendEmail({
      type, to, orderNumber, customerName, trackingNumber, locale,
      adminEmail, manufacturerEmail, companyName,
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
    console.log(`Email sent: ${job.data.type} to ${job.data.to}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Email failed: ${job?.data.type} to ${job?.data.to}:`, error.message);
  });

  return worker;
}
