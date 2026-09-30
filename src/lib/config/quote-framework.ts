/**
 * Çerçeve anlaşmaların SAF çekirdeği (0073).
 *
 * Kurumsal müşteri bir kerede büyük miktar TAAHHÜT eder, fiyat anlaşma boyunca
 * KİLİTLENİR, teslim PARTİLER hâlinde planlanır. Bu dosya o kuralların
 * veritabanısız yarısıdır: kapalı kümeler, tavanlar, plan kapıları ve ekranın
 * gösterdiği kova matematiği.
 *
 * ─── BİRİNCİ KURAL: ÖDEME PARTİ BAŞINADIR ───────────────────────────────────
 *
 * Anlaşma FİYATI ve TAAHHÜDÜ bağlar, PARAYI bağlamaz. Anlaşmanın kendisi bir
 * satış değildir: tahsilat yok, teslim taahhüdü parti serbest bırakılınca
 * doğar. Her parti KENDİ siparişi olarak ödenir, üretilir, sevk edilir ve
 * gerekirse iade edilir. Bu yüzden bu dosyada tahsilat zinciri (`quote-tender`)
 * YOKTUR ve olmamalı: çerçeve bir indirim değil, brütü hiç değiştirmiyor.
 *
 * ─── SAF MODÜL: DB YOK, `server-only` YOK, `node:` YOK ──────────────────────
 *
 * BullMQ worker'ı (`order-draft.ts` zinciri) ve istemci bileşenleri AYNI
 * dosyayı yükler; bir `server-only` importu standalone Node worker'ını
 * crash-loop'a sokar (2026-06-13'te yaşandı).
 *
 * Bu yüzden `services/manufacturer-capacity.ts` de IMPORT EDİLEMEZ: o dosya
 * `@/lib/db`yi çekiyor, yani hem saf yarıyı veritabanına bağlar hem `pg`yi
 * istemci paketine sürükler. Sonuç: `validateBatchPlan` kapasite EŞİĞİNİ
 * KURMAZ, kararı (`benchHasRoom`) ARGÜMAN olarak alır. Gerekçe
 * `manufacturer-capacity.ts` KARAR 2'dir: `loadUnits` KAPIDIR, `activeJobs`
 * GÖSTERİMDİR — bir ekran, ucun uygulamadığı bir ölçüyle kimseyi kapatamaz.
 *
 * ─── ADLANDIRMA: tutarlar `…Kurus` ile BİTER ────────────────────────────────
 *
 * Döviz gösteriminin (0071) `…Kurus` YASAĞI ÇEVRİLMİŞ döviz değerlerine
 * özeldi. Çerçeve tutarları kuruş TAMSAYISIdır ve adları `…Kurus` ile bitmek
 * ZORUNDADIR: `quote-present.ts`in fiyat kapısı `key.endsWith("Kurus")` ile
 * uygulanıyor, yani başka bir ad çerçeve tutarlarını `canSeePrices=false`
 * izleyiciye SIZDIRIR.
 */
import { addBusinessDays, istanbulDateKey } from "@/lib/config/business-days";
import { countsAsRevenue } from "@/lib/config/order-money";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";
import { painterLoadUnits } from "@/lib/config/painter-scoring";
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import type { FrozenQuotePart, PricingSnapshot } from "@/lib/config/quote-types";

// ─── Kapalı kümeler (CHECK listelerinin kaynağı) ────────────────────────────

/**
 * Anlaşmanın yaşam döngüsü. `schema.ts` `quote_frameworks_status_chk` listesini
 * BURADAN üretir (`quoteInList`); ikisi ayrışırsa uygulama katalog dışı bir
 * durum yazmaya kalkar ve veritabanı 23514 ile reddeder.
 */
export const FRAMEWORK_STATUSES = [
  "draft",
  "active",
  "completed",
  "expired",
  "cancelled",
] as const;
export type FrameworkStatus = (typeof FRAMEWORK_STATUSES)[number];

