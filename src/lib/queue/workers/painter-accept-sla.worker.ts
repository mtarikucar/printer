/**
 * Boyacı kabul SLA'sı — yanıtsız kalan OTOMATİK atamaları yeniden yerleştirir.
 *
 * Boyacı sözleşmesi (content/painter-onboarding.ts) atanan işe 24 saat içinde
 * kabul ya da ret yanıtı vermeyi şart koşuyordu, ama bu süreyi ÖLÇEN hiçbir şey
 * yoktu: yanıtlanmayan iş, boyacının tezgâhında kapasite tutarak süresiz
 * bekliyordu. Üretici ikizi (assignment-sla.worker.ts) yalnız bayrak koyar;
 * burada sahibin kararı daha ileri gider:
 *
 *   OTOMATİK atanmış iş + 24 saat sessizlik  →  iş boyacıdan ALINIR, sıradaki
 *   boyacıya otomatik verilir. CEZA YOKTUR (strikeCount artmaz, puana giren bir
 *   eylem satırı yazılmaz) ama bu, siparişin ret üst sınırına (flags.ts ·
 *   PAINTER_MAX_DECLINES) SAYILIR.
 *
 * Yalnız OTOMATİK atamalar böyle taşınır. Üreticinin ya da yöneticinin ELLE
 * seçtiği boyacı bir insan kararıdır; onu sistemin kendiliğinden bozması,
 * seçimi yapan kişiye haber vermeden onun yerine karar vermek olurdu. O işler
 * (ve baz baskısı yola çıkmış/ulaşmış olanlar) yalnız bayraklanır, kararı admin
 * verir.
 *
 * ANAHTAR, KOPARMADAN ÖNCE SORULUR. Devir tek bir kararın iki yarısıdır: işi
 * boyacıdan koparmak ve sıradakine yerleştirmek. Süpürme eskiden önce koparıyor,
 * yerleştirmeyi sonra deniyordu; yerleştirme otomatik atama anahtarını KAPALI
 * bulup geri dönünce sipariş hem boyacısız hem yerleştirilmemiş kalıyordu —
 * yani anahtarı kapatmak, işleri sahipsiz bırakan bir şeye dönüşüyordu. Anahtar
 * kapalıyken iş yerinde DURUR ve yalnız bayraklanır: admin yanıtsızlığı yine
 * öğrenir, ama kimseden bir şey koparılmaz.
 *
 * ÜRETİCİNİN BASKI HAKEDİŞİ DURUR. Devir sırasında tahakkuk eden baskı payı bu
 * yolda geri ÇEVRİLMEZ: boyacının sessizliği üreticinin kusuru değildir ve işi
 * yapmış bir partnerin parasını geri almak olurdu.
 *
 * İADE: iade edilmiş sipariş bu süpürmeye HİÇ girmez (okuma `notRefundedGuard`
 * ile süzülür, işlem içinde yeniden sorulur). İade edilmiş sipariş kımıldamaz
 * ve üstünde hiçbir partner cezalandırılmaz.
 *
 * Dayanıklılık: bir siparişin hatası süpürmenin geri kalanını düşürmez; hatalar
 * toplanır ve sonunda bir kez bildirilir (model-approval-sla ile aynı kalıp).
 *
 * NOT: bu dosya ve import ettiği HİÇBİR şey "server-only" almaz — worker
 * standalone Node'da koşar, o import zinciri onu crash-loop'a sokar.
 */
import { Worker, Job } from "bullmq";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { db } from "../../db";
import { orders, painterActions, painters } from "../../db/schema";
import { getEmailQueue } from "../queues";
import { formatAdminNoteLine, isRefunded } from "../../config/order-status-policy";
import { notRefundedGuard } from "../../services/manufacturer-assign";
import { notifyPainter } from "../../services/painter-notifications";
import { notifyManufacturer } from "../../services/manufacturer-notifications";
import { emitOrderChanged } from "../../realtime/emit";
import {
  PAINTER_MAX_REPLACEMENTS,
  painterDeclinesExhausted,
  type PainterAssignSkip,
} from "../../config/flags";
import { isFlagEnabled } from "../../services/flags";
import {
  PAINTER_AUTO_ASSIGNED_ACTION,
  assignPainterAutomatically,
  painterManualNextStep,
} from "../../services/painter-auto-assign";
import { PAINTER_SLA_TIMEOUT_ACTION } from "../../config/painter-scoring";
import { recordPainterDeclineCapReached } from "../../services/painter-evaluation";

/** Sözleşmedeki süre: atanan işe 24 saat içinde kabul/ret yanıtı. */
export const PAINTER_ACCEPT_SLA_HOURS = 24;

/** Admin notundaki bayrak; aynı siparişin her saat yeniden bildirilmesini de engeller. */
const FLAG = "[BOYACI-SLA]";

/**
 * Atamanın OTOMATİK olduğunu söyleyen tek iz: yerleştirme servisinin işlemin
 * içinde yazdığı boyacı eylem satırı. Elle atama `admin_assigned` yazar,
 * üreticinin devri ise boyacı günlüğüne hiç satır yazmaz (kendi
 * `manufacturerActions` satırına yazar) — yani "otomatik mi" sorusu bu iki
 * değerin karşılaştırmasıyla cevaplanır.
 *
 * Otomatik atamanın adı YERLEŞTİRMENİN kendi modülünden alınır: bu kelime iki
 * yerde ayrı ayrı yazılsaydı, birinin değişmesi süpürmeyi sessizce körleştirir
 * ve yanıtsız işler bir daha hiç devredilmezdi.
 */
