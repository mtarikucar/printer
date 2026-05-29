import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { db } from "@/lib/db";
import { orders, manufacturers, qcPhotos } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { saveFile, deleteFile, getPublicUrl } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import {
  canUploadQcPhotos,
  qcPhotosWouldExceed,
  type ManufacturerOrderStatus,
} from "@/lib/services/qc";

// Active-manufacturer gate, mirrors finish-printing/ship route.ts.
async function requireActiveManufacturer() {
  const session = await getManufacturerSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return {
      error: NextResponse.json({ error: "Your account is not active" }, { status: 403 }),
    };
  }
  return { session };
}

// POST: upload one or more finished-product (QC) photos for the current round.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireActiveManufacturer();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: { id: true, manufacturerStatus: true, qcRound: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!canUploadQcPhotos((order.manufacturerStatus ?? "") as ManufacturerOrderStatus)) {
    return NextResponse.json(
      { error: "QC photos can't be uploaded in this status" },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  let files = formData.getAll("files").filter((f): f is File => f instanceof File);
  const single = formData.get("file");
  if (files.length === 0 && single instanceof File) files = [single];
  if (files.length === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const [existingRow] = await db
    .select({ value: count() })
    .from(qcPhotos)
    .where(and(eq(qcPhotos.orderId, id), eq(qcPhotos.round, order.qcRound)));
  const existing = Number(existingRow?.value ?? 0);
  if (qcPhotosWouldExceed(existing, files.length)) {
    return NextResponse.json(
      { error: "Too many photos (max 6 per round)" },
      { status: 400 }
    );
  }

  const created: { id: string; url: string }[] = [];
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = validateImageMagicBytes(buffer);
    if (!detected || !["image/jpeg", "image/png"].includes(detected)) {
      return NextResponse.json({ error: "Invalid image format" }, { status: 400 });
    }
    const isPng = detected === "image/png";
    const ext = isPng ? "png" : "jpg";

    // Re-encode through sharp to strip EXIF/GPS metadata (sharp drops metadata
    // by default) and produce a thumbnail. Fall back to the raw buffer if sharp
    // can't process the image.
    let mainBuffer: Buffer = buffer;
    let thumbnailKey: string | null = null;
    try {
      const oriented = sharp(buffer).rotate();
      mainBuffer = await (isPng
        ? oriented.png()
        : oriented.jpeg({ quality: 90 })
      ).toBuffer();
      const thumb = await sharp(buffer)
        .rotate()
        .resize(400, 400, { fit: "inside" })
        .jpeg({ quality: 80 })
        .toBuffer();
      thumbnailKey = await saveFile(thumb, "qc-photos", `${nanoid()}.jpg`);
    } catch {
      mainBuffer = buffer;
      thumbnailKey = null;
    }

    const storageKey = await saveFile(mainBuffer, "qc-photos", `${nanoid()}.${ext}`);
    const [row] = await db
      .insert(qcPhotos)
      .values({
        orderId: id,
        manufacturerId: session.manufacturerId,
        round: order.qcRound,
        storageKey,
        thumbnailKey,
      })
      .returning({ id: qcPhotos.id, storageKey: qcPhotos.storageKey });
    created.push({ id: row.id, url: getPublicUrl(row.storageKey) });
  }

  return NextResponse.json({ photos: created });
}

// DELETE ?photoId=… : remove a not-yet-reviewed photo before submission.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireActiveManufacturer();
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id } = await params;

  const photoId = new URL(request.url).searchParams.get("photoId");
  if (!photoId) {
    return NextResponse.json({ error: "Missing photoId" }, { status: 400 });
  }

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: { manufacturerStatus: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!canUploadQcPhotos((order.manufacturerStatus ?? "") as ManufacturerOrderStatus)) {
    return NextResponse.json(
      { error: "QC photos can't be changed in this status" },
      { status: 400 }
    );
  }

  const photo = await db.query.qcPhotos.findFirst({
    where: and(
      eq(qcPhotos.id, photoId),
      eq(qcPhotos.orderId, id),
      eq(qcPhotos.manufacturerId, session.manufacturerId),
      eq(qcPhotos.reviewStatus, "pending")
    ),
  });
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  await db.delete(qcPhotos).where(eq(qcPhotos.id, photoId));
  await deleteFile(photo.storageKey).catch(() => {});
  if (photo.thumbnailKey) await deleteFile(photo.thumbnailKey).catch(() => {});

  return NextResponse.json({ success: true });
}
