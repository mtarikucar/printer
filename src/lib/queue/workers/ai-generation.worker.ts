import { Worker, Job } from "bullmq";
import { desc, eq, and, inArray, sql } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { getMeshProcessingQueue, type AiGenerationJobData } from "../queues";
import { generateWithMeshy } from "../../services/meshy";
import { saveFile, getPublicUrl, fileExists } from "../../services/storage";
import { applyStyleTransfer, type FigurineStyle, type StyleModifier } from "../../services/style-transfer";
import { db } from "../../db";
import { orders, generationAttempts } from "../../db/schema";
import { getEmailQueue } from "../queues";
import { nanoid } from "nanoid";

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function processJob(job: Job<AiGenerationJobData>) {
  const { orderId, imageUrl } = job.data;
  const style = (job.data.style || "realistic") as FigurineStyle;
  const modifiers = (job.data.modifiers ?? []) as StyleModifier[];

  // ─── Idempotency check ───────────────────────────────────────
  // BullMQ retries call this function with the same job.id on transient
  // failures (network blips, DB hiccups). Without this guard each retry
  // would re-bill Meshy ($0.40/call) and produce duplicate GLBs. If a
  // previous attempt already succeeded for this order, just re-enqueue
  // the downstream mesh-processing job and return.
  const existingSucceeded = await db
    .select()
    .from(generationAttempts)
    .where(
      and(
        eq(generationAttempts.orderId, orderId),
        eq(generationAttempts.status, "succeeded")
      )
    )
    .orderBy(desc(generationAttempts.createdAt))
    .limit(1);

  if (existingSucceeded.length > 0 && existingSucceeded[0].outputGlbUrl) {
    // Extract glbKey from the stored URL.
    const match = existingSucceeded[0].outputGlbUrl.match(
      /\/api\/files\/([^?]+)/
    );
    const glbKey = match?.[1];
    // Defense-in-depth: the URL is sourced from the DB but if a future
    // migration ever lets external input flow in, traversal would slip
    // through. Require the storage prefix and reject `..`.
    if (
      glbKey &&
      glbKey.startsWith("models/") &&
      !glbKey.includes("..") &&
      // Confirm the file is still on disk — admin may have pruned it.
      // Use `fileExists` (fs.access) instead of reading the file — GLBs can
      // be 10-50 MB and we'd OOM under heavy retry load.
      (await fileExists(glbKey))
    ) {
      job.log(
        `Order ${orderId} already has a succeeded generation; re-enqueueing mesh-processing without re-billing Meshy.`
      );
      await getMeshProcessingQueue().add("process-mesh", {
        orderId,
        generationId: existingSucceeded[0].id,
        glbUrl: existingSucceeded[0].outputGlbUrl,
        glbKey,
      });
      return;
    }
    job.log(
      `Order ${orderId} had a prior succeeded attempt but the GLB is unreadable (deleted/moved). Falling through to fresh generation.`
    );
  }

  // Update order status to generating — only if still in an expected state
  // This prevents BullMQ retries from overwriting admin-initiated status changes (reject, force-review)
  const [updated] = await db
    .update(orders)
    .set({ status: "generating", updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), inArray(orders.status, ["paid", "generating", "failed_generation"])))
    .returning();

  if (!updated) {
    job.log(`Order ${orderId} is no longer in a generatable state, skipping`);
    return;
  }

  // Create generation attempt record
  const attempt = await db
    .insert(generationAttempts)
    .values({
      orderId,
      provider: "meshy",
      status: "running",
      inputImageUrl: imageUrl,
    })
    .returning();

  try {
    job.log(`Starting Meshy generation (style: ${style}, modifiers: ${modifiers.join(",") || "none"})...`);
    // Apply style transfer before sending to Meshy
    const imageBuffer = await downloadFile(imageUrl);
    const styledBuffer = await applyStyleTransfer(imageBuffer, style, modifiers);
    const styledBase64 = `data:image/png;base64,${styledBuffer.toString("base64")}`;
    const result = await generateWithMeshy(styledBase64, style);

    await db
      .update(generationAttempts)
      .set({
        status: "succeeded",
        providerTaskId: result.taskId,
        durationMs: result.durationMs,
        costCents: 40, // $0.40
        updatedAt: new Date(),
      })
      .where(eq(generationAttempts.id, attempt[0].id));

    // Download GLB and save to local storage
    const glbBuffer = await downloadFile(result.glbUrl);
    const glbFilename = `${nanoid()}.glb`;
    const glbKey = await saveFile(glbBuffer, `models/${orderId}`, glbFilename);
    const localGlbUrl = getPublicUrl(glbKey);

    // Update generation attempt with local URL
    await db
      .update(generationAttempts)
      .set({ outputGlbUrl: localGlbUrl, updatedAt: new Date() })
      .where(eq(generationAttempts.id, attempt[0].id));

    // Enqueue mesh processing
    await getMeshProcessingQueue().add("process-mesh", {
      orderId,
      generationId: attempt[0].id,
      glbUrl: localGlbUrl,
      glbKey,
    });

    job.log("Successfully generated with Meshy, enqueued mesh processing");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "unknown";
    job.log(`Meshy generation failed: ${msg}`);

    await db
      .update(generationAttempts)
      .set({
        status: "failed",
        errorMessage: msg,
        updatedAt: new Date(),
      })
      .where(eq(generationAttempts.id, attempt[0].id));

    // Update order as failed with atomic retryCount increment
    await db
      .update(orders)
      .set({
        status: "failed_generation",
        failureReason: `Meshy: ${msg}`,
        retryCount: sql`${orders.retryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    // Notify customer
    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (order) {
      await getEmailQueue().add("generation-failed", {
        type: "generation_failed",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
      });
    }

    throw new Error(`Meshy generation failed: ${msg}`);
  }
}

export function startAiGenerationWorker() {
  const worker = new Worker<AiGenerationJobData>(
    "ai-generation",
    processJob,
    {
      connection: getRedisConnection(),
      concurrency: 3,
      limiter: { max: 5, duration: 60000 },
    }
  );

  worker.on("completed", (job) => {
    console.info(`AI generation completed for order ${job.data.orderId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`AI generation failed for order ${job?.data.orderId}:`, error.message);
  });

  return worker;
}