/**
 * Partinin durumu. `released` KLON TEKLİFİN VARLIĞI demektir — DB'de
 * `quote_framework_batches_released_chk` bunu şart koşuyor, yani "serbest
 * bırakıldı ama klonu yok" hâli doğmaz.
 */
export const BATCH_STATUSES = ["planned", "released", "cancelled"] as const;
export type FrameworkBatchStatus = (typeof BATCH_STATUSES)[number];

// ─── Sürüm ve tavanlar ──────────────────────────────────────────────────────

/**
 * ÇERÇEVE ANLAŞMA ŞARTLARI metninin sürümü (ticari çerçeve).
 *
 * `PRELIMINARY_INFO_VERSION` / `DISTANCE_CONTRACT_VERSION` ile KARIŞTIRILMAZ:
 * onlar mesafeli satışın sürümleridir ve PARTİ ödemesinde `quote-checkout.ts`
 * tarafından zaten yazılıyor. Çerçevenin kendisi bir satış olmadığı için o
 * metinlerin yeni bir sürümü GEREKMEZ; gereken, taahhüt/fiyat kilidi/parti
 * planı/her partinin ayrı faturalandığını yazan AYRI bir metindir.
 */
export const FRAMEWORK_TERMS_VERSION = "2026-09-30";

/**
 * Bir anlaşmanın taahhüt edebileceği en büyük toplam (₺40M).
 *
 * TÜRETİLMİŞTİR: parti tavanı `MAX_AMOUNT_KURUS`tur (tek ödeme sınırı) ve
 * çerçeve TOPLAMI onu aşabilir — bu yüzden `quote_frameworks.committed_total_kurus`
 * `bigint`, `quote_framework_batches.amount_kurus` ise `integer` kalır. Sayı
 * burada yeniden YAZILMAZ: iki tavan ayrışırsa hangi sınırın uygulandığı
 * tahmine kalır.
 */
export const MAX_FRAMEWORK_TOTAL_KURUS = 20 * MAX_AMOUNT_KURUS;

/**
 * Bir anlaşmada en fazla kaç parti. Sınır bir ürün kararı değil, bir okuma
 * kararı: 24 partilik bir zaman çizelgesi hâlâ tek ekranda okunur ve iki yıllık
 * aylık teslim planına yeter. Daha fazlası isteniyorsa ikinci bir anlaşma
 * kurulur (fiyat kilidi de yeniden konuşulur).
 */
export const MAX_BATCHES_PER_FRAMEWORK = 24;

// ─── Para: TEK aritmetik ────────────────────────────────────────────────────

/**
 * Parti satırının tutarı. Teklif motorunun MANUEL dalıyla AYNI çarpma
 * (`quote-compute.ts`: `lineKurus = manualUnitKurus * quantity`) — kilitli
 * birim fiyat manuel fiyattır.
 *
 * ÜÇ YER, TEK KURAL: burası, `quote_framework_batch_lines_line_chk`
 * (`line_kurus = unit_kurus * quantity`) ve `computeQuote`. Dördüncü bir çarpma
 * yazılmaz; `scripts/test-quote-framework.ts` bu üçünün aynı sayıyı verdiğini
 * her koşuda doğrular.
 */
export function frameworkLineKurus(unitKurus: number, quantity: number): number {
  return unitKurus * quantity;
}

/** Planlanan bir parti satırı (henüz DB'ye yazılmamış hâli). */
export interface FrameworkBatchLineInput {
  /** `parts_snapshot[].partId`. */
  partId: string;
  quantity: number;
  /** Anlaşmadan gelen KİLİTLİ birim fiyat. */
  unitKurus: number;
}

export interface FrameworkBatchTotals {
  /** Σ satır adedi — `quote_framework_batches.units` ve yük ölçüsünün girdisi. */
  units: number;
  /** Σ satır tutarı. Ek hizmetler ve asgari tamamlama BURADA YOK. */
  partsKurus: number;
}

