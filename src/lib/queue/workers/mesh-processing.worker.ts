/**
 * Turns Meshy's repaired GLB into the STL we will actually print, rules on its
 * printability, renders the customer-facing turntable, and parks the order on
 * the admin's desk.
 *
 * Every verdict — pass, warn AND fail — lands the order in `review`. A `fail`
 * is not a dead end: the mesh exists, an admin can look at it, and KVKK art.
 * 11/g gives a customer the right to object to a purely automated adverse
 * decision, so the human override is never removed. What the verdict changes
 * is the badge and whether approving demands an explicit override reason.
 */
import { Worker, Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { getRedisConnection } from "../connection";
import { type MeshProcessingJobData } from "../queues";
import { db } from "../../db";
import { orders, meshReports } from "../../db/schema";
import { saveFile, absoluteFilePath } from "../../services/storage";
import { runProcessMesh, runRenderTurntable, type RawMeshReport } from "../../services/mesh-runner";
import { attachOrderModel } from "../../services/order-model";
import {
  evaluatePrintGate,
  type MeshReport,
  type MeshyPrintabilitySummary,
} from "../../services/print-gate";
import { resolveTargetHeightMm } from "../../config/sizes";
import { emitOrderChanged } from "../../realtime/emit";

function toGateReport(raw: RawMeshReport): MeshReport {
  const size = raw.bounding_box.size;
  return {
    isWatertight: raw.is_watertight,
    isVolume: raw.is_volume,
    vertexCount: raw.vertex_count,
    faceCount: raw.face_count,
    componentCount: raw.component_count,
    boundingBox: { size: [size[0], size[1], size[2]] },
    volumeCm3: raw.volume_cm3,
    fillRatio: raw.fill_ratio,
    baseAdded: raw.base_added,
    repairsApplied: raw.repairs_applied ?? [],
    droppedSignificantComponent: raw.dropped_significant_component,
    mergedComponentCount: raw.merged_component_count,
    minWallP1Mm: raw.min_wall_p1_mm,
    minWallP5Mm: raw.min_wall_p5_mm,
    targetHeightMm: raw.target_height_mm,
    measuredHeightMm: raw.measured_height_mm,
    material: raw.material,
  };
}

function toMeshySummary(printability: unknown): MeshyPrintabilitySummary | null {
  if (!printability || typeof printability !== "object") return null;
  const p = printability as {
    status?: string;
    metrics?: { volume?: number | null; degenerateFaces?: number | null };
  };
  return {
    status: (p.status as MeshyPrintabilitySummary["status"]) ?? "unknown",
    volume: typeof p.metrics?.volume === "number" ? p.metrics.volume : null,
    degenerateFaces:
      typeof p.metrics?.degenerateFaces === "number" ? p.metrics.degenerateFaces : null,
  };
}

async function processOrder(job: Job<MeshProcessingJobData>) {
  const { orderId, round, glbKey, generationAttemptId, printability } = job.data;

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.status !== "processing_mesh") {
    job.log(`order is not in 'processing_mesh' (${order?.status ?? "missing"}); nothing to do`);
    return;
  }

  const height = resolveTargetHeightMm(order.figurineSize);
  if (!height.ok) {
    await db
      .update(orders)
      .set({
        status: "failed_mesh",
        failureReason: `unknown_size: ${order.figurineSize ?? "(boş)"}`,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, "processing_mesh")));
    return;
  }
  const material = order.material === "filament" ? "filament" : "resin";

  const work = await mkdtemp(join(tmpdir(), "mesh-"));
  try {
    const stlPath = join(work, "model.stl");
    const reportPath = join(work, "report.json");
    const mp4Path = join(work, "turntable.mp4");

    const raw = await runProcessMesh({
      inputPath: absoluteFilePath(glbKey),
      outputStlPath: stlPath,
      reportPath,
      heightMm: height.heightMm,
      material,
      onLog: (line) => job.log(line),
    });

    const gate = evaluatePrintGate(toGateReport(raw), toMeshySummary(printability));
    job.log(
      `gate verdict=${gate.verdict} failures=${gate.failures.join(",") || "-"} ` +
        `warnings=${gate.warnings.join(",") || "-"}`
    );

    const stlKey = await saveFile(
      await readFile(stlPath),
      `models/${orderId}`,
      `print-r${round}-${nanoid(8)}.stl`
    );

    // Non-fatal by contract: Meshy returns no turntable video of its own, and
    // an approval message with a still image beats no approval message at all.
    let turntableKey: string | null = null;
    const rendered = await runRenderTurntable({
      inputPath: stlPath,
      outputMp4Path: mp4Path,
      onLog: (line) => job.log(line),
    });
    if (rendered) {
      turntableKey = await saveFile(
        await readFile(mp4Path),
        `models/${orderId}`,
        `turntable-r${round}-${nanoid(8)}.mp4`
      );
    }

    await attachOrderModel({
      orderId,
      glbKey,
      stlKey,
      turntableKey,
      source: "meshy_auto",
      note: `Otomatik üretim (tur ${round}) — baskı kapısı: ${gate.verdict}`,
    });

    if (generationAttemptId) {
      await db.insert(meshReports).values({
        generationId: generationAttemptId,
        isWatertight: raw.is_watertight,
        isVolume: raw.is_volume,
        vertexCount: raw.vertex_count,
        faceCount: raw.face_count,
        componentCount: raw.component_count,
        boundingBox: {
          min: raw.bounding_box.min as [number, number, number],
          max: raw.bounding_box.max as [number, number, number],
          size: raw.bounding_box.size as [number, number, number],
        },
        baseAdded: raw.base_added,
        repairsApplied: raw.repairs_applied,
        meshyPrintability: (printability ?? null) as never,
        minWallP1Mm: raw.min_wall_p1_mm,
        minWallP5Mm: raw.min_wall_p5_mm,
        mergedComponentCount: raw.merged_component_count,
        heightMm: raw.measured_height_mm,
        fillRatio: raw.fill_ratio,
        droppedSignificantComponent: raw.dropped_significant_component,
        verdict: gate.verdict,
        verdictReasons: gate.reasonsTr,
      });
    }

    await db
      .update(orders)
      .set({
        status: "review",
        modelGenerationRound: round,
        failureReason:
          gate.verdict === "fail" ? gate.reasonsTr.join(" · ").slice(0, 500) : null,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, "processing_mesh")));

    await emitOrderChanged({
      orderId,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: "review",
    });
  } catch (err) {
    job.log(`mesh processing failed: ${(err as Error).message}`);
    await db
      .update(orders)
      .set({
        status: "failed_mesh",
        failureReason: (err as Error).message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, "processing_mesh")));
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

export function startMeshProcessingWorker(): Worker {
  const worker = new Worker<MeshProcessingJobData>("mesh-processing", processOrder, {
    connection: getRedisConnection(),
    // python saturates a core; two at once on a single-vCPU box starve the Node
    // event loop, and BullMQ then cannot renew the job lock.
    concurrency: 1,
    // The 30s default cannot survive a saturated CPU: the job is marked stalled
    // and re-run, which is precisely how a second provider task gets bought.
    lockDuration: 900_000,
    maxStalledCount: 1,
  });

  worker.on("failed", (job, err) => {
    console.error(`[mesh-processing] job ${job?.id} failed: ${err.message}`);
  });
  return worker;
}
