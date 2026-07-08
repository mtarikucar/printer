import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";
import { saveFile } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";

// Conditional-approval gate: the painter uploads a sample of prior work; the
// admin can only fully approve once `workSamplePhotoUploadedAt` is set. Mirrors
// the manufacturer printer-photo upload (validation + storage.ts usage), but
// there is no painterDocuments table, so only the timestamp is persisted.
export async function POST(request: NextRequest) {
  const session = await getPainterSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
    columns: { id: true, status: true },
  });
  if (!painter) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (painter.status !== "conditionally_approved") {
    return NextResponse.json(
      { error: "Work-sample photo upload is only available for conditionally approved accounts" },
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
  await saveFile(buffer, "work-sample-photos", `${nanoid()}.${ext}`);

  await db
    .update(painters)
    .set({ workSamplePhotoUploadedAt: new Date(), updatedAt: new Date() })
    .where(eq(painters.id, session.painterId));

  await publishRealtime([topics.admin()], { kind: "badge" });

  return NextResponse.json({ success: true });
}