/**
 * Partinin adet ve tutar toplamı — satırlardan TÜRETİLİR.
 *
 * Çağıranın elle toplaması YASAK: `validateBatchPlan` verilen `batch.units` ve
 * `batch.amountKurus` değerlerini bu fonksiyonun sonucuyla karşılaştırır ve
 * saparsa reddeder (`batch_totals_mismatch`).
 */
export function frameworkBatchTotals(
  lines: readonly FrameworkBatchLineInput[]
): FrameworkBatchTotals {
  let units = 0;
  let partsKurus = 0;
  for (const line of lines) {
    units += line.quantity;
    partsKurus += frameworkLineKurus(line.unitKurus, line.quantity);
  }
  return { units, partsKurus };
}

// ─── Kapasite: ağırlık kuralının TEK kopyası ────────────────────────────────

/**
 * Partinin tezgâhta kapladığı AĞIRLIKLI yük.
 *
 * `painterLoadUnits`in çerçeve adı: kural (1 + her yirmi adet için bir birim)
 * KOPYALANMAZ, IMPORT EDİLİR. Eşiğin kendisi bu modülde YOKTUR — çağıran
 * `manufacturerHasRoom({ loadUnits: tezgâh + frameworkBatchLoadUnits(units),
 * max })` ile ölçer ve sonucu `benchHasRoom` olarak geçer.
 */
export function frameworkBatchLoadUnits(units: number): number {
  return painterLoadUnits(units);
}

// ─── Ret kümesi ─────────────────────────────────────────────────────────────

/**
 * Anlaşma kurulumunun ya da parti planının reddedilme sebebi — KAPALI küme.
 *
 * `Record<FrameworkRefusalCode, string>` yazan sözlük, yeni bir sebebin
 * karşılığı unutulduğunda DERLEME hatası verir; admin ekranına düşen bir
 * "undefined" değil.
 */
export type FrameworkRefusalCode =
  | "painting_forbidden"
  | "framework_total_over_cap"
  | "commitment_exceeded"
  | "below_min_order"
  | "bench_full"
  | "ship_date_too_early"
  | "batch_limit_reached"
  | "batch_amount_over_cap"
  | "batch_totals_mismatch";

/** Sebebin admin'e gösterilen Türkçe hâli (cümlenin gövdesi). */
export const FRAMEWORK_REFUSAL_LABELS_TR: Record<FrameworkRefusalCode, string> = {
  painting_forbidden:
    "Çerçeve anlaşmada boyama kalemi olan yüzey kullanılamaz; boyalı parçayı ayrı bir teklifte fiyatlayın",
  framework_total_over_cap: "Anlaşma toplamı üst sınırı aşıyor",
  commitment_exceeded: "Planlanan adet taahhüdü aşıyor",
  below_min_order: "Parti tutarı asgari sipariş tutarının altında",
  bench_full: "Parti tek atölyenin tezgâhına sığmıyor; daha küçük partilere bölün",
  ship_date_too_early: "Planlanan sevk tarihi teslim süresinden önce",
  batch_limit_reached: "Anlaşmanın parti sayısı üst sınırına ulaşıldı",
  batch_amount_over_cap: "Parti tutarı tek ödeme üst sınırını aşıyor",
  batch_totals_mismatch: "Parti toplamı satırlarla uyuşmuyor",
};

export interface FrameworkPlanRefusal {
  code: FrameworkRefusalCode;
  /** Admin ekranında gösterilecek Türkçe cümle (varsa sayılarla birlikte). */
  message: string;
}

function refuse(code: FrameworkRefusalCode, detail?: string): FrameworkPlanRefusal {
  const base = FRAMEWORK_REFUSAL_LABELS_TR[code];
  return { code, message: detail ? `${base} (${detail})` : `${base}.` };
}

