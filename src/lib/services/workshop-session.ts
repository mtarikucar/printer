import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  orders,
  workshopParticipants,
  workshopSessions,
  workshopVenues,
} from "@/lib/db/schema";
import {
  deriveSessionDates,
  workshopCommissionRateBps,
  WORKSHOP_JOIN_CLOSES_DAYS_BEFORE,
} from "@/lib/config/workshop";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { notifyManufacturerSessionClosed } from "@/lib/services/workshop-manufacturer-notify";

// Geriye dönük uyumluluk: assessSessionRisk artık config/workshop.ts'te yaşıyor
// (DB'siz, server-only'siz — admin'in "Seans aç" formu bunu TARAYICIDA çağırır;
// bu dosya @/lib/db import ettiği için client component'e buradan değer importu
// yapılamaz). Mevcut çağıranlar (bkz. scripts/test-workshop.ts) bu yoldan
// değişmeden çalışmaya devam eder.
export { assessSessionRisk } from "@/lib/config/workshop";

/** Katılım token'ı: 12 karakter × 64 sembol ≈ 72 bit. Ev kuralı (order-journey). */
const TOKEN_LENGTH = 12;

export function sessionJoinUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com").replace(/\/$/, "");
  return `${base}/atolye/katil/${token}`;
}

export interface CreateSessionInput {
  venueId: string;
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
  pricePerSeatKurus: number;
  manufacturerId?: string | null;
  adminNotes?: string | null;
}

/**
 * Yeni bir seans yaratır: kapanış ve teslim tarihlerini `deriveSessionDates`
 * ile türetir, katılım token'ını hemen basar (link admin ekranında anında
 * gösterilebilsin) ve `draft` durumunda başlatır — `open`'a geçiş ayrı bir
 * admin eylemidir (üretici seçilmiş olma şartıyla, bkz. PATCH route).
 */
export async function createSession(
  input: CreateSessionInput
): Promise<{ sessionId: string; joinToken: string } | { error: string }> {
  const venue = await db.query.workshopVenues.findFirst({
    where: eq(workshopVenues.id, input.venueId),
    columns: { id: true, status: true },
  });
  if (!venue) return { error: "Mekan bulunamadı" };
  if (venue.status !== "active") return { error: "Mekan aktif değil" };

  const now = Date.now();
  if (input.startsAt.getTime() <= now) {
    return { error: "Seans tarihi geçmişte olamaz." };
  }

  const { joinClosesAt, deliverBy } = deriveSessionDates(input.startsAt);
  // Kapanış zaten geçmişse link hiç açılamaz — admin'i sessizce ölü bir
  // seansla bırakmak yerine reddet.
  if (joinClosesAt.getTime() <= now) {
    return {
      error: `Bu tarih için katılım penceresi zaten kapanmış olurdu (kapanış seanstan ${WORKSHOP_JOIN_CLOSES_DAYS_BEFORE} gün öncedir). Daha ileri bir tarih seçin.`,
    };
  }

  const token = nanoid(TOKEN_LENGTH);
  const [row] = await db
    .insert(workshopSessions)
    .values({
      venueId: input.venueId,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      capacity: input.capacity,
      pricePerSeatKurus: input.pricePerSeatKurus,
      manufacturerId: input.manufacturerId ?? null,
      adminNotes: input.adminNotes ?? null,
      joinToken: token,
      joinClosesAt,
      deliverBy,
      status: "draft",
    })
    .returning({ id: workshopSessions.id, joinToken: workshopSessions.joinToken });

  return { sessionId: row.id, joinToken: row.joinToken };
}

/** Kapanış zamanı geçmiş, hâlâ açık seanslar (kapanış worker'ı için). */
export async function findSessionsDueToClose(now: Date) {
  return db
    .select({ id: workshopSessions.id })
    .from(workshopSessions)
    .where(and(eq(workshopSessions.status, "open"), lte(workshopSessions.joinClosesAt, now)));
}

/**
 * Partiye giren siparişler: seansa bağlı ve REDDEDİLMEMİŞ olanlar.
 *
 * `rejected` siparişler dışarıda kalır çünkü admin onları iade etti — bir iadeli
 * siparişi merdivende saymak partiyi olduğundan büyük gösterir ve daha da kötüsü,
 * o siparişi üreticiye BASILMAK ÜZERE atar. Aynı yüklem hem sayımda hem atamada
 * kullanılır; ikisi ayrışırsa üretici, oranı hesaplanmayan bir figür basar.
 */
function batchOrderFilter(sessionId: string) {
  return and(
    eq(orders.workshopSessionId, sessionId),
    ne(orders.status, "rejected")
  );
}

