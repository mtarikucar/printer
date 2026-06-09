import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { uploadedModels } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { verifyTurnstileToken } from "@/lib/services/turnstile";
import { saveFile, getPublicUrl } from "@/lib/services/storage";
import { validateModelFile } from "@/lib/services/model-file-validation";
import { UPLOAD_MODEL_MAX_SIZE_BYTES } from "@/lib/config/upload";
import { uploadModelPriceKurus, uploadModelNeedsQuote } from "@/lib/config/prices";

export const runtime = "nodejs";
export const maxDuration = 120;

const execFileAsync = promisify(execFile);

// Faz 3 — upload an STL/OBJ, validate it by content, run geometry server-side,
// and either auto-price it (clean closed volume within the print envelope) or
// flag it for a manual quote. Processing is synchronous for v1 with a graceful
// fallback: any failure (trimesh missing, non-watertight, oversized) → quote
// rather than a hard error (the plan's quote-bridge-first sequencing).
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for") ??
    "unknown";

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!(await verifyTurnstileToken(String(form.get("turnstileToken") ?? ""), ip))) {
    return NextResponse.json({ error: "turnstile_failed" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }
  if (file.size > UPLOAD_MODEL_MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }

  const material = form.get("material") === "filament" ? "filament" : "resin";
  const targetHeightMm = clampHeight(Number(form.get("targetHeightMm")));

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateModelFile(buffer, file.name);
  if (!validation.ok || !validation.format) {
    return NextResponse.json({ error: validation.error ?? "invalid_model" }, { status: 400 });
  }

  const session = await getSessionUser();
  const ext = validation.format;
  const sourceKey = await saveFile(buffer, "models-upload", `${nanoid()}.${ext}`);

  const [row] = await db
    .insert(uploadedModels)
    .values({
      userId: session?.userId ?? null,
      sourceKey,
      sourceFormat: ext,
      fileName: file.name.slice(0, 200),
      fileSizeBytes: file.size,
      targetHeightMm,
      material,
      status: "processing",
    })
    .returning();

  let result: { report: Record<string, unknown>; glbKey: string } | null = null;
  try {
    result = await runGeometry(buffer, ext, targetHeightMm, row.id);
  } catch {
    result = null;
  }

  if (!result) {
    await db
      .update(uploadedModels)
      .set({
        status: "review",
        needsQuote: true,
        errorMessage: "geometry_unavailable",
        updatedAt: new Date(),
      })
      .where(eq(uploadedModels.id, row.id));
    return NextResponse.json(await present(row.id));
  }

  const { report, glbKey } = result;
  const isVolume = report.is_volume === true;
  const volumeMm3 = typeof report.volume_mm3 === "number" ? report.volume_mm3 : null;
  const bbox =
    (report.bounding_box_mm as { x: number; y: number; z: number } | null) ?? null;
  const needsQuote = uploadModelNeedsQuote({
    isVolume,
    volumeMm3,
    boundingBoxMm: bbox,
    material,
  });
  const priceKurus =
    needsQuote || volumeMm3 == null ? null : uploadModelPriceKurus(volumeMm3, material);

  await db
    .update(uploadedModels)
    .set({
      status: needsQuote ? "review" : "ready",
      isVolume,
      volumeMm3,
      boundingBoxMm: bbox,
      minWallThicknessMm:
        typeof report.min_wall_thickness_estimate_mm === "number"
          ? report.min_wall_thickness_estimate_mm
          : null,
      printRisk: Array.isArray(report.print_risk) ? (report.print_risk as string[]) : null,
      glbPreviewKey: glbKey,
      priceKurus,
      needsQuote,
      updatedAt: new Date(),
    })
    .where(eq(uploadedModels.id, row.id));

  return NextResponse.json(await present(row.id));
}

function clampHeight(n: number): number {
  if (!Number.isFinite(n)) return 80;
  return Math.min(250, Math.max(20, Math.round(n)));
}

async function runGeometry(
  buffer: Buffer,
  ext: string,
  targetHeightMm: number,
  id: string
): Promise<{ report: Record<string, unknown>; glbKey: string }> {
  const dir = await mkdtemp(join(tmpdir(), "upmodel-"));
  const inputPath = join(dir, `input.${ext}`);
  const glbPath = join(dir, "preview.glb");
  const reportPath = join(dir, "report.json");
  try {
    await writeFile(inputPath, buffer);
    const scriptPath = join(process.cwd(), "scripts", "process_upload_model.py");
    await execFileAsync(
      "python3",
      [scriptPath, inputPath, glbPath, reportPath, String(targetHeightMm)],
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
    );
    const report = JSON.parse(await readFile(reportPath, "utf8")) as Record<string, unknown>;
    const glbBuffer = await readFile(glbPath);
    const glbKey = await saveFile(glbBuffer, `models-upload/${id}`, "preview.glb");
    return { report, glbKey };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function present(id: string) {
  const row = await db.query.uploadedModels.findFirst({
    where: eq(uploadedModels.id, id),
  });
  if (!row) return { error: "not_found" };
  return {
    id: row.id,
    status: row.status,
    priceKurus: row.priceKurus,
    needsQuote: row.needsQuote,
    isVolume: row.isVolume,
    volumeMm3: row.volumeMm3,
    boundingBoxMm: row.boundingBoxMm,
    printRisk: row.printRisk,
    glbPreviewUrl: row.glbPreviewKey ? getPublicUrl(row.glbPreviewKey) : null,
    targetHeightMm: row.targetHeightMm,
    material: row.material,
  };
}
