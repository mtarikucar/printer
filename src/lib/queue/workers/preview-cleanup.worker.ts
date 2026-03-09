import { Worker, Job } from "bullmq";
import { and, lt, inArray, notInArray, sql } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { db } from "../../db";
import { previews, orders } from "../../db/schema";
import { deleteFile } from "../../services/storage";

const BATCH_SIZE = 50;
const EXPIRY_DAYS = 30;

async function processJob(job: Job) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EXPIRY_DAYS);

  // Find preview IDs that have an order (should not be deleted)
  const orderedPreviewIds = db
    .select({ previewId: orders.previewId })
    .from(orders)
    .where(sql`${orders.previewId} IS NOT NULL`);

  const expiredPreviews = await db.query.previews.findMany({
    where: and(
      lt(previews.createdAt, cutoff),
      inArray(previews.status, ["ready", "failed", "expired"]),
      notInArray(previews.id, orderedPreviewIds)
    ),
    columns: {
      id: true,
      glbKey: true,
      photoKey: true,
    },
    limit: BATCH_SIZE,
  });

  if (expiredPreviews.length === 0) {
    job.log("No expired previews to clean up");
    return;
  }

  let deleted = 0;
  for (const preview of expiredPreviews) {
    try {
      if (preview.glbKey) {
        await deleteFile(preview.glbKey);
      }
      if (preview.photoKey) {
        await deleteFile(preview.photoKey);
      }
      await db.delete(previews).where(sql`${previews.id} = ${preview.id}`);
      deleted++;
    } catch (error) {
      job.log(`Failed to clean preview ${preview.id}: ${error}`);
    }
  }

  job.log(`Cleaned up ${deleted}/${expiredPreviews.length} expired previews`);
}

export function startPreviewCleanupWorker() {
  const worker = new Worker("preview-cleanup", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    console.log(`Preview cleanup completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Preview cleanup failed:`, error.message);
  });

  return worker;
}
