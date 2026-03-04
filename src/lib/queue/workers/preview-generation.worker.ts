import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import type { PreviewGenerationJobData } from "../queues";
import { generateWithMeshy } from "../../services/meshy";
import { saveFile, getPublicUrl } from "../../services/storage";
import { db } from "../../db";
import { previews } from "../../db/schema";
import { nanoid } from "nanoid";

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function processJob(job: Job<PreviewGenerationJobData>) {
  const { previewId, imageUrl } = job.data;

  try {
    job.log("Starting Meshy preview generation...");
    const result = await generateWithMeshy(imageUrl);

    // Download GLB and save to local storage
    const glbBuffer = await downloadFile(result.glbUrl);
    const glbFilename = `${nanoid()}.glb`;
    const glbKey = await saveFile(glbBuffer, `previews/${previewId}`, glbFilename);
    const localGlbUrl = getPublicUrl(glbKey);

    // Update preview record
    await db
      .update(previews)
      .set({
        status: "ready",
        glbUrl: localGlbUrl,
        glbKey,
        meshyTaskId: result.taskId,
        durationMs: result.durationMs,
        updatedAt: new Date(),
      })
      .where(eq(previews.id, previewId));

    job.log("Preview generation completed successfully");
  } catch (error: any) {
    job.log(`Preview generation failed: ${error.message}`);

    await db
      .update(previews)
      .set({
        status: "failed",
        errorMessage: error.message,
        updatedAt: new Date(),
      })
      .where(eq(previews.id, previewId));

    throw new Error(`Preview generation failed: ${error.message}`);
  }
}

export function startPreviewGenerationWorker() {
  const worker = new Worker<PreviewGenerationJobData>(
    "preview-generation",
    processJob,
    {
      connection: getRedisConnection(),
      concurrency: 3,
      limiter: { max: 5, duration: 60000 },
    }
  );

  worker.on("completed", (job) => {
    console.log(`Preview generation completed for preview ${job.data.previewId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Preview generation failed for preview ${job?.data.previewId}:`, error.message);
  });

  return worker;
}
