import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { type ManufacturerMessageEmailJobData } from "../queues";
import { db } from "../../db";
import { orders } from "../../db/schema";
import { countChannelUnread } from "../../services/order-chat";
import { notifyManufacturer } from "../../services/manufacturer-notifications";

// Fires ~30 min after an admin sends a manufacturer-channel chat message. If the
// manufacturer has STILL not read the thread (unread > 0), email them; otherwise
// the read-receipt route already removed this job, but we re-check defensively.
async function processJob(job: Job<ManufacturerMessageEmailJobData>) {
  const { orderId } = job.data;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, orderNumber: true, manufacturerId: true },
  });
  if (!order || !order.manufacturerId) {
    job.log(`Order ${orderId} missing/unassigned — skipping unread-message email`);
    return;
  }

  const unread = await countChannelUnread(orderId, "manufacturer_admin", "counterparty");
  if (unread === 0) {
    job.log(`Order ${order.orderNumber} manufacturer caught up — no email`);
    return;
  }

  await notifyManufacturer({
    manufacturerId: order.manufacturerId,
    type: "admin_message",
    subject: `Okunmamış mesajınız var — sipariş ${order.orderNumber}`,
    body: `${order.orderNumber} numaralı siparişinizde yöneticiden okumadığınız mesaj(lar) var. Lütfen üretici panelinden yanıtlayın.`,
    orderId,
  });
}

export function startNotificationWorker() {
  const worker = new Worker<ManufacturerMessageEmailJobData>(
    "notification",
    processJob,
    { connection: getRedisConnection(), concurrency: 5 }
  );

  worker.on("completed", (job) => {
    console.log(`Notification job done for order ${job.data.orderId}`);
  });
  worker.on("failed", (job, error) => {
    console.error(
      `Notification job failed for order ${job?.data.orderId}:`,
      error.message
    );
  });

  return worker;
}