export interface CloseSessionResult {
  orderCount: number;
  commissionRateBps: number;
}

/**
 * Seansı kapatır: sipariş adedini sabitler, komisyon oranını merdivenden
 * hesaplayıp DONDURUR ve tüm partiyi ön rezerve üreticiye düşürür.
 *
 * Oran seansın TÜM siparişlerine aynı değerle yazılır — erken katılan %60,
 * geç katılan %40 almaz. Üretici seans açılışında zaten taahhüt ettiği için
 * soğuk atama + 24 saat kabul beklemesi yoktur; bu, 5 günlük pencereyi
 * gerçekçi kılan şeydir.
 *
 * İDEMPOTENT: kapanış talebi `WHERE status = 'open'` koşullu UPDATE'i ile
 * SAHİPLENİLİR. İkinci bir süpürme (ya da elle çağrı) 0 satır günceller ve
 * `{ error }` döner — oran bir daha hesaplanmaz. Bu koşul oku-sonra-yaz'a
 * çevrilmemelidir: iki süpürme aynı anda koşarsa ikisi de "açık" görüp oranı
 * iki kez yazabilir ve ödeme oranı yarıştan çıkan değere göre değişir.
 *
 * Kilit sırası: seans → siparişler. Katılım işlemi de seansı önce kilitler
 * (seans → taslak → katılımcı), koltuk bırakma ise katılımcı → seans yönünde
 * ve ÇAĞIRANIN işleminin dışında ilerler. Burada mevcut bir taslağı/katılımcıyı
 * kilitleyip sonra seansa dönmek döngüyü kapatır — yapılmamalıdır.
 */
export async function closeSession(
  sessionId: string
): Promise<CloseSessionResult | { error: string }> {
  const closedAt = new Date();

  const outcome = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(workshopSessions)
      .set({ status: "closed", updatedAt: closedAt })
      .where(
        and(eq(workshopSessions.id, sessionId), eq(workshopSessions.status, "open"))
      )
      .returning({ manufacturerId: workshopSessions.manufacturerId });
    // Seans açık değildi: ya çoktan kapandı ya da hiç açılmadı. Oran YAZILMAZ.
    if (!claimed) return null;

    // Adet, seans satırı kilitliyken sayılır: bu noktadan sonra `reserveSeat`
    // (status = 'open' şartı) yeni koltuk veremez, yani sayı gerçekten kesindir.
    const batch = await tx
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        userId: orders.userId,
        status: orders.status,
      })
      .from(orders)
      .where(batchOrderFilter(sessionId));

    const orderCount = batch.length;
    const commissionRateBps = workshopCommissionRateBps(orderCount);

    await tx
      .update(workshopSessions)
      .set({
        commissionRateBps,
        // Boş parti üretime GİRMEZ; `in_production` yazmak mekana gitmeyecek
        // bir sevkiyatı bekliyor gibi gösterirdi.
        status: orderCount > 0 ? "in_production" : "cancelled",
        updatedAt: closedAt,
      })
      .where(eq(workshopSessions.id, sessionId));

    if (orderCount > 0) {
      // Oran partideki HER siparişe yazılır; üretici ataması yalnızca ön
      // rezerve üretici varsa. `accrueEarning`/`accruePainterEarning` oranı
      // siparişten okuduğu için, üreticisiz bir seansta bile oranın donmuş
      // olması gerekir — sonradan değişen bir sabit geçmişi yeniden fiyatlamaz.
      const set: Partial<typeof orders.$inferInsert> = {
        commissionRateBps,
        updatedAt: closedAt,
      };
      if (claimed.manufacturerId) {
        set.manufacturerId = claimed.manufacturerId;
        // Üretici seansı açılışta taahhüt etti: kabul beklemesi yok.
        set.manufacturerStatus = "accepted";
        set.assignedToManufacturerAt = closedAt;
        set.manufacturerAcceptedAt = closedAt;
      }
      await tx.update(orders).set(set).where(batchOrderFilter(sessionId));
    }

    return { manufacturerId: claimed.manufacturerId, orderCount, commissionRateBps, batch };
  });

  if (!outcome) return { error: "Seans açık değil" };

  if (outcome.orderCount > 0 && !outcome.manufacturerId) {
    // Ödenmiş siparişleri olan bir seans üreticisiz kapandı: PATCH ucu seansı
    // açarken üretici şart koşuyor, demek ki sonradan kaldırılmış. Parti kimseye
    // düşmedi; admin elle atamak zorunda.
    console.error(
      `[workshop] seans ${sessionId} üreticisiz kapandı — ${outcome.orderCount} sipariş atanmadı`
    );
  }

  // Yan etkiler işlem COMMIT ettikten SONRA: bir e-posta/Redis hatası paranın
  // dondurulduğu adımı geri almamalı.
  if (outcome.manufacturerId) {
    await notifyManufacturerSessionClosed(sessionId, {
      orderCount: outcome.orderCount,
      commissionRateBps: outcome.commissionRateBps,
    });
  }
  for (const order of outcome.batch) {
    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: outcome.manufacturerId,
      status: order.status,
      manufacturerStatus: outcome.manufacturerId ? "accepted" : null,
    }).catch(() => {});
  }

  return { orderCount: outcome.orderCount, commissionRateBps: outcome.commissionRateBps };
}

