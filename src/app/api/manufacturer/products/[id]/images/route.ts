import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, productImages } from "@/lib/db/schema";
import { requireActiveSeller } from "@/lib/services/manufacturer-guard";
import { saveFile, getPublicUrl, deleteFile } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";

const MAX_IMAGES = 8;

async function ensureOwned(productId: string, manufacturerId: string) {
  return db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.manufacturerId, manufacturerId)
    ),
    with: { images: true },
  });
}

// Upload a product image. Reuses the same magic-byte + size validation as the
// public upload route, but gated by the seller session (no Turnstile).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireActiveSeller();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { id } = await params;

  const product = await ensureOwned(id, guard.manufacturerId);
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (product.images.length >= MAX_IMAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_IMAGES} images allowed` },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedType = validateImageMagicBytes(buffer);
  if (!detectedType || !["image/jpeg", "image/png"].includes(detectedType)) {
    return NextResponse.json({ error: "Invalid image format" }, { status: 400 });
  }

  const ext = detectedType === "image/png" ? "png" : "jpg";
  const storageKey = await saveFile(buffer, "products", `${nanoid()}.${ext}`);

  const nextSort = product.images.length;
  const [image] = await db
    .insert(productImages)
    .values({ productId: id, storageKey, sortOrder: nextSort })
    .returning();

  // First image becomes the denormalized cover.
  if (product.images.length === 0) {
    await db
      .update(products)
      .set({ primaryImageKey: storageKey, updatedAt: new Date() })
      .where(eq(products.id, id));
  }

  return NextResponse.json({
    image: { id: image.id, url: getPublicUrl(storageKey) },
  });
}

// Remove a product image (?imageId=...). Re-points primaryImageKey if needed.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireActiveSeller();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { id } = await params;
  const imageId = request.nextUrl.searchParams.get("imageId");
  if (!imageId) {
    return NextResponse.json({ error: "imageId required" }, { status: 400 });
  }

  const product = await ensureOwned(id, guard.manufacturerId);
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const target = product.images.find((img) => img.id === imageId);
  if (!target) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  await db.delete(productImages).where(eq(productImages.id, imageId));
  await deleteFile(target.storageKey).catch(() => {});

  // If we removed the cover, promote the next remaining image (lowest sort).
  if (product.primaryImageKey === target.storageKey) {
    const [next] = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sortOrder))
      .limit(1);
    await db
      .update(products)
      .set({ primaryImageKey: next?.storageKey ?? null, updatedAt: new Date() })
      .where(eq(products.id, id));
  }

  return NextResponse.json({ success: true });
}
