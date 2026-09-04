import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, workshopSessions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";

/**
 * Üretici, kendisine ön rezerve edilmiş bir atölye seansının tarihini TAAHHÜT
 * eder. Bu, kapanışta partinin soğuk atama ve 24 saatlik kabul beklemesi
 * olmadan doğrudan ona düşmesinin dayanağıdır — 5 günlük katılım penceresini
 * gerçekçi kılan şey budur.
 *
 * `manufacturerCommittedAt` COALESCE ile yazılır: ikinci bir POST başarıyla
 * döner ama İLK taahhüdün zamanını korur. Taahhüdün ne zaman verildiği bir
 * kayıttır; her tıklamada tazelenirse anlamını kaybeder.
 *
 * Yalnızca `draft`/`open` seanslar taahhüt edilebilir: kapanmış ya da iptal
 * edilmiş bir seans için taahhüt kaydı, olmayan bir işi kabul etmiş gibi
 * görünür.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { status: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Hesabınız aktif değil" }, { status: 403 });
  }

  const { id } = await params;
  const now = new Date();
  const [updated] = await db
    .update(workshopSessions)
    .set({
      manufacturerCommittedAt: sql`COALESCE(${workshopSessions.manufacturerCommittedAt}, ${now})`,
      updatedAt: now,
    })
    .where(
      and(
        eq(workshopSessions.id, id),
        eq(workshopSessions.manufacturerId, session.manufacturerId),
        inArray(workshopSessions.status, ["draft", "open"])
      )
    )
    .returning({
      id: workshopSessions.id,
      committedAt: workshopSessions.manufacturerCommittedAt,
    });

  // Seans yok, başkasına ait ya da artık taahhüt edilebilir durumda değil —
  // üçü de aynı yanıtı döner: başkasının seansının varlığı sızdırılmaz.
  if (!updated) {
    return NextResponse.json({ error: "Seans bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ success: true, committedAt: updated.committedAt });
}