const PAINTER_ADMIN_ASSIGN_ACTION = "admin_assigned";

/*
 * Yanıtsızlığın kalıcı kaydının adı, SIRALAYICININ sözlüğünden alınır
 * (config/painter-scoring.ts · PAINTER_SLA_TIMEOUT_ACTION). Burada kendi
 * dizemizi yazsaydık, sıralayıcı bu satırları hiç görmezdi: sinyal sessizce
 * kaybolurdu.
 *
 * "CEZA YOK" ile "sıralamada hiç görünmesin" aynı şey DEĞİLDİR. Sahibin kararı
 * strike'ı yasaklar — hesabı askıya alan açık yaptırım — ama "kim daha hızlı
 * yanıt veriyor" sorusunun cevabı tam da bu satırdır; sıralayıcı onu olumsuz
 * sayar (P1'in PAINTER_BAD_ACTIONS listesi).
 */

/**
 * Eylem satırı ile atama damgası arasındaki saniyelik fark (saat kayması ve
 * işlem gecikmesi) yüzünden pencere biraz geriye açılır: satır atamadan hemen
 * SONRA yazılır, ama iki damga farklı saatlerden gelir.
 */
const ACTION_WINDOW_SLACK_MS = 60_000;

export type PainterSlaAction = "reassign" | "flag";

export interface PainterSlaInput {
  /** Atamanın üstünden geçen saat. */
  ageHours: number;
  /** Bu atamayı sıralayıcı mı yaptı? (elle atama otomatik bozulmaz) */
  autoAssigned: boolean;
  /** Baz baskı boyacıya ulaştı ya da ona doğru yola çıktı mı? */
  parcelOnTheWay: boolean;
  /** Sipariş bu bayrağı zaten taşıyor mu? (aynı işi her saat bildirmeyelim) */
  alreadyFlagged: boolean;
  /**
   * Otomatik boyacı atama anahtarı açık mı?
   *
   * Belirtilmezse AÇIK sayılır: kuralın anahtarı ayrıca sormayan çağıranları
   * (ve saf testler) varsayılan "kapalı" yüzünden sessizce bayrak dalına
   * düşerdi — yani anahtarı hiç sormamak, onu kapatmakla aynı şey olurdu.
   */
  autoAssignEnabled?: boolean;
}

/**
 * Süpürmenin TEK kuralı, saf hâlde — veritabanına dokunmaz, böylece sınanabilir.
 *
 * Sıra önemlidir:
 *  1. Süre dolmadıysa hiçbir şey olmaz.
 *  2. Baz baskı yola çıkmış ya da ulaşmışsa iş TAŞINMAZ: kutu o boyacıdadır,
 *     işi başkasına vermek fiziksel parçayı öksüz bırakırdı. Bayrak yeter.
 *  3. Atama elle yapıldıysa yine taşınmaz (bkz. dosya başlığı).
 *  4. Otomatik atama anahtarı kapalıysa da taşınmaz: koparma yerleştirmenin ilk
 *     yarısıdır ve yalnız o yarıyı yapmak siparişi sahipsiz bırakırdı.
 *  5. Kalan hâl: otomatik atanmış, yanıtsız, henüz yola çıkmamış iş → devret.
 */
export function planPainterAcceptSla(
  input: PainterSlaInput,
  slaHours: number = PAINTER_ACCEPT_SLA_HOURS
): PainterSlaAction[] {
  if (input.ageHours < slaHours) return [];
  const autoAssignEnabled = input.autoAssignEnabled !== false;
  if (input.autoAssigned && !input.parcelOnTheWay && autoAssignEnabled) {
    return ["reassign"];
  }
  // Bayraklı sipariş yeniden bayraklanmaz: not zaten orada, admin bir kez
  // haber aldı.
  if (input.alreadyFlagged) return [];
  return ["flag"];
}

/**
 * Yerleştirmenin yapılmama sebebinin admin'e Türkçe karşılığı.
 *
 * `PainterAssignSkip` üzerine tiplenmiştir: yerleştirme yeni bir sebep
 * eklediğinde karşılığı unutulursa DERLEME hatası verir — admin'in e-postasına
 * düşen bir "undefined" değil.
 */
const SKIP_REASONS_TR: Record<PainterAssignSkip, string> = {
  paints_in_house: "üretici boyamayı kendi yapıyor",
  not_needed: "siparişte boyama yok",
  no_candidate: "uygun boyacı kalmadı",
  refunded: "sipariş iade edilmiş",
  already_assigned: "sipariş bu sırada başka bir boyacıya atandı",
  flag_off: "otomatik boyacı atama anahtarı kapalı",
};

/**
 * Admin'e "BUNDAN SONRA NE OLACAK" cümlesi — SEBEBE göre.
 *
 * Ölçülen kusur: sebep ne olursa olsun "sipariş sayfasından elle boyacı atayın"
 * yazılıyordu. Üreticisi boyamayı kendi yapan siparişte o atama HİÇ yapılmamalı
 * (painterAssignRowGate sonsuza dek `paints_in_house` ile atlar): admin
 * yapılmaması gereken bir işe çağrılıyor, gerçekten atama bekleyen kayıtlar da
 * aynı cümlenin gürültüsünde eşitleniyordu.
 *
 * `PainterAssignSkip` üzerine tiplenmiştir: yeni bir atlama sebebi eklendiğinde
 * karşılığını yazmamak DERLEME hatasıdır.
 */
