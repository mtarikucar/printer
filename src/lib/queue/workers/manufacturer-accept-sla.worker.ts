/**
 * Üretici kabul SLA'sı — yanıtsız kalan OTOMATİK atamaları yeniden yerleştirir.
 *
 * Atama e-postası üreticiye "24 saat içinde kabul ya da reddedin" diyor; bugüne
 * kadar bu süreyi ölçen tek şey `assignment-sla` süpürmesiydi ve o yalnız
 * BAYRAK koyuyordu. Yanıtlanmayan iş, üreticinin tezgâhında kapasite tutarak
 * süresiz bekliyordu; devri bir insan fark edene kadar hiçbir şey olmuyordu.
 *
 * Sahibin kararı (sla-no-answer = C) boyacı ikizinde çoktan uygulanıyor
 * (painter-accept-sla.worker.ts, Faz 4); bu dosya AYNI kuralı üretici tarafına
 * taşır ve o dosyanın şeklini bilerek birebir izler:
 *
 *   OTOMATİK atanmış iş + 24 saat sessizlik  →  iş üreticiden ALINIR, sıradaki
 *   atölyeye otomatik verilir. CEZA YOKTUR (strikeCount artmaz, güvenilirlik
 *   puanına giren bir eylem satırı yazılmaz) ama bu, siparişin yeniden
 *   yerleştirme üst sınırına (flags.ts · MANUFACTURER_MAX_DECLINES) SAYILIR.
 *
 * Yalnız OTOMATİK atamalar böyle taşınır. Admin'in ELLE seçtiği (sipariş
 * sayfası, toplu atama, atama taraması) atölye bir insan kararıdır; onu
 * sistemin kendiliğinden bozması, seçimi yapan kişiye haber vermeden onun
 * yerine karar vermek olurdu. O işler yalnız bayraklanır, kararı admin verir.
 *
 * SATICININ KENDİ ÜRÜNÜ HİÇBİR KOŞULDA TAŞINMAZ. Pazaryeri mülkiyet kuralı
 * (E-C1) tek cümle: satıcının kataloğundan çıkan sipariş yalnız o atölyede
 * basılır. Sessiz kalması onu rakip bir atölyeye verme sebebi DEĞİLDİR —
 * bayraklanır, kararı admin verir. Kural burada yeniden yazılmaz, siparişin
 * `sellerManufacturerId` kolonundan okunur.
 *
 * ANAHTAR, KOPARMADAN ÖNCE SORULUR (boyacı ikizinde ölçülen kusur). Devir tek
 * bir kararın iki yarısıdır: işi üreticiden koparmak ve sıradakine
 * yerleştirmek. Önce koparıp sonra yerleştirmeyi denemek, yerleştirme kapalı
 * bir anahtara çarptığında siparişi hem üreticisiz hem yerleştirilmemiş
 * bırakırdı — yani anahtarı kapatmak, işleri sahipsiz bırakan bir şeye
 * dönüşürdü. Anahtar kapalıyken iş yerinde DURUR ve yalnız bayraklanır.
 *
 * Anahtar SİPARİŞ TÜRÜ BAŞINADIR (autoAssignFlagFor) ve süpürme başına TEK
 * okumayla alınır (`getAllFlags`): sipariş başına sormak, uzun bir süpürmenin
 * ortasında anahtar değişirse aynı taramada bazı işlerin koparılıp bazılarının
 * koparılmaması demek olurdu. Atölye seansı siparişinin anahtarı YOKTUR ve
 * hiçbir zaman otomatik atanmaz; o da yalnız bayraklanır.
 *
 * İADE: iade edilmiş sipariş bu süpürmeye HİÇ girmez (okuma `notRefundedGuard`
 * ile süzülür, işlem içinde yeniden sorulur). İade edilmiş sipariş kımıldamaz
 * ve üstünde hiçbir partner cezalandırılmaz.
 *
 * YOLA ÇIKMIŞ İŞ TAŞINMAZ: kargoya verilmiş ya da boyacıya devredilmiş bir
 * siparişi başka bir atölyeye yazmak, fiziksel parçayı öksüz bırakırdı. Ölçü
 * ortak ve saftır (flags.ts · manufacturerJobInTransit).
 *
 * MÜŞTERİYE AYRI BİR HABER GİTMEZ, çünkü müşteriye gösterilen hiçbir şey
 * yanlış hâle gelmiyor: siparişin `status` kolonu (approved / paid) devirde
 * DEĞİŞMEZ ve takip ekranı atölyenin kimliğini zaten göstermez. Değişen tek
 * şey siparişin hangi tezgâhta olduğu; canlı yayın (emitOrderChanged) açık
 * ekranları tazeler. Müşteriye "siparişiniz başka bir atölyeye aktarıldı"
 * demek, elinde eylem olmayan birini kendi siparişi hakkında tedirgin etmek
 * olurdu.
 *
 * Dayanıklılık: bir siparişin hatası süpürmenin geri kalanını düşürmez; hatalar
 * toplanır ve sonunda bir kez bildirilir (painter-accept-sla ile aynı kalıp).
 *
 * NOT: bu dosya ve import ettiği HİÇBİR şey "server-only" almaz — worker
 * standalone Node'da koşar, o import zinciri onu crash-loop'a sokar.
 */
