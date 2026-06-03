import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { manufacturers, manufacturerDocuments } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { saveFile } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";

export async function POST(request: NextRequest) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { id: true, status: true },
  });
  if (!manufacturer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (manufacturer.status !== "conditionally_approved") {
    return NextResponse.json(
      { error: "Printer photo upload is only available for conditionally approved accounts" },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const img = validateImageMagicBytes(buffer);
  if (!img || !["image/jpeg", "image/png"].includes(img)) {
    return NextResponse.json({ error: "Only JPEG or PNG" }, { status: 400 });
  }
  const ext = img === "image/png" ? "png" : "jpg";
  const storageKey = await saveFile(buffer, "printer-photos", `${nanoid()}.${ext}`);

  await db.insert(manufacturerDocuments).values({
    manufacturerId: session.manufacturerId,
    type: "printer_photo",
    storageKey,
  });
  await db
    .update(manufacturers)
    .set({ printerPhotoUploadedAt: new Date(), updatedAt: new Date() })
    .where(eq(manufacturers.id, session.manufacturerId));

  await publishRealtime([topics.admin()], { kind: "badge" });

  return NextResponse.json({ success: true });
}