const ADMIN_NEXT_STEP_TR: Record<PainterAssignSkip, string> = {
  paints_in_house:
    "Boyamayı üretici kendi atölyesinde yapıyor: bu siparişe boyacı ATANMAYACAK, elle atama yapmayın — üretici boyayıp kargolayacak.",
  not_needed:
    "Siparişte devredilecek bir boyama adımı görünmüyor (boyama kalemi yok ya da baskı QC onayından geçmedi): atama yapmadan önce siparişi inceleyin.",
  no_candidate:
    "Sipariş boyacı bekliyor, sipariş sayfasından elle boyacı atayın.",
  refunded:
    "Sipariş iade edilmiş: boyacı atanmayacak, bu sipariş için işlem gerekmiyor.",
  already_assigned:
    "Sipariş bu sırada başka bir boyacıya atandı: işlem gerekmiyor, güncel boyacıyı sipariş sayfasında görebilirsiniz.",
  flag_off:
    "Sipariş boyacı bekliyor: sipariş sayfasından elle atayabilirsiniz (otomatik atama anahtarı açılırsa sıradaki boyacıya kendiliğinden de yerleşir).",
};

/** Atlama kodu YOKSA (üst sınır, beklenmeyen arıza) iş gerçekten admin'dedir. */
function adminNextStepTr(skip: PainterAssignSkip | null): string {
  return skip
    ? ADMIN_NEXT_STEP_TR[skip]
    : "Sipariş boyacı bekliyor, sipariş sayfasından elle boyacı atayın.";
}

/**
 * BOYACIYA GİDEN CÜMLE: cevapsız kalan işin gerçekten ne olduğu.
 *
 * Ölçülen kusur: bildirim koparmanın hemen ardından, yerleştirme DENENMEDEN
 * gönderiliyordu ve her hâlde "başka bir boyacıya yönlendiriliyor" diyordu.
 * Yerleştirme atlandığında (üretici kendi boyuyor, boyama kalemi yok, uygun
 * boyacı kalmadı, sipariş iade edildi, araya başka bir atama girdi) ya da ret
 * üst sınırı dolduğunda iş admin kuyruğuna düşer veya hiçbir yere gitmez:
 * partnere kendi işi hakkında doğru OLMAYAN bir şey söylenmiş olurdu.
 *
 * Kural ret rotasındaki ikizinin (decline/route.ts · painterDeclineNotice)
 * aynısı: cümle işin BUNDAN SONRA ne olacağını söyler ve sıradaki boyacının
 * kimliğini taşımaz (o ad yalnız üreticiye açılır).
 */
function painterSlaNotice(args: {
  orderNumber: string;
  placed: boolean;
  skip: PainterAssignSkip | null;
}): string {
  const { orderNumber, placed, skip } = args;
  const opener =
    `${orderNumber} numaralı sipariş için size atanan boyama işi, ` +
    `${PAINTER_ACCEPT_SLA_HOURS} saat içinde kabul ya da ret yanıtı gelmediği için geri alındı.`;
  // Ceza yoktur (sahibin kararı) ve bu her dalda söylenir: iş elinden gitti,
  // boyacının ilk sorusu budur.
  const tail =
    `\n\nHesabınıza herhangi bir ceza işlenmedi. Yoğunluk nedeniyle iş alamıyorsanız ` +
    `panelinizdeki "İş alıyorum" anahtarını kapatabilirsiniz.`;
  if (placed) {
    return `${opener} İş başka bir boyacıya yönlendirildi; sizden bir işlem beklenmiyor.${tail}`;
  }
  if (skip === "paints_in_house") {
    return (
      `${opener} Bu siparişin boyamasını üretici kendi atölyesinde yapacak: siparişe yeni bir ` +
      `boyacı ATANMAYACAK ve yönetici de atama yapmayacak. Sizden bir işlem beklenmiyor.${tail}`
    );
  }
  if (skip === "already_assigned") {
    return `${opener} Sipariş bu sırada başka bir boyacıya atanmış; sizden bir işlem beklenmiyor.${tail}`;
  }
  if (skip === "refunded") {
    return (
      `${opener} Sipariş bu sırada müşteriye iade edilmiş: başka bir boyacıya yönlendirilmeyecek ` +
      `ve sizden bir işlem beklenmiyor.${tail}`
    );
  }
  if (skip === "not_needed") {
    return (
      `${opener} Sistemde bu sipariş için devredilecek bir boyama adımı görünmüyor; siparişin ` +
      `nasıl devam edeceğine yönetici karar verecek. Sizden bir işlem beklenmiyor.${tail}`
    );
  }
  // Kalan hâller (uygun boyacı kalmadı, anahtar kapalı, ret üst sınırı, arıza)
  // işi GERÇEKTEN admin kuyruğuna koyar: orada "yönetici yönlendirecek" doğrudur.
  return `${opener} İşi yeni bir boyacıya yönetici yönlendirecek; sizden bir işlem beklenmiyor.${tail}`;
}

