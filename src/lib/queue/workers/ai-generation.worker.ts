import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { getMeshProcessingQueue, type AiGenerationJobData } from "../queues";
import { generateWithMeshy } from "../../services/meshy";
import { saveFile, getPublicUrl } from "../../services/storage";
import { db } from "../../db";
import { orders, generationAttempts, orderPhotos } from "../../db/schema";
import { getEmailQueue } from "../queues";
import { nanoid } from "nanoid";

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function processJob(job: Job<AiGenerationJobData>) {
  const { orderId, imageUrl } = job.data;

  // Update order status to generating
  await db
    .update(orders)
    .set({ status: "generating", updatedAt: new Date() })
    .where(eq(orders.id, orderId));

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
    job.log("Starting Meshy generation...");
    const result = await generateWithMeshy(imageUrl);

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
  } catch (error: any) {
    job.log(`Meshy generation failed: ${error.message}`);

    await db
      .update(generationAttempts)
      .set({
        status: "failed",
        errorMessage: error.message,
        updatedAt: new Date(),
      })
      .where(eq(generationAttempts.id, attempt[0].id));

    // Update order as failed
    const currentOrder = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    await db
      .update(orders)
      .set({
        status: "failed_generation",
        failureReason: `Meshy: ${error.message}`,
        retryCount: (currentOrder?.retryCount ?? 0) + 1,
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

    throw new Error(`Meshy generation failed: ${error.message}`);
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
    console.log(`AI generation completed for order ${job.data.orderId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`AI generation failed for order ${job?.data.orderId}:`, error.message);
  });

  return worker;
}
