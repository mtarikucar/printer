import { Worker, Job } from "bullmq";
import { lt } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { db } from "../../db";
import { manufacturerAssignmentEvaluations } from "../../db/schema";

/**
 * Q7 retention cleanup. Manufacturer scoring evaluation rows are written on
 * every assignment + N12 retry. After cutover the table is only useful for
 * recent diagnostics — we keep 30 days and drop older rows so the table
 * doesn't grow unbounded.
 *
 * Mirrors the preview-cleanup worker pattern (hourly schedule, console
 * logging via job.log).
 */
const RETENTION_DAYS = 30;

async function processJob(job: Job) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const result = await db
    .delete(manufacturerAssignmentEvaluations)
    .where(lt(manufacturerAssignmentEvaluations.createdAt, cutoff))
    .returning({ id: manufacturerAssignmentEvaluations.id });

  job.log(
    `Deleted ${result.length} scoring evaluations older than ${RETENTION_DAYS}d`
  );
}

export function startScoringEvaluationsCleanupWorker() {
  const worker = new Worker("scoring-evaluations-cleanup", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    console.info(`scoring-evaluations-cleanup completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`scoring-evaluations-cleanup failed:`, error.message);
  });

  return worker;
}
