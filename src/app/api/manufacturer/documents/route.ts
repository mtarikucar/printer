import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "@/lib/db";
import { manufacturers, manufacturerDocuments } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { saveFile, getPublicUrl } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";

const DOC_TYPES = ["vergi_levhasi", "ticaret_sicil", "imza_sirkuleri", "kimlik", "other"] as const;
const typeSchema = z.enum(DOC_TYPES);

function isPdf(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

async function requireManufacturer() {
  const session = await getManufacturerSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { session };
}

export async function GET() {
  const auth = await requireManufacturer();
  if ("error" in auth) return auth.error;
  const docs = await db.query.manufacturerDocuments.findMany({
    where: eq(manufacturerDocuments.manufacturerId, auth.session.manufacturerId),
    orderBy: [desc(manufacturerDocuments.createdAt)],
  });
  return NextResponse.json({
    documents: docs.map((d) => ({
      id: d.id,
      type: d.type,
      status: d.status,
      reviewNote: d.reviewNote,
      url: getPublicUrl(d.storageKey),
      createdAt: d.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireManufacturer();
  if ("error" in auth) return auth.error;
  // Manufacturers can upload docs even while pending_approval (that's the point).
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, auth.session.manufacturerId),
    columns: { id: true },
  });
  if (!manufacturer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData();
  const parsedType = typeSchema.safeParse(form.get("type"));
  if (!parsedType.success) {
    return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const img = validateImageMagicBytes(buffer);
  const pdf = isPdf(buffer);
  if (!pdf && (!img || !["image/jpeg", "image/png"].includes(img))) {
    return NextResponse.json({ error: "Only JPEG, PNG or PDF" }, { status: 400 });
  }
  const ext = pdf ? "pdf" : img === "image/png" ? "png" : "jpg";
  const storageKey = await saveFile(buffer, "kyc-docs", `${nanoid()}.${ext}`);

  const [row] = await db
    .insert(manufacturerDocuments)
    .values({
      manufacturerId: auth.session.manufacturerId,
      type: parsedType.data,
      storageKey,
    })
    .returning({ id: manufacturerDocuments.id });

  return NextResponse.json({ success: true, id: row.id });
}
