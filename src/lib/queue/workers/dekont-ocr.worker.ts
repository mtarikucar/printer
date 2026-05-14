import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { getEmailQueue, type DekontOcrJobData } from "../queues";
import { db } from "../../db";
import { orderDrafts } from "../../db/schema";
import { getFileBuffer } from "../../services/storage";
import { ocrDekont, scoreOcr } from "../../services/dekont-ocr";
import { promoteDraftToOrder } from "../../services/order-draft";
import type { Locale } from "../../i18n/types";

function localeOf(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "tr";
}

async function processJob(job: Job<DekontOcrJobData>) {
  const { draftId, receiptKey } = job.data;
  const adminEmail = process.env.ADMIN_EMAIL;

  const draft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.id, draftId),
  });
  if (!draft) {
    job.log(`Draft ${draftId} not found — abandoning OCR.`);
    return;
  }

  if (draft.status !== "pending" && draft.status !== "awaiting_review") {
    job.log(`Draft ${draft.reference} status=${draft.status} — skipping OCR.`);
    return;
  }

  if (draft.bankTransferReceiptKey !== receiptKey) {
    job.log(`Receipt key changed — abandoning stale OCR job for ${draft.reference}.`);
    return;
  }

  let buffer: Buffer;
  try {
    buffer = await getFileBuffer(receiptKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "load failed";
    await db
      .update(orderDrafts)
      .set({
        receiptOcrConfidence: "low",
        receiptOcrFailureReason: `Receipt load failed: ${msg}`,
        status: "awaiting_review",
        updatedAt: new Date(),
      })
      .where(eq(orderDrafts.id, draftId));
    return;
  }

  const expectedAmountKurus =
    draft.amountKurus - draft.giftCardAmountKurus - draft.havaleDiscountKurus;

  const result = await ocrDekont(buffer, receiptKey, draft.reference);
  const confidence = scoreOcr(result, expectedAmountKurus);

  await db
    .update(orderDrafts)
    .set({
      receiptOcrText: result.rawText || null,
      receiptOcrParsed: {
        amountKurus: result.amountKurus,
        iban: result.iban,
        sender: result.sender,
        referenceFound: result.referenceFound,
        date: result.date,
      },
      receiptOcrConfidence: confidence,
      receiptOcrFailureReason: result.failureReason ?? null,
      // High confidence will get promoted below; medium/low stays in awaiting_review.
      status: confidence === "high" ? "pending" : "awaiting_review",
      updatedAt: new Date(),
    })
    .where(eq(orderDrafts.id, draftId));

  const locale = localeOf(draft.locale);
  const summary = [
    result.amountKurus !== undefined
      ? `Tutar (algılanan): ${(result.amountKurus / 100).toFixed(2)} TL`
      : "Tutar algılanamadı",
    `Beklenen: ${(expectedAmountKurus / 100).toFixed(2)} TL`,
    `Referans: ${result.referenceFound ? "Eşleşti" : "Bulunamadı"}`,
    result.iban ? `IBAN: ${result.iban}` : null,
    result.sender ? `Gönderen: ${result.sender}` : null,
    result.failureReason ? `Hata: ${result.failureReason}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (confidence === "high") {
    try {
      await promoteDraftToOrder(draftId);
      job.log(`Draft ${draft.reference} auto-confirmed via OCR.`);
      if (adminEmail) {
        await getEmailQueue().add("send-email", {
          type: "bank_transfer_auto_confirmed",
          to: adminEmail,
          adminEmail,
          orderNumber: draft.reference,
          customerName: draft.customerName,
          ocrConfidence: confidence,
          ocrSummary: summary,
          locale: "tr",
        });
      }
      return;
    } catch (err) {
      job.log(`Auto-promote failed for ${draft.reference}: ${err}`);
      // fall through to admin review email
    }
  }

  if (adminEmail) {
    await getEmailQueue().add("send-email", {
      type: "bank_transfer_needs_review",
      to: adminEmail,
      adminEmail,
      orderNumber: draft.reference,
      customerName: draft.customerName,
      ocrConfidence: confidence,
      ocrSummary: summary,
      locale: "tr",
    });
  }

  void locale;
}

export function startDekontOcrWorker() {
  const worker = new Worker<DekontOcrJobData>("dekont-ocr", processJob, {
    connection: getRedisConnection(),
    concurrency: 2,
  });

  worker.on("completed", (job) => {
    console.log(`Dekont OCR done for draft ${job.data.draftId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(
      `Dekont OCR failed for draft ${job?.data.draftId}:`,
      error.message
    );
  });

  return worker;
}
