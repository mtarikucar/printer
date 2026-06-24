import { Worker, Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import {
  getPreviewGenerationQueue,
  type PreviewGenerationJobData,
  type PreviewBuildJobData,
} from "../queues";
import { generateWithMeshy } from "../../services/meshy";
import {
  meshyImageToImage,
  backViewPrompt,
  VARIATION_NUDGES,
  DEFAULT_IMAGE_MODEL,
} from "../../services/meshy-image";
import { saveFile, getPublicUrl, getFileBuffer } from "../../services/storage";
import {
  buildTemplatePrompt,
  getTemplate,
  type FigurineStyle,
  type StyleModifier,
} from "../../create/design-templates";
import { db } from "../../db";
import { previews } from "../../db/schema";
import { nanoid } from "nanoid";

// Number of 2D variations to generate in Stage A.
const VARIATION_COUNT = 2;

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Meshy fetches public URLs in production; locally it can't reach localhost, so
// send the bytes as a base64 data URI instead.
function toMeshyInput(buffer: Buffer, url: string): string {
  return url.includes("localhost") || url.includes("127.0.0.1")
    ? `data:image/png;base64,${buffer.toString("base64")}`
    : url;
}

// ── Stage A: generate 2 stylized 2D variations (or, for non-stylized templates,
// skip straight to the 3D build with the raw photo). ──────────────────────────
async function generateVariations(job: Job<PreviewGenerationJobData>) {
  const { previewId, photoKey } = job.data;
  const style = (job.data.style || "realistic") as FigurineStyle;
  const modifiers = (job.data.modifiers ?? []) as StyleModifier[];
  const photoKeys =
    job.data.photoKeys && job.data.photoKeys.length > 0
      ? job.data.photoKeys
      : [photoKey];
  const tpl = getTemplate(style);

  try {
    job.log(`Stage A (style: ${style}, stylize: ${!!tpl?.stylize})`);

    // Non-stylized (realistic/object/unknown): no restyle, so there is nothing to
    // choose between — go straight to Stage B with the raw photo(s).
    if (!tpl || !tpl.stylize) {
      await db
        .update(previews)
        .set({ status: "building", updatedAt: new Date() })
        .where(and(eq(previews.id, previewId), eq(previews.status, "generating")));
      await getPreviewGenerationQueue().add("build-from-selection", {
        previewId,
        style,
        rawPhotoKeys: photoKeys,
        modifiers,
      } satisfies PreviewBuildJobData);
      return;
    }

    // Stylized: run the PRIMARY photo through image-to-image N times, nudging the
    // prompt each time so the variations differ (the API has no seed/n param).
    const basePrompt = buildTemplatePrompt(style, modifiers)!;
    const photoBuf = await getFileBuffer(photoKey);
    const ref = toMeshyInput(photoBuf, getPublicUrl(photoKey));

    const urls: string[] = [];
    for (let i = 0; i < VARIATION_COUNT; i++) {
      const nudge = VARIATION_NUDGES[i % VARIATION_NUDGES.length];
      const r = await meshyImageToImage([ref], `${basePrompt} ${nudge}`, DEFAULT_IMAGE_MODEL);
      const buf = await downloadFile(r.imageUrl);
      const key = await saveFile(buf, `previews/${previewId}`, `var-${i}-${nanoid()}.png`);
      urls.push(getPublicUrl(key));
      job.log(`variation ${i} ok (credits ${r.consumedCredits})`);
    }

    const [flipped] = await db
      .update(previews)
      .set({ status: "styled", styledImageUrls: urls, updatedAt: new Date() })
      .where(and(eq(previews.id, previewId), eq(previews.status, "generating")))
      .returning({ id: previews.id });
    if (!flipped) job.log("preview no longer 'generating' — skipping update");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unknown";
    job.log(`Stage A failed: ${msg}`);
    await db
      .update(previews)
      .set({ status: "failed", errorMessage: msg, updatedAt: new Date() })
      .where(eq(previews.id, previewId));
    throw new Error(`Stage A failed: ${msg}`);
  }
}

// ── Stage B: back-view (stylized only) + multi-image-to-3d → ready. ───────────
async function buildFromSelection(job: Job<PreviewBuildJobData>) {
  const { previewId, selectedUrl, rawPhotoKeys } = job.data;
  const style = (job.data.style || "realistic") as FigurineStyle;

  try {
    let meshyInputs: string | string[];

    if (selectedUrl) {
      // Stylized path: generate the back view of the SELECTED character, then
      // feed [front, back] to multi-image-to-3d for real rear coverage.
      const frontBuf = await downloadFile(selectedUrl);
      const frontInput = toMeshyInput(frontBuf, selectedUrl);

      let backInput: string | null = null;
      try {
        const back = await meshyImageToImage([frontInput], backViewPrompt(), DEFAULT_IMAGE_MODEL);
        const backBuf = await downloadFile(back.imageUrl);
        const backKey = await saveFile(backBuf, `previews/${previewId}`, `back-${nanoid()}.png`);
        const backUrl = getPublicUrl(backKey);
        backInput = toMeshyInput(backBuf, backUrl);
        await db.update(previews).set({ backImageUrl: backUrl }).where(eq(previews.id, previewId));
        job.log(`back-view ok (credits ${back.consumedCredits})`);
      } catch (e) {
        job.log(
          `back-view failed (non-fatal, falling back to single image): ${e instanceof Error ? e.message : "?"}`,
        );
      }

      meshyInputs = backInput ? [frontInput, backInput] : frontInput;
    } else {
      // Non-stylized path: raw photo(s) straight to 3D (multi-image fusion when
      // the customer added extra reference angles).
      const keys = rawPhotoKeys && rawPhotoKeys.length > 0 ? rawPhotoKeys : [];
      const inputs = await Promise.all(
        keys.map(async (k) => toMeshyInput(await getFileBuffer(k), getPublicUrl(k))),
      );
      meshyInputs = inputs.length > 1 ? inputs : inputs[0];
    }

    const result = await generateWithMeshy(meshyInputs, style);

    const glbBuffer = await downloadFile(result.glbUrl);
    const glbKey = await saveFile(glbBuffer, `previews/${previewId}`, `${nanoid()}.glb`);
    const localGlbUrl = getPublicUrl(glbKey);

    // Best-effort OBJ/STL persistence (non-critical — the GLB drives the viewer).
    const persistOptional = async (
      url: string | null,
      ext: "obj" | "stl",
    ): Promise<{ url: string; key: string } | null> => {
      if (!url) return null;
      try {
        const buffer = await downloadFile(url);
        const key = await saveFile(buffer, `previews/${previewId}`, `${nanoid()}.${ext}`);
        return { url: getPublicUrl(key), key };
      } catch (err) {
        job.log(`${ext.toUpperCase()} save failed (non-fatal): ${err instanceof Error ? err.message : "?"}`);
        return null;
      }
    };
    const obj = await persistOptional(result.objUrl, "obj");
    const stl = await persistOptional(result.stlUrl, "stl");

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
      .where(and(eq(previews.id, previewId), eq(previews.status, "building")))
      .returning({ id: previews.id });
    if (!flipped) job.log("preview no longer 'building' — skipping update");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unknown";
    job.log(`Stage B failed: ${msg}`);
    await db
      .update(previews)
      .set({ status: "failed", errorMessage: msg, updatedAt: new Date() })
      .where(eq(previews.id, previewId));
    throw new Error(`Stage B failed: ${msg}`);
  }
}

export function startPreviewGenerationWorker() {
  const worker = new Worker<PreviewGenerationJobData | PreviewBuildJobData>(
    "preview-generation",
    async (job) => {
      if (job.name === "build-from-selection") {
        return buildFromSelection(job as Job<PreviewBuildJobData>);
      }
      return generateVariations(job as Job<PreviewGenerationJobData>);
    },
    {
      connection: getRedisConnection(),
      concurrency: 3,
      limiter: { max: 5, duration: 60000 },
    },
  );

  worker.on("completed", (job) => {
    console.info(`Preview job '${job.name}' completed for preview ${job.data.previewId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Preview job failed for preview ${job?.data.previewId}:`, error.message);
  });

  return worker;
}