/**
 * ÜRETİCİYE giden cümle — ret rotasındaki ikizinin (decline/route.ts ·
 * manufacturerDeclineNotice) kuralıyla aynı: cümle üreticinin BUNDAN SONRA NE
 * YAPACAĞINI söyler.
 *
 * Ölçülen kusur: tek bir sabit cümle vardı ve kendi boyayan üreticiye "baz
 * baskıyı HENÜZ göndermeyin, yeni boyacı atandığında adresiyle bilgilendirileceksiniz"
 * diyordu. O siparişe boyacı hiç atanmayacağı için bekleme hiç bitmezdi: baskı
 * elinde hazır dururken sipariş donardı.
 */
function manufacturerSlaNotice(
  orderNumber: string,
  skip: PainterAssignSkip | null
): string {
  const opener =
    `${orderNumber} numaralı siparişte atanan boyacı ${PAINTER_ACCEPT_SLA_HOURS} saat içinde ` +
    `yanıt vermedi ve iş geri alındı.`;
  const tail = "\n\nHakedişiniz bu değişiklikten etkilenmedi.";
  if (skip === "paints_in_house") {
    return (
      `${opener} Bu siparişin boyamasını kendi atölyenizde yaptığınız için siparişe yeni bir ` +
      `boyacı ATANMAYACAK; yönetici ataması beklemeyin. Baskı sizde: boyamayı tamamlayıp ` +
      `siparişi panelinizden kargolayabilirsiniz.${tail}`
    );
  }
  if (skip === "already_assigned") {
    return (
      `${opener} Sipariş bu sırada başka bir boyacıya atanmış görünüyor; güncel boyacıyı ve ` +
      `teslimat adresini sipariş sayfanızdan görebilirsiniz.${tail}`
    );
  }
  if (skip === "refunded") {
    return (
      `${opener} Sipariş bu sırada müşteriye iade edildiği için başka bir boyacıya ` +
      `gönderilmeyecek; bu sipariş için yapmanız gereken bir işlem yok.${tail}`
    );
  }
  if (skip === "not_needed") {
    return (
      `${opener} Sistemde bu sipariş için ayrı bir boyama adımı görünmediğinden yeni bir boyacı ` +
      `atanmadı. Baskıyı elinizde tutun; durum yöneticiye bildirildi, siparişin nasıl devam ` +
      `edeceğini yönetici size iletecek.${tail}`
    );
  }
  // Kalan hâller (uygun boyacı kalmadı, anahtar kapalı, ret üst sınırı, arıza)
  // siparişi gerçekten admin kuyruğuna koyar ve yerleştirmeyi bir insan yapar:
  // orada "baskıyı göndermeyin, bilgilendirileceksiniz" DOĞRUDUR.
  return (
    `${opener} Sipariş şu an boyacı bekliyor: baz baskıyı HENÜZ göndermeyin, yeni boyacı ` +
    `atandığında adresiyle birlikte bilgilendirileceksiniz.${tail}`
  );
}

interface StaleJob {
  orderId: string;
  orderNumber: string;
  userId: string | null;
  painterId: string;
  painterName: string | null;
  manufacturerId: string | null;
  assignedAt: Date;
  parcelOnTheWay: boolean;
  adminNotes: string | null;
}

/** Admin'in bakması gereken bir sipariş: not + toplu e-posta satırı. */
interface AdminQueueItem {
  orderNumber: string;
  reason: string;
  /**
   * Bu siparişte gerçekten bir boyacı ATAMASI bekleniyor mu?
   *
   * Toplu e-postanın konusu ve giriş cümlesi buna bakar: "atama için yönetici
   * kararı bekliyor" diyen bir başlık, atanmayacak siparişler için gelen
   * kutusunda YANLIŞ bir iş listesi kurardı — satırın kendisi doğruyu söylerken.
   * Ayrım tek kaynaktan gelir (painter-auto-assign.ts · painterManualNextStep),
   * yani flagPainterManualAssignment'ın konu satırındakiyle aynıdır.
   */
  assignmentExpected: boolean;
}

function hoursSince(when: Date, now: number): number {
  return (now - when.getTime()) / 3_600_000;
}

/**
 * Notu EKLER, üzerine yazmaz: araya giren [SLA]/[ATAMA] bayrakları korunur.
 *
 * TARİH DAMGASI, ikizindeki (painter-auto-assign.ts · flagPainterManualAssignment)
 * gibi aynı yardımcıdan gelir. Ölçülen kusur: bu süpürmenin notları tarihsizdi,
 * aynı siparişteki [BOYACI] notları tarihliydi; iki dakika sonra iş gerçekten
 * devredilince tarihsiz not yerinde kaldı ve admin hangisinin güncel olduğunu
 * okuyamadı.
 */