import { Worker, Job } from "bullmq";
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { db } from "../../db";
import {
  adminActions,
  manufacturerActions,
  manufacturerAssignmentEvaluations,
  manufacturers,
  orderItems,
  orders,
} from "../../db/schema";
import { getEmailQueue } from "../queues";
import { formatAdminNoteLine, isRefunded } from "../../config/order-status-policy";
import { notRefundedGuard } from "../../services/manufacturer-assign";
import { notifyManufacturer } from "../../services/manufacturer-notifications";
import { emitOrderChanged } from "../../realtime/emit";
import {
  AUTO_ASSIGN_ASSIGNMENT_EXPECTED,
  AUTO_ASSIGN_SKIP_NEXT_STEP_TR,
  AUTO_ASSIGN_SKIP_NOTIFIES_ADMIN,
  AUTO_ASSIGN_SKIP_REASON_TR,
  MANUFACTURER_MAX_REPLACEMENTS,
  MANUFACTURER_SLA_TIMEOUT_ACTION,
  autoAssignFlagFor,
  classifyAutoAssignOrder,
  manufacturerDeclinesExhausted,
  manufacturerJobInTransit,
  type AutoAssignOrderKind,
  type AutoAssignSkip,
} from "../../config/flags";
import { getAllFlags } from "../../services/flags";
import { autoAssignIfEligible } from "../../services/order-confirm";

/** Sözleşmedeki süre: atanan işe 24 saat içinde kabul/ret yanıtı. */
export const MANUFACTURER_ACCEPT_SLA_HOURS = 24;

/**
 * Admin notundaki bayrak; aynı siparişin her saat yeniden bildirilmesini de
 * engeller.
 *
 * Eski bayrak-only süpürmesinin etiketi ("[SLA]") BİLEREK kullanılmıyor: o
 * etiket hâlâ eski notların içinde duruyor ve aynı dizeyi paylaşmak, bu
 * süpürmenin kendi notunu eski bir nota bakıp "zaten bayraklandı" sanmasına yol
 * açardı — yani devri açıklayan cümle hiç yazılmazdı.
 */
const FLAG = "[ÜRETİCİ-SLA]";

/**
 * Eylem satırı ile atama damgası arasındaki saniyelik fark (saat kayması ve
 * işlem gecikmesi) yüzünden pencere biraz geriye açılır: satır atamadan hemen
 * SONRA yazılır, ama iki damga farklı saatlerden gelir.
 */
const ACTION_WINDOW_SLACK_MS = 60_000;

/** Admin'in elle yaptığı atamanın denetim satırındaki adı. */
const ADMIN_ASSIGN_ACTION = "assign_manufacturer";

export type ManufacturerSlaAction = "reassign" | "flag";