// ─── Anlaşma kurulumu ───────────────────────────────────────────────────────

/**
 * Anlaşmada BOYAMA KALEMİ olan bir yüzey var mı?
 *
 * Çerçevede boyama YASAKTIR (tasarım §1): boyamayı çerçeveye almak boyacı
 * kapasitesini de ileriye dönük planlamak demektir. Yasağın para tarafı da
 * var: `quote-checkout.ts` parti taslağına `needsPainting: false` /
 * `paintingPriceKurus: 0` / `productionBaseKurus = amountKurus` yazıyor ve
 * `payouts.ts`in `production + painting = amount` kapısı bu üçlüye dayanıyor.
 *
 * BİLİNMEYEN YÜZEY DE REDDEDİLİR: snapshot'ta karşılığı olmayan bir yüzey
 * anahtarının boyama olup olmadığı KANITLANAMAZ ve kanıtlayamadığımız şey lehe
 * yazılmaz (fail-closed).
 */
export function frameworkPaintingForbidden(
  snapshot: PricingSnapshot,
  parts: readonly Pick<FrozenQuotePart, "finishKey">[]
): boolean {
  for (const part of parts) {
    const finish = snapshot.finishes.find((f) => f.key === part.finishKey);
    if (!finish) return true;
    if (finish.costLineKind === "painting") return true;
  }
  return false;
}

/**
 * Anlaşma KURULABİLİR mi? Boş dizi = kurulabilir.
 *
 * Tavan burada BRÜT toplam üzerindedir ve parti tavanından AYRIDIR: tek ödeme
 * `MAX_AMOUNT_KURUS`u aşamaz ama anlaşma toplamı aşabilir (ödeme parti
 * başınadır).
 */
export function validateFrameworkAgreement(args: {
  /** Anlaşmanın DONDURDUĞU katalog — canlı katalog DEĞİL. */
  snapshot: PricingSnapshot;
  parts: readonly Pick<FrozenQuotePart, "finishKey">[];
  committedTotalKurus: number;
}): FrameworkPlanRefusal[] {
  const refusals: FrameworkPlanRefusal[] = [];
  if (frameworkPaintingForbidden(args.snapshot, args.parts)) {
    refusals.push(refuse("painting_forbidden"));
  }
  if (args.committedTotalKurus > MAX_FRAMEWORK_TOTAL_KURUS) {
    refusals.push(
      refuse(
        "framework_total_over_cap",
        `${args.committedTotalKurus} > ${MAX_FRAMEWORK_TOTAL_KURUS}`
      )
    );
  }
  return refusals;
}

// ─── Taahhüt defteri ────────────────────────────────────────────────────────

/** Anlaşmanın taahhüdü: parça başına adet ve KİLİTLİ birim fiyat. */
export interface FrameworkCommitmentPart {
  partId: string;
  /** `parts_snapshot[].quantity` — taahhüt edilen adet. */
  quantity: number;
  unitKurus: number;
}

/** Taahhüt defterinin satırı (`quote_framework_batch_lines` + partisinin hâli). */
export interface FrameworkLedgerLine {
  partId: string;
  quantity: number;
  batchStatus: FrameworkBatchStatus;
  /** Partinin siparişi; klon teklif ödenmediyse null. */
  orderId: string | null;
}

/**
 * Bu satır taahhüdü TÜKETTİ mi?
 *
 * Tek ayrım PARANIN HAREKET ETMİŞ olmasıdır:
 *
 *  - Hiç serbest bırakılmamış bir partinin iptali (sipariş YOK) taahhüdü
 *    tüketmez: ortada ödeme, üretim ve teslim taahhüdü yoktur, admin yanlış
 *    planladığı adedi yeniden planlayabilmelidir.
 *  - Serbest bırakılmış bir parti (siparişi var) taahhüdü TÜKETİR ve iade
 *    edilse bile geri yüklenMEZ (tasarım §3.1): iade bir para kararıdır, üretim
 *    planını sessizce değiştiren bir düğme değildir.
 *
 * Kova matematiği de bu tek ölçüyü okur, o yüzden "taahhüt kadar" çubuk hiçbir
 * hâlde şaşmaz.
 */
