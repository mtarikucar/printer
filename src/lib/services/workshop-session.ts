import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  manufacturers,
  orders,
  workshopParticipants,
  workshopSessions,
  workshopVenues,
} from "@/lib/db/schema";
import {
  deriveSessionDates,
  workshopCommissionRateBps,
  WORKSHOP_BATCH_EXCLUDED_PAYMENT_STATUSES,
  WORKSHOP_BATCH_EXCLUDED_STATUSES,
  WORKSHOP_DELIVER_PENDING_EXCLUDED_STATUSES,
  WORKSHOP_JOIN_CLOSES_DAYS_BEFORE,
  WORKSHOP_ORPHAN_HOLD_REPORT_DAYS,
  WORKSHOP_SEAT_HOLD_HOURS,
  WORKSHOP_SHIP_PENDING_EXCLUDED_STATUSES,
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
 * Partinin DIŞINDA kalan siparişler — İKİ eksende.
 *
 * `rejected`: admin siparişi reddetti.
 * `payment_status = 'refunded'`: sipariş iade edildi. `refundOrder`
 * `orders.status`e dokunmadığı için bu ayak olmadan iadeli sipariş partide
 * kalır — gerekçenin tamamı `config/workshop.ts`teki
 * `WORKSHOP_BATCH_EXCLUDED_*` yorumunda.
 *
 * Dizi hâlinde tutulur ki SQL (burası) ve JS (`orderInBatch`) tarafı aynı
 * kaynaktan okusun.
 */
const NOT_EXCLUDED_STATUS = notInArray(orders.status, [
  ...WORKSHOP_BATCH_EXCLUDED_STATUSES,
]);
const NOT_REFUNDED = notInArray(orders.paymentStatus, [
  ...WORKSHOP_BATCH_EXCLUDED_PAYMENT_STATUSES,
]);

/**
 * Partiye giren siparişler: seansa bağlı, reddedilmemiş ve iadesi yapılmamış
 * olanlar. Aynı yüklem sayımda, atamada, toplu sevkte ve toplu teslimde
 * kullanılır; biri ayrışırsa üretici oranı hesaplanmayan (ya da parası geri
 * verilmiş) bir figür basar.
 *
 * EXPORT EDİLİR: ship/deliver uçları da bunu kullanır, kendi kopyalarını
 * yazmaz. Uçlar bunu kendi `orders.status` dizileriyle (`WORKSHOP_*_PENDING_
 * EXCLUDED_STATUSES`) BİRLEŞTİRİR — o diziler "hâlâ bekliyor mu", bu yüklem
 * "partiye ait mi" sorusunu yanıtlar.
 */
export function batchOrderFilter(sessionId: string) {
  return and(eq(orders.workshopSessionId, sessionId), NOT_EXCLUDED_STATUS, NOT_REFUNDED);
}

/**
 * Partide HÂLÂ sevk edilmeyi bekleyen sipariş — toplu sevk ucunun tanımı.
 *
 * Rotadan buraya taşındı ki DB'li test aynı yüklemi çağırabilsin: "iade edilmiş
 * sipariş sevk kuyruğundan düşer" iddiası ancak rotanın GERÇEK yüklemiyle
 * doğrulanırsa bir şey ifade eder; testin kendi kopyası bir gün ayrışır ve
 * yeşil kalarak yalan söyler.
 *
 * Üretici ataması (`manufacturerId`) BİLEREK aranmaz: üreticisiz bir sipariş de
 * partiye aittir, yalnızca sevk edilemez (rota UPDATE'inde ayrıca süzülür).
 * Bunu yükleme koymak, böyle bir siparişi hem UPDATE'ten hem `leftBehind`
 * raporundan düşürür; `pending` yanlışlıkla boşalır, seans `shipped` olur ve
 * admin'e "geride kalan yok" denir (bkz. task-12a-report.md, fix round 2).
 */
export function batchShipPending(sessionId: string) {
  return and(
    batchOrderFilter(sessionId),
    notInArray(orders.status, [...WORKSHOP_SHIP_PENDING_EXCLUDED_STATUSES])
  );
}

/**
 * Partide HÂLÂ teslim edilmeyi bekleyen sipariş — toplu teslim ucunun tanımı.
 * `shipped` burada HARİÇ TUTULMAZ (ship'in tam tersi): sevk edilmiş sipariş tam
 * olarak teslim bekleyen sipariştir.
 */
export function batchDeliverPending(sessionId: string) {
  return and(
    batchOrderFilter(sessionId),
    notInArray(orders.status, [...WORKSHOP_DELIVER_PENDING_EXCLUDED_STATUSES])
  );
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

/**
 * Bu seansa bağlı, reddedilmemiş sipariş adedi.
 *
 * Admin ucu "bu seansı geri taslağa çekmek sipariş ortada bırakır mı?" sorusunu
 * bununla yanıtlar. Ayrı bir sorgu yazmak yerine burada durur ki "partiye giren
 * sipariş" tanımı (iade edilmiş sipariş sayılmaz) tek yerde kalsın.
 */
export async function countBatchOrders(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(batchOrderFilter(sessionId));
  return row?.count ?? 0;
}

export interface CloseSessionResult {
  orderCount: number;
  commissionRateBps: number;
}

/** `closeSession`'ın işlem içi sonucu: ya sahiplenilemedi ya da parti yazıldı. */
type CloseOutcome =
  | { reason: string }
  | {
      manufacturerId: string | null;
      orderCount: number;
      commissionRateBps: number;
      batch: { id: string; orderNumber: string; userId: string; status: string }[];
    };

/**
 * Seansı kapatır: sipariş adedini sabitler, komisyon oranını merdivenden
 * hesaplayıp DONDURUR ve tüm partiyi ön rezerve üreticiye düşürür.
 *
 * Oran seansın TÜM siparişlerine aynı değerle yazılır — erken katılan %60,
 * geç katılan %40 almaz. Üretici seans açılışında zaten taahhüt ettiği için
 * soğuk atama + 24 saat kabul beklemesi yoktur; bu, 5 günlük pencereyi
 * gerçekçi kılan şeydir.
 *
 * İDEMPOTENT: kapanış talebi koşullu UPDATE ile SAHİPLENİLİR. İkinci bir
 * süpürme (ya da elle çağrı) 0 satır günceller ve `{ error }` döner. Bu koşul
 * oku-sonra-yaz'a çevrilmemelidir: iki süpürme aynı anda koşarsa ikisi de
 * "açık" görüp oranı iki kez yazabilir ve ödeme oranı yarıştan çıkan değere
 * göre değişir.
 *
 * Koşulun İKİ ayağı var ve ikincisi paranın kendisidir:
 *   - `status = 'open'` — çifte kapanışı durdurur;
 *   - `commission_rate_bps IS NULL` — YENİDEN kapanışı durdurur. Admin PATCH
 *     ucu geçiş kontrolü yapmıyor: kapanmış bir seansı tekrar `open` yapmak
 *     mümkün. O ayak olmasaydı, bir sonraki süpürme oranı o günkü sipariş
 *     adedine göre YENİDEN hesaplayıp seansa ve partideki her siparişe
 *     yazardı — hakedişi çoktan işlenmiş siparişler dâhil. `accrueEarning` ve
 *     `accruePainterEarning` oranı siparişten okuduğu için bu doğrudan ödeme
 *     tutarını değiştirirdi. Garanti route'un iznine değil, YAPIYA bağlanmalı:
 *     bir seans ömrü boyunca yalnızca BİR kez fiyatlanır.
 *
 * Kilit sırası — kod NE YAPIYORSA o yazılıdır, dilek değil:
 *   - burası (kapanış):    seans → siparişler
 *   - katılım:             seans → taslak → katılımcı
 *   - koltuk bırakma:      katılımcı → seans (ÇAĞIRANIN işleminin dışında)
 *   - toplu sevk/teslim:   siparişler → seans (TERS yön)
 *
 * Sevk/teslim uçları bilerek ters sırada ilerliyor (önce partiyi güncelleyip
 * sonra seans damgasını atmak, "kaç sipariş sevk edildi" ile "seans durumu"nun
 * aynı işlemde tutarlı kalmasının en doğal yolu). Bu bir kilit döngüsü DEĞİL,
 * çünkü iki tarafın dokunduğu seans durumları AYRIK: kapanış yalnızca
 * `status = 'open'` bir seansı sahiplenir, sevk/teslim ise yalnızca kapanmış
 * (`in_production`/`shipped`) bir partide iş yapar — ikisi aynı seans satırında
 * asla aynı anda çalışmaz. Bu ayrıklık bozulursa (ör. bir gün açık seansta da
 * sevk edilebilirse) yönlerden biri düzeltilmek ZORUNDA.
 *
 * Buna karşılık BURADA mevcut bir taslağı/katılımcıyı kilitleyip sonra seansa
 * dönmek gerçek bir döngü açar (katılım yolu tam tersini yapıyor) —
 * yapılmamalıdır.
 */
export async function closeSession(
  sessionId: string
): Promise<CloseSessionResult | { error: string }> {
  const closedAt = new Date();

  const outcome = await db.transaction(async (tx): Promise<CloseOutcome> => {
    const [claimed] = await tx
      .update(workshopSessions)
      .set({ status: "closed", updatedAt: closedAt })
      .where(
        and(
          eq(workshopSessions.id, sessionId),
          eq(workshopSessions.status, "open"),
          // Bir kez fiyatlanmış seans bir daha fiyatlanmaz — bkz. doc yorumu.
          isNull(workshopSessions.commissionRateBps)
        )
      )
      .returning({ manufacturerId: workshopSessions.manufacturerId });
    // Seans açık değil ya da zaten bir kez fiyatlandı. Oran YAZILMAZ.
    //
    // Hangisi olduğunu SÖYLEMEK gerekiyor: yeniden `open` yapılmış, bir kez
    // fiyatlanmış bir seans her saat başı bu yoldan geçer ve log'da "açık
    // değil" yazması admin'i şaşırtır — seans gerçekten açıktır, kapanamayan
    // şey fiyatlamadır.
    if (!claimed) {
      const [row] = await tx
        .select({
          status: workshopSessions.status,
          commissionRateBps: workshopSessions.commissionRateBps,
        })
        .from(workshopSessions)
        .where(eq(workshopSessions.id, sessionId));
      if (!row) return { reason: "Seans bulunamadı" };
      return {
        reason:
          row.commissionRateBps !== null
            ? "Seans zaten fiyatlandı — komisyon oranı bir kez donar"
            : "Seans açık değil",
      };
    }

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

    // Oran YALNIZCA gerçekten fiyatlanacak bir parti varsa DONAR.
    //
    // Boş seansta dondurmak, hiçbir şeyi korumadığı gibi seansı KALICI OLARAK
    // ölü bırakıyordu: PATCH ucunun "fiyatlanmış seans yeniden açılamaz" kapısı
    // `commission_rate_bps IS NOT NULL`e bakıyor, yani kimsenin katılmadığı bir
    // seans bir daha katılıma açılamıyordu. Korunacak para yok — partide sipariş
    // yok — ama admin'in tek çıkışı yeni bir seans yaratmak oluyordu.
    //
    // Kapanışın idempotensi bundan ETKİLENMEZ: boş seans `cancelled` olur ve
    // sahiplenme koşulunun ilk ayağı (`status = 'open'`) ikinci bir kapanışı
    // zaten reddeder.
    await tx
      .update(workshopSessions)
      .set({
        ...(orderCount > 0 ? { commissionRateBps } : {}),
        status: nextStatus,
        updatedAt: closedAt,
      })
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

  if ("reason" in outcome) return { error: outcome.reason };

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

/**
 * Üreticisiz kapanmış bir seansın partisini SONRADAN bir üreticiye devreder.
 *
 * Neden var: `closeSession` seansta ön rezerve üretici yoksa oranı dondurur ama
 * hiçbir siparişe üretici yazmaz. O noktadan sonra seans KÖR NOKTAYA düşer —
 * PATCH ile `open`a çekilemez (fiyatlanmış), `adoptOrphanBatchOrders` mühürlü
 * seansları atlar, toplu sevk ise sipariş başına üretici arar. Admin'e giden
 * e-posta "bir üretici atayın ve siparişleri elle devredin" diyordu; ne birinin
 * ne diğerinin arayüzü vardı. Bu, o kurtarmanın gerçek yoludur.
 *
 * Atama `batchAssignmentSet` ile yazılır — `closeSession` ve
 * `adoptOrphanBatchOrders` ile AYNI tanım. Üçüncü bir yazım biçimi, bir gün
 * kabul damgası ya da donmuş oran eksik yazılan bir parti demektir.
 *
 * Kapılar:
 *  - üretici aktif olmalı,
 *  - seans `closed` ya da `in_production` olmalı (yola çıkmış partiyi devretmek
 *    kutuda olmayan bir figüre üretici atamaktır),
 *  - seansın üreticisi GERÇEKTEN boş olmalı — bu bir kurtarma yolu, sessiz bir
 *    devir aracı değil. Sahiplenme koşullu UPDATE'tir: iki admin aynı anda
 *    farklı üretici seçerse ikincisi 0 satır günceller ve reddedilir.
 *
 * Kilit sırası closeSession ile aynı: seans → siparişler.
 */
export type AssignBatchManufacturerResult =
  | { ok: true; orderCount: number; commissionRateBps: number | null }
  | { ok: false; error: string };

const BATCH_ASSIGNABLE_SESSION_STATUSES = ["closed", "in_production"] as const;

export async function assignBatchManufacturer(input: {
  sessionId: string;
  manufacturerId: string;
}): Promise<AssignBatchManufacturerResult> {
  const { sessionId, manufacturerId } = input;

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, manufacturerId),
    columns: { id: true, status: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return { ok: false, error: "Seçilen üretici bulunamadı ya da aktif değil." };
  }

  const session = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.id, sessionId),
    columns: { id: true, status: true, manufacturerId: true, commissionRateBps: true },
  });
  if (!session) return { ok: false, error: "Seans bulunamadı" };
  if (session.manufacturerId) {
    return {
      ok: false,
      error:
        "Bu seansın zaten bir üreticisi var. Devir gerekiyorsa siparişleri " +
        "tek tek atama ekranından taşıyın — toplu devir yalnızca üreticisiz " +
        "kalmış bir parti için vardır.",
    };
  }
  if (
    !(BATCH_ASSIGNABLE_SESSION_STATUSES as readonly string[]).includes(session.status)
  ) {
    return {
      ok: false,
      error:
        "Yalnızca kapanmış ama henüz sevk edilmemiş bir partiye üretici " +
        `atanabilir (bu seans: ${session.status}).`,
    };
  }

  /** İşlem içi sonuç: ya sahiplenilemedi ya da parti devredildi. */
  type AssignOutcome =
    | { error: string }
    | {
        batch: { id: string; orderNumber: string; userId: string | null; status: string }[];
        commissionRateBps: number | null;
      };

  const at = new Date();
  const outcome = await db.transaction(async (tx): Promise<AssignOutcome> => {
    const [claimed] = await tx
      .update(workshopSessions)
      .set({ manufacturerId, updatedAt: at })
      .where(
        and(
          eq(workshopSessions.id, sessionId),
          isNull(workshopSessions.manufacturerId),
          inArray(workshopSessions.status, [...BATCH_ASSIGNABLE_SESSION_STATUSES])
        )
      )
      .returning({ commissionRateBps: workshopSessions.commissionRateBps });
    if (!claimed) {
      return {
        error:
          "Seansın durumu bu arada değişti (başka bir atama araya girmiş " +
          "olabilir). Sayfayı yenileyip tekrar bakın.",
      };
    }

    const batch = await tx
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        userId: orders.userId,
        status: orders.status,
      })
      .from(orders)
      .where(and(batchOrderFilter(sessionId), isNull(orders.manufacturerId)));

    // Oran kapanışta donmuştu; yoksa bu parti hiç fiyatlanmamış demektir ve
    // üretici hangi payı aldığını bilmeden basmaya başlamamalı.
    if (batch.length > 0 && claimed.commissionRateBps === null) {
      throw new Error(
        "WORKSHOP_BATCH_UNPRICED: seans donmuş komisyon oranı taşımıyor"
      );
    }

    if (batch.length > 0) {
      await tx
        .update(orders)
        .set(
          batchAssignmentSet({
            manufacturerId,
            commissionRateBps: claimed.commissionRateBps!,
            at,
          })
        )
        .where(and(batchOrderFilter(sessionId), isNull(orders.manufacturerId)));

      // Parti artık gerçekten basılıyor: durum bunu söylemeli. `closed`,
      // "ödendi ama kimse basmıyor"un adıydı.
      await tx
        .update(workshopSessions)
        .set({ status: "in_production", updatedAt: at })
        .where(
          and(eq(workshopSessions.id, sessionId), eq(workshopSessions.status, "closed"))
        );
    }

    return { batch, commissionRateBps: claimed.commissionRateBps } as const;
  });

  if ("error" in outcome) return { ok: false, error: outcome.error };

  // Yan etkiler COMMIT'ten SONRA (closeSession'daki aynı ilke).
  if (outcome.batch.length > 0) {
    await notifyManufacturerSessionClosed(sessionId, {
      orderCount: outcome.batch.length,
      commissionRateBps: outcome.commissionRateBps!,
    });
  }
  for (const order of outcome.batch) {
    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId,
      status: order.status,
      manufacturerStatus: "accepted",
    }).catch(() => {});
  }

  return {
    ok: true,
    orderCount: outcome.batch.length,
    commissionRateBps: outcome.commissionRateBps,
  };
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
 * NE YAPMAZ: ödemesi hiç gelmeyen koltuğu geri vermez. Katılım, koltuğu ve
 * katılımcı satırını TEK işlemde yazıp süre dolumu işini ondan SONRA kuyruğa
 * aldığı (ve Redis erişilemezse bile başarılı saydığı) için, "işi hiç
 * planlanamamış" bir koltuğun `pending_payment` katılımcı satırı DURUYORDUR:
 * sayaç ile satırlar birbirini tutar, burada düzeltilecek bir sapma yoktur ve
 * koltuk sonsuza kadar tutulu kalırdı. Onu geri veren şey `findStaleSeatHolds`
 * + `expireDraft` yoludur (bkz. aşağısı ve workshop-close worker'ı).
 *
 * NE YAPAR: iki tarafı ayrı ayrı yazan HERHANGİ bir yolun açtığı sapmayı
 * kapatır — elle DB müdahalesi, `releaseSeat(sessionId)`'i katılımcıyı iptal
 * etmeden çağıran (ya da tersini yapan) bir çağrı ve gelecekte ikisini birlikte
 * güncellemeyi unutan yeni bir yol. Bu, "koltuk sayacı doğrudur" iddiasının
 * tek denetimidir; kaldırılırsa sapma sessizce büyür.
 *
 * Doğru değerin tanımı: rezervasyon ve katılımcı satırı aynı commit'te doğduğu
 * için, meşru olarak tutulan her koltuğun bir katılımcı satırı vardır —
 * `cancelled` olmayan katılımcı sayısı koltuk sayacının doğru değeridir.
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
 *
 * Üretici, seansın O ANKİ `manufacturer_id`'sinden DEĞİL, PARTİNİN KENDİSİNDEN
 * okunur: admin PATCH ucu seansın üreticisini kapanıştan sonra değiştirebiliyor
 * ve o hâlde geç gelen sipariş, partinin geri kalanından BAŞKA bir üreticiye
 * düşerdi — tek kutu, iki üretici. Partinin taşıdığı üretici, atamanın
 * donduğu andaki üreticidir; admin partiyi topluca devrettiyse de doğru cevabı
 * verir. Birden fazla (ya da hiç) üretici görülürse parti bölünmüş demektir:
 * sahiplenme yapılmaz, gürültülü loglanır.
 *
 * Oran seanstan okunur ve bu güvenlidir: `closeSession`'ın
 * `commission_rate_bps IS NULL` koşulu onu ömür boyu bir kez yazılabilir kılar
 * ve hiçbir route bu alanı güncellemez.
 */
export async function adoptOrphanBatchOrders(): Promise<OrphanAdoption[]> {
  const orphans = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      sessionId: workshopSessions.id,
      sessionStatus: workshopSessions.status,
      commissionRateBps: workshopSessions.commissionRateBps,
    })
    .from(orders)
    .innerJoin(workshopSessions, eq(workshopSessions.id, orders.workshopSessionId))
    .where(
      and(
        isNull(orders.manufacturerId),
        isNull(orders.commissionRateBps),
        NOT_EXCLUDED_STATUS,
        // İADE EDİLMİŞ sipariş öksüz DEĞİLDİR. `refundOrder`
        // `manufacturer_id`yi NULL'a çeker; kapanıştan ÖNCE iade edilmiş bir
        // siparişte `commission_rate_bps` de zaten NULL'dır — yani yukarıdaki
        // iki NULL koşulu onu tam olarak "öksüz" gibi gösterir. Bu ayak
        // olmadan mühürlenmiş bir seanstaki iadeli sipariş her saat
        // "sahiplenilemedi" diye loglanır, sonsuza kadar.
        NOT_REFUNDED,
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
    const { sessionStatus, commissionRateBps } = rows[0];
    const orderNumbers = rows.map((r) => r.orderNumber).join(", ");

    if (sessionStatus !== "in_production") {
      // Parti kapandı ve yola çıktı: sipariş ödenmiş ama bu partiye giremez.
      console.error(
        `[workshop] seans ${sessionId} (${sessionStatus}) kapandıktan sonra ödenen ` +
          `${rows.length} sipariş partiye ALINMADI — elle karar gerekiyor: ${orderNumbers}`
      );
      continue;
    }
    if (commissionRateBps === null) {
      // Donmuş oranı olmayan bir partiye bağlanmak, öksüzü "iptal edilmiş
      // atama" gibi göstererek bir daha bulunamaz hâle getirirdi.
      console.error(
        `[workshop] seans ${sessionId} donmuş oran taşımıyor — ${rows.length} öksüz ` +
          `sipariş sahiplenilemedi: ${orderNumbers}`
      );
      continue;
    }

    // Partinin GERÇEKTEN atandığı üretici (seansın o anki alanı değil).
    const assigned = await db
      .selectDistinct({ manufacturerId: orders.manufacturerId })
      .from(orders)
      .where(and(batchOrderFilter(sessionId), isNotNull(orders.manufacturerId)));
    const batchManufacturerId = assigned.length === 1 ? assigned[0].manufacturerId : null;
    if (!batchManufacturerId) {
      console.error(
        `[workshop] seans ${sessionId} partisi tek bir üreticiye ait değil ` +
          `(${assigned.length} üretici) — ${rows.length} öksüz sipariş ` +
          `sahiplenilemedi: ${orderNumbers}`
      );
      continue;
    }

    const updated = await db
      .update(orders)
      .set(batchAssignmentSet({ manufacturerId: batchManufacturerId, commissionRateBps, at }))
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
          `partisine sonradan alındı — oran ${commissionRateBps}bps, üretici ${batchManufacturerId}`
      );
    }

    adopted.push({
      sessionId,
      orderIds: updated.map((o) => o.id),
      commissionRateBps,
    });

    await notifyManufacturerOrdersAdopted(sessionId, batchManufacturerId, updated.length);
    for (const order of updated) {
      await emitOrderChanged({
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        manufacturerId: batchManufacturerId,
        status: order.status,
        manufacturerStatus: "accepted",
      }).catch(() => {});
    }
  }

  return adopted;
}

