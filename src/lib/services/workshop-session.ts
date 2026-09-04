import { and, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
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
import {
  notifyAdminSessionWithoutManufacturer,
  notifyManufacturerOrdersAdopted,
  notifyManufacturerSessionClosed,
} from "@/lib/services/workshop-manufacturer-notify";

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
 * `rejected` siparişler her yerde partinin DIŞINDADIR: admin onları iade etti.
 * Bir iadeli siparişi merdivende saymak partiyi olduğundan büyük gösterir ve
 * daha da kötüsü, o siparişi üreticiye BASILMAK ÜZERE atar.
 */
const NOT_REJECTED = ne(orders.status, "rejected");

/**
 * Partiye giren siparişler: seansa bağlı ve reddedilmemiş olanlar. Aynı yüklem
 * hem sayımda hem atamada kullanılır; ikisi ayrışırsa üretici, oranı
 * hesaplanmayan bir figür basar.
 */
function batchOrderFilter(sessionId: string) {
  return and(eq(orders.workshopSessionId, sessionId), NOT_REJECTED);
}

/**
 * Bir siparişi partiye bağlayan alanların TEK tanımı.
 *
 * Hem kapanış (`closeSession`) hem sonradan gelen öksüz siparişin sahiplenilmesi
 * (`adoptOrphanBatchOrders`) bunu kullanır: "partiye atanmış olmak" iki yerde
 * ayrı ayrı tarif edilirse, geç ödeyen katılımcı bir gün kabul damgası ya da
 * donmuş oranı eksik alır ve fark ancak ödeme gününde görülür.
 *
 * Üretici yoksa YALNIZCA oran yazılır: oran, `accrueEarning`/`accruePainterEarning`
 * tarafından siparişten okunduğu için üreticisiz bir seansta bile donmuş olmalı —
 * sonradan değişen bir sabit geçmişi yeniden fiyatlamamalı.
 */
function batchAssignmentSet(args: {
  manufacturerId: string | null;
  commissionRateBps: number;
  at: Date;
}): Partial<typeof orders.$inferInsert> {
  const set: Partial<typeof orders.$inferInsert> = {
    commissionRateBps: args.commissionRateBps,
    updatedAt: args.at,
  };
  if (args.manufacturerId) {
    set.manufacturerId = args.manufacturerId;
    // Üretici seansı açılışta taahhüt etti: kabul beklemesi yok.
    set.manufacturerStatus = "accepted";
    set.assignedToManufacturerAt = args.at;
    set.manufacturerAcceptedAt = args.at;
  }
  return set;
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

    // Boş parti üretime GİRMEZ; `in_production` yazmak mekana gitmeyecek bir
    // sevkiyatı bekliyor gibi gösterirdi.
    //
    // Ödenmiş siparişi olup üreticisi olmayan seans da `in_production` OLMAZ:
    // "üretimde" görünen ama kimsenin bakmadığı bir ödenmiş sipariş yığını,
    // durumun kendisinin yalan söylemesidir. `closed` dürüst hâldir ve admin'e
    // haber verilir (aşağıda).
    const nextStatus = orderCount === 0
      ? "cancelled"
      : claimed.manufacturerId
        ? "in_production"
        : "closed";

    await tx
      .update(workshopSessions)
      .set({ commissionRateBps, status: nextStatus, updatedAt: closedAt })
      .where(eq(workshopSessions.id, sessionId));

    if (orderCount > 0) {
      await tx
        .update(orders)
        .set(
          batchAssignmentSet({
            manufacturerId: claimed.manufacturerId,
            commissionRateBps,
            at: closedAt,
          })
        )
        .where(batchOrderFilter(sessionId));
    }

    return { manufacturerId: claimed.manufacturerId, orderCount, commissionRateBps, batch };
  });

  if (!outcome) return { error: "Seans açık değil" };

  if (outcome.orderCount > 0 && !outcome.manufacturerId) {
    // Ödenmiş siparişleri olan bir seans üreticisiz kapandı: PATCH ucu seansı
    // açarken üretici şart koşuyor, demek ki sonradan kaldırılmış. Parti kimseye
    // düşmedi ve seans `closed`'da bekliyor; admin elle atamak zorunda.
    console.error(
      `[workshop] seans ${sessionId} üreticisiz kapandı — ${outcome.orderCount} sipariş atanmadı`
    );
    await notifyAdminSessionWithoutManufacturer(sessionId, outcome.orderCount);
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

/**
 * Kapanmış bir partiye SONRADAN katılan sipariş.
 *
 * Nasıl doğuyor: koltuk `joinClosesAt`'e kadar rezerve edilebiliyor ve taslak
 * `WORKSHOP_SEAT_HOLD_HOURS` boyunca yaşıyor; süpürme ise saatlik. Kapanıştan
 * sonra tamamlanan bir ödeme, seansa bağlı ama üreticisiz ve oransız bir sipariş
 * üretir: partiye girmez, kimseye atanmaz, üretime hiç düşmez. Müşteri ₺1.350
 * öder ve seans günü figürsüz kalır.
 */
export interface OrphanAdoption {
  sessionId: string;
  orderIds: string[];
  commissionRateBps: number;
}

/**
 * Öksüz sipariş sahiplenmenin yapılabildiği TEK seans durumu: parti hâlâ
 * üretimde, yani kutuya bir figür daha eklenebilir.
 */
const ADOPTABLE_SESSION_STATUSES = ["in_production"] as const;

/**
 * Partisi ARTIK açılamayan seanslar: sevkiyat yola çıktı (ya da hiç olmadı).
 * Bunlara sessizce sipariş eklemek, kutuda olmayan bir figürü söz vermektir —
 * sahiplenilmez, GÜRÜLTÜLÜ loglanır ve karar admin'e bırakılır.
 *
 * `cancelled` de buradadır: üreticiye "parti yok" denmişti; sonradan gelen tek
 * ödeme bunu geri almaz, bu bir insan kararıdır.
 *
 * `closed` da buradadır ve tek anlamı vardır: seans ödenmiş siparişlerle ama
 * ÜRETİCİSİZ kapandı (kapanış işlemi içindeki geçici `closed` dışarıdan hiç
 * görülmez). Bağlanacak bir üretici ve donmuş oran yok; o seans zaten admin'e
 * bildirildi, geç gelen sipariş de aynı yerde görünmeli.
 */
const SEALED_SESSION_STATUSES = [
  "closed",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
] as const;

/**
 * Kapanıştan sonra ödemesi tamamlanan sipariş(ler)i partiye alır.
 *
 * Ayrım noktası — sahiplenilecek öksüz ile admin'in BİLEREK aldığı sipariş
 * birbirine karışmamalı:
 *   - `manufacturer-revoke` / `revoke-after-painter` atamayı geri alırken
 *     `manufacturerId`'yi NULL'a çeker ama `commissionRateBps`'i BIRAKIR.
 *   - Partiye hiç girememiş öksüzde İKİSİ DE NULL'dır.
 * Bu yüzden koşul `manufacturer_id IS NULL AND commission_rate_bps IS NULL`:
 * admin'in elinden aldığı bir siparişi süpürme her saat geri kapamaz.
 *
 * Atama alanları `batchAssignmentSet` ile yazılır — `closeSession` ile aynı
 * tanım, iki yer ayrışamaz. UPDATE aynı NULL koşullarını tekrar taşır: eşzamanlı
 * bir admin ataması araya girerse 0 satır döner ve sahiplenme sessizce iptal olur.
 */
export async function adoptOrphanBatchOrders(): Promise<OrphanAdoption[]> {
  const orphans = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      sessionId: workshopSessions.id,
      sessionStatus: workshopSessions.status,
      manufacturerId: workshopSessions.manufacturerId,
      commissionRateBps: workshopSessions.commissionRateBps,
    })
    .from(orders)
    .innerJoin(workshopSessions, eq(workshopSessions.id, orders.workshopSessionId))
    .where(
      and(
        isNull(orders.manufacturerId),
        isNull(orders.commissionRateBps),
        NOT_REJECTED,
        inArray(workshopSessions.status, [
          ...ADOPTABLE_SESSION_STATUSES,
          ...SEALED_SESSION_STATUSES,
        ])
      )
    );
  if (orphans.length === 0) return [];

  const bySession = new Map<string, typeof orphans>();
  for (const row of orphans) {
    const list = bySession.get(row.sessionId) ?? [];
    list.push(row);
    bySession.set(row.sessionId, list);
  }

  const adopted: OrphanAdoption[] = [];
  const at = new Date();

  for (const [sessionId, rows] of bySession) {
    const { sessionStatus, manufacturerId, commissionRateBps } = rows[0];
    const orderNumbers = rows.map((r) => r.orderNumber).join(", ");

    if (sessionStatus !== "in_production") {
      // Parti kapandı ve yola çıktı: sipariş ödenmiş ama bu partiye giremez.
      console.error(
        `[workshop] seans ${sessionId} (${sessionStatus}) kapandıktan sonra ödenen ` +
          `${rows.length} sipariş partiye ALINMADI — elle karar gerekiyor: ${orderNumbers}`
      );
      continue;
    }
    if (!manufacturerId || commissionRateBps === null) {
      // Üreticisi ya da donmuş oranı olmayan bir partiye bağlanmak, öksüzü
      // "iptal edilmiş atama" gibi göstererek bir daha bulunamaz hâle getirirdi.
      console.error(
        `[workshop] seans ${sessionId} üretici/oran taşımıyor — ${rows.length} öksüz ` +
          `sipariş sahiplenilemedi: ${orderNumbers}`
      );
      continue;
    }

    const updated = await db
      .update(orders)
      .set(batchAssignmentSet({ manufacturerId, commissionRateBps, at }))
      .where(
        and(
          inArray(
            orders.id,
            rows.map((r) => r.orderId)
          ),
          isNull(orders.manufacturerId),
          isNull(orders.commissionRateBps)
        )
      )
      .returning({
        id: orders.id,
        orderNumber: orders.orderNumber,
        userId: orders.userId,
        status: orders.status,
      });
    if (updated.length === 0) continue;

    for (const order of updated) {
      console.warn(
        `[workshop] sipariş ${order.orderNumber} (${order.id}) seans ${sessionId} ` +
          `partisine sonradan alındı — oran ${commissionRateBps}bps, üretici ${manufacturerId}`
      );
    }

    adopted.push({
      sessionId,
      orderIds: updated.map((o) => o.id),
      commissionRateBps,
    });

    await notifyManufacturerOrdersAdopted(sessionId, updated.length);
    for (const order of updated) {
      await emitOrderChanged({
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        manufacturerId,
        status: order.status,
        manufacturerStatus: "accepted",
      }).catch(() => {});
    }
  }

  return adopted;
}