export function frameworkLineConsumesCommitment(
  line: Pick<FrameworkLedgerLine, "batchStatus" | "orderId">
): boolean {
  return !(line.batchStatus === "cancelled" && line.orderId === null);
}

/**
 * Parça başına KALAN taahhüt (taahhüt − tüketen satırlar).
 *
 * Değer bilerek İŞARETLİDİR: negatif bir kalan, aşırı planlanmış bir anlaşma
 * demektir ve plan kapısı onu (herhangi bir adette) reddeder. Sıfıra
 * kırpılsaydı aşırı planlama sessizce meşrulaşırdı.
 */
export function frameworkCommitmentRemaining(
  commitment: readonly FrameworkCommitmentPart[],
  lines: readonly FrameworkLedgerLine[]
): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const part of commitment) {
    remaining.set(part.partId, (remaining.get(part.partId) ?? 0) + part.quantity);
  }
  for (const line of lines) {
    if (!frameworkLineConsumesCommitment(line)) continue;
    remaining.set(line.partId, (remaining.get(line.partId) ?? 0) - line.quantity);
  }
  return remaining;
}

// ─── Plan doğrulayıcı ───────────────────────────────────────────────────────

/** Planlanan partinin kendisi. */
export interface BatchPlanInput {
  /** Σ satır adedi (`frameworkBatchTotals`). */
  units: number;
  /** Partinin BRÜT tutarı: Σ satır + ek hizmet. */
  amountKurus: number;
  /** YYYY-MM-DD, İstanbul takvimi. */
  plannedShipDate: string;
  /**
   * `manufacturerHasRoom({ loadUnits: tezgâh + frameworkBatchLoadUnits(units),
   * max })` sonucu. ÇAĞIRAN hesaplar; bu modül eşiği KURMAZ.
   */
  benchHasRoom: boolean;
}

/**
 * Bir parti PLANLANABİLİR mi? Boş dizi = planlanabilir.
 *
 * Dört kural (tasarım §1 madde 6) ve üç tavan, hepsi AYRI AYRI rapor edilir:
 * kurallar birbirini maskelemez, yoksa admin bir düzeltmeden sonra ikinci
 * duvara toslar.
 *
 *  1. Σ parti adedi ≤ taahhüt (parça başına).
 *  2. Σ satır + ek hizmet ≥ `settings.minOrderKurus` — asgari tamamlama
 *     (`minOrderTopUpKurus`) müşteriye SÜRPRİZ olmasın. Snapshot DONMUŞ olduğu
 *     için bu belirlenimcidir.
 *  3. Parti tek atölyenin tezgâhına sığar (`benchHasRoom` argümanı).
 *  4. `plannedShipDate` bugünden en az `leadDays` İŞ GÜNÜ sonra.
 *
 * DÖRDÜNCÜ KURALIN YAZILI SÖZÜ: tatil listesi ve `cutoffHour` ANLAŞMANIN
 * DONMUŞ snapshot'ından okunur, canlı ayardan değil. Yani anlaşma
 * imzalandıktan SONRA listeye eklenen bir resmî tatil, imzalanmış parti
 * tarihlerini KAYDIRMAZ. İkinci bir takvim yazılmaz: ölçü
 * `addBusinessDays`tir.
 */
