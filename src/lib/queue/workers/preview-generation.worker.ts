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
  // Resolve the photo set: a multi-image fusion set (object/realistic with
  // extra reference photos) or the single primary photo. The API already
  // collapses this to one key for stylized templates, so this just mirrors it.
  const photoKeys =
    job.data.photoKeys && job.data.photoKeys.length > 0
      ? job.data.photoKeys
      : [photoKey];

  try {
    console.log(`[preview ${previewId}] Style: ${style}, modifiers: ${JSON.stringify(modifiers)}, photos: ${photoKeys.length}, job data:`, JSON.stringify(job.data));
    job.log(`Starting Meshy preview generation (style: ${style}, modifiers: ${modifiers.join(",") || "none"}, photos: ${photoKeys.length})...`);

    // Read + style-transfer each photo. For non-stylized templates with no
    // modifiers applyStyleTransfer is a passthrough (raw buffer), so a
    // multi-photo object/realistic request incurs no extra FLUX cost. The
    // styled images are saved so Meshy can fetch them by URL in production.
    const styled: { buffer: Buffer; url: string }[] = [];
    for (let i = 0; i < photoKeys.length; i++) {
      const imageBuffer = await getFileBuffer(photoKeys[i]);
      const styledBuffer = await applyStyleTransfer(imageBuffer, style, modifiers);
      const styledFilename = `styled-${i}-${nanoid()}.png`;
      const styledKey = await saveFile(styledBuffer, `previews/${previewId}`, styledFilename);
      styled.push({ buffer: styledBuffer, url: getPublicUrl(styledKey) });
    }
    job.log(`Styled ${styled.length} image(s): ${styled.map((s) => s.url).join(", ")}`);

    // In production, send public URLs to Meshy; locally use base64 (Meshy can't
    // reach localhost). Multiple photos → image_urls[] (multi-image-to-3d);
    // single photo → scalar image_url (image-to-3d).
    const toMeshyInput = (s: { buffer: Buffer; url: string }) =>
      s.url.includes("localhost") || s.url.includes("127.0.0.1")
        ? `data:image/png;base64,${s.buffer.toString("base64")}`
        : s.url;
    const meshyInput =
      styled.length > 1 ? styled.map(toMeshyInput) : toMeshyInput(styled[0]);
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
