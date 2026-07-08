import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { db } from "@/lib/db";
import { orders, painterQcPhotos } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { saveFile, getPublicUrl } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import {
  canUploadPainterQcPhotos,
  painterQcPhotosWouldExceed,
  type PainterOrderStatus,
} from "@/lib/services/painter-qc";

// POST: painter uploads one or more finished paint-job photos for the current
// QC round. Mirrors the manufacturer qc-photos route (sharp re-encode strips
// EXIF + makes a thumbnail; raw uploads are rejected).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.painterId, g.painterId)),
    columns: { id: true, painterStatus: true, painterQcRound: true },
  });
  if (!order) return NextResponse.json({ error: "İş bulunamadı" }, { status: 404 });
  if (!canUploadPainterQcPhotos((order.painterStatus ?? "") as PainterOrderStatus)) {
    return NextResponse.json(
      { error: "Bu durumda QC fotoğrafı yüklenemez" },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  let files = formData.getAll("files").filter((f): f is File => f instanceof File);
  const single = formData.get("file");
  if (files.length === 0 && single instanceof File) files = [single];
  if (files.length === 0) {
    return NextResponse.json({ error: "Dosya yok" }, { status: 400 });
  }

  const [existingRow] = await db
    .select({ value: count() })
    .from(painterQcPhotos)
    .where(and(eq(painterQcPhotos.orderId, id), eq(painterQcPhotos.round, order.painterQcRound)));
  const existing = Number(existingRow?.value ?? 0);
  if (painterQcPhotosWouldExceed(existing, files.length)) {
    return NextResponse.json({ error: "Çok fazla fotoğraf (tur başına en fazla 6)" }, { status: 400 });
  }

  const created: { id: string; url: string }[] = [];
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Dosya çok büyük (en fazla 10MB)" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const detected = validateImageMagicBytes(buffer);
    if (!detected || !["image/jpeg", "image/png"].includes(detected)) {
      return NextResponse.json({ error: "Geçersiz görsel formatı" }, { status: 400 });
    }
    const isPng = detected === "image/png";
    const ext = isPng ? "png" : "jpg";

    let mainBuffer: Buffer;
    let thumbnailKey: string | null = null;
    try {
      const oriented = sharp(buffer).rotate();
      mainBuffer = await (isPng ? oriented.png() : oriented.jpeg({ quality: 90 })).toBuffer();
      const thumb = await sharp(buffer)
        .rotate()
        .resize(400, 400, { fit: "inside" })
        .jpeg({ quality: 80 })
        .toBuffer();
      thumbnailKey = await saveFile(thumb, "painter-qc-photos", `${nanoid()}.jpg`);
    } catch {
      return NextResponse.json(
        { error: "Görsel işlenemedi; lütfen geçerli bir JPEG/PNG yükleyin." },
        { status: 400 }
      );
    }

    const storageKey = await saveFile(mainBuffer, "painter-qc-photos", `${nanoid()}.${ext}`);
    const [row] = await db
      .insert(painterQcPhotos)
      .values({
        orderId: id,
        painterId: g.painterId,
        round: order.painterQcRound,
        storageKey,
        thumbnailKey,
      })
      .returning({ id: painterQcPhotos.id, storageKey: painterQcPhotos.storageKey });
    created.push({ id: row.id, url: getPublicUrl(row.storageKey) });
  }

  return NextResponse.json({ photos: created });
}
