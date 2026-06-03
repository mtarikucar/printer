import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturerDocuments } from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

const DOC_LABELS: Record<string, string> = {
  vergi_levhasi: "Vergi levhası",
  ticaret_sicil: "Ticaret sicil belgesi",
  imza_sirkuleri: "İmza sirküleri",
  kimlik: "Kimlik belgesi",
  printer_photo: "Yazıcı fotoğrafı",
  other: "Belge",
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { docId } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const [row] = await db
    .update(manufacturerDocuments)
    .set({
      status: parsed.data.action === "approve" ? "approved" : "rejected",
      reviewNote: parsed.data.note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(manufacturerDocuments.id, docId))
    .returning({
      id: manufacturerDocuments.id,
      manufacturerId: manufacturerDocuments.manufacturerId,
      type: manufacturerDocuments.type,
    });

  if (!row) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const docLabel = DOC_LABELS[row.type] ?? "Belge";
  const approved = parsed.data.action === "approve";
  await notifyManufacturer({
    manufacturerId: row.manufacturerId,
    type: "system_announcement",
    subject: approved ? `${docLabel} onaylandı` : `${docLabel} reddedildi`,
    body: approved
      ? `Yüklediğiniz "${docLabel}" belgesi onaylandı.`
      : `Yüklediğiniz "${docLabel}" belgesi reddedildi.${parsed.data.note ? `\n\nNot: ${parsed.data.note}` : ""}\n\nLütfen belgeyi kontrol edip yeniden yükleyin.`,
  }).catch((e) => console.error("notifyManufacturer (kyc doc) failed", e));

  return NextResponse.json({ success: true });
}
