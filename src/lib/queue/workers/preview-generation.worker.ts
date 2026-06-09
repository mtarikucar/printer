import { Worker, Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import type { PreviewGenerationJobData } from "../queues";
import { generateWithMeshy } from "../../services/meshy";
import { saveFile, getPublicUrl, getFileBuffer } from "../../services/storage";
import { applyStyleTransfer, type FigurineStyle, type StyleModifier } from "../../services/style-transfer";
import { db } from "../../db";
import { previews } from "../../db/schema";
import { nanoid } from "nanoid";

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
    const result = await generateWithMeshy(meshyInput, style);

    // Download GLB and save to local storage
    const glbBuffer = await downloadFile(result.glbUrl);
    const glbFilename = `${nanoid()}.glb`;
    const glbKey = await saveFile(glbBuffer, `previews/${previewId}`, glbFilename);
    const localGlbUrl = getPublicUrl(glbKey);

    // Best-effort: persist Meshy's OBJ + STL exports alongside the GLB so the
    // customer can download the preview in a print/edit-friendly format. These
    // are non-critical (the GLB is what the 3D viewer needs), so a download
    // failure just leaves that format unavailable rather than failing the
    // whole preview.
    const persistOptional = async (
      url: string | null,
      ext: "obj" | "stl"
    ): Promise<{ url: string; key: string } | null> => {
      if (!url) return null;
      try {
        const buffer = await downloadFile(url);
        const key = await saveFile(buffer, `previews/${previewId}`, `${nanoid()}.${ext}`);
        return { url: getPublicUrl(key), key };
      } catch (err) {
        job.log(`${ext.toUpperCase()} download/save failed (non-fatal): ${err instanceof Error ? err.message : "unknown"}`);
        return null;
      }
    };
    const obj = await persistOptional(result.objUrl, "obj");
    const stl = await persistOptional(result.stlUrl, "stl");

    // Guarded transition: only flip to "ready" when we still own the record
    // (status === "generating") AND we actually have a glbUrl. Without this
    // guard a worker crash mid-update could leave status="ready" but
    // glbUrl=null, which the 3D viewer can't handle.
    const [flipped] = await db
      .update(previews)
      .set({
        status: "ready",
        glbUrl: localGlbUrl,
        glbKey,
        objUrl: obj?.url ?? null,
        objKey: obj?.key ?? null,
        stlUrl: stl?.url ?? null,
        stlKey: stl?.key ?? null,
        meshyTaskId: result.taskId,
        durationMs: result.durationMs,
        updatedAt: new Date(),
      })
      .where(
        and(eq(previews.id, previewId), eq(previews.status, "generating"))
      )
      .returning({ id: previews.id });

    if (!flipped) {
      job.log(
        "Preview status was already terminal (canceled/failed/ready) — skipping update"
      );
      return;
    }

    job.log("Preview generation completed successfully");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unknown";
    job.log(`Preview generation failed: ${msg}`);

    await db
      .update(previews)
      .set({
        status: "failed",
        errorMessage: msg,
        updatedAt: new Date(),
      })
      .where(eq(previews.id, previewId));

    throw new Error(`Preview generation failed: ${msg}`);
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
    console.info(`Preview generation completed for preview ${job.data.previewId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Preview generation failed for preview ${job?.data.previewId}:`, error.message);
  });

  return worker;
}
