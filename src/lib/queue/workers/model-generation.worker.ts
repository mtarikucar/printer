/**
 * Meshy image→3D worker.
 *
 * A self-re-enqueuing state machine, not a blocking poll: one order must never
 * hold a worker slot for minutes on a single-vCPU box.
 *
 *   create → poll (×90, 10 s apart) → analyze (free) → repair → poll-repair
 *          → download the repaired GLB → hand off to `mesh-processing`
 *
 * `print/repair` is UNCONDITIONAL. Measured on 2026-08-28: raw meshy-7 output
 * had 610 disconnected shells, is_watertight false, 416 non-manifold edges and
 * 16 holes, and our mesh pipeline cannot rescue that — the union fails and the
 * concatenate fallback loses two thirds of the faces. Budget 30 credits/order.
 *
 * Money safety: the round is CLAIMED in `generation_attempts`
 * (UNIQUE(order_id, round)) BEFORE the provider POST. BullMQ marks a job
 * stalled when its lock cannot be renewed and re-runs it; `jobId` does not help
 * (it is the same job running again). The claim does: the second run finds the
 * row, re-attaches to provider_task_id, and does not buy a second task.
 */
import { Worker, Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getRedisConnection } from "../connection";
import {
  getModelGenerationQueue,
  getMeshProcessingQueue,
  type ModelGenerationJobData,
} from "../queues";
import { db } from "../../db";
import { orders, previews, generationAttempts } from "../../db/schema";
import { saveFile, getFileBuffer, fileKeyFromUrl } from "../../services/storage";
import {
  createImageTo3dTask,
  getImageTo3dTask,
  analyzePrintability,
  getPrintAnalysis,
  createPrintRepairTask,
  getPrintRepairTask,
  getCreditBalance,
  classifyTaskError,
  isTerminal,
  MESHY_CREDITS,
  MeshyError,
} from "../../services/meshy";
import { reserveSpend, settleSpend, releaseSpend } from "../../services/spend-guard";
import { isFlagEnabled } from "../../services/flags";

const MAX_POLLS = 90; // × 10 s = 15 minutes
const POLL_DELAY_MS = 10_000;
const MAX_REPAIR_POLLS = 40;
const REPAIR_POLL_DELAY_MS = 8_000;

/** Meshy sells credits at roughly $0.02; the ledger is in US cents. */
const CENTS_PER_CREDIT = Number(process.env.MESHY_CENTS_PER_CREDIT ?? 2);
const cents = (credits: number) => Math.ceil(credits * CENTS_PER_CREDIT);

/**
 * Fall back to the flow that works today. A paid order must degrade to the
 * manual path, never to an error email.
 */
async function fallbackToManual(orderId: string, why: string) {
  console.warn(`[model-generation] order=${orderId} falling back to manual: ${why}`);
  await db
    .update(orders)
    .set({ status: "awaiting_model", updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.status, "generating")));
}

async function failGeneration(orderId: string, reason: string, code: string) {
  await db
    .update(orders)
    .set({
      status: "failed_generation",
      failureReason: `${code}: ${reason}`.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, orderId), eq(orders.status, "generating")));
  console.error(`[model-generation] order=${orderId} failed code=${code}: ${reason}`);
}

/** Claim the round before spending. Never throws on a race. */
async function claimRound(orderId: string, round: number) {
  const inserted = await db
    .insert(generationAttempts)
    .values({ orderId, round, provider: "meshy", status: "pending" })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return inserted[0];

  const [existing] = await db
    .select()
    .from(generationAttempts)
    .where(and(eq(generationAttempts.orderId, orderId), eq(generationAttempts.round, round)))
    .limit(1);
  return existing ?? null;
}

