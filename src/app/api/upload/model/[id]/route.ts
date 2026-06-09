import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { uploadedModels } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";

export const runtime = "nodejs";

// GET — model details for the customer quote page (/quote/[id]). The UUID is the
// capability (mirrors /api/preview/[id]).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await db.query.uploadedModels.findFirst({
    where: eq(uploadedModels.id, id),
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    material: row.material,
    targetHeightMm: row.targetHeightMm,
    priceKurus: row.priceKurus,
    needsQuote: row.needsQuote,
    quoteStatus: row.quoteStatus,
    quotedPriceKurus: row.quotedPriceKurus,
    quoteExpiresAt: row.quoteExpiresAt,
    printRisk: row.printRisk,
    glbPreviewUrl: row.glbPreviewKey ? getPublicUrl(row.glbPreviewKey) : null,
  });
}

// POST — submit a quote request: attach a contact email so an admin can reply
// (guest uploads carry no userId). Claims the row for the session user if any.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "email_required" }, { status: 400 });
  }
  const row = await db.query.uploadedModels.findFirst({
    where: eq(uploadedModels.id, id),
  });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const session = await getSessionUser();
  await db
    .update(uploadedModels)
    .set({
      contactEmail: email,
      userId: row.userId ?? session?.userId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(uploadedModels.id, id));
  return NextResponse.json({ ok: true });
}