/** Düzeltilen bir koltuk sayacı: `from` → `to`. */
export interface SeatReconciliation {
  sessionId: string;
  from: number;
  to: number;
}

/**
 * AÇIK seansların koltuk sayacını gerçek katılımcı satırlarından yeniden kurar.
 *
 * Neden gerekli: koltuk rezervasyonu ile katılımcı insert'i tek işlemde (Task 8),
 * ama koltuğu GERİ veren yollar öyle değil. Süre dolumu işi Redis'e hiç
 * yazılamazsa (katılım anında Redis erişilemez) ya da süreç rezervasyon ile
 * bırakma arasında ölürse, koltuk hiçbir yeniden denemenin kurtaramayacağı
 * şekilde tutulu kalır. Tek tek yamamak yerine sayaç saatlik olarak
 * MUTABAKATA getirilir.
 *
 * Doğruluk dayanağı: rezervasyon ve katılımcı satırı aynı commit'te doğduğu
 * için, meşru olarak tutulan her koltuğun bir katılımcı satırı VARDIR. `cancelled`
 * olmayan katılımcı sayısı bu yüzden koltuk sayacının doğru değeridir.
 *
 * Yalnızca `open` seanslar: kapanmış bir seansın sayacı tarihsel kayıttır ve
 * geriye dönük düzeltilmesi, kapanış anındaki tabloyu bozar.
 *
 * Yarış güvenliği: sayaçlar önce seans, SONRA katılımcı okunur ve yazım
 * "gördüğüm değer hâlâ duruyorsa" (compare-and-set) koşuludur. Araya giren bir
 * katılım/bırakma UPDATE'i eşleştirmez, 0 satır döner ve düzeltme bir sonraki
 * tura kalır — hiçbir koşulda taze bir sayacın üstüne bayat değer yazılmaz.
 * Kilit sırası da korunur: katılımcılar KİLİTSİZ okunur, sonra seans yazılır.
 */
export async function reconcileOpenSessionSeats(): Promise<SeatReconciliation[]> {
  const open = await db
    .select({ id: workshopSessions.id, bookedCount: workshopSessions.bookedCount })
    .from(workshopSessions)
    .where(eq(workshopSessions.status, "open"));
  if (open.length === 0) return [];

  const held = await db
    .select({
      sessionId: workshopParticipants.sessionId,
      seats: sql<number>`count(*)::int`,
    })
    .from(workshopParticipants)
    .where(
      and(
        inArray(
          workshopParticipants.sessionId,
          open.map((s) => s.id)
        ),
        ne(workshopParticipants.status, "cancelled")
      )
    )
    .groupBy(workshopParticipants.sessionId);
  const seatsBySession = new Map(held.map((r) => [r.sessionId, r.seats]));

  const corrections: SeatReconciliation[] = [];
  for (const session of open) {
    const actual = seatsBySession.get(session.id) ?? 0;
    if (actual === session.bookedCount) continue;

    const fixed = await db
      .update(workshopSessions)
      .set({ bookedCount: actual, updatedAt: new Date() })
      .where(
        and(
          eq(workshopSessions.id, session.id),
          eq(workshopSessions.status, "open"),
          eq(workshopSessions.bookedCount, session.bookedCount)
        )
      )
      .returning({ id: workshopSessions.id });
    if (fixed.length === 0) continue; // araya bir katılım/bırakma girdi

    // Sessiz onarım, hatayı gizler: her düzeltme seans ve fark ile loglanır.
    console.warn(
      `[workshop] seans ${session.id}: koltuk sayacı ${session.bookedCount} → ${actual} ` +
        `(fark ${actual - session.bookedCount})`
    );
    corrections.push({ sessionId: session.id, from: session.bookedCount, to: actual });
  }
  return corrections;
}
