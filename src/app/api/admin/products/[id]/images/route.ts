import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { products, productImages } from "@/lib/db/schema";
import { saveFile, getPublicUrl, deleteFile } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import { optimizeDisplayImage } from "@/lib/services/image-optimize";

const MAX_IMAGES = 8;

// Admin product image upload (any product, not owner-scoped). Mirrors the
// seller images route but gated by requireAdmin.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: { images: true },
  });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (product.images.length >= MAX_IMAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_IMAGES} images allowed` },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedType = validateImageMagicBytes(buffer);
  if (!detectedType || !["image/jpeg", "image/png"].includes(detectedType)) {
    return NextResponse.json({ error: "Invalid image format" }, { status: 400 });
  }

  // Re-encode to a capped-size WebP (see seller route); fall back to original.
  let storeBuffer: Buffer = buffer;
  let ext = detectedType === "image/png" ? "png" : "jpg";
  try {
    const optimized = await optimizeDisplayImage(buffer);
    storeBuffer = optimized.buffer;
    ext = optimized.ext;
  } catch {
    /* keep original */
  }
  const storageKey = await saveFile(storeBuffer, "products", `${nanoid()}.${ext}`);

  const [image] = await db
    .insert(productImages)
    .values({ productId: id, storageKey, sortOrder: product.images.length })
    .returning();

  if (product.images.length === 0) {
    await db
      .update(products)
      .set({ primaryImageKey: storageKey, updatedAt: new Date() })
      .where(eq(products.id, id));
  }

  return NextResponse.json({ image: { id: image.id, url: getPublicUrl(storageKey) } });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;
  const imageId = request.nextUrl.searchParams.get("imageId");
  if (!imageId) {
    return NextResponse.json({ error: "imageId required" }, { status: 400 });
  }

  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: { images: true },
  });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const target = product.images.find((img) => img.id === imageId);
  if (!target) return NextResponse.json({ error: "Image not found" }, { status: 404 });

  await db.delete(productImages).where(eq(productImages.id, imageId));
  await deleteFile(target.storageKey).catch(() => {});

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
