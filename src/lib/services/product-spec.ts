import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  productFiles,
  productComponents,
  productAssemblySteps,
} from "@/lib/db/schema";
import { saveFile, getPublicUrl, deleteFile } from "@/lib/services/storage";
import { validateModelFile } from "@/lib/services/model-file-validation";
import { UPLOAD_MODEL_MAX_SIZE_BYTES } from "@/lib/config/upload";
import type {
  ProductComponentInput,
  ProductAssemblyStepInput,
} from "@/lib/validators/product";

const execFileAsync = promisify(execFile);

// A lamp ≈ a handful of printed parts; 12 is a generous cap.
export const MAX_PRODUCT_FILES = 12;

// Best-effort: convert an STL/OBJ → GLB preview + capture true volume/bbox via
// the existing geometry script (skip-scale mode). Returns null if Python /
// trimesh is unavailable — the raw STL download still works regardless.
async function runProductGeometry(
  buffer: Buffer,
  ext: string,
  id: string
): Promise<{
  glbKey: string;
  volumeMm3: number | null;
  bbox: { x: number; y: number; z: number } | null;
} | null> {
  const dir = await mkdtemp(join(tmpdir(), "prodfile-"));
  const inputPath = join(dir, `input.${ext}`);
  const glbPath = join(dir, "preview.glb");
  const reportPath = join(dir, "report.json");
  try {
    await writeFile(inputPath, buffer);
    const scriptPath = join(process.cwd(), "scripts", "process_upload_model.py");
    // target_height_mm = 0 → keep the part's true dimensions (no print scale).
    await execFileAsync(
      "python3",
      [scriptPath, inputPath, glbPath, reportPath, "0"],
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
    );
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      volume_mm3?: number | null;
      bounding_box_mm?: { x: number; y: number; z: number } | null;
    };
    const glbBuffer = await readFile(glbPath);
    const glbKey = await saveFile(glbBuffer, `product-files/${id}`, "preview.glb");
    return {
      glbKey,
      volumeMm3: report.volume_mm3 ?? null,
      bbox: report.bounding_box_mm ?? null,
    };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type SaveProductFileResult =
  | { ok: true; fileId: string; hasPreview: boolean }
  | { ok: false; error: string };

// Validate + persist one printable part (STL/OBJ) for a product, with a
// best-effort GLB preview. Caller checks ownership + the MAX_PRODUCT_FILES cap.
export async function saveProductFile(args: {
  productId: string;
  buffer: Buffer;
  fileName: string;
  partName?: string | null;
  quantity?: number;
  sortOrder: number;
}): Promise<SaveProductFileResult> {
  const { productId, buffer, fileName } = args;
  if (buffer.length > UPLOAD_MODEL_MAX_SIZE_BYTES) {
    return { ok: false, error: "too_large" };
  }
  const validation = validateModelFile(buffer, fileName);
  if (!validation.ok || !validation.format) {
    return { ok: false, error: validation.error ?? "invalid_model" };
  }
  const ext = validation.format; // "stl" | "obj"
  const id = nanoid();
  const storageKey = await saveFile(buffer, "product-files", `${id}.${ext}`);

  const geometry = await runProductGeometry(buffer, ext, id);

  const [row] = await db
    .insert(productFiles)
    .values({
      productId,
      storageKey,
      sourceFormat: ext,
      fileName: fileName.slice(0, 200),
      fileSizeBytes: buffer.length,
      partName: args.partName?.slice(0, 120) || null,
      quantity: Math.max(1, Math.min(9999, Math.floor(args.quantity ?? 1))),
      glbPreviewKey: geometry?.glbKey ?? null,
      volumeMm3: geometry?.volumeMm3 ?? null,
      boundingBoxMm: geometry?.bbox ?? null,
      sortOrder: args.sortOrder,
    })
    .returning({ id: productFiles.id });

  return { ok: true, fileId: row.id, hasPreview: !!geometry?.glbKey };
}

// Remove a print file (row + STL + GLB preview), scoped to its product.
export async function deleteProductFile(
  fileId: string,
  productId: string
): Promise<boolean> {
  const row = await db.query.productFiles.findFirst({
    where: and(eq(productFiles.id, fileId), eq(productFiles.productId, productId)),
    columns: { id: true, storageKey: true, glbPreviewKey: true },
  });
  if (!row) return false;
  await db.delete(productFiles).where(eq(productFiles.id, fileId));
  await deleteFile(row.storageKey).catch(() => {});
  if (row.glbPreviewKey) await deleteFile(row.glbPreviewKey).catch(() => {});
  return true;
}

// Atomically replace the product's BOM + assembly recipe (files unaffected).
export async function replaceProductSpec(
  productId: string,
  spec: {
    components: ProductComponentInput[];
    assemblySteps: ProductAssemblyStepInput[];
  }
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(productComponents)
      .where(eq(productComponents.productId, productId));
    await tx
      .delete(productAssemblySteps)
      .where(eq(productAssemblySteps.productId, productId));
    if (spec.components.length) {
      await tx.insert(productComponents).values(
        spec.components.map((c, i) => ({
          productId,
          name: c.name,
          quantity: c.quantity ?? 1,
          unit: c.unit ?? null,
          notes: c.notes ?? null,
          sortOrder: i,
        }))
      );
    }
    if (spec.assemblySteps.length) {
      await tx.insert(productAssemblySteps).values(
        spec.assemblySteps.map((s, i) => ({
          productId,
          instruction: s.instruction,
          imageKey: s.imageKey ?? null,
          sortOrder: i,
        }))
      );
    }
  });
}