export interface ManufacturerSlaInput {
  /** Atamanın üstünden geçen saat. */
  ageHours: number;
  /** Bu atamayı sıralayıcı mı yaptı? (elle atama otomatik bozulmaz) */
  autoAssigned: boolean;
  /** İş fiziksel olarak yola çıktı mı (kargo ya da boyacıya devir)? */
  inTransit: boolean;
  /** Sipariş bir satıcının KENDİ katalog ürünü mü? (asla taşınmaz) */
  sellerOwned: boolean;
  /** Sipariş bu bayrağı zaten taşıyor mu? (aynı işi her saat bildirmeyelim) */
  alreadyFlagged: boolean;
  /**
   * Bu siparişin TÜRÜNE ait otomatik atama anahtarı açık mı?
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
 *  2. Satıcının kendi ürünü TAŞINMAZ: mülkiyet kuralı sessizlikle aşılamaz.
 *  3. İş yola çıkmışsa taşınmaz: parça dışarıda, işi başkasına vermek fiziksel
 *     parçayı öksüz bırakırdı. Bayrak yeter.
 *  4. Atama elle yapıldıysa taşınmaz (bkz. dosya başlığı).
 *  5. Türün otomatik atama anahtarı kapalıysa da taşınmaz: koparma
 *     yerleştirmenin ilk yarısıdır ve yalnız o yarıyı yapmak siparişi sahipsiz
 *     bırakırdı. (Atölye seansı siparişi buraya düşer: anahtarı yoktur.)
 *  6. Kalan hâl: otomatik atanmış, yanıtsız, sahipsiz, yola çıkmamış iş → devret.
 */
export function planManufacturerAcceptSla(
  input: ManufacturerSlaInput,
  slaHours: number = MANUFACTURER_ACCEPT_SLA_HOURS
): ManufacturerSlaAction[] {
  if (input.ageHours < slaHours) return [];
  const autoAssignEnabled = input.autoAssignEnabled !== false;
  if (
    input.autoAssigned &&
    !input.sellerOwned &&
    !input.inTransit &&
    autoAssignEnabled
  ) {
    return ["reassign"];
  }
  // Bayraklı sipariş yeniden bayraklanmaz: not zaten orada, admin bir kez
  // haber aldı.
  if (input.alreadyFlagged) return [];
  return ["flag"];
}

/* ────────────────────────────────────────────────────────────────────────────
 * SEBEBİN TÜRKÇESİ ARTIK BU DOSYADA DEĞİL — config/flags.ts'te.
 *
 * Taşındı, çünkü AYNI cümleyi otomatik atamanın kendisi de kuruyor
 * (services/order-confirm.ts · flagManualAssignment). Bu worker order-confirm'i
 * import ediyor, yani ters yönde bir import DÖNGÜ kurardı: tablolar burada
 * kalsaydı order-confirm kendi kopyasını yazmak zorunda kalır ve iki kopya ilk
 * düzeltmede ayrışırdı — admin aynı sipariş için iki farklı sebep okurdu.
 *
 * Üçü de `Record<AutoAssignSkip, …>`: yerleştirme yeni bir sebep eklediğinde
 * karşılığı unutulursa DERLEME hatası verir, admin'in e-postasına düşen bir
 * "undefined" değil.
 * ────────────────────────────────────────────────────────────────────────── */

/** Atlama kodu YOKSA (üst sınır, beklenmeyen arıza) iş gerçekten admin'dedir. */
function adminNextStepTr(skip: AutoAssignSkip | null): string {
  return skip
    ? AUTO_ASSIGN_SKIP_NEXT_STEP_TR[skip]
    : "Sipariş üretici bekliyor: /admin/orders üzerinden elle üretici atayın.";
}

/**
 * Bu siparişte gerçekten bir ATAMA bekleniyor mu? Cevap kapalı kümeden okunur
 * (config/flags.ts · AUTO_ASSIGN_ASSIGNMENT_EXPECTED): sebep başına yazılmış
 * bir `if` zinciri, yeni üyeleri sessizce varsayılana düşürürdü.
 *
 * Kod yoksa (üst sınır doldu, beklenmeyen arıza) iş admin'dedir: `true`.
 */
function assignmentExpectedFor(skip: AutoAssignSkip | null): boolean {
  return skip ? AUTO_ASSIGN_ASSIGNMENT_EXPECTED[skip] : true;
}

/**
 * ÜRETİCİYE GİDEN CÜMLE: cevapsız kalan işin gerçekten ne olduğu.
 *
 * Boyacı ikizinde ölçülen kusur burada da mümkündü: bildirimi koparmanın hemen
 * ardından, yerleştirme DENENMEDEN göndermek ve her hâlde "başka bir atölyeye
 * yönlendiriliyor" demek. Yerleştirme atlandığında ya da üst sınır dolduğunda
 * iş admin kuyruğuna düşer veya hiçbir yere gitmez: partnere kendi işi hakkında
 * doğru OLMAYAN bir şey söylenmiş olurdu.
 *
 * Cümle sıradaki atölyenin kimliğini TAŞIMAZ: bir atölyenin, işin rakibine
 * gittiğini adıyla öğrenmesi için hiçbir sebep yok.
 */
function manufacturerSlaNotice(args: {
  orderNumber: string;
  placed: boolean;
  skip: AutoAssignSkip | null;
}): string {
  const { orderNumber, placed, skip } = args;
  const opener =
    `${orderNumber} numaralı sipariş için size yapılan atama, ` +
    `${MANUFACTURER_ACCEPT_SLA_HOURS} saat içinde kabul ya da ret yanıtı gelmediği için geri alındı.`;
  // Ceza yoktur (sahibin kararı) ve bu her dalda söylenir: iş elinden gitti,
  // üreticinin ilk sorusu budur.
  const tail =
    `\n\nHesabınıza herhangi bir ceza işlenmedi ve güvenilirlik puanınız bu yüzden düşmedi. ` +
    `Yoğunluk nedeniyle iş alamıyorsanız panelinizdeki "Sipariş alıyorum" anahtarını kapatabilirsiniz.`;
  if (placed) {
    return `${opener} İş başka bir atölyeye yönlendirildi; sizden bir işlem beklenmiyor.${tail}`;
  }
  if (skip === "refunded") {
    return (
      `${opener} Sipariş bu sırada müşteriye iade edilmiş: başka bir atölyeye yönlendirilmeyecek ` +
      `ve sizden bir işlem beklenmiyor.${tail}`
    );
  }
  if (skip === "not_eligible") {
    return (
      `${opener} Sipariş bu sırada başka bir atölyeye atanmış ya da durumu değişmiş; sizden bir ` +
      `işlem beklenmiyor.${tail}`
    );
  }
  // Kalan hâller (uygun atölye kalmadı, anahtar kapalı, üst sınır, arıza ve
  // Faz 5'in iki yeni sebebi — `capacity_full`, `large_format_required`) işi
  // GERÇEKTEN admin kuyruğuna koyar: orada "yönetici yönlendirecek" doğrudur.
  // Bu iki sebep eskiden `not_eligible`e çöktüğü için üstteki dala düşüyor ve
  // atölyeye "iş başka bir atölyeye atanmış" deniyordu — iş hiçbir yere
  // gitmemişti.
  return `${opener} İşi yeni bir atölyeye yönetici yönlendirecek; sizden bir işlem beklenmiyor.${tail}`;
}

/** Yalnız BAYRAKLANAN (koparılmayan) işte üreticiye hiçbir şey söylenmez. */
interface StaleJob {
  orderId: string;
  orderNumber: string;
  userId: string | null;
  manufacturerId: string;
  companyName: string | null;
  assignedAt: Date;
  inTransit: boolean;
  sellerOwned: boolean;
  adminNotes: string | null;
  kind: AutoAssignOrderKind;
}

/** Admin'in bakması gereken bir sipariş: not + toplu e-posta satırı. */
interface AdminQueueItem {
  orderNumber: string;
  reason: string;
  assignmentExpected: boolean;
  /**
   * Yerleştirici bu sipariş için KENDİ [ATAMA] notunu ve e-postasını da yazdı
   * mı? (`no_candidate` dalı bunu yapıyor.) Toplu e-posta bunu söyler, yoksa
   * admin aynı sipariş için gelen ikinci postayı ayrı bir olay sanardı.
   */
  alsoNotifiedSeparately?: boolean;
}

function hoursSince(when: Date, now: number): number {
  return (now - when.getTime()) / 3_600_000;
}

/**
 * Notu EKLER, üzerine yazmaz: araya giren [SLA]/[ATAMA]/[N12] bayrakları
 * korunur. TARİH DAMGASI ortak yardımcıdan gelir (formatAdminNoteLine), böylece
 * aynı siparişteki diğer bayraklarla aynı biçimde okunur.
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

/** Süresi dolmuş, hâlâ 'assigned' duran üretici işleri (iade edilmişler hariç). */
async function staleJobs(cutoff: Date): Promise<StaleJob[]> {
  const rows = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      userId: orders.userId,
      manufacturerId: orders.manufacturerId,
      companyName: manufacturers.companyName,
      assignedAt: orders.assignedToManufacturerAt,
      adminNotes: orders.adminNotes,
      sellerManufacturerId: orders.sellerManufacturerId,
      // Yola çıkmışlık ölçüsünün okuduğu alanlar (flags.ts · manufacturerJobInTransit).
      shippedAt: orders.shippedAt,
      trackingNumber: orders.trackingNumber,
      sentToPainterAt: orders.sentToPainterAt,
      painterHandoffTrackingNumber: orders.painterHandoffTrackingNumber,
      // Sipariş TÜRÜ (anahtarı seçer) bu kolonlardan türetilir.
      orderType: orders.orderType,
      workshopSessionId: orders.workshopSessionId,
      attributionChannel: orders.attributionChannel,
      productId: orders.productId,
      parentReference: orders.parentReference,
    })
    .from(orders)
    .leftJoin(manufacturers, eq(manufacturers.id, orders.manufacturerId))
    .where(
      and(
        eq(orders.manufacturerStatus, "assigned"),
        isNotNull(orders.manufacturerId),
        isNotNull(orders.assignedToManufacturerAt),
        lt(orders.assignedToManufacturerAt, cutoff),
        // İade edilmiş sipariş süpürmenin DIŞINDA: kımıldamaz, kimse
        // cezalandırılmaz, kimseye yeniden verilmez.
        notRefundedGuard()
      )
    );

  const usable = rows.filter(
    (r): r is typeof r & { manufacturerId: string; assignedAt: Date } =>
      !!r.manufacturerId && !!r.assignedAt
  );
  if (usable.length === 0) return [];

  // Sepet alt siparişi ürünlerini SATIRLARINDA taşır (orders→items ilişkisi
  // yok) ve tür kararı bunu bilmek zorunda. Sipariş başına sorgu yerine tek
  // gruplu sorgu — sweep-data.ts'in yaptığının aynısı.
  const itemRows = await db
    .select({ orderId: orderItems.orderId })
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        usable.map((r) => r.orderId)
      )
    )
    .groupBy(orderItems.orderId);
  const withItems = new Set(itemRows.map((r) => r.orderId));

  return usable.map((r) => ({
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    userId: r.userId,
    manufacturerId: r.manufacturerId,
    companyName: r.companyName,
    assignedAt: r.assignedAt,
    inTransit: manufacturerJobInTransit(r),
    sellerOwned: !!r.sellerManufacturerId,
    adminNotes: r.adminNotes,
    // Tür, otomatik atamanın kendi taksonomisinden gelir; ikinci bir
    // sınıflandırma yazılmaz.
    kind: classifyAutoAssignOrder({
      orderType: r.orderType,
      workshopSessionId: r.workshopSessionId,
      attributionChannel: r.attributionChannel,
      productId: r.productId,
      parentReference: r.parentReference,
      hasOrderItems: withItems.has(r.orderId),
    }),
  }));
}

