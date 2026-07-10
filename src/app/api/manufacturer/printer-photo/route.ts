import { NextRequest, NextResponse } from "next/server";
import { desc, eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { manufacturers, manufacturerDocuments } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { saveFile, getPublicUrl } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";

// A manufacturer may run several printers, so multiple photos are allowed: the
// conditional-approval gate needs at least one, and an active manufacturer can
// add more later (each photo is a verification document — no delete endpoint).
const MAX_PRINTER_PHOTOS = 10;

export async function POST(request: NextRequest) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { id: true, status: true },
  });
  if (!manufacturer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["conditionally_approved", "active"].includes(manufacturer.status)) {
    return NextResponse.json(
      { error: "Yazıcı fotoğrafı yüklemek için hesabınız koşullu onaylı veya aktif olmalı" },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const [{ existingCount }] = await db
    .select({ existingCount: sql<number>`count(*)::int` })
    .from(manufacturerDocuments)
    .where(
      and(
        eq(manufacturerDocuments.manufacturerId, session.manufacturerId),
        eq(manufacturerDocuments.type, "printer_photo")
      )
    );
  if (existingCount + files.length > MAX_PRINTER_PHOTOS) {
    return NextResponse.json(
      { error: `En fazla ${MAX_PRINTER_PHOTOS} yazıcı fotoğrafı yükleyebilirsiniz` },
      { status: 400 }
    );
  }

  // Validate everything BEFORE saving anything, so a bad file in a multi-select
  // doesn't leave a partial batch.
  const validated: { buffer: Buffer; ext: string }[] = [];
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const img = validateImageMagicBytes(buffer);
    if (!img || !["image/jpeg", "image/png"].includes(img)) {
      return NextResponse.json({ error: "Only JPEG or PNG" }, { status: 400 });
    }
    validated.push({ buffer, ext: img === "image/png" ? "png" : "jpg" });
  }

  for (const v of validated) {
    const storageKey = await saveFile(v.buffer, "printer-photos", `${nanoid()}.${v.ext}`);
    await db.insert(manufacturerDocuments).values({
      manufacturerId: session.manufacturerId,
      type: "printer_photo",
      storageKey,
    });
  }

  await db
    .update(manufacturers)
    .set({ printerPhotoUploadedAt: new Date(), updatedAt: new Date() })
    .where(eq(manufacturers.id, session.manufacturerId));

  await publishRealtime([topics.admin()], { kind: "badge" });

  return NextResponse.json({ success: true, uploaded: validated.length });
}

// List the manufacturer's own printer photos (for the profile section).
export async function GET() {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const docs = await db.query.manufacturerDocuments.findMany({
    where: and(
      eq(manufacturerDocuments.manufacturerId, session.manufacturerId),
      eq(manufacturerDocuments.type, "printer_photo")
    ),
    orderBy: [desc(manufacturerDocuments.createdAt)],
  });

  return NextResponse.json({
    photos: docs.map((d) => ({
      id: d.id,
      url: getPublicUrl(d.storageKey),
      createdAt: d.createdAt.toISOString(),
    })),
  });
}
