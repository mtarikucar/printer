import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { workshopSessions } from "@/lib/db/schema";
import { updateSessionSchema } from "@/lib/validators/workshop";

/**
 * Seans durumu/kontenjanı/üreticisi/notları güncellenir.
 *
 * `draft → open` geçişi bir üretici seçilmiş olmasını ŞART koşar: seans
 * açıldığı anda üretici taahhüt eder, böylece 5 günlük katılım penceresi
 * kapanınca parti soğuk atama beklemeden doğrudan ona düşer.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const parsed = updateSessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  if (data.status === "open") {
    const s = await db.query.workshopSessions.findFirst({
      where: eq(workshopSessions.id, id),
      columns: { manufacturerId: true },
    });
    if (!s) {
      return NextResponse.json({ error: "Seans bulunamadı" }, { status: 404 });
    }
    // Bu istekte manufacturerId de gönderiliyorsa onu, yoksa mevcut kayıttakini esas al.
    const effectiveManufacturerId =
      data.manufacturerId !== undefined ? data.manufacturerId : s.manufacturerId;
    if (!effectiveManufacturerId) {
      return NextResponse.json(
        { error: "Seansı açmadan önce bir üretici seçin — parti kapanışta ona düşecek." },
        { status: 400 }
      );
    }
  }

  // createSession de aynı şartı koyar: kapanışı geçmişe taşımak, hiç
  // açılamayacak ölü bir link üretir. Burada da reddedilir.
  let joinClosesAt: Date | undefined;
  if (data.joinClosesAt !== undefined) {
    joinClosesAt = new Date(data.joinClosesAt);
    if (joinClosesAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "Katılım kapanışı geçmişte olamaz. Daha ileri bir tarih seçin." },
        { status: 400 }
      );
    }
  }

  const set: Partial<typeof workshopSessions.$inferInsert> = { updatedAt: new Date() };
  if (data.status !== undefined) set.status = data.status;
  if (data.capacity !== undefined) set.capacity = data.capacity;
  if (data.manufacturerId !== undefined) set.manufacturerId = data.manufacturerId;
  if (joinClosesAt !== undefined) set.joinClosesAt = joinClosesAt;
  if (data.adminNotes !== undefined) set.adminNotes = data.adminNotes || null;

  const [row] = await db
    .update(workshopSessions)
    .set(set)
    .where(eq(workshopSessions.id, id))
    .returning({ id: workshopSessions.id });

  if (!row) {
    return NextResponse.json({ error: "Seans bulunamadı" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
