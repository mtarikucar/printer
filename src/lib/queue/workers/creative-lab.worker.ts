import { Worker, Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import type { CreativeLabJobData } from "../queues";
import {
  generateCreativeLabProduct,
  type CreativeLabProduct,
} from "../../services/creative-lab";
import { saveFile, getPublicUrl, getFileBuffer } from "../../services/storage";
import { db } from "../../db";
import { creativeLabJobs } from "../../db/schema";
import { nanoid } from "nanoid";

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Meshy fetches public URLs in production; locally send base64 (can't reach localhost).
function toMeshyInput(buffer: Buffer, url: string): string {
  return url.includes("localhost") || url.includes("127.0.0.1")
    ? `data:image/png;base64,${buffer.toString("base64")}`
    : url;
}

async function processJob(job: Job<CreativeLabJobData>) {
  const { jobId, product, photoKey } = job.data;
  try {
    job.log(`Creative Lab ${product} starting for job ${jobId}`);
    const buf = await getFileBuffer(photoKey);
    const imageInput = toMeshyInput(buf, getPublicUrl(photoKey));
    const result = await generateCreativeLabProduct(product as CreativeLabProduct, imageInput);

    const persist = async (url: string | null, ext: "glb" | "stl") => {
      if (!url) return null;
      const buffer = await downloadFile(url);
      const key = await saveFile(buffer, `creative-lab/${jobId}`, `${nanoid()}.${ext}`);
      return { url: getPublicUrl(key), key };
    };
    const glb = await persist(result.glbUrl, "glb");
    const stl = await persist(result.stlUrl, "stl");

    if (!glb && !stl) throw new Error("Creative Lab returned no model");

    const [flipped] = await db
      .update(creativeLabJobs)
      .set({
        status: "ready",
        glbUrl: glb?.url ?? null,
        glbKey: glb?.key ?? null,
        stlUrl: stl?.url ?? null,
        stlKey: stl?.key ?? null,
        prototypeTaskId: result.prototypeTaskId,
        buildTaskId: result.buildTaskId,
        updatedAt: new Date(),
      })
      .where(and(eq(creativeLabJobs.id, jobId), eq(creativeLabJobs.status, "generating")))
      .returning({ id: creativeLabJobs.id });
    if (!flipped) job.log("creative-lab job no longer 'generating' — skipping update");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unknown";
    job.log(`Creative Lab failed: ${msg}`);
    await db
      .update(creativeLabJobs)
      .set({ status: "failed", errorMessage: msg, updatedAt: new Date() })
      .where(eq(creativeLabJobs.id, jobId));
    throw new Error(`Creative Lab failed: ${msg}`);
  }
}

export function startCreativeLabWorker() {
  const worker = new Worker<CreativeLabJobData>("creative-lab", processJob, {
    connection: getRedisConnection(),
    concurrency: 2,
    limiter: { max: 5, duration: 60000 },
  });
  worker.on("failed", (job, error) =>
    console.error(`creative-lab failed for job ${job?.data.jobId}:`, error.message),
  );
  return worker;
}
