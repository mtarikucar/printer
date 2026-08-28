import "dotenv/config";
import "./instrument";
import { startEmailWorker } from "../src/lib/queue/workers/email.worker";
import { startPreviewGenerationWorker } from "../src/lib/queue/workers/preview-generation.worker";
import { startPreviewCleanupWorker } from "../src/lib/queue/workers/preview-cleanup.worker";
import { startPaymentDeadlineWorker } from "../src/lib/queue/workers/payment-deadline.worker";
import { startDekontOcrWorker } from "../src/lib/queue/workers/dekont-ocr.worker";
import { startScoringEvaluationsCleanupWorker } from "../src/lib/queue/workers/scoring-evaluations-cleanup.worker";
import { startNotificationWorker } from "../src/lib/queue/workers/notification.worker";
import { startAnalyticsCleanupWorker } from "../src/lib/queue/workers/analytics-cleanup.worker";
import { startAssignmentSlaWorker } from "../src/lib/queue/workers/assignment-sla.worker";
import { startModelGenerationWorker } from "../src/lib/queue/workers/model-generation.worker";
import { startMeshProcessingWorker } from "../src/lib/queue/workers/mesh-processing.worker";
import { startWhatsAppOutboundWorker } from "../src/lib/queue/workers/whatsapp-outbound.worker";
import { startWaInboundWorker } from "../src/lib/queue/workers/wa-inbound.worker";
import { startModelApprovalSlaWorker } from "../src/lib/queue/workers/model-approval-sla.worker";
import {
  getPreviewCleanupQueue,
  getScoringEvaluationsCleanupQueue,
  getAnalyticsCleanupQueue,
  getAssignmentSlaQueue,
  getModelApprovalSlaQueue,
} from "../src/lib/queue/queues";

console.log("Starting BullMQ workers...");

const emailWorker = startEmailWorker();
const previewWorker = startPreviewGenerationWorker();
const cleanupWorker = startPreviewCleanupWorker();
const paymentDeadlineWorker = startPaymentDeadlineWorker();
const dekontOcrWorker = startDekontOcrWorker();
const scoringEvalCleanupWorker = startScoringEvaluationsCleanupWorker();
const notificationWorker = startNotificationWorker();
const analyticsCleanupWorker = startAnalyticsCleanupWorker();
const assignmentSlaWorker = startAssignmentSlaWorker();
// Auto-3D: Meshy generation (short API calls, self-re-enqueuing) and mesh
// processing (python, CPU-bound, concurrency 1).
const modelGenerationWorker = startModelGenerationWorker();
const meshProcessingWorker = startMeshProcessingWorker();
// WhatsApp channel. Both are inert until platform_flags.wa_bot_enabled is on.
const whatsappOutboundWorker = startWhatsAppOutboundWorker();
const waInboundWorker = startWaInboundWorker();
// A paid order parked in `awaiting_customer_approval` prints nothing until
// somebody decides; this sweeper is that somebody.
const modelApprovalSlaWorker = startModelApprovalSlaWorker();

// Schedule repeatable cleanup job (every hour)
getPreviewCleanupQueue().upsertJobScheduler(
  "preview-cleanup-hourly",
  { every: 3600000 },
  { name: "preview-cleanup" }
);

// Q7: drop manufacturer_assignment_evaluations older than 30d, daily.
getScoringEvaluationsCleanupQueue().upsertJobScheduler(
  "scoring-evaluations-cleanup-daily",
  { every: 24 * 3600 * 1000 },
  { name: "scoring-evaluations-cleanup" }
);

// Analytics retention: drop analytics_events older than the retention window
// (default 180d), daily, so the funnel log doesn't grow unbounded.
getAnalyticsCleanupQueue().upsertJobScheduler(
  "analytics-cleanup-daily",
  { every: 24 * 3600 * 1000 },
  { name: "analytics-cleanup" }
);

// The assignment email promises a 24h accept/decline; flag the ones that blow
// through it so an admin can reassign instead of noticing by accident.
getAssignmentSlaQueue().upsertJobScheduler(
  "assignment-sla-hourly",
  { every: 3600000 },
  { name: "assignment-sla" }
);

// 48h auto-approve (only a clean `pass`), 72h customer reminder, 7d admin
// escalation. DB-backed scheduler so it survives a Redis restart.
getModelApprovalSlaQueue().upsertJobScheduler(
  "model-approval-sla-6h",
  { every: 6 * 3600 * 1000 },
  { name: "model-approval-sla" }
);

console.log("All workers started:");
console.log("  - email (concurrency: 5)");
console.log("  - preview-generation (concurrency: 3)");
console.log("  - preview-cleanup (repeatable: every 1h)");
console.log("  - payment-deadline (concurrency: 2)");
console.log("  - dekont-ocr (concurrency: 2)");
console.log("  - scoring-evaluations-cleanup (repeatable: every 24h)");
console.log("  - notification (concurrency: 5)");
console.log("  - analytics-cleanup (repeatable: every 24h)");
console.log("  - assignment-sla (repeatable: every 1h)");
console.log("  - model-generation (concurrency: 4, meshy)");
console.log("  - mesh-processing (concurrency: 1, python)");
console.log("  - wa-outbound (concurrency: 4, 40/min)");
console.log("  - wa-inbound (concurrency: 4)");
console.log("  - model-approval-sla (repeatable: every 6h)");

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    emailWorker.close(),
    previewWorker.close(),
    cleanupWorker.close(),
    paymentDeadlineWorker.close(),
    dekontOcrWorker.close(),
    scoringEvalCleanupWorker.close(),
    notificationWorker.close(),
    analyticsCleanupWorker.close(),
    assignmentSlaWorker.close(),
    modelGenerationWorker.close(),
    meshProcessingWorker.close(),
    whatsappOutboundWorker.close(),
    waInboundWorker.close(),
    modelApprovalSlaWorker.close(),
  ]);
  console.log("Workers shut down gracefully");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
