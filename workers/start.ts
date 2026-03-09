import "dotenv/config";
import { startAiGenerationWorker } from "../src/lib/queue/workers/ai-generation.worker";
import { startMeshProcessingWorker } from "../src/lib/queue/workers/mesh-processing.worker";
import { startEmailWorker } from "../src/lib/queue/workers/email.worker";
import { startPreviewGenerationWorker } from "../src/lib/queue/workers/preview-generation.worker";
import { startPreviewCleanupWorker } from "../src/lib/queue/workers/preview-cleanup.worker";
import { getPreviewCleanupQueue } from "../src/lib/queue/queues";

console.log("Starting BullMQ workers...");

const aiWorker = startAiGenerationWorker();
const meshWorker = startMeshProcessingWorker();
const emailWorker = startEmailWorker();
const previewWorker = startPreviewGenerationWorker();
const cleanupWorker = startPreviewCleanupWorker();

// Schedule repeatable cleanup job (every hour)
getPreviewCleanupQueue().upsertJobScheduler(
  "preview-cleanup-hourly",
  { every: 3600000 },
  { name: "preview-cleanup" }
);

console.log("All workers started:");
console.log("  - ai-generation (concurrency: 3)");
console.log("  - mesh-processing (concurrency: 2)");
console.log("  - email (concurrency: 5)");
console.log("  - preview-generation (concurrency: 3)");
console.log("  - preview-cleanup (repeatable: every 1h)");

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    aiWorker.close(),
    meshWorker.close(),
    emailWorker.close(),
    previewWorker.close(),
    cleanupWorker.close(),
  ]);
  console.log("Workers shut down gracefully");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