/** Süresi dolmuş bir koltuk tutması — süpürmenin geri alacağı rezervasyon. */
export interface StaleSeatHold {
  participantId: string;
  sessionId: string;
  draftId: string | null;
  fullName: string;
  heldSince: Date;
}

/**
 * `WORKSHOP_SEAT_HOLD_HOURS`'ı aşmış, hâlâ ödeme bekleyen koltuk tutmaları.
 *
 * Bu, koltuk sızıntısının GERÇEK kurtarma yoludur. Katılım akışı süre dolumu
 * işini işlem COMMIT ettikten SONRA kuyruğa alır ve Redis erişilemezse katılımı
 * yine de başarılı sayar (müşteriyi ödeme sayfasına hiç götürmemenin bedeli
 * daha ağır) — o iş hiç yazılmazsa koltuğu geri verecek başka hiçbir mekanizma
 * yoktu. Sayaç mutabakatı bunu YAKALAYAMAZ: katılımcı satırı `pending_payment`
 * olarak durduğu için sayaç ile satırlar zaten tutarlıdır.
 *
 * Seans durumuna göre SÜZÜLMEZ. Tutma süresi katılım anından işler; kapanmış
 * bir seansta bile ödenmemiş bir tutmayı sonlandırmak doğrudur — hem sayacı
 * gerçeğe yaklaştırır hem de taslağı `expired` yaparak kapanıştan SONRA ödenip
 * partiye giremeyen "öksüz sipariş"in bir kaynağını kurutur.
 *
 * Yalnızca ADAYLARI döndürür; iptal `expireDraft` üzerinden yürür (Task 10'un
 * bırakma yolu). Bu modül `order-draft.ts`'i import ETMEZ: o modül
 * `workshop-notify.ts`'i, o da bu dosyayı import ediyor — döngü olurdu. Bu
 * yüzden bulma burada, eylem worker'da (aynı `findSessionsDueToClose` +
 * `closeSession` ayrımı).
 *
 * TASLAKSIZ tutmalar SINIRLIDIR (`WORKSHOP_ORPHAN_HOLD_REPORT_DAYS`).
 * Gerekçesi: taslaklı bir tutma `expireDraft` ile kapanır ve bir daha bu
 * sorguya düşmez, ama taslaksız olanı (elle eklenmiş ya da bozulmuş bir
 * katılımcı satırı) kapatacak güvenli bir otomatik yol yok — worker onu
 * yalnızca `console.error` ile bildirebiliyor. Sınır olmadan aynı satır her
 * saat, sonsuza kadar hata basar ve gerçek uyarıları gömer. Bir hafta boyunca
 * bildirilir, sonra susar; koltuk zaten kapanmış bir seansta anlamsızdır ve
 * açık seansta `reconcileOpenSessionSeats` sayaç sapmasını ayrıca raporlar.
 *
 * TASLAKLI tutmalar bu sınırdan ETKİLENMEZ: onların her turda denenmesi
 * gerekir (`expireDraft` geçici bir hatayla patlamış olabilir).
 */
export async function findStaleSeatHolds(now: Date): Promise<StaleSeatHold[]> {
  const cutoff = new Date(now.getTime() - WORKSHOP_SEAT_HOLD_HOURS * 3600 * 1000);
  const reportFloor = new Date(
    now.getTime() - WORKSHOP_ORPHAN_HOLD_REPORT_DAYS * 24 * 3600 * 1000
  );
  return db
    .select({
      participantId: workshopParticipants.id,
      sessionId: workshopParticipants.sessionId,
      draftId: workshopParticipants.draftId,
      fullName: workshopParticipants.fullName,
      heldSince: workshopParticipants.createdAt,
    })
    .from(workshopParticipants)
    .where(
      and(
        eq(workshopParticipants.status, "pending_payment"),
        lte(workshopParticipants.createdAt, cutoff),
        or(
          isNotNull(workshopParticipants.draftId),
          gt(workshopParticipants.createdAt, reportFloor)
        )
      )
    );
}