/**
 * Hangi işler OTOMATİK atandı?
 *
 * Boyacı ikizinde bu sorunun tek bir cevabı vardı (boyacı eylem günlüğündeki
 * `auto_assigned` satırı). Üretici tarafında ÖYLE BİR SATIR YOK: atama servisi
 * denetim satırını yalnız `adminEmail` geçildiğinde yazar. Dolayısıyla cevap
 * iki kaydın BİRLİKTE okunmasından çıkar:
 *
 *  - `admin_actions` · `assign_manufacturer`: atamayı bir İNSAN yaptı (sipariş
 *    sayfası, toplu atama, atama taraması — üçü de adminEmail geçiyor).
 *    Varsa cevap kesindir: ELLE. Taşınmaz.
 *  - `manufacturer_assignment_evaluations`: SIRALAMANIN yerleştirdiği bir
 *    kararın telemetri satırı (otomatik atama ve ret sonrası yeniden atama
 *    yazar). İnsan izi yokken bu satır varsa atama OTOMATİKTİR.
 *
 * İkisi de yoksa cevap KAPALI tarafa düşer (elle sayılır): kaydı olmayan bir
 * atamayı otomatik sayıp koparmak, admin'in elle seçtiği atölyeden işi almak
 * olabilirdi. Okuma hata verirse `null` döner ve çağıran hepsini elle sayar —
 * hiçbir iş kendiliğinden taşınmaz.
 *
 * NOT (sahibine): kalıcı ve tek parçalı çözüm, atamanın kendisinin
 * `manufacturer_actions`a bir `auto_assigned` satırı yazmasıdır — boyacı
 * tarafındaki gibi. O satır atıldığı gün bu fonksiyon tek okumaya iner.
 */
