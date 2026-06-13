import { Worker, Job } from "bullmq";
import { lt } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { db } from "../../db";
import { analyticsEvents } from "../../db/schema";

/**
 * Retention cleanup for the analytics_events funnel log. A row is written for
 * every tracked event (including page views), so the table would grow unbounded
 * without pruning. We keep ANALYTICS_RETENTION_DAYS (default 180) — long enough
 * for the admin dashboard's longest range — and drop older rows daily.
 *
 * Mirrors the scoring-evaluations-cleanup worker pattern.
 */
const RETENTION_DAYS = Number(process.env.ANALYTICS_RETENTION_DAYS ?? "180");

async function processJob(job: Job) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const result = await db
    .delete(analyticsEvents)
    .where(lt(analyticsEvents.createdAt, cutoff))
    .returning({ id: analyticsEvents.id });

  job.log(`Deleted ${result.length} analytics events older than ${RETENTION_DAYS}d`);
}

export function startAnalyticsCleanupWorker() {
  const worker = new Worker("analytics-cleanup", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    console.info(`analytics-cleanup completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`analytics-cleanup failed:`, error.message);
  });

  return worker;
}
