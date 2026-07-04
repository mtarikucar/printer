import { Worker, Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { type PreviewGenerationJobData } from "../queues";
import { falNanoBananaEdit, VARIATION_NUDGES } from "../../services/fal-image";
import { saveFile, getPublicUrl, getFileBuffer } from "../../services/storage";
import {
  buildTemplatePrompt,
  type FigurineStyle,
  type StyleModifier,
} from "../../create/design-templates";
import { db } from "../../db";
import { previews } from "../../db/schema";
import { nanoid } from "nanoid";

// Number of stylized image variations to generate.
const VARIATION_COUNT = 2;

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// fal fetches public URLs in production; locally it can't reach localhost, so
// send the bytes as a base64 data URI instead.
function toFalInput(buffer: Buffer, url: string): string {
  return url.includes("localhost") || url.includes("127.0.0.1")
    ? `data:image/png;base64,${buffer.toString("base64")}`
    : url;
}

// Generate VARIATION_COUNT stylized figure IMAGES via fal.ai, nudging the prompt
// each time so the variations differ (fal has no seed/n param). The customer
// then picks + approves one image; there is NO automatic 3D — the admin sculpts
// and uploads the model after payment.
async function generateVariations(job: Job<PreviewGenerationJobData>) {
  const { previewId, photoKey } = job.data;
  const style = (job.data.style || "realistic") as FigurineStyle;
  const modifiers = (job.data.modifiers ?? []) as StyleModifier[];
  const photoKeys =
    job.data.photoKeys && job.data.photoKeys.length > 0
      ? job.data.photoKeys
      : [photoKey];

  try {
    job.log(`Generating ${VARIATION_COUNT} variations (style: ${style})`);

    const basePrompt = buildTemplatePrompt(style, modifiers);
    // All provided reference photos (the generate route already caps them per
    // template) are fused by fal via image_urls.
    const refs = await Promise.all(
      photoKeys.map(async (k) => toFalInput(await getFileBuffer(k), getPublicUrl(k))),
    );

    const urls: string[] = [];
    for (let i = 0; i < VARIATION_COUNT; i++) {
      const nudge = VARIATION_NUDGES[i % VARIATION_NUDGES.length];
      const r = await falNanoBananaEdit(refs, `${basePrompt} ${nudge}`);
      const buf = await downloadFile(r.imageUrl);
      const key = await saveFile(buf, `previews/${previewId}`, `var-${i}-${nanoid()}.png`);
      urls.push(getPublicUrl(key));
      job.log(`variation ${i} ok (${r.costCents}c)`);
    }

    const [flipped] = await db
      .update(previews)
      .set({ status: "styled", styledImageUrls: urls, updatedAt: new Date() })
      .where(and(eq(previews.id, previewId), eq(previews.status, "generating")))
      .returning({ id: previews.id });
    if (!flipped) job.log("preview no longer 'generating' — skipping update");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unknown";
    job.log(`Generation failed: ${msg}`);
    await db
      .update(previews)
      .set({ status: "failed", errorMessage: msg, updatedAt: new Date() })
      .where(eq(previews.id, previewId));
    throw new Error(`Generation failed: ${msg}`);
  }
}

export function startPreviewGenerationWorker() {
  const worker = new Worker<PreviewGenerationJobData>(
    "preview-generation",
    async (job) => generateVariations(job),
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
