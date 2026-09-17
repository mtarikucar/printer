import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export interface PreviewGenerationJobData {
  previewId: string;
  imageUrl: string;
  photoKey: string;
  // Optional multi-image fusion set (1-4 keys, includes the primary photoKey
  // as the first element). Present only for templates that allow multiple
  // reference photos; absent → single-image generation.
  photoKeys?: string[];
  style: string;
  modifiers?: string[];
}

/**
 * Auto-3D generation, run as a self-re-enqueuing state machine rather than a
 * blocking poll: one order must never hold a worker slot for minutes.
 *
 *   create -> poll (x90, 10s apart) -> analyze (free) -> repair -> poll-repair
 */
export interface ModelGenerationJobData {
  orderId: string;
  round: number;
  stage: "create" | "poll" | "poll-repair";
  /** image-to-3d task id, set once stage `create` succeeds. */
  taskId?: string;
  /** print/repair task id, set once stage `poll` succeeds. */
  repairTaskId?: string;
  polls?: number;
  /** ai_spend_ledger row backing the in-flight provider call. */
  reservationId?: string;
  /** Meshy's free print/analyze result, carried to the gate. */
  printability?: unknown;
}

export interface MeshProcessingJobData {
  orderId: string;
  round: number;
  /** Storage key of Meshy's REPAIRED glb. */
  glbKey: string;
  generationAttemptId: string;
  printability?: unknown;
}

export interface WaInboundJobData {
  waMessageId: string;
  from?: string;
  waId?: string;
  profileName?: string | null;
  type?: string;
  text?: string | null;
  imageId?: string | null;
  buttonReplyId?: string | null;
  buttonReplyTitle?: string | null;
  timestamp?: string | null;
  /** Delivery-status callbacks reuse the queue with job name "status". */
  status?: string;
  errorCode?: number | null;
}

/**
 * Everything we say on WhatsApp goes through this queue, so the kill switch,
 * the 24h window check and the per-recipient rate limit have one home.
 */
export interface WaOutboundJobData {
  conversationId: string;
  to: string;
  kind: "text" | "image" | "video" | "buttons" | "template";
  body?: string;
  mediaKey?: string;
  caption?: string;
  buttons?: Array<{ id: string; title: string }>;
  headerMediaKey?: string;
  headerType?: "image" | "video";
  /** Used when the 24h window has closed and free-form is refused. */
  templateName?: string;
  templateParams?: string[];
  senderKind?: "admin" | "bot" | "agent" | "system";
}

export interface WaAgentJobData {
  conversationId: string;
  /** Media ids from the messages this turn is answering. */
  pendingMediaIds?: string[];
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
    | "new_message"
    // Auto-3D: the customer must approve the 360° turntable before printing.
    | "model_approval_request";
  to: string;
  orderNumber: string;
  customerName: string;
  trackingNumber?: string;
  // Finish tier of the shipped order. The shipped email lists the paint-kit
  // contents, which only the paintable_kit tier actually receives.
  finish?: string;
  adminEmail?: string;
  manufacturerEmail?: string;
  companyName?: string;
  cancelReason?: string;
  photoUrl?: string;
  glbUrl?: string;
  approvalUrl?: string;
  turntableUrl?: string;
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
  type: "havale_reminder" | "havale_expire" | "card_expire";
}

export interface DekontOcrJobData {
  draftId: string;
  receiptKey: string;
}

let emailQueue: Queue | null = null;
let previewGenerationQueue: Queue | null = null;
let previewCleanupQueue: Queue | null = null;
let paymentDeadlineQueue: Queue | null = null;
let dekontOcrQueue: Queue | null = null;
let scoringEvaluationsCleanupQueue: Queue | null = null;
let notificationQueue: Queue | null = null;
let analyticsCleanupQueue: Queue | null = null;
let assignmentSlaQueue: Queue | null = null;
let manufacturerAcceptSlaQueue: Queue | null = null;
let painterAcceptSlaQueue: Queue | null = null;
let modelApprovalSlaQueue: Queue | null = null;
let workshopCloseQueue: Queue | null = null;

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

let modelGenerationQueue: Queue | null = null;
let meshProcessingQueue: Queue | null = null;

