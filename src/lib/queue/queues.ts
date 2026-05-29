import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export interface AiGenerationJobData {
  orderId: string;
  imageUrl: string;
  style: string;
  modifiers?: string[];
}

export interface MeshProcessingJobData {
  orderId: string;
  generationId: string;
  glbUrl: string;
  glbKey: string;
}

export interface PreviewGenerationJobData {
  previewId: string;
  imageUrl: string;
  photoKey: string;
  style: string;
  modifiers?: string[];
}

export interface EmailJobData {
  type:
    | "order_confirmation"
    | "generation_failed"
    | "order_shipped"
    | "order_refunded"
    | "revision_request"
    | "order_approved"
    | "order_printing"
    | "order_delivered"
    | "gift_card_received"
    | "admin_custom"
    | "order_assigned"
    | "manufacturer_shipped"
    | "bank_transfer_instructions"
    | "bank_transfer_reminder"
    | "bank_transfer_receipt_received"
    | "bank_transfer_auto_confirmed"
    | "bank_transfer_needs_review"
    | "payment_expired"
    | "manufacturer_notification"
    | "qc_submitted"
    | "new_message";
  to: string;
  orderNumber: string;
  customerName: string;
  trackingNumber?: string;
  adminEmail?: string;
  manufacturerEmail?: string;
  companyName?: string;
  photoUrl?: string;
  glbUrl?: string;
  revisionNote?: string;
  giftCardCode?: string;
  giftCardAmount?: number;
  giftCardMessage?: string;
  senderName?: string;
  customSubject?: string;
  customBody?: string;
  locale?: "en" | "tr";
  bankName?: string;
  bankAccountHolder?: string;
  bankIban?: string;
  bankBranch?: string;
  paymentAmountKurus?: number;
  paymentDeadline?: string;
  // OCR auto-confirm / review notification
  ocrConfidence?: "high" | "medium" | "low";
  ocrSummary?: string;
  // Manufacturer notification
  manufacturerNotificationId?: string;
  notificationSubject?: string;
  notificationBody?: string;
  notificationType?: string;
}

export interface PaymentDeadlineJobData {
  draftId: string;
  reference: string;
  type: "havale_reminder" | "havale_expire";
}

export interface DekontOcrJobData {
  draftId: string;
  receiptKey: string;
}

let aiGenerationQueue: Queue | null = null;
let meshProcessingQueue: Queue | null = null;
let emailQueue: Queue | null = null;
let previewGenerationQueue: Queue | null = null;
let previewCleanupQueue: Queue | null = null;
let paymentDeadlineQueue: Queue | null = null;
let dekontOcrQueue: Queue | null = null;
let scoringEvaluationsCleanupQueue: Queue | null = null;

export function getAiGenerationQueue(): Queue {
  if (!aiGenerationQueue) {
    aiGenerationQueue = new Queue("ai-generation", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return aiGenerationQueue;
}

export function getMeshProcessingQueue(): Queue {
  if (!meshProcessingQueue) {
    meshProcessingQueue = new Queue("mesh-processing", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 15000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return meshProcessingQueue;
}

export function getPreviewGenerationQueue(): Queue {
  if (!previewGenerationQueue) {
    previewGenerationQueue = new Queue("preview-generation", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return previewGenerationQueue;
}

export function getPreviewCleanupQueue(): Queue {
  if (!previewCleanupQueue) {
    previewCleanupQueue = new Queue("preview-cleanup", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return previewCleanupQueue;
}

export function getEmailQueue(): Queue {
  if (!emailQueue) {
    emailQueue = new Queue("email", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return emailQueue;
}

export function getPaymentDeadlineQueue(): Queue {
  if (!paymentDeadlineQueue) {
    paymentDeadlineQueue = new Queue("payment-deadline", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return paymentDeadlineQueue;
}

export function getScoringEvaluationsCleanupQueue(): Queue {
  if (!scoringEvaluationsCleanupQueue) {
    scoringEvaluationsCleanupQueue = new Queue("scoring-evaluations-cleanup", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return scoringEvaluationsCleanupQueue;
}

export function getDekontOcrQueue(): Queue {
  if (!dekontOcrQueue) {
    dekontOcrQueue = new Queue("dekont-ocr", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return dekontOcrQueue;
}

// Job IDs are keyed by draft id (matches the new draft-based payment lifecycle).
export function havaleReminderJobId(draftId: string): string {
  return `havale-reminder-${draftId}`;
}

export function havaleExpireJobId(draftId: string): string {
  return `havale-expire-${draftId}`;
}
