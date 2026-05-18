import { Worker, Job } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { getEmailQueue, type DekontOcrJobData } from "../queues";
import { db } from "../../db";
import { orderDrafts } from "../../db/schema";
import { getFileBuffer } from "../../services/storage";
import { ocrDekont, scoreOcr } from "../../services/dekont-ocr";
import { promoteDraftToOrder } from "../../services/order-draft";
import { getBankDetails } from "../../config/payment";
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
    // Throw so BullMQ retries the job — most file-read failures (storage
    // hiccups, transient FS errors) are recoverable. The `failed` handler
    // below parks the draft for manual review only after attempts are
    // exhausted, so we don't permanently strand a draft on a single blip.
    throw new Error(
      `Receipt load failed (will retry): ${err instanceof Error ? err.message : "unknown"}`
    );
  }

  const expectedAmountKurus =
    draft.amountKurus - draft.giftCardAmountKurus - draft.havaleDiscountKurus;
  // Merchant's receiving IBAN — passing it in lets the OCR cross-check the
  // extracted IBAN. Mismatch = fraud signal → score forced to "low" (admin
  // review). Match = confidence boost.
  const { iban: expectedIban } = getBankDetails();

  const result = await ocrDekont(buffer, receiptKey, draft.reference, {
    expectedIban: expectedIban || undefined,
  });
  const confidence = scoreOcr(result, expectedAmountKurus);

  // Re-assert staleness in the WHERE clause: if the customer uploaded a new
  // receipt after we started, or the draft already moved on (admin marked
  // paid, etc.), don't clobber that newer state.
  await db
    .update(orderDrafts)
    .set({
      receiptOcrText: result.rawText || null,
      receiptOcrParsed: {
        amountKurus: result.amountKurus,
        iban: result.iban,
        sender: result.sender,
        referenceFound: result.referenceFound,
        referenceFuzzyMatched: result.referenceFuzzyMatched,
        date: result.date,
        ibanMatchesExpected: result.ibanMatchesExpected,
      },
      receiptOcrConfidence: confidence,
      receiptOcrFailureReason: result.failureReason ?? null,
      // High confidence will get promoted below; medium/low stays in awaiting_review.
      status: confidence === "high" ? "pending" : "awaiting_review",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orderDrafts.id, draftId),
        eq(orderDrafts.bankTransferReceiptKey, receiptKey),
        inArray(orderDrafts.status, ["pending", "awaiting_review"])
      )
    );

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
    // Stalled-job detection: tesseract OCR is CPU-bound and sometimes hangs
    // on adversarial input (very large images, malformed JPEG, etc.). Without
    // this config a stuck job blocks a worker slot indefinitely and the
    // customer's draft sits in `pending` forever.
    //
    // `stalledInterval` = how often BullMQ checks each running job for
    // staleness. `maxStalledCount` = how many times a job can be marked
    // stalled before BullMQ moves it to the `failed` set (where our
    // `failed` handler below parks the draft for admin review).
    //
    // 30s interval × max 1 stall = ~30-60s before stuck jobs escalate.
    stalledInterval: 30_000,
    maxStalledCount: 1,
  });

  worker.on("completed", (job) => {
    console.log(`Dekont OCR done for draft ${job.data.draftId}`);
  });

  worker.on("failed", async (job, error) => {
    console.error(
      `Dekont OCR failed for draft ${job?.data.draftId}:`,
      error.message
    );
    // When attempts are exhausted (BullMQ stops retrying), park the draft so
    // admin sees it in the review queue. Best-effort — failure here just logs.
    const draftId = job?.data.draftId;
    const attemptsMade = job?.attemptsMade ?? 0;
    const attemptsAllowed = job?.opts?.attempts ?? 1;
    if (draftId && attemptsMade >= attemptsAllowed) {
      try {
        await db
          .update(orderDrafts)
          .set({
            receiptOcrConfidence: "low",
            receiptOcrFailureReason: `OCR exhausted: ${error.message}`,
            status: "awaiting_review",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(orderDrafts.id, draftId),
              inArray(orderDrafts.status, ["pending", "awaiting_review"])
            )
          );
      } catch (e) {
        console.error("Dekont OCR final-park write failed:", e);
      }
    }
  });

  return worker;
}