async function autoAssignedByOrder(
  jobs: StaleJob[]
): Promise<Map<string, boolean> | null> {
  if (jobs.length === 0) return new Map();
  const orderIds = jobs.map((j) => j.orderId);
  try {
    const [adminRows, evalRows] = await Promise.all([
      db
        .select({
          orderId: adminActions.orderId,
          createdAt: adminActions.createdAt,
        })
        .from(adminActions)
        .where(
          and(
            inArray(adminActions.orderId, orderIds),
            eq(adminActions.action, ADMIN_ASSIGN_ACTION)
          )
        )
        .orderBy(desc(adminActions.createdAt)),
      db
        .select({
          orderId: manufacturerAssignmentEvaluations.orderId,
          createdAt: manufacturerAssignmentEvaluations.createdAt,
        })
        .from(manufacturerAssignmentEvaluations)
        .where(inArray(manufacturerAssignmentEvaluations.orderId, orderIds))
        .orderBy(desc(manufacturerAssignmentEvaluations.createdAt)),
    ]);

    // AYAKTAKİ atamayı anlatan kayıt: atama damgasından (küçük bir saat
    // kaymasına tolerans tanıyarak) SONRA yazılmış olan. Daha eski satırlar bu
    // siparişin ÖNCEKİ atamalarını anlatır ve bugünkü kararı açıklamaz.
    const inWindow = (
      rows: Array<{ orderId: string | null; createdAt: Date }>,
      job: StaleJob
    ): boolean =>
      rows.some(
        (r) =>
          r.orderId === job.orderId &&
          r.createdAt.getTime() >= job.assignedAt.getTime() - ACTION_WINDOW_SLACK_MS
      );

    const out = new Map<string, boolean>();
    for (const job of jobs) {
      const humanAssigned = inWindow(adminRows, job);
      const rankedAssigned = inWindow(evalRows, job);
      out.set(job.orderId, !humanAssigned && rankedAssigned);
    }
    return out;
  } catch (err) {
    console.error("[üretici-sla] atama kayıtları okunamadı", err);
    return null;
  }
}

type DetachOutcome =
  | { code: "detached"; declinedCount: number; hours: number }
  | { code: "skipped"; reason: string };

/**
 * İşi üreticiden KOPARIR — tek işlem, tek tutamak.
 *
 * Durum yazması, kara liste kaydı ve onu açıklayan eylem satırı aynı işlemin
 * içindedir: birini yazıp öbürünü yazmamak, siparişin neden üreticisiz
 * kaldığını okunamaz hâle getirirdi.
 *
 * CEZA YOKTUR: `strikeCount` artmaz ve yazılan eylem satırının adı
 * (MANUFACTURER_SLA_TIMEOUT_ACTION) sıralayıcının güvenilirlik kümelerinin
 * (GOOD_ACTIONS / BAD_ACTIONS) DIŞINDADIR, yani puana girmez. Bu bilinçli:
 * sinyali canlı puana sokmak, partner gelirini sessizce kaydıran bir sıralama
 * değişikliği olurdu (ranker-rollout = B: önce gölge).
 *
 * `orders.status` bilerek DEĞİŞMEZ: üreticisi olmayan bir sipariş zaten
 * `approved` (ya da pazaryerinde `paid`) durur — atanabilir hâlin ta kendisi.
 */
async function detachStaleManufacturer(
  job: StaleJob,
  cutoff: Date
): Promise<DetachOutcome> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        manufacturerId: orders.manufacturerId,
        manufacturerStatus: orders.manufacturerStatus,
        assignedAt: orders.assignedToManufacturerAt,
        declinedManufacturerIds: orders.declinedManufacturerIds,
        paymentStatus: orders.paymentStatus,
        shippedAt: orders.shippedAt,
        trackingNumber: orders.trackingNumber,
        sentToPainterAt: orders.sentToPainterAt,
        painterHandoffTrackingNumber: orders.painterHandoffTrackingNumber,
      })
      .from(orders)
      .where(eq(orders.id, job.orderId))
      .for("update");

    if (!existing) return { code: "skipped" as const, reason: "sipariş bulunamadı" };
    // Kilit altında YENİDEN sorulur: okuma ile yazma arasında üretici kabul
    // etmiş, admin işi almış ya da sipariş iade edilmiş olabilir.
    if (
      existing.manufacturerStatus !== "assigned" ||
      existing.manufacturerId !== job.manufacturerId
    ) {
      return {
        code: "skipped" as const,
        reason: "iş bu sırada yanıtlandı ya da devredildi",
      };
    }
    if (isRefunded(existing)) {
      return { code: "skipped" as const, reason: "sipariş iade edilmiş" };
    }
    if (manufacturerJobInTransit(existing)) {
      return { code: "skipped" as const, reason: "iş bu sırada yola çıktı" };
    }
    if (!existing.assignedAt || existing.assignedAt >= cutoff) {
      return { code: "skipped" as const, reason: "iş bu sırada yeniden atandı" };
    }

    const hours = Math.floor(hoursSince(existing.assignedAt, Date.now()));
    const declined = Array.from(
      new Set([...(existing.declinedManufacturerIds ?? []), job.manufacturerId])
    );

    const [updated] = await tx
      .update(orders)
      .set({
        manufacturerId: null,
        manufacturerStatus: "unassigned",
        assignedToManufacturerAt: null,
        // Yanıt vermeyen atölye siparişin kara listesine yazılır: iş ona bir
        // daha verilmez ve bu, yeniden yerleştirme üst sınırına SAYILIR
        // (sahibin kararı).
        declinedManufacturerIds: declined,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, job.orderId),
          eq(orders.manufacturerId, job.manufacturerId),
          eq(orders.manufacturerStatus, "assigned"),
          notRefundedGuard()
        )
      )
      .returning({ id: orders.id });
    if (!updated) {
      return { code: "skipped" as const, reason: "sipariş bu sırada değişti" };
    }

    // Koparmayı AÇIKLAYAN kayıt, koparmayla aynı işlemde. Ceza değil (bkz.
    // fonksiyon başlığı).
    await tx.insert(manufacturerActions).values({
      orderId: job.orderId,
      manufacturerId: job.manufacturerId,
      action: MANUFACTURER_SLA_TIMEOUT_ACTION,
      notes:
        `${hours} saat içinde kabul/ret yanıtı gelmedi; iş otomatik olarak geri alındı. ` +
        `Ceza uygulanmadı.`,
    });

    return { code: "detached" as const, declinedCount: declined.length, hours };
  });
}

