import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, rm, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { getRedisConnection } from "../connection";
import type { MeshProcessingJobData } from "../queues";
import { getFileBuffer, saveFile, getPublicUrl } from "../../services/storage";
import { db } from "../../db";
import { orders, generationAttempts, meshReports } from "../../db/schema";
import { nanoid } from "nanoid";

const execFileAsync = promisify(execFile);

async function processJob(job: Job<MeshProcessingJobData>) {
  const { orderId, generationId, glbKey } = job.data;

  // Update order status
  await db
    .update(orders)
    .set({ status: "processing_mesh", updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  // Create temp directory for processing
  const tempDir = await mkdtemp(join(tmpdir(), "mesh-"));
  const inputPath = join(tempDir, "input.glb");
  const outputStlPath = join(tempDir, "output.stl");
  const reportPath = join(tempDir, "report.json");

  try {
    // Download GLB from local storage
    job.log("Downloading GLB from storage...");
    const glbBuffer = await getFileBuffer(glbKey);
    await writeFile(inputPath, glbBuffer);

    // Run Python mesh processing script
    job.log("Running mesh processing pipeline...");
    const scriptPath = join(process.cwd(), "scripts", "process_mesh.py");

    const { stdout, stderr } = await execFileAsync("python3", [
      scriptPath,
      inputPath,
      outputStlPath,
      reportPath,
    ], { timeout: 120000 });

    if (stderr) {
      job.log(`Python stderr: ${stderr}`);
    }
    if (stdout) {
      job.log(`Python stdout: ${stdout}`);
    }

    // Read report
    const report = JSON.parse(await readFile(reportPath, "utf-8"));

    // Persist STL to storage before temp dir cleanup
    const stlBuffer = await readFile(outputStlPath);
    const stlFilename = `processed-${nanoid()}.stl`;
    const stlKey = await saveFile(stlBuffer, `models/${orderId}`, stlFilename);
    const stlUrl = getPublicUrl(stlKey);

    // Create mesh report
    await db.insert(meshReports).values({
      generationId,
      isWatertight: report.is_watertight,
      isVolume: report.is_volume,
      vertexCount: report.vertex_count,
      faceCount: report.face_count,
      componentCount: report.component_count,
      boundingBox: report.bounding_box,
      baseAdded: report.base_added,
      repairsApplied: report.repairs_applied,
    });

    // Store STL URL on generation attempt
    await db
      .update(generationAttempts)
      .set({ outputStlUrl: stlUrl, updatedAt: new Date() })
      .where(eq(generationAttempts.id, generationId));

    // Update order status to review
    await db
      .update(orders)
      .set({ status: "review", updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    job.log("Mesh processing complete, order ready for review");
  } catch (error: any) {
    job.log(`Mesh processing failed: ${error.message}`);

    await db
      .update(orders)
      .set({
        status: "failed_mesh",
        failureReason: error.message,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    throw error;
  } finally {
    // Cleanup entire temp directory
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function startMeshProcessingWorker() {
  const worker = new Worker<MeshProcessingJobData>(
    "mesh-processing",
    processJob,
    {
      connection: getRedisConnection(),
      concurrency: 2,
    }
  );

  worker.on("completed", (job) => {
    console.log(`Mesh processing completed for order ${job.data.orderId}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Mesh processing failed for order ${job?.data.orderId}:`, error.message);
  });

  return worker;
}
