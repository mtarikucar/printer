import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { workshopSessions } from "@/lib/db/schema";
import { updateSessionSchema } from "@/lib/validators/workshop";
import { notifyManufacturerSessionOpened } from "@/lib/services/workshop-manufacturer-notify";

/**
 * Seans durumu/kontenjanı/üreticisi/notları güncellenir.
 *
 * `draft → open` geçişi bir üretici seçilmiş olmasını ŞART koşar: seans
 * açıldığı anda üretici taahhüt eder, böylece 5 günlük katılım penceresi
 * kapanınca parti soğuk atama beklemeden doğrudan ona düşer.
 *
 * FİYATLANMIŞ bir seans yeniden `open` YAPILAMAZ. Bu, `closeSession`'ın
 * `commission_rate_bps IS NULL` koşuluyla aynı deliği KAPATMAZ; ikisi ayrı iş
 * yapar ve ikisi de gerekli:
 *   - oradaki koşul PARAYI korur — bir seans ömrü boyunca yalnızca bir kez
 *     fiyatlanır, hangi route ne izin verirse versin;
 *   - buradaki kontrol OPERATÖRÜ korur — o koşul yüzünden yeniden açılan seans
 *     bir daha asla kapanamaz: açık görünür, katılım alır, ödeme alır ve
 *     siparişleri hiçbir partiye girmez. Sessizce sipariş yutan bir seans,
 *     admin'in "bir kişi daha ekleyeyim" refleksinin bedeli olmamalı.
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

  // Açılış bildirimi yalnızca GERÇEK bir draft → open geçişinde gider; zaten
  // açık bir seansın kontenjanını güncellemek üreticiye ikinci bir çağrı
  // göndermemeli.
  let opensNow = false;
  if (data.status === "open") {
    const s = await db.query.workshopSessions.findFirst({
      where: eq(workshopSessions.id, id),
      columns: { manufacturerId: true, status: true, commissionRateBps: true },
    });
    if (!s) {
      return NextResponse.json({ error: "Seans bulunamadı" }, { status: 404 });
    }
    // Fiyatlanmış seans bir daha açılamaz (gerekçe: doc yorumu).
    if (s.commissionRateBps !== null) {
      return NextResponse.json(
        {
          error:
            "Bu seans kapanmış ve fiyatlanmış (komisyon oranı donduruldu); " +
            "yeniden katılıma açılamaz — açılsaydı bir daha kapanamaz, aldığı " +
            "siparişler hiçbir partiye giremezdi. Yeni bir seans açın.",
        },
        { status: 409 }
      );
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
    opensNow = s.status !== "open";
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

  // Üretici tarihi burada öğrenir ve taahhüt eder: gövdede tarih, kontenjan,
  // kişi başı fiyat ve komisyon merdiveni var. Bildirim kendi hatasını yutar —
  // bir e-posta hatası seansın açılmasını geri almamalı.
  if (opensNow) {
    await notifyManufacturerSessionOpened(id);
  }

  return NextResponse.json({ success: true });
}