async function stageCreate(job: Job<ModelGenerationJobData>) {
  const { orderId, round } = job.data;

  if (!(await isFlagEnabled("meshy_enabled"))) {
    return fallbackToManual(orderId, "meshy_enabled is off");
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.status !== "generating") {
    job.log(`order is not in 'generating' (${order?.status ?? "missing"}); nothing to do`);
    return;
  }

  const attempt = await claimRound(orderId, round);
  if (!attempt) return failGeneration(orderId, "could not claim the round", "internal");

  if (attempt.providerTaskId) {
    job.log(`round ${round} already owns task ${attempt.providerTaskId}; resuming the poll`);
    await getModelGenerationQueue().add(
      "step",
      { ...job.data, stage: "poll", taskId: attempt.providerTaskId, polls: 0 },
      { delay: POLL_DELAY_MS }
    );
    return;
  }

  const minBalance = Number(process.env.MESHY_MIN_CREDIT_BALANCE ?? 60);
  const balance = await getCreditBalance().catch(() => -1);
  if (balance >= 0 && balance < minBalance) {
    return fallbackToManual(orderId, `credit balance ${balance} < floor ${minBalance}`);
  }

  const reservation = await reserveSpend("meshy", cents(MESHY_CREDITS.imageTo3d), {
    kind: "order",
    id: orderId,
  });
  if (!reservation.ok) {
    return fallbackToManual(orderId, `spend refused (${reservation.reason})`);
  }

  const [preview] = order.previewId
    ? await db.select().from(previews).where(eq(previews.id, order.previewId)).limit(1)
    : [];
  const selectedKey = fileKeyFromUrl(preview?.selectedStyledImageUrl);
  if (!selectedKey) {
    await releaseSpend(reservation.reservationId);
    return failGeneration(orderId, "no approved preview image on the order", "no_selected_image");
  }

  try {
    // Inline the bytes instead of handing Meshy a signed public URL: a signed
    // URL is a bearer capability and this is usually a photo of someone's child.
    const buffer = await getFileBuffer(selectedKey);
    const dataUri = `data:image/png;base64,${buffer.toString("base64")}`;
    const taskId = await createImageTo3dTask(dataUri);

    await db
      .update(generationAttempts)
      .set({ providerTaskId: taskId, status: "running", updatedAt: new Date() })
      .where(eq(generationAttempts.id, attempt.id));

    job.log(`meshy task ${taskId} created (round ${round})`);
    await getModelGenerationQueue().add(
      "step",
      {
        ...job.data,
        stage: "poll",
        taskId,
        polls: 0,
        reservationId: reservation.reservationId,
      },
      { delay: POLL_DELAY_MS }
    );
  } catch (err) {
    await releaseSpend(reservation.reservationId);
    const code = err instanceof MeshyError ? err.code : "provider_error";
    await failGeneration(orderId, (err as Error).message, code);
  }
}