export function getModelGenerationQueue(): Queue {
  if (!modelGenerationQueue) {
    modelGenerationQueue = new Queue("model-generation", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // A failed stage is retried once; beyond that the order falls to
        // failed_generation where an admin decides, because every retry past
        // the first risks buying another 20-credit provider task.
        attempts: 2,
        backoff: { type: "exponential", delay: 30000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return modelGenerationQueue;
}

export function getMeshProcessingQueue(): Queue {
  if (!meshProcessingQueue) {
    meshProcessingQueue = new Queue("mesh-processing", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 15000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return meshProcessingQueue;
}

let waInboundQueue: Queue | null = null;
let waOutboundQueue: Queue | null = null;

export function getWaInboundQueue(): Queue {
  if (!waInboundQueue) {
    waInboundQueue = new Queue("wa-inbound", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return waInboundQueue;
}

export function getWaOutboundQueue(): Queue {
  if (!waOutboundQueue) {
    waOutboundQueue = new Queue("wa-outbound", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // Meta error 131056 means we are already sending too fast to this
        // recipient; a tight retry makes it worse, so back off hard.
        attempts: 3,
        backoff: { type: "exponential", delay: 20000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return waOutboundQueue;
}

let waAgentQueue: Queue | null = null;

export function getWaAgentQueue(): Queue {
  if (!waAgentQueue) {
    waAgentQueue = new Queue("wa-agent", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // An LLM turn is NEVER retried automatically: a retry spends the tokens
        // again and can duplicate a side effect. Failure is a handoff.
        attempts: 1,
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return waAgentQueue;
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

/** Hourly sweep for assignments the manufacturer never answered. */
export function getAssignmentSlaQueue(): Queue {
  if (!assignmentSlaQueue) {
    assignmentSlaQueue = new Queue("assignment-sla", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return assignmentSlaQueue;
}

/**
 * Saatlik süpürme: atanan ÜRETİCİNİN 24 saatlik kabul/ret süresini aşan işler.
 *
 * `assignment-sla`nın yerini alır: o süpürme yalnız bayrak koyuyordu, bu
 * süpürme OTOMATİK atanmış işi sıradaki atölyeye devreder (ceza yok, yeniden
 * yerleştirme sınırına sayılır) ve kalanını bayraklar. İkisi aynı anda
 * zamanlanmaz — aynı sipariş için admin'e iki ayrı e-posta giderdi
 * (bkz. workers/start.ts).
 */
export function getManufacturerAcceptSlaQueue(): Queue {
  if (!manufacturerAcceptSlaQueue) {
    manufacturerAcceptSlaQueue = new Queue("manufacturer-accept-sla", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // Tek deneme: süpürme idempotent (koparma korumalı UPDATE ile yazılır)
        // ve bir saat sonra zaten tekrar koşuyor; yeniden denemek aynı
        // siparişleri ikinci kez taramaktan başka bir şey yapmaz.
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return manufacturerAcceptSlaQueue;
}

/**
 * Saatlik süpürme: atanan boyacının 24 saatlik kabul/ret süresini aşan işler.
 * Üretici ikizinden (assignment-sla) farkı, yalnız bayrak koymakla kalmayıp
 * OTOMATİK atanmış işi sıradaki boyacıya devretmesidir.
 */
export function getPainterAcceptSlaQueue(): Queue {
  if (!painterAcceptSlaQueue) {
    painterAcceptSlaQueue = new Queue("painter-accept-sla", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // Tek deneme: süpürme idempotent (koparma korumalı UPDATE ile yazılır)
        // ve bir saat sonra zaten tekrar koşuyor; yeniden denemek aynı
        // siparişleri ikinci kez taramaktan başka bir şey yapmaz.
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return painterAcceptSlaQueue;
}

/**
 * Six-hourly sweep over orders parked in `awaiting_customer_approval`. A paid
 * order waiting there is printing nothing, and until this queue existed nobody
 * was watching it.
 */
export function getModelApprovalSlaQueue(): Queue {
  if (!modelApprovalSlaQueue) {
    modelApprovalSlaQueue = new Queue("model-approval-sla", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // One attempt on purpose: the sweep is idempotent and runs again in six
        // hours, so a retry storm would only re-scan the same orders.
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return modelApprovalSlaQueue;
}

/**
 * Saatlik süpürme: kapanış zamanı geçmiş atölye seanslarını kapatır, komisyon
 * oranını dondurur ve partiyi ön rezerve üreticiye düşürür. Aynı süpürme, açık
 * seansların koltuk sayacını gerçek katılımcı satırlarıyla mutabakata getirir.
 * Kimse izlemezse seans açık kalır ve siparişler üretime hiç girmez.
 */
export function getWorkshopCloseQueue(): Queue {
  if (!workshopCloseQueue) {
    workshopCloseQueue = new Queue("workshop-close", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        // Tek deneme: süpürme idempotent ve bir saat sonra tekrar koşuyor.
        attempts: 1,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return workshopCloseQueue;
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

// Backstop expiry for an abandoned CARD draft: releases any reserved gift-card
// balance if the customer never completes (or retries) the PayTR payment.
export function cardExpireJobId(draftId: string): string {
  return `card-expire-${draftId}`;
}

// Keyed by order id: one pending unread-message email per order at a time.
export function mfgMessageEmailJobId(orderId: string): string {
  return `mfg-msg-email-${orderId}`;
}