export function validateBatchPlan(args: {
  /** Anlaşmanın DONDURDUĞU katalog (tatiller + cutoff + asgari sipariş). */
  snapshot: PricingSnapshot;
  commitment: readonly FrameworkCommitmentPart[];
  /** Anlaşmanın BUGÜNE KADARKİ parti satırları (planlanan parti hariç). */
  ledger: readonly FrameworkLedgerLine[];
  /** Planlanan partinin satırları. */
  lines: readonly FrameworkBatchLineInput[];
  batch: BatchPlanInput;
  /** Partinin ek hizmet tutarı (anlaşma boyunca aynı). */
  addonsKurus: number;
  /** Teslim kademesinin iş günü sayısı (donmuş snapshot'tan hesaplanmış). */
  leadDays: number;
  now: Date;
  /** Anlaşmanın var olan parti sayısı (iptal edilenler dâhil değil). */
  existingBatchCount: number;
}): FrameworkPlanRefusal[] {
  const refusals: FrameworkPlanRefusal[] = [];
  const totals = frameworkBatchTotals(args.lines);
  const grossKurus = totals.partsKurus + args.addonsKurus;

  // Toplamlar satırlardan SAPAMAZ: para değişmezinin saf yarısı.
  if (args.batch.units !== totals.units || args.batch.amountKurus !== grossKurus) {
    refusals.push(
      refuse(
        "batch_totals_mismatch",
        `${args.batch.units} adet / ${args.batch.amountKurus} kuruş verildi, satırlar ${totals.units} adet / ${grossKurus} kuruş`
      )
    );
  }

  // 1. Taahhüt kapısı — parça başına, KALAN üzerinden.
  const remaining = frameworkCommitmentRemaining(args.commitment, args.ledger);
  for (const line of args.lines) {
    const left = remaining.get(line.partId) ?? 0;
    if (line.quantity > left) {
      refusals.push(
        refuse("commitment_exceeded", `${line.partId}: ${line.quantity} istendi, kalan ${left}`)
      );
    }
  }

  // 2. Asgari sipariş tutarı — asgari tamamlama sürprizi imkânsız olsun.
  if (grossKurus < args.snapshot.settings.minOrderKurus) {
    refusals.push(
      refuse("below_min_order", `${grossKurus} < ${args.snapshot.settings.minOrderKurus}`)
    );
  }

  // 3. Tezgâh kararı ARGÜMANDIR (eşik `manufacturerHasRoom`ın).
  if (!args.batch.benchHasRoom) {
    refusals.push(
      refuse("bench_full", `${totals.units} adet = ${frameworkBatchLoadUnits(totals.units)} birim`)
    );
  }

  // 4. Tarih kapısı — DONMUŞ tatil listesi ve cutoff ile, iş günü üzerinden.
  const earliest = istanbulDateKey(
    addBusinessDays(
      args.now,
      args.leadDays,
      args.snapshot.settings.holidays,
      args.snapshot.settings.cutoffHour
    )
  );
  if (args.batch.plannedShipDate < earliest) {
    refusals.push(
      refuse("ship_date_too_early", `${args.batch.plannedShipDate} < ${earliest}`)
    );
  }

  // Tavanlar.
  if (args.existingBatchCount >= MAX_BATCHES_PER_FRAMEWORK) {
    refusals.push(
      refuse("batch_limit_reached", `${args.existingBatchCount} / ${MAX_BATCHES_PER_FRAMEWORK}`)
    );
  }
  if (grossKurus > MAX_AMOUNT_KURUS) {
    refusals.push(refuse("batch_amount_over_cap", `${grossKurus} > ${MAX_AMOUNT_KURUS}`));
  }

  return refusals;
}

// ─── İlerleme görünümü (kovalar) ────────────────────────────────────────────

