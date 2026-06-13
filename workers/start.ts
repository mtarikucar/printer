import "dotenv/config";
import { startAiGenerationWorker } from "../src/lib/queue/workers/ai-generation.worker";
import { startMeshProcessingWorker } from "../src/lib/queue/workers/mesh-processing.worker";
import { startEmailWorker } from "../src/lib/queue/workers/email.worker";
import { startPreviewGenerationWorker } from "../src/lib/queue/workers/preview-generation.worker";
import { startPreviewCleanupWorker } from "../src/lib/queue/workers/preview-cleanup.worker";
import { startPaymentDeadlineWorker } from "../src/lib/queue/workers/payment-deadline.worker";
import { startDekontOcrWorker } from "../src/lib/queue/workers/dekont-ocr.worker";
import { startScoringEvaluationsCleanupWorker } from "../src/lib/queue/workers/scoring-evaluations-cleanup.worker";
import { startNotificationWorker } from "../src/lib/queue/workers/notification.worker";
import { startAnalyticsCleanupWorker } from "../src/lib/queue/workers/analytics-cleanup.worker";
import {
  getPreviewCleanupQueue,
  getScoringEvaluationsCleanupQueue,
  getAnalyticsCleanupQueue,
} from "../src/lib/queue/queues";

console.log("Starting BullMQ workers...");

const aiWorker = startAiGenerationWorker();
const meshWorker = startMeshProcessingWorker();
const emailWorker = startEmailWorker();
const previewWorker = startPreviewGenerationWorker();
const cleanupWorker = startPreviewCleanupWorker();
const paymentDeadlineWorker = startPaymentDeadlineWorker();
const dekontOcrWorker = startDekontOcrWorker();
const scoringEvalCleanupWorker = startScoringEvaluationsCleanupWorker();
const notificationWorker = startNotificationWorker();
const analyticsCleanupWorker = startAnalyticsCleanupWorker();

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

console.log("All workers started:");
console.log("  - ai-generation (concurrency: 3)");
console.log("  - mesh-processing (concurrency: 2)");
console.log("  - email (concurrency: 5)");
console.log("  - preview-generation (concurrency: 3)");
console.log("  - preview-cleanup (repeatable: every 1h)");
console.log("  - payment-deadline (concurrency: 2)");
console.log("  - dekont-ocr (concurrency: 2)");
console.log("  - scoring-evaluations-cleanup (repeatable: every 24h)");
console.log("  - notification (concurrency: 5)");
console.log("  - analytics-cleanup (repeatable: every 24h)");

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    aiWorker.close(),
    meshWorker.close(),
    emailWorker.close(),
    previewWorker.close(),
    cleanupWorker.close(),
    paymentDeadlineWorker.close(),
    dekontOcrWorker.close(),
    scoringEvalCleanupWorker.close(),
    notificationWorker.close(),
    analyticsCleanupWorker.close(),
  ]);
  console.log("Workers shut down gracefully");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