async function appendAdminNote(orderId: string, note: string): Promise<void> {
  const line = formatAdminNoteLine(note);
  await db
    .update(orders)
    .set({
      adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                      THEN ${line} ELSE ${orders.adminNotes} || E'\n' || ${line} END`,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));
}

/** Süresi dolmuş, hâlâ 'assigned' duran boyacı işleri (iade edilmişler hariç). */
async function staleJobs(cutoff: Date): Promise<StaleJob[]> {
  const rows = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      userId: orders.userId,
      painterId: orders.painterId,
      painterName: painters.companyName,
      manufacturerId: orders.manufacturerId,
      assignedAt: orders.assignedToPainterAt,
      receivedAt: orders.receivedByPainterAt,
      handoffTracking: orders.painterHandoffTrackingNumber,
      adminNotes: orders.adminNotes,
    })
    .from(orders)
    .leftJoin(painters, eq(painters.id, orders.painterId))
    .where(
      and(
        eq(orders.painterStatus, "assigned"),
        isNotNull(orders.painterId),
        isNotNull(orders.assignedToPainterAt),
        lt(orders.assignedToPainterAt, cutoff),
        // İade edilmiş sipariş süpürmenin DIŞINDA: kımıldamaz, kimse
        // cezalandırılmaz, kimseye yeniden verilmez.
        notRefundedGuard()
      )
    );

  return rows
    .filter((r): r is typeof r & { painterId: string; assignedAt: Date } =>
      !!r.painterId && !!r.assignedAt
    )
    .map((r) => ({
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      userId: r.userId,
      painterId: r.painterId,
      painterName: r.painterName,
      manufacturerId: r.manufacturerId,
      assignedAt: r.assignedAt,
      // Kutu yola çıktıysa (takip numarası girildi) ya da ulaştıysa iş taşınmaz.
      parcelOnTheWay: !!r.receivedAt || !!r.handoffTracking,
      adminNotes: r.adminNotes,
    }));
}

/**
 * Hangi işler OTOMATİK atandı? Okuma BİR KAPIYI besliyor (yalnız otomatik
 * atamalar taşınır), o yüzden okunamadığında KAPALI tarafa düşer: `null` döner
 * ve çağıran hepsini elle atanmış sayar — hiçbir iş kendiliğinden taşınmaz.
 */
async function autoAssignedByOrder(
  jobs: StaleJob[]
): Promise<Map<string, boolean> | null> {
  if (jobs.length === 0) return new Map();
  try {
    const rows = await db
      .select({
        orderId: painterActions.orderId,
        painterId: painterActions.painterId,
        action: painterActions.action,
        createdAt: painterActions.createdAt,
      })
      .from(painterActions)
      .where(
        and(
          inArray(
            painterActions.orderId,
            jobs.map((j) => j.orderId)
          ),
          inArray(painterActions.action, [
            PAINTER_AUTO_ASSIGNED_ACTION,
            PAINTER_ADMIN_ASSIGN_ACTION,
          ])
        )
      )
      .orderBy(desc(painterActions.createdAt));

    // Sipariş+boyacı başına EN YENİ atama satırı: aynı boyacı daha önce başka
    // bir yolla atanmış olabilir, bizi ilgilendiren AYAKTAKİ atamadır.
    const newest = new Map<string, { action: string; createdAt: Date }>();
    for (const row of rows) {
      const key = `${row.orderId}:${row.painterId}`;
      if (!newest.has(key)) newest.set(key, row);
    }

    const out = new Map<string, boolean>();
    for (const job of jobs) {
      const row = newest.get(`${job.orderId}:${job.painterId}`);
      const inWindow =
        !!row &&
        row.createdAt.getTime() >= job.assignedAt.getTime() - ACTION_WINDOW_SLACK_MS;
      out.set(job.orderId, inWindow && row!.action === PAINTER_AUTO_ASSIGNED_ACTION);
    }
    return out;
  } catch (err) {
    console.error("[boyacı-sla] boyacı eylem günlüğü okunamadı", err);
    return null;
  }
}

type DetachOutcome =
  | { code: "detached"; declinedCount: number; hours: number }
  | { code: "skipped"; reason: string };

/**
 * İşi boyacıdan KOPARIR — tek işlem, tek tutamak.
 *
 * Durum geri sarması (painting → quality_check), kara liste kaydı ve onu
 * açıklayan eylem satırı aynı işlemin içindedir: birini yazıp öbürünü
 * yazmamak, siparişin neden boyacısız kaldığını okunamaz hâle getirirdi.
 * Ceza YOKTUR — ne `applyStrike` ne de puana giren bir satır.
 */
async function detachStalePainter(job: StaleJob, cutoff: Date): Promise<DetachOutcome> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        painterId: orders.painterId,
        painterStatus: orders.painterStatus,
        assignedAt: orders.assignedToPainterAt,
        receivedAt: orders.receivedByPainterAt,
        handoffTracking: orders.painterHandoffTrackingNumber,
        declinedPainterIds: orders.declinedPainterIds,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(eq(orders.id, job.orderId))
      .for("update");

    if (!existing) return { code: "skipped" as const, reason: "sipariş bulunamadı" };
    // Kilit altında YENİDEN sorulur: okuma ile yazma arasında boyacı kabul
    // etmiş, admin işi almış ya da sipariş iade edilmiş olabilir.
    if (existing.painterStatus !== "assigned" || existing.painterId !== job.painterId) {
      return { code: "skipped" as const, reason: "iş bu sırada yanıtlandı ya da devredildi" };
    }
    if (isRefunded(existing)) {
      return { code: "skipped" as const, reason: "sipariş iade edilmiş" };
    }
    if (existing.receivedAt || existing.handoffTracking) {
      return { code: "skipped" as const, reason: "baz baskı boyacıya ulaştı/yola çıktı" };
    }
    if (!existing.assignedAt || existing.assignedAt >= cutoff) {
      return { code: "skipped" as const, reason: "iş bu sırada yeniden atandı" };
    }

    const hours = Math.floor(hoursSince(existing.assignedAt, Date.now()));
    const declined = Array.from(
      new Set([...(existing.declinedPainterIds ?? []), job.painterId])
    );

    const [updated] = await tx
      .update(orders)
      .set({
        painterId: null,
        painterStatus: "unassigned",
        assignedToPainterAt: null,
        sentToPainterAt: null,
        painterHandoffCarrier: null,
        painterHandoffTrackingNumber: null,
        // Yanıt vermeyen boyacı siparişin kara listesine yazılır: iş ona bir
        // daha verilmez ve bu, ret üst sınırına (PAINTER_MAX_DECLINES) SAYILIR
        // (sahibin kararı).
        declinedPainterIds: declined,
        // Üreticinin QC sonrası hâli: boyacı bekleyen siparişin durduğu yer.
        // Ret yolunun geri sardığı durumun aynısı.
        status: "quality_check",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, job.orderId),
          eq(orders.painterId, job.painterId),
          eq(orders.painterStatus, "assigned"),
          notRefundedGuard()
        )
      )
      .returning({ id: orders.id });
    if (!updated) {
      return { code: "skipped" as const, reason: "sipariş bu sırada değişti" };
    }

    // Koparmayı AÇIKLAYAN kayıt, koparmayla aynı işlemde. Ceza değil: boyacı
    // sıralamasında puanlanan bir eylem adı değildir ve strikeCount artmaz.
    await tx.insert(painterActions).values({
      orderId: job.orderId,
      painterId: job.painterId,
      action: PAINTER_SLA_TIMEOUT_ACTION,
      notes:
        `${hours} saat içinde kabul/ret yanıtı gelmedi; iş otomatik olarak geri alındı. ` +
        `Ceza uygulanmadı.`,
    });

    return { code: "detached" as const, declinedCount: declined.length, hours };
  });
}

async function processJob(job: Job) {
  const now = Date.now();
  const cutoff = new Date(now - PAINTER_ACCEPT_SLA_HOURS * 3_600_000);
  const jobs = await staleJobs(cutoff);
  if (jobs.length === 0) {
    job.log("yanıtsız boyacı ataması yok");
    return;
  }

  const autoMap = await autoAssignedByOrder(jobs);
  const actionLogUnreadable = autoMap === null;

  // ANAHTAR HERHANGİ BİR KOPARMADAN ÖNCE, süpürme başına TEK okumayla sorulur
  // (bkz. dosya başlığı). Sipariş başına sormak, uzun bir süpürmenin ortasında
  // anahtarın değişmesiyle aynı taramada bazı işlerin koparılıp bazılarının
  // koparılmaması demek olurdu. Okuma hata verirse isFlagEnabled derlenmiş
  // varsayılana (AÇIK) düşer: bayrak tablosundaki bir tökezleme yanıtsız işleri
  // sonsuza kadar dondurmamalı.
  const autoAssignEnabled = await isFlagEnabled("auto_assign_painter");

  const reassigned: string[] = [];
  const adminQueue: AdminQueueItem[] = [];
  const flagged: string[] = [];
  const failures: string[] = [];

  for (const stale of jobs) {
    const hours = Math.floor(hoursSince(stale.assignedAt, now));
    // Günlük okunamadıysa KAPALI taraf: elle atanmış say, kendiliğinden taşıma.
    const autoAssigned = autoMap?.get(stale.orderId) ?? false;
    const actions = planPainterAcceptSla({
      ageHours: hours,
      autoAssigned,
      parcelOnTheWay: stale.parcelOnTheWay,
      alreadyFlagged: (stale.adminNotes ?? "").includes(FLAG),
      autoAssignEnabled,
    });
    if (actions.length === 0) continue;

    try {
      if (actions.includes("flag")) {
        // Zincir TÜKETİCİDİR: bayrak dalına düşmüş bir iş için ilk üç soru da
        // "hayır" ise geriye tek engel kalır, o da anahtardır. Sebebi yanlış
        // yazmak, admin'i olmayan bir arızaya bakmaya göndermek olurdu.
        const why = stale.parcelOnTheWay
          ? "baz baskı boyacıya ulaştığı ya da ona doğru yola çıktığı için iş otomatik devredilmedi"
          : actionLogUnreadable
            ? "boyacı eylem günlüğü okunamadığı için atamanın otomatik olup olmadığı doğrulanamadı; iş otomatik devredilmedi"
            : !autoAssigned
              ? "iş elle atandığı için otomatik devredilmedi"
              : "otomatik boyacı atama anahtarı kapalı olduğu için iş boyacıdan alınmadı; devri yönetici yapmalı";
        await appendAdminNote(
          stale.orderId,
          `${FLAG} ${stale.painterName ?? "Boyacı"} ${hours} saattir yanıt vermedi ` +
            `(${PAINTER_ACCEPT_SLA_HOURS} saatlik süre aşıldı); ${why}.`
        );
        flagged.push(stale.orderNumber);
        // İş boyacıda DURUYOR (koparma yapılmadı): burada yönetici gerçekten bir
        // karar bekliyor, yani başlıktaki "atama bekliyor" bu satır için doğrudur.
        adminQueue.push({
          orderNumber: stale.orderNumber,
          reason: why,
          assignmentExpected: true,
        });
        continue;
      }

      // ── Devir: önce KOPAR, sonra yerleştir ──────────────────────────────
      const outcome = await detachStalePainter(stale, cutoff);
      if (outcome.code === "skipped") {
        job.log(`${stale.orderNumber}: ${outcome.reason}`);
        continue;
      }

      // Buradan sonrası "KOPARMA YAZILDI" dünyası: iş boyacının listesinden
      // düştü. Aşağıdaki adımlar en iyi çabadır, hiçbiri koparmayı geri almaz.
      //
      // BOYACININ KENDİ BİLDİRİMİ AŞAĞIDA, yerleştirmenin sonucu belli olunca
      // gönderilir: burada gönderilen cümle işin nereye gittiğini bilemezdi.
      // Panelin işi listeden düşürmesi ise sonucu beklemez — olay hemen yayılır.
      await emitOrderChanged({
        orderId: stale.orderId,
        orderNumber: stale.orderNumber,
        userId: stale.userId,
        manufacturerId: stale.manufacturerId,
        // Eski boyacının paneli yalnız kendi konusunu dinler: iş oradan
        // düşsün diye olay onun kimliğiyle yayılır.
        painterId: stale.painterId,
        status: "quality_check",
        painterStatus: "unassigned",
      }).catch((e) => console.error("[boyacı-sla] emitOrderChanged başarısız", e));

      // ÜRETİCİNİN BASKI HAKEDİŞİ GERİ ÇEVRİLMEZ (bkz. dosya başlığı).

      let placedPainterId: string | null = null;
      let adminReason: string | null = null;
      // Sebebin KODU da tutulur: admin'e ve üreticiye ne söyleneceği koda göre
      // dallanır. Türkçe cümleyi parçalayarak karar vermek, çeviriyi kurala
      // dönüştürmek olurdu.
      let skipCode: PainterAssignSkip | null = null;

      // ÜST SINIR ORTAK KAYNAKTAN OKUNUR (config/flags.ts). Sayaç
      // `declinedPainterIds` uzunluğudur ve yanıtsız boyacı az önce o listeye
      // yazıldı: bu yol da ret üst sınırına (flags.ts · PAINTER_MAX_DECLINES)
      // SAYILIR (sahibin kararı). Sayıyı
      // burada ikinci kez yazmak, ret yolu ile bu yolun farklı sınırlarda
      // çalışmasına açık kapı bırakırdı.
      if (painterDeclinesExhausted(outcome.declinedCount)) {
        adminReason = `${outcome.declinedCount} boyacı işi almadı (en fazla ${PAINTER_MAX_REPLACEMENTS} kez yeniden yerleştirilir)`;
        // Ret yolundaki ikizinin aynısı: üst sınır burada da kapıyı aday
        // aranmadan kapatıyor. Süpürmenin öbür dalı kaydı yerleştiriciden
        // alıyor (`sla_reassign` damgalı satır orada yazılıyor); bu dal
        // yerleştiriciye hiç girmediği için kaydı kendisi yazmak zorunda,
        // yoksa cevapsızlıkla admin kuyruğuna düşen işin tetiği kayıtta hiç
        // görünmezdi.
        await recordPainterDeclineCapReached({
          orderId: stale.orderId,
          trigger: "sla_reassign",
        });
      } else {
        // `notifyAdminOnFailure: false`: admin'e haber vermek bu süpürmenin
        // işidir. Yerleştirme kendi başına da not + e-posta yazabiliyor; ikisi
        // birden koşarsa aynı sipariş için iki e-posta giderdi. Süpürme
        // hepsini TEK e-postada toplar (aşağıda).
        //
        // Yerleştirme ASLA fırlatmaz (kendi sözleşmesi); yine de siparişin
        // kendi try/catch'i içindedir, çünkü koparma çoktan commit oldu ve
        // buradan çıkan bir hata süpürmenin geri kalanını düşürmemeli.
        const result = await assignPainterAutomatically(stale.orderId, {
          trigger: "sla_reassign",
          notifyAdminOnFailure: false,
        });
        if (result.assigned && result.painterId) {
          placedPainterId = result.painterId;
        } else {
          skipCode = result.skipped ?? null;
          adminReason = skipCode
            ? SKIP_REASONS_TR[skipCode]
            : "otomatik yerleştirme yapılamadı";
        }
      }

      if (placedPainterId) {
        reassigned.push(stale.orderNumber);
      } else {
        const note =
          `${FLAG} ${stale.painterName ?? "Boyacı"} ${hours} saattir yanıt vermediği için iş geri alındı; ` +
          `${adminReason}. ${adminNextStepTr(skipCode)}`;
        await appendAdminNote(stale.orderId, note).catch((e) =>
          console.error("[boyacı-sla] admin notu yazılamadı", e)
        );
        adminQueue.push({
          orderNumber: stale.orderNumber,
          // Toplu e-postadaki satır da yapılacak işi taşır: aynı listede "elle
          // atayın" ile "atama yapmayın" yan yana durabilmeli.
          reason: `${adminReason ?? "otomatik yerleştirme yapılamadı"} — ${adminNextStepTr(skipCode)}`,
          // Kod YOKSA (ret üst sınırı, beklenmeyen arıza) iş gerçekten admin'i
          // bekler: yardımcının varsayılanı da bunu söyler.
          assignmentExpected: painterManualNextStep(skipCode ?? undefined).expected,
        });
      }

      // BOYACIYA HABER: İŞİN GERÇEKTEN NEREYE GİTTİĞİ.
      //
      // Koparma çoktan commit oldu; bu bildirim en iyi çabadır ve patlarsa
      // süpürme devam eder. Cümle sonucun KODUNA bakar (painterSlaNotice):
      // yerleştirme atlandıysa ya da üst sınır dolduysa "başka bir boyacıya
      // yönlendiriliyor" demek, partnere kendi işi hakkında yalan olurdu.
      await notifyPainter({
        painterId: stale.painterId,
        type: "system_announcement",
        subject: "Yanıtsız boyama işi geri alındı",
        body: painterSlaNotice({
          orderNumber: stale.orderNumber,
          placed: !!placedPainterId,
          skip: skipCode,
        }),
        orderId: stale.orderId,
      }).catch((e) => console.error("[boyacı-sla] notifyPainter başarısız", e));

      // YENİ BOYACI BULUNDUYSA ÜRETİCİYE HABERİ YERLEŞTİRME VERİR: o bildirim
      // boyacının adresini taşır (kimliğin açıldığı tek yer) ve burada ikinci
      // bir mesaj yazmak aynı olayı iki kez anlatmak olurdu. Üreticiyle yalnız
      // YENİ BOYACI YOKKEN konuşulur: baskı onun elinde duruyor ve
      // göndermemesi gerektiğini başka hiçbir yerden öğrenemez.
      if (!placedPainterId && stale.manufacturerId) {
        await notifyManufacturer({
          manufacturerId: stale.manufacturerId,
          type: "system_announcement",
          subject: `Boyacı yanıt vermedi — ${stale.orderNumber}`,
          body: manufacturerSlaNotice(stale.orderNumber, skipCode),
          orderId: stale.orderId,
        }).catch((e) => console.error("[boyacı-sla] notifyManufacturer başarısız", e));
      }
    } catch (err) {
      // Bir siparişin hatası süpürmenin geri kalanına mal olmaz.
      const message = (err as Error).message;
      console.error(`[boyacı-sla] ${stale.orderNumber} işlenemedi: ${message}`);
      failures.push(`${stale.orderNumber}: ${message}`);
    }
  }

  if (adminQueue.length > 0) {
    const adminEmail = process.env.ADMIN_EMAIL || "system@figurunica.com";
    // BAŞLIK DA SATIR KADAR DOĞRU OLMAK ZORUNDA. Ölçülen kusur: konu ve giriş
    // cümlesi yalnız SATIR SAYISINA bakıyor, satırların atlama koduna
    // bakmıyordu — "1 sipariş boyacı ataması için yönetici kararı bekliyor"
    // diyen e-postanın tek satırı "bu siparişe boyacı ATANMAYACAK, elle atama
    // yapmayın" diyordu. Ayrım flagPainterManualAssignment'ın konusundakiyle
    // aynı kaynaktan gelir (painterManualNextStep · expected).
    const expected = adminQueue.filter((o) => o.assignmentExpected).length;
    const allExpected = expected === adminQueue.length;
    const noneExpected = expected === 0;
    const customSubject = allExpected
      ? `${adminQueue.length} sipariş boyacı ataması için yönetici kararı bekliyor`
      : noneExpected
        ? `${adminQueue.length} sipariş boyacısız kaldı — atama beklenmiyor`
        : `${adminQueue.length} sipariş boyacısız kaldı — ${expected} tanesi atama bekliyor`;
    const opener =
      `Aşağıdaki siparişlerde atanan boyacı ${PAINTER_ACCEPT_SLA_HOURS} saat içinde kabul/ret ` +
      (allExpected
        ? `yanıtı vermedi ve iş otomatik olarak yeni bir boyacıya yerleştirilemedi:`
        : noneExpected
          ? `yanıtı vermedi; bu siparişlere yeni bir boyacı ATANMAYACAK (sebebi her satırda yazıyor):`
          : `yanıtı vermedi. Bir kısmı yeni bir boyacıya yerleştirilemedi, bir kısmına ise boyacı ATANMAYACAK:`);
    await getEmailQueue()
      .add("admin-painter-sla", {
        type: "admin_custom",
        to: adminEmail,
        orderNumber: adminQueue[0].orderNumber,
        customerName: "Admin",
        customSubject,
        customBody:
          `${opener}\n\n` +
          adminQueue.map((o) => `- ${o.orderNumber} — ${o.reason}`).join("\n") +
          // Toplu çağrı SATIRA bırakılır: her sipariş için yapılacak iş aynı
          // değil ("elle atayın" ile "boyacı atanmayacak" bir arada gelebilir).
          (noneExpected
            ? `\n\nBu listedeki siparişler için atama yapmanız gerekmiyor; her satır kendi adımını söylüyor.`
            : `\n\nHer satır kendi adımını söylüyor; atama gereken siparişlerde sipariş sayfasındaki "Boyacı ata" bloğunu kullanın.`),
        locale: "tr",
      })
      .catch((e) => console.error("[boyacı-sla] admin e-postası kuyruğa alınamadı", e));
  }

  job.log(
    `${jobs.length} yanıtsız atama tarandı: ${reassigned.length} devredildi, ` +
      `${adminQueue.length} admin kuyruğuna düştü (${flagged.length} yalnız bayraklandı), ` +
      `${failures.length} hata`
  );

  // Hata, HER sipariş işlendikten sonra bildirilir: süpürme yarıda kesilmez.
  if (failures.length > 0) {
    throw new Error(
      `painter-accept-sla: ${failures.length} sipariş işlenemedi — ${failures.join(" | ")}`
    );
  }
}

export function startPainterAcceptSlaWorker(): Worker {
  const worker = new Worker("painter-accept-sla", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (j) => {
    console.info(`painter-accept-sla completed: ${j.id}`);
  });
  worker.on("failed", (j, err) => {
    console.error(`painter-accept-sla failed: ${j?.id}`, err);
  });

  return worker;
}
