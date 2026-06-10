import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { requireActiveSeller } from "@/lib/services/manufacturer-guard";
import { requireAdmin } from "@/lib/auth/require-admin";
import { saveFile, getPublicUrl } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import { updateProductSpecSchema } from "@/lib/validators/product";
import {
  saveProductFile,
  deleteProductFile,
  replaceProductSpec,
  getProductSpec,
  countProductFiles,
  MAX_PRODUCT_FILES,
} from "@/lib/services/product-spec";

type AuthResult = { ok: true } | { ok: false; status: number; error: string };

// A seller may only touch products they own.
export async function authorizeSellerProduct(productId: string): Promise<AuthResult> {
  const guard = await requireActiveSeller();
  if ("error" in guard) return { ok: false, status: guard.status, error: guard.error };
  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.manufacturerId, guard.manufacturerId)
    ),
    columns: { id: true },
  });
  if (!product) return { ok: false, status: 404, error: "Not found" };
  return { ok: true };
}

// Admin may touch any existing product.
export async function authorizeAdminProduct(productId: string): Promise<AuthResult> {
  const a = await requireAdmin();
  if ("response" in a) return { ok: false, status: 401, error: "Unauthorized" };
  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
    columns: { id: true },
  });
  if (!product) return { ok: false, status: 404, error: "Not found" };
  return { ok: true };
}

// ─── Shared handlers (called after the route authorizes the product) ────────

// POST a print file (multipart: file, partName?, quantity?).
export async function handleProductFilePost(
  request: NextRequest,
  productId: string
) {
  const count = await countProductFiles(productId);
  if (count >= MAX_PRODUCT_FILES) {
    return NextResponse.json(
      { error: "too_many_files", code: "too_many_files" },
      { status: 400 }
    );
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  const partName = (form.get("partName") as string | null)?.trim() || null;
  const quantity = Number(form.get("quantity")) || 1;
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await saveProductFile({
    productId,
    buffer,
    fileName: file.name,
    partName,
    quantity,
    sortOrder: count,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.error }, { status: 400 });
  }
  const spec = await getProductSpec(productId);
  const created = spec.files.find((f) => f.id === result.fileId);
  return NextResponse.json({ file: created, hasPreview: result.hasPreview });
}

// DELETE a print file (?fileId=...).
export async function handleProductFileDelete(
  request: NextRequest,
  productId: string
) {
  const fileId = request.nextUrl.searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json({ error: "fileId required" }, { status: 400 });
  }
  const ok = await deleteProductFile(fileId, productId);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

// PATCH the BOM + recipe (atomic replace).
export async function handleProductSpecPatch(
  request: NextRequest,
  productId: string
) {
  const body = await request.json().catch(() => ({}));
  const parsed = updateProductSpecSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_spec", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  await replaceProductSpec(productId, parsed.data);
  const spec = await getProductSpec(productId);
  return NextResponse.json({ components: spec.components, steps: spec.steps });
}

// POST a recipe-step photo (multipart: file) → { imageKey, url }. The client
// attaches imageKey to a step before PATCH /spec.
export async function handleStepImagePost(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = validateImageMagicBytes(buffer);
  if (!detected || !["image/jpeg", "image/png"].includes(detected)) {
    return NextResponse.json({ error: "invalid_image" }, { status: 400 });
  }
  const ext = detected === "image/png" ? "png" : "jpg";
  const key = await saveFile(buffer, "product-files", `step-${nanoid()}.${ext}`);
  return NextResponse.json({ imageKey: key, url: getPublicUrl(key) });
}