async function processJob(job: Job) {
  const now = Date.now();
  const cutoff = new Date(now - MANUFACTURER_ACCEPT_SLA_HOURS * 3_600_000);
  const jobs = await staleJobs(cutoff);
  if (jobs.length === 0) {
    job.log("yanıtsız üretici ataması yok");
    return;
  }

  const autoMap = await autoAssignedByOrder(jobs);
  const assignmentLogUnreadable = autoMap === null;

  // ANAHTARLAR HERHANGİ BİR KOPARMADAN ÖNCE, süpürme başına TEK okumayla
  // sorulur (bkz. dosya başlığı). `getAllFlags` okuma hatasında derlenmiş
  // varsayılanlara düşer (otomatik atama anahtarları AÇIK doğar): bayrak
  // tablosundaki bir tökezleme yanıtsız işleri sonsuza kadar dondurmamalı.
  const flags = await getAllFlags();

  const reassigned: string[] = [];
  const adminQueue: AdminQueueItem[] = [];
  const flagged: string[] = [];
  const failures: string[] = [];

  for (const stale of jobs) {
    const hours = Math.floor(hoursSince(stale.assignedAt, now));
    // Kayıt okunamadıysa KAPALI taraf: elle atanmış say, kendiliğinden taşıma.
    const autoAssigned = autoMap?.get(stale.orderId) ?? false;
    const flagKey = autoAssignFlagFor(stale.kind);
    // Anahtarı OLMAYAN tür (atölye) hiçbir zaman otomatik atanmaz.
    const autoAssignEnabled = flagKey ? flags[flagKey] : false;
    const actions = planManufacturerAcceptSla({
      ageHours: hours,
      autoAssigned,
      inTransit: stale.inTransit,
      sellerOwned: stale.sellerOwned,
      alreadyFlagged: (stale.adminNotes ?? "").includes(FLAG),
      autoAssignEnabled,
    });
    if (actions.length === 0) continue;

    try {
      if (actions.includes("flag")) {
        // Zincir TÜKETİCİDİR: bayrak dalına düşmüş bir iş için önceki sorular
        // "hayır" ise geriye tek engel kalır. Sebebi yanlış yazmak, admin'i
        // olmayan bir arızaya bakmaya göndermek olurdu — ve sıra, saf kuralın
        // sırasının AYNISI olmak zorunda.
        const why = stale.sellerOwned
          ? "sipariş bir satıcının kendi kataloğundan çıktı; yalnız o atölyede basılabilir, bu yüzden otomatik devredilmedi"
          : stale.inTransit
            ? "iş fiziksel olarak yola çıktığı (kargo ya da boyacıya devir kaydı var) için otomatik devredilmedi"
            : assignmentLogUnreadable
              ? "atama kayıtları okunamadığı için atamanın otomatik olup olmadığı doğrulanamadı; iş otomatik devredilmedi"
              : !autoAssigned
                ? "atama elle yapıldığı için otomatik devredilmedi"
                : flagKey
                  ? "bu sipariş türünün otomatik atama anahtarı kapalı olduğu için iş üreticiden alınmadı; devri yönetici yapmalı"
                  : "atölye seansı siparişi otomatik atanmaz; devri yönetici yapmalı";
        await appendAdminNote(
          stale.orderId,
          `${FLAG} ${stale.companyName ?? "Üretici"} ${hours} saattir yanıt vermedi ` +
            `(${MANUFACTURER_ACCEPT_SLA_HOURS} saatlik süre aşıldı); ${why}.`
        );
        flagged.push(stale.orderNumber);
        // İş üreticide DURUYOR (koparma yapılmadı): burada yönetici gerçekten
        // bir karar bekliyor.
        adminQueue.push({
          orderNumber: stale.orderNumber,
          reason: why,
          assignmentExpected: true,
        });
        continue;
      }

      // ── Devir: önce KOPAR, sonra yerleştir ──────────────────────────────
      const outcome = await detachStaleManufacturer(stale, cutoff);
      if (outcome.code === "skipped") {
        // ATLANAN İŞ, İSTEYENE GÖRÜNÜR (Faz 4'ün dersi): sessizce dönmek,
        // süpürmenin neden hiçbir şey yapmadığını sorulamaz hâle getirirdi.
        job.log(`${stale.orderNumber}: ${outcome.reason}`);
        continue;
      }

      // Buradan sonrası "KOPARMA YAZILDI" dünyası: iş üreticinin listesinden
      // düştü. Aşağıdaki adımlar en iyi çabadır, hiçbiri koparmayı geri almaz.
      //
      // ÜRETİCİNİN KENDİ BİLDİRİMİ AŞAĞIDA, yerleştirmenin sonucu belli olunca
      // gönderilir: burada gönderilen cümle işin nereye gittiğini bilemezdi.
      // Panelin işi listeden düşürmesi ise sonucu beklemez — olay hemen yayılır.
      await emitOrderChanged({
        orderId: stale.orderId,
        orderNumber: stale.orderNumber,
        userId: stale.userId,
        // Eski üreticinin paneli yalnız kendi konusunu dinler: iş oradan
        // düşsün diye olay onun kimliğiyle yayılır.
        manufacturerId: stale.manufacturerId,
        manufacturerStatus: "unassigned",
      }).catch((e) => console.error("[üretici-sla] emitOrderChanged başarısız", e));

      let placedManufacturerId: string | null = null;
      let adminReason: string | null = null;
      // Sebebin KODU da tutulur: admin'e ve üreticiye ne söyleneceği koda göre
      // dallanır. Türkçe cümleyi parçalayarak karar vermek, çeviriyi kurala
      // dönüştürmek olurdu.
      let skipCode: AutoAssignSkip | null = null;
      let alsoNotifiedSeparately = false;

      // ÜST SINIR ORTAK KAYNAKTAN OKUNUR (config/flags.ts). Sayaç
      // `declinedManufacturerIds` uzunluğudur ve yanıtsız atölye az önce o
      // listeye yazıldı: bu yol da üst sınıra SAYILIR (sahibin kararı).
      if (manufacturerDeclinesExhausted(outcome.declinedCount)) {
        adminReason =
          `${outcome.declinedCount} atölye işi almadı ` +
          `(en fazla ${MANUFACTURER_MAX_REPLACEMENTS} kez yeniden yerleştirilir)`;
      } else {
        // Yerleştirme ASLA fırlatmaz (kendi sözleşmesi); yine de siparişin
        // kendi try/catch'i içindedir, çünkü koparma çoktan commit oldu ve
        // buradan çıkan bir hata süpürmenin geri kalanını düşürmemeli.
        const result = await autoAssignIfEligible(stale.orderId, {
          reason: "24 saat yanıtsız kalan atama geri alındı",
          // Az önce koparılan atölye bu denemede sıralamaya HİÇ girmez: kara
          // listeye yazıldı, ama iş ona saniyeler içinde geri dönmemeli.
          excludeManufacturerIds: [stale.manufacturerId],
        });
        if (result.assigned && result.manufacturerId) {
          placedManufacturerId = result.manufacturerId;
        } else {
          skipCode = result.skipped ?? null;
          adminReason = skipCode
            ? AUTO_ASSIGN_SKIP_REASON_TR[skipCode]
            : "otomatik yerleştirme yapılamadı";
          // Bazı sebeplerde yerleştirici KENDİ [ATAMA] notunu ve admin
          // e-postasını da yazıyor (order-confirm.ts · flagManualAssignment) ve
          // bunu kapatan bir seçeneği yok. Sipariş bu yüzden iki posta alır;
          // toplu e-posta bunu SÖYLER, yoksa admin ikinciyi ayrı bir olay
          // sanardı. (Boyacı ikizinde bu seçenek var: notifyAdminOnFailure.)
          //
          // Liste BURADA YAZILMAZ, ortak tablodan okunur: `no_candidate`
          // elle yazılıydı ve Faz 5'in iki yeni sebebi de ikinci postayı
          // yazdığı hâlde bu satır onları görmüyordu.
          alsoNotifiedSeparately = skipCode
            ? AUTO_ASSIGN_SKIP_NOTIFIES_ADMIN[skipCode]
            : false;
        }
      }

      if (placedManufacturerId) {
        reassigned.push(stale.orderNumber);
      } else {
        const note =
          `${FLAG} ${stale.companyName ?? "Üretici"} ${hours} saattir yanıt vermediği için iş geri alındı; ` +
          `${adminReason}. ${adminNextStepTr(skipCode)}`;
        await appendAdminNote(stale.orderId, note).catch((e) =>
          console.error("[üretici-sla] admin notu yazılamadı", e)
        );
        adminQueue.push({
          orderNumber: stale.orderNumber,
          reason: `${adminReason ?? "otomatik yerleştirme yapılamadı"} — ${adminNextStepTr(skipCode)}`,
          assignmentExpected: assignmentExpectedFor(skipCode),
          alsoNotifiedSeparately,
        });
      }

      // ÜRETİCİYE HABER: İŞİN GERÇEKTEN NEREYE GİTTİĞİ.
      //
      // Koparma çoktan commit oldu; bu bildirim en iyi çabadır ve patlarsa
      // süpürme devam eder. Cümle sonucun KODUNA bakar: yerleştirme atlandıysa
      // ya da üst sınır dolduysa "başka bir atölyeye yönlendirildi" demek,
      // partnere kendi işi hakkında yalan olurdu.
      await notifyManufacturer({
        manufacturerId: stale.manufacturerId,
        type: "system_announcement",
        subject: `Yanıtsız atama geri alındı — ${stale.orderNumber}`,
        body: manufacturerSlaNotice({
          orderNumber: stale.orderNumber,
          placed: !!placedManufacturerId,
          skip: skipCode,
        }),
        orderId: stale.orderId,
      }).catch((e) => console.error("[üretici-sla] notifyManufacturer başarısız", e));

      // YENİ ATÖLYEYE HABERİ YERLEŞTİRME VERİR (assignManufacturerToOrder kendi
      // "yeni sipariş atandı" bildirimini gönderiyor); burada ikinci bir mesaj
      // yazmak aynı olayı iki kez anlatmak olurdu.
    } catch (err) {
      // Bir siparişin hatası süpürmenin geri kalanına mal olmaz.
      const message = (err as Error).message;
      console.error(`[üretici-sla] ${stale.orderNumber} işlenemedi: ${message}`);
      failures.push(`${stale.orderNumber}: ${message}`);
    }
  }

  if (adminQueue.length > 0) {
    const adminEmail = process.env.ADMIN_EMAIL || "system@figurunica.com";
    // BAŞLIK DA SATIR KADAR DOĞRU OLMAK ZORUNDA (boyacı ikizinde ölçülen
    // kusur): konu yalnız SATIR SAYISINA bakarsa, "atama bekliyor" diyen bir
    // e-postanın tek satırı "işlem gerekmiyor" diyebilir.
    const expected = adminQueue.filter((o) => o.assignmentExpected).length;
    const allExpected = expected === adminQueue.length;
    const noneExpected = expected === 0;
    const customSubject = allExpected
      ? `${adminQueue.length} sipariş üretici ataması için yönetici kararı bekliyor`
      : noneExpected
        ? `${adminQueue.length} sipariş üreticisiz kaldı — atama beklenmiyor`
        : `${adminQueue.length} sipariş üreticisiz kaldı — ${expected} tanesi atama bekliyor`;
    const opener =
      `Aşağıdaki siparişlerde atanan üretici ${MANUFACTURER_ACCEPT_SLA_HOURS} saat içinde kabul/ret ` +
      (allExpected
        ? `yanıtı vermedi ve iş otomatik olarak yeni bir atölyeye yerleştirilemedi:`
        : noneExpected
          ? `yanıtı vermedi; bu siparişler için atama beklenmiyor (sebebi her satırda yazıyor):`
          : `yanıtı vermedi. Bir kısmı yeni bir atölyeye yerleştirilemedi, bir kısmı için ise atama beklenmiyor:`);
    const duplicateNote = adminQueue.some((o) => o.alsoNotifiedSeparately)
      ? `\n\nNot: "(ayrıca tekil [ATAMA] bildirimi gönderildi)" yazan satırlar için aynı sipariş ` +
        `hakkında ikinci bir e-posta daha almış olabilirsiniz; ikisi AYNI olayı anlatıyor.`
      : "";
    await getEmailQueue()
      .add("admin-manufacturer-sla", {
        type: "admin_custom",
        to: adminEmail,
        orderNumber: adminQueue[0].orderNumber,
        customerName: "Admin",
        customSubject,
        customBody:
          `${opener}\n\n` +
          adminQueue
            .map(
              (o) =>
                `- ${o.orderNumber} — ${o.reason}` +
                (o.alsoNotifiedSeparately ? " (ayrıca tekil [ATAMA] bildirimi gönderildi)" : "")
            )
            .join("\n") +
          duplicateNote +
          // Toplu çağrı SATIRA bırakılır: her sipariş için yapılacak iş aynı
          // değil ("elle atayın" ile "işlem gerekmiyor" bir arada gelebilir).
          (noneExpected
            ? `\n\nBu listedeki siparişler için atama yapmanız gerekmiyor; her satır kendi adımını söylüyor.`
            : `\n\nHer satır kendi adımını söylüyor; atama gereken siparişlerde sipariş sayfasındaki atama bloğunu kullanın.`),
        locale: "tr",
      })
      .catch((e) => console.error("[üretici-sla] admin e-postası kuyruğa alınamadı", e));
  }

  job.log(
    `${jobs.length} yanıtsız atama tarandı: ${reassigned.length} devredildi, ` +
      `${adminQueue.length} admin kuyruğuna düştü (${flagged.length} yalnız bayraklandı), ` +
      `${failures.length} hata`
  );

  // Hata, HER sipariş işlendikten sonra bildirilir: süpürme yarıda kesilmez.
  if (failures.length > 0) {
    throw new Error(
      `manufacturer-accept-sla: ${failures.length} sipariş işlenemedi — ${failures.join(" | ")}`
    );
  }
}

export function startManufacturerAcceptSlaWorker(): Worker {
  const worker = new Worker("manufacturer-accept-sla", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (j) => {
    console.info(`manufacturer-accept-sla completed: ${j.id}`);
  });
  worker.on("failed", (j, err) => {
    console.error(`manufacturer-accept-sla failed: ${j?.id}`, err);
  });

  return worker;
}
