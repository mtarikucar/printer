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
  // Optional multi-image fusion set (1-4 keys, includes the primary photoKey
  // as the first element). Present only for object/realistic templates when the
  // customer added extra reference photos; absent → single-image generation.
  photoKeys?: string[];
  style: string;
  modifiers?: string[];
  // Scene axis (Phase 1). sceneFragment is the selected preset's stored
  // composition text; sceneCustomText is the free-text scene. Both optional —
  // absent → single-subject default behavior. Only applied to stylized styles.
  sceneFragment?: string;
  sceneCustomText?: string;
}

// Stage B — 3D build after the customer picks a variation. Stylized: selectedUrl
// (worker generates a back view, then multi-image-to-3d on [front, back]).
// Non-stylized (realistic/object): rawPhotoKeys (raw photos straight to 3D, no
// back-view). Both run on the same "preview-generation" queue, job name
// "build-from-selection".
export interface PreviewBuildJobData {
  previewId: string;
  style: string;
  selectedUrl?: string;
  rawPhotoKeys?: string[];
  modifiers?: string[];
}

export interface CreativeLabJobData {
  jobId: string;
  product: "keychain" | "fridge_magnet" | "lamp";
  photoKey: string;
  imageUrl: string;
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
    | "manufacturer_cancelled"
    | "new_message";
  to: string;
  orderNumber: string;
  customerName: string;
  trackingNumber?: string;
  adminEmail?: string;
  manufacturerEmail?: string;
  companyName?: string;
  cancelReason?: string;
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
let creativeLabQueue: Queue | null = null;
let paymentDeadlineQueue: Queue | null = null;
let dekontOcrQueue: Queue | null = null;
let scoringEvaluationsCleanupQueue: Queue | null = null;
let notificationQueue: Queue | null = null;
let analyticsCleanupQueue: Queue | null = null;

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

export function getCreativeLabQueue(): Queue {
  if (!creativeLabQueue) {
    creativeLabQueue = new Queue("creative-lab", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return creativeLabQueue;
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

export function getAnalyticsCleanupQueue(): Queue {
  if (!analyticsCleanupQueue) {
    analyticsCleanupQueue = new Queue("analytics-cleanup", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return analyticsCleanupQueue;
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

// Delayed/cancellable notifications (e.g. "manufacturer has an unread chat
// message for N minutes" → email). Jobs are scheduled with a stable jobId so a
// burst of messages keeps a single pending email, and the read-receipt route
// can remove it.
export function getNotificationQueue(): Queue {
  if (!notificationQueue) {
    notificationQueue = new Queue("notification", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return notificationQueue;
}

export interface ManufacturerMessageEmailJobData {
  orderId: string;
}

// Job IDs are keyed by draft id (matches the new draft-based payment lifecycle).
export function havaleReminderJobId(draftId: string): string {
  return `havale-reminder-${draftId}`;
}

export function havaleExpireJobId(draftId: string): string {
  return `havale-expire-${draftId}`;
}

// Keyed by order id: one pending unread-message email per order at a time.
export function mfgMessageEmailJobId(orderId: string): string {
  return `mfg-msg-email-${orderId}`;
}