/** Kova matematiğinin okuduğu satır: defter satırı + partisinin siparişinin hâli. */
export interface FrameworkProgressLine extends FrameworkLedgerLine {
  /**
   * PARTİNİN SİPARİŞİ İPTAL EDİLDİ Mİ — GERÇEĞİ ÇAĞIRAN VERİR.
   *
   * `orders.status` İPTAL diye bir değer TAŞIMAZ (`orderStatusEnum`,
   * `schema.ts:55`): iptali yazan tek yer `order-refund-record.ts`in
   * `closeOrder`u ve o, `status`u **`'rejected'`** yapıp `payment_status`u
   * **`'succeeded'` BIRAKIR** (iade ise tersi: `payment_status='refunded'`,
   * durum korunur). Üstelik iptalin ikinci biçimi hiç `status`ta görünmez:
   * `order_refunds.kind='cancellation'` tahsis satırı.
   *
   * Bu yüzden kova matematiği durum dizesini KENDİ ÖLÇMEZ; depodaki TEK iptal
   * ölçüsünü (`actualReturnFacts(...).cancelled`, `order-money.ts:322` —
   * `status === "rejected" || refunds.some(r => r.kind === "cancellation")`)
   * yükleyiciden hazır alır. Alan ZORUNLU: unutulduğunda TypeScript kırılır,
   * çünkü sessizce `false` varsayılması iptal edilmiş bir partiyi "Üretimde"
   * göstermek demekti.
   */
  cancelled: boolean;
  paymentStatus: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
}

/**
 * Altı kova + bir AYRIK kova. Kovalar DAİMA taahhüde toplanır:
 *
 *   unplanned + planned + awaitingPayment + inProduction + shipped + delivered
 *     + cancelledOrRefunded = committed
 *
 * Aksi hâlde ekran yalan söyler — bir çubuğun toplamı taahhüdü tutmazsa müşteri
 * hangi sayıya güveneceğini bilemez.
 */
export interface FrameworkProgress {
  /** Taahhüt: çubuğun TAMAMI. */
  committedUnits: number;
  /** Henüz hiçbir partiye girmemiş (ya da iptal edilip serbest kalmış) taahhüt. */
  unplannedUnits: number;
  plannedUnits: number;
  awaitingPaymentUnits: number;
  inProductionUnits: number;
  shippedUnits: number;
  deliveredUnits: number;
  /** AYRIK kova: iade ya da iptal. Diğer kovaların HEPSİNİ ezer (çifte sayım yok). */
  cancelledOrRefundedUnits: number;
}

export interface FrameworkPartProgress extends FrameworkProgress {
  partId: string;
}

function emptyProgress(): Omit<FrameworkProgress, "committedUnits" | "unplannedUnits"> {
  return {
    plannedUnits: 0,
    awaitingPaymentUnits: 0,
    inProductionUnits: 0,
    shippedUnits: 0,
    deliveredUnits: 0,
    cancelledOrRefundedUnits: 0,
  };
}

/**
 * Bu satır "üretimde" mi sayılır — PARA tarafı.
 *
 * `revenueKurus`un (`order-money.ts:299`) kapısının birebir aynısı:
 * `countsAsRevenue(paymentStatus) && !cancelled`. İptal GERÇEĞİ ödeme durumuna
 * BAKMAZ (iptal `payment_status`u `'succeeded'` bırakır), o yüzden ciro kapısı
 * tek başına kullanılamaz; ikisi EŞLEŞTİRİLİR. Böylece kova sırası ileride
 * değişse bile iptal edilmiş bir parti "Üretimde" görünemez.
 */
function earnsRevenue(line: FrameworkProgressLine): boolean {
  return countsAsRevenue(line.paymentStatus) && !line.cancelled;
}

/**
 * Satırın kovası. SIRA KURALIN KENDİSİDİR:
 *
 *  1. İade/iptal her şeyi EZER. Aynı sipariş hem `refunded` hem
 *     `shipped_at IS NOT NULL` olabilir; ikisine de sayılsa çubuk taahhüdü
 *     aşardı (ölçülen çifte sayım tam buydu). İptal, sevk edilmiş ve hatta
 *     teslim edilmiş bir partide de olabilir (iade/iptal siparişi geriye
 *     dönük kapatır) — o yüzden fiziksel gerçeğin ÜSTÜNDE durur.
 *  2. Sonra FİZİKSEL gerçek: teslim → sevk.
 *  3. Sonra PARA: siparişi olan ama tahsilatı ciroya saymayan bir parti
 *     "üretimde" DEĞİL, ödeme bekliyordur.
 *  4. En son planın kendi hâli.
 */