export interface ProductSpecFile {
  id: string;
  partName: string | null;
  fileName: string;
  sourceFormat: string;
  quantity: number;
  fileSizeBytes: number;
  glbUrl: string | null;
  volumeMm3: number | null;
  boundingBoxMm: { x: number; y: number; z: number } | null;
}
export interface ProductSpecComponent {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
}
export interface ProductSpecStep {
  id: string;
  instruction: string;
  imageKey: string | null;
  imageUrl: string | null;
}
export interface ProductSpec {
  files: ProductSpecFile[];
  components: ProductSpecComponent[];
  steps: ProductSpecStep[];
}

// Load a product's full spec (files + BOM + recipe), ordered, with signed GLB /
// step-image URLs. The STL itself is NOT exposed here — download is route-gated.
export async function getProductSpec(productId: string): Promise<ProductSpec> {
  const [files, components, steps] = await Promise.all([
    db.query.productFiles.findMany({
      where: eq(productFiles.productId, productId),
      orderBy: [asc(productFiles.sortOrder)],
    }),
    db.query.productComponents.findMany({
      where: eq(productComponents.productId, productId),
      orderBy: [asc(productComponents.sortOrder)],
    }),
    db.query.productAssemblySteps.findMany({
      where: eq(productAssemblySteps.productId, productId),
      orderBy: [asc(productAssemblySteps.sortOrder)],
    }),
  ]);
  return {
    files: files.map((f) => ({
      id: f.id,
      partName: f.partName,
      fileName: f.fileName,
      sourceFormat: f.sourceFormat,
      quantity: f.quantity,
      fileSizeBytes: f.fileSizeBytes,
      glbUrl: f.glbPreviewKey ? getPublicUrl(f.glbPreviewKey) : null,
      volumeMm3: f.volumeMm3,
      boundingBoxMm: f.boundingBoxMm,
    })),
    components: components.map((c) => ({
      id: c.id,
      name: c.name,
      quantity: c.quantity,
      unit: c.unit,
      notes: c.notes,
    })),
    steps: steps.map((s) => ({
      id: s.id,
      instruction: s.instruction,
      imageKey: s.imageKey,
      imageUrl: s.imageKey ? getPublicUrl(s.imageKey) : null,
    })),
  };
}

// Buyer-facing "box contents": just component name + quantity + unit. No notes,
// no recipe, no files.
export async function getProductBoxContents(
  productId: string
): Promise<{ name: string; quantity: number; unit: string | null }[]> {
  const rows = await db.query.productComponents.findMany({
    where: eq(productComponents.productId, productId),
    orderBy: [asc(productComponents.sortOrder)],
    columns: { name: true, quantity: true, unit: true },
  });
  return rows;
}

// Count files for the ≥1-file publish gate + the MAX_PRODUCT_FILES cap.
export async function countProductFiles(productId: string): Promise<number> {
  const rows = await db
    .select({ id: productFiles.id })
    .from(productFiles)
    .where(eq(productFiles.productId, productId));
  return rows.length;
}
