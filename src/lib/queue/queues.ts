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
    | "manufacturer_shipped";
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
}

let aiGenerationQueue: Queue | null = null;
let meshProcessingQueue: Queue | null = null;
let emailQueue: Queue | null = null;
let previewGenerationQueue: Queue | null = null;
let previewCleanupQueue: Queue | null = null;

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