function bucketOf(line: FrameworkProgressLine): keyof ReturnType<typeof emptyProgress> {
  if (
    line.paymentStatus === REFUNDED_PAYMENT_STATUS ||
    line.cancelled ||
    line.batchStatus === "cancelled"
  ) {
    return "cancelledOrRefundedUnits";
  }
  if (line.deliveredAt) return "deliveredUnits";
  if (line.shippedAt) return "shippedUnits";
  if (line.orderId && earnsRevenue(line)) return "inProductionUnits";
  if (line.batchStatus === "released") return "awaitingPaymentUnits";
  return "plannedUnits";
}

/**
 * Parça başına ve anlaşma toplamında kova kırılımı.
 *
 * `committedUnits` bilerek `max(taahhüt, tüketilen)`dir: aşırı planlanmış bir
 * parçada çubuk taahhüdü değil GERÇEĞİ gösterir. Eksik gösteren bir çubuk
 * yalan söyler; fazla gösteren uyarır. (Plan kapısı bu hâlin doğmasını zaten
 * engelliyor — bu yalnız ekranın hiçbir veride şaşmaması için.)
 */
export function frameworkProgressBuckets(
  commitment: readonly FrameworkCommitmentPart[],
  lines: readonly FrameworkProgressLine[]
): { total: FrameworkProgress; byPart: FrameworkPartProgress[] } {
  const committed = new Map<string, number>();
  const order: string[] = [];
  for (const part of commitment) {
    if (!committed.has(part.partId)) order.push(part.partId);
    committed.set(part.partId, (committed.get(part.partId) ?? 0) + part.quantity);
  }

  const buckets = new Map<string, ReturnType<typeof emptyProgress>>();
  const consumed = new Map<string, number>();
  for (const line of lines) {
    if (!committed.has(line.partId) && !buckets.has(line.partId)) order.push(line.partId);
    const row = buckets.get(line.partId) ?? emptyProgress();
    if (frameworkLineConsumesCommitment(line)) {
      row[bucketOf(line)] += line.quantity;
      consumed.set(line.partId, (consumed.get(line.partId) ?? 0) + line.quantity);
    }
    buckets.set(line.partId, row);
  }

  const byPart: FrameworkPartProgress[] = order.map((partId) => {
    const row = buckets.get(partId) ?? emptyProgress();
    const consumedUnits = consumed.get(partId) ?? 0;
    const committedUnits = Math.max(committed.get(partId) ?? 0, consumedUnits);
    return { partId, committedUnits, unplannedUnits: committedUnits - consumedUnits, ...row };
  });

  const total: FrameworkProgress = byPart.reduce<FrameworkProgress>(
    (sum, part) => ({
      committedUnits: sum.committedUnits + part.committedUnits,
      unplannedUnits: sum.unplannedUnits + part.unplannedUnits,
      plannedUnits: sum.plannedUnits + part.plannedUnits,
      awaitingPaymentUnits: sum.awaitingPaymentUnits + part.awaitingPaymentUnits,
      inProductionUnits: sum.inProductionUnits + part.inProductionUnits,
      shippedUnits: sum.shippedUnits + part.shippedUnits,
      deliveredUnits: sum.deliveredUnits + part.deliveredUnits,
      cancelledOrRefundedUnits: sum.cancelledOrRefundedUnits + part.cancelledOrRefundedUnits,
    }),
    { committedUnits: 0, unplannedUnits: 0, ...emptyProgress() }
  );

  return { total, byPart };
}
