import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { extname } from "path";
import { getRedisConnection } from "../connection";
import type { PreviewGenerationJobData } from "../queues";
import { generateWithMeshy } from "../../services/meshy";
import { saveFile, getPublicUrl, getFileBuffer } from "../../services/storage";
import { applyStyleTransfer, type FigurineStyle, type StyleModifier } from "../../services/style-transfer";
import { db } from "../../db";
import { previews } from "../../db/schema";
import { nanoid } from "nanoid";

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp",
  };
  return types[ext] || "image/jpeg";
}

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function processJob(job: Job<PreviewGenerationJobData>) {
  const { previewId, photoKey } = job.data;
  const style = (job.data.style || "realistic") as FigurineStyle;
  const modifiers = (job.data.modifiers ?? []) as StyleModifier[];

  try {
    console.log(`[preview ${previewId}] Style: ${style}, modifiers: ${JSON.stringify(modifiers)}, job data:`, JSON.stringify(job.data));
    job.log(`Starting Meshy preview generation (style: ${style}, modifiers: ${modifiers.join(",") || "none"})...`);

    // Read image from disk and apply style transfer
    const imageBuffer = await getFileBuffer(photoKey);
    const styledBuffer = await applyStyleTransfer(imageBuffer, style, modifiers);

    // Save styled image to disk so it's accessible via URL (and viewable)
    const styledFilename = `styled-${nanoid()}.png`;
    const styledKey = await saveFile(styledBuffer, `previews/${previewId}`, styledFilename);
    const styledUrl = getPublicUrl(styledKey);
    job.log(`Styled image saved: ${styledUrl}`);

    // In production, send public URL to Meshy; locally use base64 (Meshy can't reach localhost)
    const isLocal = styledUrl.includes("localhost") || styledUrl.includes("127.0.0.1");
    const meshyInput = isLocal
      ? `data:image/png;base64,${styledBuffer.toString("base64")}`
      : styledUrl;
    const result = await generateWithMeshy(meshyInput);

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