async function stagePoll(job: Job<ModelGenerationJobData>) {
  const { orderId, round, taskId, polls = 0, reservationId } = job.data;
  if (!taskId) return failGeneration(orderId, "poll stage without a task id", "internal");

  const task = await getImageTo3dTask(taskId);
  job.log(`task ${taskId} ${task.status} ${task.progress}% (poll ${polls})`);

  if (!isTerminal(task.status)) {
    if (polls + 1 >= MAX_POLLS) {
      if (reservationId) await releaseSpend(reservationId);
      return failGeneration(orderId, `no result after ${MAX_POLLS} polls`, "provider_timeout");
    }
    await getModelGenerationQueue().add(
      "step",
      { ...job.data, polls: polls + 1 },
      { delay: POLL_DELAY_MS }
    );
    return;
  }

  if (task.status !== "SUCCEEDED") {
    if (reservationId) await releaseSpend(reservationId);
    return failGeneration(orderId, task.taskError ?? task.status, classifyTaskError(task.taskError));
  }

  const consumed = task.consumedCredits || MESHY_CREDITS.imageTo3d;
  if (reservationId) await settleSpend(reservationId, cents(consumed));
  await db
    .update(generationAttempts)
    .set({
      status: "succeeded",
      credits: consumed,
      costCents: cents(consumed),
      outputGlbUrl: task.modelUrls.glb ?? null,
      durationMs:
        task.finishedAt && task.createdAt ? task.finishedAt - task.createdAt : null,
      updatedAt: new Date(),
    })
    .where(and(eq(generationAttempts.orderId, orderId), eq(generationAttempts.round, round)));

  // Free cross-check, recorded raw. Never a pass on its own.
  let printability: unknown = null;
  try {
    const analyzeId = await analyzePrintability({ taskId });
    for (let i = 0; i < 12; i++) {
      const res = await getPrintAnalysis(analyzeId);
      if (res.status === "SUCCEEDED") {
        printability = res.printability;
        break;
      }
      if (isTerminal(res.status)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (err) {
    job.log(`print/analyze skipped: ${(err as Error).message}`);
  }

  const repairReservation = await reserveSpend("meshy", cents(MESHY_CREDITS.printRepair), {
    kind: "order",
    id: orderId,
  });
  if (!repairReservation.ok) {
    return failGeneration(orderId, `repair spend refused: ${repairReservation.reason}`, "budget");
  }

  try {
    const repairTaskId = await createPrintRepairTask(taskId);
    job.log(`print/repair task ${repairTaskId} created`);
    await getModelGenerationQueue().add(
      "step",
      {
        ...job.data,
        stage: "poll-repair",
        repairTaskId,
        polls: 0,
        reservationId: repairReservation.reservationId,
        printability,
      },
      { delay: REPAIR_POLL_DELAY_MS }
    );
  } catch (err) {
    await releaseSpend(repairReservation.reservationId);
    await failGeneration(orderId, (err as Error).message, "repair_failed");
  }
}

async function stagePollRepair(job: Job<ModelGenerationJobData>) {
  const { orderId, round, repairTaskId, polls = 0, reservationId, printability } = job.data;
  if (!repairTaskId) {
    return failGeneration(orderId, "repair stage without a task id", "internal");
  }

  const task = await getPrintRepairTask(repairTaskId);
  job.log(`repair ${repairTaskId} ${task.status} (poll ${polls})`);

  if (!isTerminal(task.status)) {
    if (polls + 1 >= MAX_REPAIR_POLLS) {
      if (reservationId) await releaseSpend(reservationId);
      return failGeneration(orderId, "repair did not finish in time", "provider_timeout");
    }
    await getModelGenerationQueue().add(
      "step",
      { ...job.data, polls: polls + 1 },
      { delay: REPAIR_POLL_DELAY_MS }
    );
    return;
  }

  if (task.status !== "SUCCEEDED" || !task.modelUrls.glb) {
    if (reservationId) await releaseSpend(reservationId);
    return failGeneration(orderId, task.taskError ?? "repair produced no GLB", "repair_failed");
  }

  if (reservationId) {
    await settleSpend(reservationId, cents(task.consumedCredits || MESHY_CREDITS.printRepair));
  }

  const res = await fetch(task.modelUrls.glb);
  if (!res.ok) {
    return failGeneration(orderId, `GLB download returned ${res.status}`, "download_failed");
  }
  const glbKey = await saveFile(
    Buffer.from(await res.arrayBuffer()),
    `models/${orderId}`,
    `meshy-r${round}-${nanoid(8)}.glb`
  );
  job.log(`repaired GLB stored at ${glbKey}`);

  const [attempt] = await db
    .select({ id: generationAttempts.id })
    .from(generationAttempts)
    .where(and(eq(generationAttempts.orderId, orderId), eq(generationAttempts.round, round)))
    .limit(1);

  await db
    .update(orders)
    .set({ status: "processing_mesh", updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), eq(orders.status, "generating")));

  await getMeshProcessingQueue().add(
    "process",
    {
      orderId,
      round,
      glbKey,
      generationAttemptId: attempt?.id ?? "",
      printability,
    },
    { jobId: `mesh-proc:${orderId}:${round}` }
  );
}

export function startModelGenerationWorker(): Worker {
  const worker = new Worker<ModelGenerationJobData>(
    "model-generation",
    async (job) => {
      switch (job.data.stage) {
        case "create":
          return stageCreate(job);
        case "poll":
          return stagePoll(job);
        case "poll-repair":
          return stagePollRepair(job);
        default:
          throw new Error(`unknown stage ${job.data.stage}`);
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 4,
      // Every stage is a short API call; the long waits are job delays, not
      // held locks. Still well above BullMQ's 30s default.
      lockDuration: 120_000,
      maxStalledCount: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[model-generation] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
