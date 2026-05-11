import { Worker, Job } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { getEmailQueue, type PaymentDeadlineJobData } from "../queues";
import { db } from "../../db";
import { orders, giftCards, giftCardRedemptions, adminActions } from "../../db/schema";
import { getBankDetails } from "../../config/payment";
import type { Locale } from "../../i18n/types";

const SYSTEM_ADMIN_EMAIL = process.env.ADMIN_EMAIL || "system@figurunica.com";

function localeOf(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "tr";
}

async function processJob(job: Job<PaymentDeadlineJobData>) {
  const { orderId, orderNumber, type } = job.data;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });

  if (!order) {
    job.log(`Order ${orderId} not found — skipping ${type}`);
    return;
  }

  if (order.paymentStatus !== "awaiting_transfer") {
    job.log(`Order ${orderNumber} payment_status=${order.paymentStatus} — skipping ${type}`);
    return;
  }

  const locale = localeOf(order.locale);

  if (type === "havale_reminder") {
    // Atomic claim: only one worker can set reminderSentAt; concurrent attempts
    // (e.g. job retries or two pods) will see zero affected rows and bail out.
    const [claimed] = await db
      .update(orders)
      .set({ bankTransferReminderSentAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(orders.id, orderId),
          isNull(orders.bankTransferReminderSentAt),
          eq(orders.paymentStatus, "awaiting_transfer")
        )
      )
      .returning({ id: orders.id });

    if (!claimed) {
      job.log(`Reminder already sent or order no longer eligible: ${orderNumber}`);
      return;
    }

    const bank = getBankDetails();
    const finalAmountKurus =
      order.amountKurus - order.giftCardAmountKurus - order.havaleDiscountKurus;

    await getEmailQueue().add("send-email", {
      type: "bank_transfer_reminder",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      bankName: bank.bankName,
      bankAccountHolder: bank.accountHolder,
      bankIban: bank.iban,
      bankBranch: bank.branch,
      paymentAmountKurus: finalAmountKurus,
      paymentDeadline: order.bankTransferDeadline?.toISOString(),
      locale,
    });
    job.log(`Reminder sent for ${orderNumber}`);
    return;
  }

  if (type === "havale_expire") {
    await db.transaction(async (tx) => {
      // Re-check status inside the transaction to avoid racing with admin confirm.
      const [current] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!current || current.paymentStatus !== "awaiting_transfer") {
        return;
      }

      // Refund any gift card redemption associated with this order.
      const redemption = await tx.query.giftCardRedemptions.findFirst({
        where: eq(giftCardRedemptions.orderId, orderId),
      });
      if (redemption) {
        const [card] = await tx
          .select()
          .from(giftCards)
          .where(eq(giftCards.id, redemption.giftCardId))
          .for("update");
        if (card) {
          const newBalance = card.balanceKurus + redemption.amountKurus;
          // Preserve "expired" status; otherwise pick the right state based on
          // whether the card is now back to full, still partial, or zero.
          let newStatus: typeof card.status;
          if (card.status === "expired") {
            newStatus = "expired";
          } else if (newBalance === 0) {
            newStatus = "fully_used";
          } else if (newBalance >= card.amountKurus) {
            newStatus = "active";
          } else {
            newStatus = "partially_used";
          }
          await tx
            .update(giftCards)
            .set({
              balanceKurus: newBalance,
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(eq(giftCards.id, card.id));
        }
      }

      await tx
        .update(orders)
        .set({
          status: "rejected",
          paymentStatus: "expired",
          failureReason: "Havale ödeme süresi doldu (72 saat)",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));

      await tx.insert(adminActions).values({
        orderId,
        action: "mark_payment_expired",
        adminEmail: SYSTEM_ADMIN_EMAIL,
        notes: "Otomatik iptal: havale 72 saat içinde tamamlanmadı",
      });
    });

    await getEmailQueue().add("send-email", {
      type: "payment_expired",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      locale,
    });

    job.log(`Order ${orderNumber} expired and refunded`);
  }
}

export function startPaymentDeadlineWorker() {
  const worker = new Worker<PaymentDeadlineJobData>("payment-deadline", processJob, {
    connection: getRedisConnection(),
    concurrency: 2,
  });

  worker.on("completed", (job) => {
    console.log(`Payment deadline job done: ${job.data.type} for ${job.data.orderNumber}`);
  });

  worker.on("failed", (job, error) => {
    console.error(
      `Payment deadline job failed: ${job?.data.type} for ${job?.data.orderNumber}:`,
      error.message
    );
  });

  return worker;
}
