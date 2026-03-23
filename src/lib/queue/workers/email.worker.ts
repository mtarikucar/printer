import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import type { EmailJobData } from "../queues";
import { sendEmail } from "../../services/email";

async function processJob(job: Job<EmailJobData>) {
  const {
    type, to, orderNumber, customerName, trackingNumber, locale,
    adminEmail, photoUrl, glbUrl, revisionNote,
    giftCardCode, giftCardAmount, giftCardMessage, senderName,
    customSubject, customBody,
  } = job.data;

  await sendEmail({
    type, to, orderNumber, customerName, trackingNumber, locale,
    adminEmail, photoUrl, glbUrl, revisionNote,
    giftCardCode, giftCardAmount, giftCardMessage, senderName,
    customSubject, customBody,
  });

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
