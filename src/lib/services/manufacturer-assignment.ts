import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturers,
  orders,
  orderItems,
  manufacturerActions,
} from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { regionOf } from "@/lib/data/turkey-regions";
import {
  MAP_UNIT_KM,
  foldProvinceName,
  provinceDistanceUnits,
  sameProvinceName,
} from "@/lib/data/province-distance";
import { effectiveCoverage } from "@/lib/config/network-map";
import {
  getAssignmentWeights,
  getDistanceModel,
  type DistanceModel,
  type ScoringProfile,
  type ScoringWeights,
} from "@/lib/config/manufacturer-scoring";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";
import {
  manufacturerSupportsMaterial,
  orderRequirements,
} from "@/lib/services/capability";
// Faz 5 sinyalleri. Sıralayıcı env OKUMAZ: yalnız `signalsForProfile()`in
// verdiği kümeye bakar, yani "canlı skora yeni bir sinyal sızdı mı?" sorusunun
// cevabı tek bir yerde aranır (config/scoring.ts, dosya başlığı).
import {
  NO_SIGNALS,
  PHASE5_DISTANCE_MODEL,
  anySignalOn,
  applyReliabilityPenalties,
  activeSignals,
  paintInHouseBonus,
  phase5Weights,
  signalsForProfile,
  type CoverageResolver,
  type CoverageSource,
  type Phase5SignalSet,
  type ShadowSignalDetail,
} from "@/lib/config/scoring";

// Every manufacturerStatus where the order is still on the manufacturer's bench
// (i.e. counts against their capacity) — everything except 'unassigned' and the
// terminal 'shipped'. Post-print states (printed, qc_*) MUST be included: a shop
// that finished printing but hasn't shipped is still occupied, so omitting them
// let a fully-loaded shop score as idle and pick up more work past its cap.
// Exported so the admin activeOrderCount and the scoring currentLoad share one
// source and can never drift.
export const ACTIVE_MFG_STATUSES = [
  "assigned",
  "accepted",
  "printing",
  "printed",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
] as const;

// An order handed off to a painter (painterStatus assigned+) is no longer on the
// MANUFACTURER's bench: the print is done, their earning already accrued, and
// they take no further action on it. Crucially, for painting orders the
// manufacturerStatus stays 'qc_approved' forever (send-to-painter/painter-ship
// never advance it), so without this the completed painting jobs would count
// against the shop's capacity permanently and lock it out of new assignments.
// A NULL/'unassigned' painterStatus means it's still the manufacturer's job.
export function orderStillOnManufacturerBench() {
  return or(
    isNull(orders.painterStatus),
    eq(orders.painterStatus, "unassigned")
  )!;
}

/**
 * "Bu sipariş şu anda bir atölyenin TEZGÂHINDA" — tek SQL cümlesi.
 *
 * Üç okuma bu aynı cümleyi ayrı ayrı yazıyordu (canlı yük sayımı, parti
 * toplaması ve şimdi ağırlıklı yük). Üç kopya, tezgâh tanımının bir gün
 * birinde değişip ötekilerde kalmasına açık davetiyeydi: yük "dolu" derken
 * parti sayacı "boş" diyebilirdi. Tanım tek yerde durur.
 */
function manufacturerBenchFilter() {
  return and(
    inArray(orders.manufacturerStatus, [...ACTIVE_MFG_STATUSES]),
    orderStillOnManufacturerBench(),
    sql`${orders.manufacturerId} IS NOT NULL`
  );
}

// Human labels for the material a manufacturer can't print (ineligibleReason).
const MATERIAL_LABEL_TR: Record<string, string> = {
  resin: "reçine",
  filament: "filament",
};

// v2: thresholds for on-time-delivery scoring. A manufacturer shipping
// within these windows gets full credit; beyond them they lose points
// linearly until floor 0.
const OTD_PRINT_TARGET_MS = 7 * 24 * 60 * 60 * 1000; // 7 days assign → print
const OTD_SHIP_TARGET_MS = 3 * 24 * 60 * 60 * 1000; // 3 days print → ship
const OTD_LOOKBACK = 20;

export interface CandidateScore {
  manufacturerId: string;
  companyName: string;
  city: string | null;
  district: string | null;
  phone: string | null;
  email: string;
  iban: string | null;
  currentLoad: number;
  maxConcurrentOrders: number;
  acceptingOrders: boolean;
  scores: {
    distance: number;
    load: number;
    reliability: number;
    onTimeDelivery: number;
    compliance: number;
    batchAffinity: number;
  };
  /** Units of the order's product(s) already on this shop's bench. */
  sameProductUnits: number;
  totalScore: number;
  reasons: string[];
  eligible: boolean;
  ineligibleReason?: string;
  /**
   * Faz 5 GÖLGE açıklaması — yalnız en az bir yeni sinyal yürürlükteyken dolar.
   *
   * İsteğe bağlı olması yapısal bir güvencedir: sinyaller kapalıyken (canlı
   * yolun varsayılanı) aday nesnesi bugünküyle ALAN ALAN aynıdır, yani "canlı
   * skor değişmedi" iddiası derin eşitlikle sınanabilir.
   */
  shadow?: ShadowSignalDetail;
}

/**
 * Mesafe skorunun NEDEN o değer olduğu. Skorun kendisinden geri çıkarılamaz:
 * admin adaylara bakarken 85'i "Aynı bölge" diye etiketlemek yanlış olurdu
 * (kapsama isabeti bambaşka bir gerekçedir ve farklı bölgede de olabilir).
 */
export type DistanceKind = "same_il" | "coverage" | "same_region" | "other" | "unknown";

export interface DistanceVerdict {
  score: number;
  kind: DistanceKind;
}

/**
 * Sipariş ili ile atölye arasındaki yakınlık skoru.
 *
 * Kademeler ve SIRA (sıra kuralın kendisidir):
 *  1. sipariş ili bilinmiyor      → 30
 *  2. atölyenin ili = sipariş ili → 100
 *  3. sipariş ili ETKİ ALANINDA   → 85
 *  4. aynı bölge                  → 60
 *  5. atölyenin ili bilinmiyor    → 30
 *  6. aksi                        → 20
 *
 * Kapsama kontrolü "il bilinmiyor" kontrolünden ÖNCE gelir: adresi olmayan ama
 * admin'in etki alanı tanımladığı bir atölye geçerli bir durumdur ve o iller
 * için tam olarak bu skoru hak eder.
 *
 * 85, aynı ilin (100) altında ve aynı bölgenin (60) üstünde: sorumluluk
 * verilmiş il o atölyeyi öne çeker ama siparişin KENDİ ilindeki atölye hâlâ
 * önde kalır. Uyarı: 81 ile yayılmış bir kapsama, ülke genelinde aynı-bölge
 * rakiplerini geçer — admin editörü bu yüzden geniş seçimde uyarı gösterir.
 *
 * CANLI OLAN BUDUR ve Phase 1'de kademeleri DEĞİŞMEDİ: sürekli mesafeli sürüm
 * (`distanceScoreContinuous`, hemen aşağıda) yalnız v3 gölge profilinde
 * çalışır, kimin iş aldığını bu fazda değiştirmemesi için (ranker-rollout).
 */
export function distanceScore(
  // null da kabul eder: adres alanları ve partner ili DB'de nullable, çağıranın
  // `?? undefined` yazmak zorunda kalması sessiz hatalara davetiye.
  orderCity: string | null | undefined,
  mfgCity: string | null | undefined,
  coverage?: readonly string[] | null
): DistanceVerdict {
  if (!orderCity) return { score: 30, kind: "unknown" };
  if (mfgCity && orderCity === mfgCity) return { score: 100, kind: "same_il" };
  if (coverage?.includes(orderCity)) return { score: 85, kind: "coverage" };
  if (!mfgCity) return { score: 30, kind: "unknown" };
  const orderRegion = regionOf(orderCity);
  const mfgRegion = regionOf(mfgCity);
  if (orderRegion && mfgRegion && orderRegion === mfgRegion) {
    return { score: 60, kind: "same_region" };
  }
  return { score: 20, kind: "other" };
}

/**
 * Sürekli mesafe skorunun gerekçesi. Kademeli `DistanceKind` ile bilerek AYRI
 * bir tip: "coverage_pin" bir kademe değil, hesaplanan skorun altına
 * düşemeyeceği bir TABANDIR; "near"/"far" ise tek bir eğrinin iki yakası.
 */
export type ContinuousDistanceKind =
  | "same_il"
  | "coverage_pin"
  | "near"
  | "far"
  | "unknown";

export interface ContinuousDistanceVerdict {
  score: number;
  kind: ContinuousDistanceKind;
  /** Çapa mesafesi (harita birimi); illerden biri tanınmıyorsa null. */
  units: number | null;
}

/** Bu mesafeye kadar "yakın" (~300 km): ertesi gün teslim yarıçapı. */
export const DISTANCE_NEAR_UNITS = 200;
/**
 * ~300 km'deki (DISTANCE_NEAR_UNITS) skor. EĞRİNİN KALİBRASYON NOKTASI BUDUR.
 *
 * NEDEN 55 — yakınlık kısa mesafede BASKIN olmalı. Ağırlıklar mesafe 0.35,
 * yük 0.30 olduğuna göre iki atölye arasındaki kararı şu eşitlik verir:
 *
 *     0.35 × (mesafe farkı)  >  0.30 × (yük farkı)
 *
 * Siparişin kendi ilindeki atölye 100 alıyor; 300 km ötedeki 55 alırsa mesafe
 * farkı 45 → 15.75 puan. Bu, 50 puanlık bir yük farkını (15.0 puan) bile
 * yener: yarı dolu YEREL atölye, boştaki UZAK atölyeyi geçer. Eski kalibrasyon
 * (700 birimde tabana inen tek bir doğru) aynı mesafeye yalnız 22 puan
 * biçiyordu → 7.7 puan, ve 35 puanlık bir yük farkı (10.5) işi 300 km öteye
 * taşıyordu. Çalışma anındaki örneklemede 6 siparişin 4'ünde olan tam olarak
 * buydu; kargoyu platform ödediği için bu doğrudan para kaybıdır.
 *
 * Yakınlık mutlak DEĞİL: neredeyse dolu bir yerel atölye (9/10 → yük 10) hâlâ
 * boştaki uzak atölyeye kaybeder (38 < 49.6) — kapasite hâlâ konuşur.
 */
export const DISTANCE_NEAR_SCORE = 55;
/**
 * Skorun tabana oturduğu mesafe (~1050 km). Ötesini ayırmanın yönlendirmeye
 * katkısı yok: 1100 km ile 1400 km arasındaki fark kargoda da tek bir "en uzak
 * bölge" satırıdır.
 */
export const DISTANCE_FLOOR_UNITS = 700;
/** Uzaklık tabanı — kademeli sürümün "diğer" skoruyla aynı, kıyas bozulmasın. */
export const DISTANCE_FLOOR_SCORE = 20;
/** İl bilinmiyorsa nötr skor — kademeli sürümle aynı. */
export const DISTANCE_UNKNOWN_SCORE = 30;
/** Etki alanı pini: hesaplanan skor bunun ALTINA düşemez. */
export const COVERAGE_PIN_FLOOR = 85;

/**
 * Mesafe → skor eğrisi: İKİ DOĞRU PARÇASI, kırılma noktası ~300 km.
 *
 *   0 birim          → 100
 *   200 birim (~300 km) → 55   (ilk 300 km 45 puana mal olur)
 *   700 birim (~1050 km) → 20  (sonraki 750 km yalnız 35 puana)
 *
 * Kırılma kasıtlı: yakınlığın PARASAL karşılığı kısa mesafede yoğunlaşır
 * (aynı gün/ertesi gün kargo, hasarda geri dönüş, atölyeye uğrayabilme).
 * 900 km ile 1200 km arasındaki fark ise ne kargo tarifesinde ne teslim
 * süresinde ayrı bir satırdır — o aralıkta eğrinin dik olması yalnız gürültü
 * üretirdi.
 */
function continuousDecay(units: number): number {
  const capped = Math.min(Math.max(units, 0), DISTANCE_FLOOR_UNITS);
  if (capped <= DISTANCE_NEAR_UNITS) {
    const drop = (100 - DISTANCE_NEAR_SCORE) * (capped / DISTANCE_NEAR_UNITS);
    return Math.round(100 - drop);
  }
  const beyond =
    (capped - DISTANCE_NEAR_UNITS) / (DISTANCE_FLOOR_UNITS - DISTANCE_NEAR_UNITS);
  const drop = (DISTANCE_NEAR_SCORE - DISTANCE_FLOOR_SCORE) * beyond;
  return Math.round(DISTANCE_NEAR_SCORE - drop);
}

/** Kapsama listesi bu ili içeriyor mu? Serbest yazım toleranslı. */
function coverageCovers(
  coverage: readonly string[] | null | undefined,
  orderCity: string
): boolean {
  if (!coverage || coverage.length === 0) return false;
  const key = foldProvinceName(orderCity);
  if (!key) return false;
  return coverage.some((c) => foldProvinceName(c) === key);
}

/**
 * Sürekli mesafe skoru — v3 GÖLGE profilinin mesafe alt-skoru.
 *
 * NEDEN: kademeli sürümde mesafe üç kovaya iniyor ve iki komşu il farklı
 * bölgelere düşüyorsa (Kocaeli→Düzce, 103 km) ülkenin öbür ucuyla
 * (Edirne→Hakkari, 1423 km) AYNI 20 puanı alıyor. Kargoyu platform ödediği
 * için bu, parayı doğrudan yanlış yere akıtan bir körlüktür.
 *
 * Kurallar (sıra kuralın kendisidir):
 *  1. sipariş ili bilinmiyor        → 30 (pin bile kurtarmaz: nereye
 *     gönderileceği bilinmeden "bu il benim" demenin anlamı yok)
 *  2. atölyenin ili = sipariş ili   → 100
 *  3. çapalar biliniyor             → `continuousDecay` eğrisi (100 → 55 → 20)
 *  4. çapa yoksa ama il pinliyse    → 85
 *  5. aksi                          → 30
 * Sonra: il pinliyse skor 85'in altına düşemez (coverage-model kararı —
 * hesaplanan kapsama Phase 5'te gelecek, bugünkü elle seçilmiş iller PİN).
 *
 * Pin'in TABAN olması (kademeli sürümdeki gibi sabit 85 değil) kasıtlı: 500 km
 * öteden "bu ile de bakarım" demiş bir atölye, siparişin kendi ilindeki
 * atölyeyi geçemez; ama yakındaki pinli atölye 85'e sıkışıp hak ettiği 91'i
 * kaybetmez de.
 */
export function distanceScoreContinuous(
  orderCity: string | null | undefined,
  mfgCity: string | null | undefined,
  coverage?: readonly string[] | null
): ContinuousDistanceVerdict {
  if (!orderCity) {
    return { score: DISTANCE_UNKNOWN_SCORE, kind: "unknown", units: null };
  }
  if (sameProvinceName(orderCity, mfgCity)) {
    return { score: 100, kind: "same_il", units: 0 };
  }

  const pinned = coverageCovers(coverage, orderCity);
  const units = provinceDistanceUnits(orderCity, mfgCity);

  if (units === null) {
    // Adresi olmayan ama admin'in etki alanı tanımladığı atölye geçerli bir
    // durumdur ve o iller için tam olarak pin tabanını hak eder.
    if (pinned) {
      return { score: COVERAGE_PIN_FLOOR, kind: "coverage_pin", units: null };
    }
    return { score: DISTANCE_UNKNOWN_SCORE, kind: "unknown", units: null };
  }

  const decayed = continuousDecay(units);
  if (pinned && decayed < COVERAGE_PIN_FLOOR) {
    return { score: COVERAGE_PIN_FLOOR, kind: "coverage_pin", units };
  }
  return {
    score: decayed,
    kind: units <= DISTANCE_NEAR_UNITS ? "near" : "far",
    units,
  };
}

/**
 * Doluluk → 0-100. Boş atölye 100, kapasitesi dolan 0.
 *
 * Dışa açık: kalibrasyon testleri "yarı dolu yerel atölye, boştaki uzak
 * atölyeyi geçer mi?" sorusunu sıralayıcının KENDİ yük fonksiyonuyla kurmalı;
 * testte elle yazılmış bir yük skoru, formül kaydığında sessizce yalan söyler.
 */
export function loadScore(currentLoad: number, max: number): number {
  if (max <= 0) return 0;
  if (currentLoad >= max) return 0;
  const ratio = currentLoad / max;
  return Math.max(0, Math.round((1 - ratio) * 100));
}

/**
 * Alt skorların ağırlıklı toplamı — sıralamanın TEK formülü.
 *
 * Ayrı bir fonksiyon, çünkü mesafe eğrisinin kalibrasyonu ancak "bu fark, şu
 * yük farkını yener mi?" diye sınanabilir; testin formülü elle kopyalaması
 * hâlinde test, ranker'ın ne yaptığını değil kendi kopyasını doğrular.
 */
export function weightedTotal(
  scores: CandidateScore["scores"],
  weights: ScoringWeights
): number {
  return (
    scores.distance * weights.distance +
    scores.load * weights.load +
    scores.reliability * weights.reliability +
    scores.onTimeDelivery * weights.onTimeDelivery +
    scores.compliance * weights.compliance +
    scores.batchAffinity * weights.batchAffinity
  );
}

/**
 * Units of the same product already on a shop's bench, mapped to 0-100.
 *
 * Saturating rather than linear: the operational win (one plate setup, one
 * resin batch, one QC pass) is mostly realised as soon as the shop is already
 * making the item at all, and a shop holding 400 units is not four times better
 * a fit than one holding 100 — it is closer to being full.
 */
const BATCH_SATURATION_UNITS = 100;
function batchAffinityScore(sameProductUnits: number): number {
  if (sameProductUnits <= 0) return 0;
  return Math.min(
    100,
    Math.round(50 + (50 * Math.min(sameProductUnits, BATCH_SATURATION_UNITS)) / BATCH_SATURATION_UNITS)
  );
}

/**
 * For each active manufacturer, how many units of `productIds` they currently
 * hold. Counts both order shapes: a single-product order carries its product on
 * the orders row, a cart sub-order carries them on order_items. Same bench
 * definition as `currentLoad`, so the two signals can never disagree about what
 * "in progress" means.
 */
async function sameProductUnitsByManufacturer(
  productIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (productIds.length === 0) return out;

  const onBench = manufacturerBenchFilter();

  const scalar = await db
    .select({
      manufacturerId: orders.manufacturerId,
      units: sql<number>`coalesce(sum(${orders.quantity}), 0)::int`,
    })
    .from(orders)
    .where(and(onBench, inArray(orders.productId, productIds)))
    .groupBy(orders.manufacturerId);

  const perLine = await db
    .select({
      manufacturerId: orders.manufacturerId,
      units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(onBench, inArray(orderItems.productId, productIds)))
    .groupBy(orders.manufacturerId);

  for (const row of [...scalar, ...perLine]) {
    if (!row.manufacturerId) continue;
    out.set(row.manufacturerId, (out.get(row.manufacturerId) ?? 0) + row.units);
  }
  return out;
}

/** The product(s) this order is asking to have produced. */
async function productIdsForOrder(
  orderId: string,
  scalarProductId: string | null
): Promise<string[]> {
  const lines = await db
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const ids = new Set<string>();
  if (scalarProductId) ids.add(scalarProductId);
  for (const l of lines) if (l.productId) ids.add(l.productId);
  return [...ids];
}

/**
 * On-time-delivery score (Q7 v2). Looks at the last 20 completed orders
 * for this manufacturer and measures actual assign→print and print→ship
 * windows against targets. Returns 0-100 where 100 = consistently
 * shipping within target windows. Defaults to 70 (same neutral floor as
 * reliability) when there aren't enough completed orders.
 *
 * v1 ignores this signal entirely (weight = 0); v2 gives it material
 * weight via getAssignmentWeights.
 */
async function onTimeDeliveryScoreFor(manufacturerId: string): Promise<number> {
  const rows = await db
    .select({
      assignedAt: orders.assignedToManufacturerAt,
      printedAt: orders.manufacturerPrintedAt,
      shippedAt: orders.shippedAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.manufacturerId, manufacturerId),
        isNotNull(orders.shippedAt),
        isNotNull(orders.assignedToManufacturerAt),
        isNotNull(orders.manufacturerPrintedAt)
      )
    )
    .orderBy(desc(orders.shippedAt))
    .limit(OTD_LOOKBACK);

  if (rows.length < 3) return 70; // not enough signal, neutral

  let totalPctSum = 0;
  for (const r of rows) {
    if (!r.assignedAt || !r.printedAt || !r.shippedAt) continue;
    const printDelta = r.printedAt.getTime() - r.assignedAt.getTime();
    const shipDelta = r.shippedAt.getTime() - r.printedAt.getTime();
    // Each segment scored linearly: 100 if at/under target, 0 at 2× target.
    const printScore = Math.max(
      0,
      Math.min(100, 100 * (2 - printDelta / OTD_PRINT_TARGET_MS))
    );
    const shipScore = Math.max(
      0,
      Math.min(100, 100 * (2 - shipDelta / OTD_SHIP_TARGET_MS))
    );
    totalPctSum += (printScore + shipScore) / 2;
  }
  return Math.round(totalPctSum / rows.length);
}

/** Platform's stated assign→print target, expressed in days (not ms). */
const OTD_PRINT_TARGET_DAYS = OTD_PRINT_TARGET_MS / (24 * 60 * 60 * 1000);

/**
 * Average assign→print span (in days) over a manufacturer's last N
 * completed orders. Same lookback window and "completed" definition as
 * `onTimeDeliveryScoreFor` (assigned + printed + shipped all set), so the
 * two signals can never disagree about which orders count as history.
 *
 * Exported for the workshop admin UI: it feeds `assessSessionRisk` (see
 * config/workshop.ts) to warn whether a chosen manufacturer can realistically
 * print a batch before a session's delivery deadline. That function stays
 * pure and DB-free, so the query lives here instead, next to the other
 * "last N orders" OTD logic it shares a convention with.
 *
 * Falls back to the platform's own stated target (OTD_PRINT_TARGET_MS, in
 * days) when the manufacturer has no usable print history yet — a brand
 * new partner is assumed neither instantly fast nor permanently slow.
 */
export async function averagePrintDaysFor(manufacturerId: string): Promise<number> {
  const rows = await db
    .select({
      assignedAt: orders.assignedToManufacturerAt,
      printedAt: orders.manufacturerPrintedAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.manufacturerId, manufacturerId),
        isNotNull(orders.shippedAt),
        isNotNull(orders.assignedToManufacturerAt),
        isNotNull(orders.manufacturerPrintedAt)
      )
    )
    .orderBy(desc(orders.shippedAt))
    .limit(OTD_LOOKBACK);

  if (rows.length < 3) return OTD_PRINT_TARGET_DAYS; // not enough signal, neutral

  const DAY_MS = 24 * 60 * 60 * 1000;
  let totalDays = 0;
  let counted = 0;
  for (const r of rows) {
    if (!r.assignedAt || !r.printedAt) continue;
    totalDays += (r.printedAt.getTime() - r.assignedAt.getTime()) / DAY_MS;
    counted++;
  }
  if (counted === 0) return OTD_PRINT_TARGET_DAYS;
  return Math.round((totalDays / counted) * 10) / 10;
}

/**
 * Action strings as written by the manufacturer routes — keep in sync with
 * `manufacturerActions.action` inserts (accept / start_printing /
 * finish_printing / submit_qc / send_to_painter / ship / decline /
 * cancel_after_accept / admin_revoked).
 */
const GOOD_ACTIONS = new Set([
  "accept",
  "start_printing",
  "finish_printing",
  "submit_qc",
  "send_to_painter",
  "ship",
]);
/**
 * `admin_revoked` is deliberately NOT counted: an admin takes an order back for
 * many reasons (wrong material, customer change, silence), and the strike
 * mechanism is the explicit, opt-in penalty for that.
 */
const BAD_ACTIONS = new Set(["decline", "cancel_after_accept"]);

async function reliabilityScoreFor(manufacturerId: string): Promise<number> {
  // Look at the last 20 manufacturer actions; reward "shipped" / "printed" outcomes,
  // penalize "rejected" / "cancelled". Default to 70 for new manufacturers.
  const rows = await db
    .select({ action: manufacturerActions.action })
    .from(manufacturerActions)
    .where(eq(manufacturerActions.manufacturerId, manufacturerId))
    .orderBy(sql`${manufacturerActions.createdAt} DESC`)
    .limit(20);

  if (rows.length === 0) return 70;

  let good = 0;
  let bad = 0;
  for (const r of rows) {
    // These MUST match the strings the routes actually insert. The previous
    // list ("shipped"/"printed"/"accepted") matched nothing that is ever
    // written, so the good counter stayed 0 and a single decline dropped a
    // manufacturer from 70 to 0.
    if (GOOD_ACTIONS.has(r.action)) {
      good++;
    } else if (BAD_ACTIONS.has(r.action)) {
      // N12: a manufacturer-initiated decline costs reliability score; the
      // score feeds back into ranking so chronic decliners drift down the
      // candidate list and eventually become ineligible by score weight.
      bad++;
    }
  }
  const total = good + bad;
  if (total === 0) return 70;
  return Math.round((good / total) * 100);
}

/** Geçmiş okunamadığında yazılan nötr QC sayacı: ne ödül ne ceza. */
const NEUTRAL_QC = { jobs: 0, rejectedJobs: 0 } as const;

/**
 * Bir atölyenin son işlerinden QC REDDİ sayacı (Faz 5 · qcRejections sinyali).
 *
 * ÖLÇÜ `qcRejectionCount`, `qcRound` DEĞİL: ikisi de "1'den büyük" olabilir ama
 * `qcRound` başka sebeplerle de artıyor — atama geri alındığında
 * (manufacturer-revoke.ts) ve müşteriye yeni bir model sürümü yüklendiğinde
 * (order-model.ts). O turları atölyeye ceza olarak yazmak, hiç hata yapmamış
 * bir atölyeyi admin'in kendi işlemleri yüzünden cezalandırmak olurdu.
 * `qcRejectionCount` yalnız QC reddinde artan ömür boyu sayaçtır.
 *
 * PENCERE, OTD ile AYNI (son `OTD_LOOKBACK` kargolanmış iş): iki geçmiş sinyali
 * "hangi işler sayılır" konusunda asla ayrışamasın.
 *
 * İADE EDİLMİŞ SİPARİŞ SAYILMAZ: iade kimseyi cezalandırmaz (fazın bağlayıcı
 * kuralı). Boyacı tarafındaki geçmiş okumasının (painter-assignment.ts
 * `historyFor`) aynı filtresi.
 *
 * HATA POLİTİKASI: bu sinyal yalnız skoru GÖLGELER, kapıyı değil — okunamazsa
 * nötre düşer ve loglanır. Sıralama tek bir yavaş sorgu yüzünden durmaz.
 */
async function qcRejectionHistoryFor(
  manufacturerId: string
): Promise<{ jobs: number; rejectedJobs: number }> {
  try {
    const rows = await db
      .select({ rejections: orders.qcRejectionCount })
      .from(orders)
      .where(
        and(
          eq(orders.manufacturerId, manufacturerId),
          isNotNull(orders.shippedAt),
          ne(orders.paymentStatus, REFUNDED_PAYMENT_STATUS)
        )
      )
      .orderBy(desc(orders.shippedAt))
      .limit(OTD_LOOKBACK);
    let rejectedJobs = 0;
    for (const r of rows) if ((r.rejections ?? 0) > 0) rejectedJobs++;
    return { jobs: rows.length, rejectedJobs };
  } catch (e) {
    console.error("QC geçmişi okunamadı (nötr puanla devam)", manufacturerId, e);
    return { ...NEUTRAL_QC };
  }
}


/**
 * Bu DENEMEYE özgü dışlanan atölyenin uygunsuzluk gerekçesi.
 *
 * Sabit olarak duruyor ki çağıran (order-confirm) "hiç aday çıkmadı"yı
 * anlatırken sebebi metin karşılaştırmadan ayırt edebilsin: "uygun üreticilerin
 * tamamı bu deneme için dışlandı" ile "hiçbiri zaten uygun değildi" admin için
 * iki ayrı operasyonel gerçektir.
 */
export const EXCLUDED_THIS_ATTEMPT_REASON =
  "Bu deneme için dışlandı (iş az önce bu atölyeden geri alındı)";

/** Sıralamayı etkileyen, siparişin kendi satırında YAZMAYAN girdiler. */
export interface RankOptions {
  /**
   * Bu denemede sıralamaya HİÇ girmemesi gereken atölyeler (geri alınan atölye).
   *
   * Siparişin kalıcı `declinedManufacturerIds` listesinden ayrıdır: geri alma
   * "kara listeye ekle" işaretlenmeden yapıldığında bile sipariş az önce
   * koparıldığı atölyeye anında geri dönmemelidir.
   *
   * SIRALAMANIN İÇİNDE uygulanır, sonrasında değil: dışlama sıralamadan sonra
   * süzülürse kaydedilen "kazanan" seçilemeyecek bir atölye olur ve sipariş
   * sayfası o ayrışmayı "iş elle atanmış olabilir" diye —yani hiç olmamış bir
   * insan kararı olarak— açıklar.
   */
  excludeManufacturerIds?: readonly string[];
  /**
   * Faz 5 GÖLGE geçişi de çalışsın mı (yalnız `rankManufacturersDetailed`
   * okur). Gölge hiçbir işi yerleştirmez; sonucu kaydedilir ve ekranda canlının
   * yanına konur.
   */
  phase5Shadow?: boolean;
  /**
   * K1'in HESAPLANAN kapsama planı — takılırsa gölge, elle yazılmış listenin
   * yerine bunu kullanır (coverage-model = B). Verilmezse gölge bugünkü listeyi
   * okur ve kaydına "typed" damgalar, yani hesaplanan lane'in henüz bağlanmadığını
   * SÖYLER. Buraya ikinci bir kapsama hesabı YAZILMAZ; tek sahibi K1'in modülü.
   */
  coverageOf?: CoverageResolver;
  /**
   * ADET AĞIRLIKLI yük — DIŞARIDAN verilir, burada HESAPLANMAZ.
   *
   * Ölçünün tek sahibi `services/manufacturer-capacity.ts`
   * (`loadManufacturerCapacities`). Buraya ikinci bir yükleyici yazmak, Faz
   * 4'te boyacı tarafında ölçülen kusurun aynısını doğururdu: ekran bir ölçüyle
   * kapatırken uç başka bir ölçüyle kabul eder.
   *
   * IMPORT EDİLEMEZ, ENJEKTE EDİLİR: o modül `ACTIVE_MFG_STATUSES`i BURADAN
   * alıyor, yani buradan onu import etmek döngü kurardı. Şekil yapısaldır
   * (`{ loadUnits }`), böylece tip düzeyinde bile bağ kurulmaz.
   *
   * Verilmezse ağırlıklı yük "ölçülemedi" sayılır ve sıralayıcı ham iş sayısına
   * düşer (bkz. ShadowSignalDetail · loadUnitsMeasured).
   */
  capacities?: ReadonlyMap<string, { loadUnits: number }>;
  /**
   * "Bu iş, bu atölyenin beyan etmediği bir BÜYÜK FORMAT işi mi?"
   *
   * Kural burada YAZILMAZ: tek sahibi `services/manufacturer-assign.ts` ·
   * `largeFormatPlacementBlocked` ve o kural, etiket yazamayan bugünkü
   * yüzeyler yüzünden "değerlendirilmemiş atölye" istisnasını da taşıyor.
   * Buraya çıplak bir `capabilityMatch` yazmak o istisnayı düşürür ve hiç
   * etiket beyan etmemiş (bugün: hepsi) atölyelerin tamamını eler — yani
   * gölge, karşılaştırılacak veri yerine gürültü üretirdi.
   *
   * IMPORT EDİLEMEZ, ENJEKTE EDİLİR: o modül `manufacturer-capacity.ts`i, o da
   * BURAYI import ediyor — import zinciri döngü kurardı.
   *
   * Verilmezse sinyal KONUŞMAZ (bugünkü davranış: sıralayıcı büyük formata hiç
   * bakmıyordu). Sessizce elemek yerine susmak doğrudur: takılmamış bir fiş,
   * aday havuzunu daraltmak için gerekçe değildir.
   */
  largeFormatBlocked?: (
    figurineSize: string | null,
    capabilities: string[] | null
  ) => boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * SAF SKORLAYICI
 *
 * Boyacı ikizindeki (`painter-assignment.ts` · `scorePainters`) düzenin
 * aynısı: saf yarı `@/lib/db`ye DOKUNMAZ, yükleyici yarısı veriyi toplayıp saf
 * yarıyı çağırır.
 *
 * NEDEN AYRILDI: Faz 5'in bağlayıcı sözü "yeni sinyaller canlı skoru
 * değiştirmesin". Bu, ancak SAYISAL olarak sınanabilir bir iddiadır — aynı
 * girdiyi hem sinyaller kapalı hem açık geçirip çıktının bit-bit aynı kaldığını
 * görmek gerekir. Skor matematiği veritabanı yükleyicisinin içinde kaldığı
 * sürece o test yazılamazdı (scripts/test-scoring-v2.ts artık yazıyor).
 * ────────────────────────────────────────────────────────────────────────── */

/** Skorlayıcının beklediği ham atölye satırı — DB tiplerine bağlı DEĞİL. */
export interface ManufacturerScoringRow {
  manufacturerId: string;
  companyName: string;
  /** `address.il`; yoksa null. */
  il: string | null;
  /** `address.ilce`; yoksa null. */
  ilce: string | null;
  phone: string | null;
  email: string;
  iban: string | null;
  capabilities: string[] | null;
  coverageProvinces: string[] | null;
  requiresManualTaxReview: boolean;
  acceptingOrders: boolean;
  /** Boyamayı kendi atölyesinde yapıyor mu (Faz 5 · paintInHouse). */
  paintsInHouse: boolean;
  /** `manufacturers.strikeCount` (Faz 5 · strikes). */
  strikeCount: number;
  maxConcurrentOrders: number;
  /** HAM iş sayısı — bugünkü CANLI kapı ve yük skoru. */
  currentLoad: number;
  /** ADET ağırlıklı yük birimi — yalnız weightedLoad sinyali açıkken konuşur. */
  loadUnits: number;
  /** Ağırlıklı yük gerçekten ölçülebildi mi (kapasite haritası geldi mi). */
  loadUnitsMeasured: boolean;
  /** Eylem geçmişinden gelen güvenilirlik (0-100), cezalar UYGULANMADAN önce. */
  reliability: number;
  /** Zamanında teslim (0-100). */
  onTimeDelivery: number;
  /** QC penceresinde sayılan iş sayısı. */
  qcJobs: number;
  /** Bunlardan kaçı en az bir kez QC'den geri döndü. */
  qcRejectedJobs: number;
  /** Tezgâhındaki, bu siparişin ürün(ler)ine ait adet. */
  sameProductUnits: number;
}

/** Skorlayıcının gördüğü sipariş bağlamı — DB tiplerine bağlı DEĞİL. */
export interface ManufacturerScoringOrder {
  /** Teslimat ili. */
  city: string | null | undefined;
  material: string;
  /** Siparişte boyama kalemi var mı (Faz 5 · paintInHouse). */
  needsPainting: boolean;
  /** Faz 5 · largeFormat sinyalinin girdileri. */
  style: string | null;
  figurineSize: string | null;
  declinedManufacturerIds?: readonly string[];
  excludeManufacturerIds?: readonly string[];
}

export interface ManufacturerScoringInput {
  order: ManufacturerScoringOrder;
  manufacturers: readonly ManufacturerScoringRow[];
  weights: ScoringWeights;
  distanceModel: DistanceModel;
  /**
   * Bu geçişte YÜRÜRLÜKTEKİ Faz 5 sinyalleri. Verilmezse HİÇBİRİ — yani
   * bugünkü canlı davranış. Varsayılanın "boş küme" olması bir tercih değil,
   * fazın kararıdır: çağıran unutursa canlı skor oynamaz.
   */
  signals?: Phase5SignalSet;
  /** K1'in hesaplanan kapsama planı; yoksa elle yazılmış liste kullanılır. */
  coverageOf?: CoverageResolver;
  /** Büyük format kuralı (K2'nin saf fonksiyonu); yoksa sinyal konuşmaz. */
  largeFormatBlocked?: (
    figurineSize: string | null,
    capabilities: string[] | null
  ) => boolean;
}

/**
 * SAF, KARARLI ve açıklanabilir sıralama: aynı girdi → aynı çıktı, IO yok.
 *
 * Uygunsuzluk SIRASI kuralın kendisidir, çünkü admin'in gördüğü gerekçe bu
 * sıradan çıkar: bu denemeye özgü dışlama → kalıcı ret → malzeme → büyük format
 * → "sipariş almıyor" → kapasite.
 */
export function scoreManufacturers(
  input: ManufacturerScoringInput
): CandidateScore[] {
  const { weights, distanceModel } = input;
  const signals = input.signals ?? NO_SIGNALS;
  const signalNames = activeSignals(signals);
  const explain = anySignalOn(signals);
  const declinedIds = new Set(input.order.declinedManufacturerIds ?? []);
  const excludedIds = new Set(
    (input.order.excludeManufacturerIds ?? []).filter((id) => !!id)
  );
  const orderCity = input.order.city;
  const orderMaterial = input.order.material;

  // Sipariş NE İSTİYOR: kural burada yeniden yazılmaz, `orderRequirements`
  // çağrılır (services/capability.ts). O fonksiyon büyük formatı MİLİMETREYLE
  // belirler, kademe ADIYLA değil — katalog yeniden adlandırıldığında sessizce
  // bozulmayan tek ölçü budur.
  const required = signals.largeFormat
    ? orderRequirements({
        style: input.order.style ?? undefined,
        figurineSize: input.order.figurineSize ?? undefined,
      })
    : [];
  const largeFormatRequired = required.includes("large_format");

  const candidates = input.manufacturers.map((m): CandidateScore => {
    const city = m.il;
    const district = m.ilce;
    const currentLoad = m.currentLoad;
    const max = m.maxConcurrentOrders;

    // YÜK ÖLÇÜSÜ: sinyal açıkken ağırlıklı birim, kapalıyken bugünkü ham sayı.
    // Ölçü hem SKORU hem KAPIYI birlikte belirler — ikisini ayırmak, ekranın
    // ucun uygulamadığı bir sınırla atölye kapatması demekti (Faz 4'te ölçülen
    // kusur, painter-capacity.ts · KARAR 2).
    const loadValue = signals.weightedLoad ? m.loadUnits : currentLoad;

    // Ağırlığı 0 olan sinyal, profilin çıktısında da nötr kalır: v1'in
    // değerlendirme anlık görüntüsü ortak yükleme yüzünden değişmesin.
    const onTimeDelivery = weights.onTimeDelivery > 0 ? m.onTimeDelivery : 70;
    const sameProductUnits = weights.batchAffinity > 0 ? m.sameProductUnits : 0;

    // Etki alanı: HESAPLANAN plan takılıysa o, değilse admin'in verdiği iller +
    // atölyenin kendi ili. İkinci bir kapsama hesabı buraya YAZILMAZ.
    const coverageSource: CoverageSource =
      signals.computedCoverage && input.coverageOf ? "computed" : "typed";
    const coverage =
      coverageSource === "computed" && input.coverageOf
        ? [
            ...input.coverageOf({
              manufacturerId: m.manufacturerId,
              il: city,
              coverageProvinces: m.coverageProvinces,
            }),
          ]
        : effectiveCoverage(m.coverageProvinces, city);

    const continuous =
      distanceModel === "continuous"
        ? distanceScoreContinuous(orderCity, city, coverage)
        : null;
    const distance: {
      score: number;
      kind: DistanceKind | ContinuousDistanceKind;
    } = continuous ?? distanceScore(orderCity, city, coverage);

    // Güvenilirlik: QC reddi ve ceza puanı bu kalemin İÇİNDEN düşer (sahibin
    // cümlesi "güvenilirlik düşsün"). Sinyaller kapalıyken taban aynen geçer.
    const penalties = applyReliabilityPenalties(
      m.reliability,
      { jobs: m.qcJobs, rejectedJobs: m.qcRejectedJobs, strikeCount: m.strikeCount },
      signals
    );

    const scores = {
      distance: distance.score,
      load: loadScore(loadValue, max),
      reliability: penalties.score,
      onTimeDelivery,
      compliance:
        (m.requiresManualTaxReview ? 60 : 100) +
        (m.iban ? 0 : -10) +
        (m.acceptingOrders ? 0 : -20),
      batchAffinity: batchAffinityScore(sameProductUnits),
    };
    scores.compliance = Math.max(0, Math.min(100, scores.compliance));

    // Kendi boyayan atölyenin artısı BONUSTUR, ağırlık değil: kapalıyken tam
    // olarak 0'dır ve formülün şekline hiç dokunmaz (config/scoring.ts).
    const bonus = paintInHouseBonus(signals, {
      orderNeedsPainting: input.order.needsPainting,
      paintsInHouse: m.paintsInHouse,
    });
    const totalScore = weightedTotal(scores, weights) + bonus;

    // Beyanın yeterli olup olmadığına K2'nin kuralı karar verir; fiş takılı
    // değilse sinyal susar (aday elenmez), çünkü eksik bir fiş bir gerekçe
    // değildir.
    const largeFormatOk = !(
      largeFormatRequired &&
      (input.largeFormatBlocked?.(input.order.figurineSize, m.capabilities) ?? false)
    );

    let eligible = true;
    let ineligibleReason: string | undefined;
    // SIRA KURALIN KENDİSİDİR: en üstte bu denemeye özgü dışlama durur.
    // Kalıcı "reddetti" etiketinden önce gelir, çünkü iş az önce bu atölyeden
    // GERİ ALINDIYSA admin'in gördüğü gerekçe o olmalıdır — daha eski bir
    // reddin üstünü örtmez, yalnızca bugünkü sebebi öne alır.
    //
    // Material hard-filter: an order routes only to manufacturers that declare
    // they print its material. Legacy manufacturers with no declared material
    // tags are treated as able to print any material (manufacturerSupportsMaterial).
    if (excludedIds.has(m.manufacturerId)) {
      eligible = false;
      ineligibleReason = EXCLUDED_THIS_ATTEMPT_REASON;
    } else if (declinedIds.has(m.manufacturerId)) {
      eligible = false;
      ineligibleReason = "Bu siparişi daha önce reddetti / iptal etti";
    } else if (!manufacturerSupportsMaterial(m.capabilities, orderMaterial)) {
      eligible = false;
      ineligibleReason = `Malzeme uyumsuz (${MATERIAL_LABEL_TR[orderMaterial] ?? orderMaterial})`;
      // Büyük format MALZEMEDEN SONRA sorulur: ikisi de "bu atölye bunu basabilir
      // mi" kapısıdır ve malzeme uyuşmazlığı daha temel bir cevaptır.
    } else if (!largeFormatOk) {
      eligible = false;
      ineligibleReason = "Büyük format yeteneği beyan edilmemiş";
    } else if (!m.acceptingOrders) {
      eligible = false;
      ineligibleReason = "Sipariş almıyor";
    } else if (loadValue >= max) {
      eligible = false;
      ineligibleReason = "Kapasite dolu";
    }
    // IBAN is required for payout but isn't a hard eligibility gate — pre-existing
    // manufacturers may not have filled it in yet, and blocking them entirely freezes
    // assignment. Surface the missing-IBAN warning via a reason chip instead and let
    // the admin decide. (Compliance score already penalizes missing IBAN.)

    const reasons: string[] = [];
    if (distance.kind === "same_il") reasons.push("Aynı şehir");
    else if (distance.kind === "coverage" || distance.kind === "coverage_pin")
      reasons.push("Etki alanı");
    else if (distance.kind === "same_region") reasons.push("Aynı bölge");
    // Sürekli modelde "aynı bölge" diye bir kademe yok; mesafeyi km olarak
    // yazmak admin'e kademeden daha çok şey söyler.
    else if (continuous?.kind === "near" && continuous.units !== null)
      reasons.push(`Yakın (~${Math.round(continuous.units * MAP_UNIT_KM)} km)`);
    if (scores.load >= 80) reasons.push("Düşük yük");
    else if (scores.load <= 30 && eligible) reasons.push("Yüksek yük");
    if (scores.reliability >= 85) reasons.push("Güvenilir");
    if (weights.onTimeDelivery > 0 && scores.onTimeDelivery >= 85)
      reasons.push("Hızlı teslimat");
    if (sameProductUnits > 0)
      reasons.push(`Aynı ürünü üretiyor (${sameProductUnits} adet)`);
    if (m.requiresManualTaxReview) reasons.push("Vergi incelemede");
    if (!m.iban) reasons.push("⚠ IBAN eksik");
    // Faz 5 gerekçeleri: hepsi ölçülen bir farktan doğar, tahminden değil.
    // Sinyal kapalıyken karşılık gelen değer 0'dır, yani rozet de çıkmaz.
    if (bonus > 0) reasons.push("Kendi boyuyor");
    if (penalties.qcPenalty > 0) reasons.push(`QC reddi −${penalties.qcPenalty}`);
    if (penalties.strikePenalty > 0)
      reasons.push(`Ceza puanı −${penalties.strikePenalty}`);
    if (signals.weightedLoad) reasons.push(`Ağırlıklı yük ${m.loadUnits}/${max} birim`);

    return {
      manufacturerId: m.manufacturerId,
      companyName: m.companyName,
      city,
      district,
      phone: m.phone,
      email: m.email,
      iban: m.iban,
      currentLoad,
      maxConcurrentOrders: max,
      acceptingOrders: m.acceptingOrders,
      scores,
      sameProductUnits,
      totalScore: Math.round(totalScore),
      reasons,
      eligible,
      ineligibleReason,
      // Açıklama alanı YALNIZ sinyaller açıkken eklenir: kapalıyken aday nesnesi
      // bugünküyle alan alan aynı kalsın (testin derin eşitlik iddiası budur).
      ...(explain
        ? {
            shadow: {
              signals: signalNames,
              loadUnits: m.loadUnits,
              loadUnitsMeasured: m.loadUnitsMeasured,
              bonus,
              qcPenalty: penalties.qcPenalty,
              strikePenalty: penalties.strikePenalty,
              coverageSource,
              largeFormatRequired,
              largeFormatOk,
            } satisfies ShadowSignalDetail,
          }
        : {}),
    };
  });

  // Sort eligible first (by score desc), ineligible at bottom.
  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.totalScore - a.totalScore;
  });
  return candidates;
}

/**
 * Rank candidates for an order using either v1 (legacy) or v2 (Q7
 * rollout). Profile defaults to v1 so existing callers stay on the
 * authoritative algorithm during shadow phase; Q7 dual-write code calls
 * with `"v2"` explicitly to capture the parallel evaluation.
 */
export async function rankManufacturersForOrder(
  orderId: string,
  profile: ScoringProfile = "v1",
  opts?: RankOptions
): Promise<CandidateScore[]> {
  const byProfile = await rankManufacturersForProfiles(orderId, [profile], opts);
  return byProfile.get(profile) ?? [];
}

/**
 * AYNI siparişi birden çok profile göre sıralar — veriyi BİR KEZ okuyarak.
 *
 * NEDEN: her atamada artık üç sıralama karşılaştırılıyor (canlı + ağırlık
 * gölgesi + mesafe gölgesi) ve tarama ekranı bunu tek istekte onlarca siparişe
 * uyguluyor. Profil başına ayrı `rankManufacturersForOrder` çağrısı, aynı
 * satırları üç kez okumak demekti: en pahalısı atölye başına geçmiş sorgusu
 * (güvenilirlik + gerekirse zamanında teslim), yani 3×N sorgu.
 *
 * MALİYET (sorgu sayısı, N = aktif atölye sayısı):
 *   1 sipariş + 1 atölye listesi + 1 yük toplaması
 *   + (parti ağırlığı > 0 ise) 1 sipariş kalemi + 2 parti toplaması
 *   + N güvenilirlik  + (v2 gibi OTD ağırlığı > 0 bir profil varsa) N OTD
 * ve bu toplam KARŞILAŞTIRILAN PROFİL SAYISINDAN BAĞIMSIZDIR. Üç profil için
 * eskiden ~3×(6+N) sorgu vardı, şimdi ~6+N. Atölye başına sorgular paralel
 * çalışır; 25 siparişlik bir tarama tek HTTP isteği içinde 25×(6+N) sorgu
 * demektir (N=10 → ~400 indeksli sorgu), profil sayısı arttıkça büyümez.
 *
 * Siparişler ARASINDA önbellek YOK ve olmamalı: tarama uygularken her atama
 * bir sonraki siparişin yük tablosunu değiştirir; bayat bir yük tablosu
 * kapasitesi dolmuş atölyeye iş yazdırırdı.
 *
 * Canlı sıralama BİREBİR aynı kalır: ortak yükleme yalnız I/O'yu paylaşır,
 * skorlar profil başına ayrı ayrı ve eski sırayla hesaplanır — ağırlığı 0 olan
 * sinyaller (v1'de OTD, parti) profilin kendi sonucunda yine nötr yazılır.
 */
export async function rankManufacturersForProfiles(
  orderId: string,
  profiles: readonly ScoringProfile[],
  opts?: RankOptions
): Promise<Map<ScoringProfile, CandidateScore[]>> {
  return (await rankManufacturersDetailed(orderId, profiles, opts)).byProfile;
}

/** `rankManufacturersDetailed`in çıktısı: canlı profiller + Faz 5 gölgesi. */
export interface RankedProfiles {
  /** İstenen her profilin kendi sıralaması (bugünkü davranış). */
  byProfile: Map<ScoringProfile, CandidateScore[]>;
  /**
   * Faz 5 gölge sıralaması; istenmediyse null.
   *
   * HİÇBİR İŞİ YERLEŞTİRMEZ. Çağıran bunu yalnız kaydeder ve ekranda canlının
   * yanına koyar (ranker-rollout = B).
   */
  phase5: CandidateScore[] | null;
  /** Gölgede yürürlükte olan sinyaller — kayda ve ekrana damgalanır. */
  phase5Signals: Phase5SignalSet;
}

/**
 * Sıralamanın TAM hâli: istenen profiller + (istenirse) Faz 5 gölgesi, hepsi
 * TEK bir veri yüklemesinden.
 *
 * `rankManufacturersForProfiles` bunun ince bir sarmalayıcısıdır; bugünkü
 * çağıranların hiçbiri değişmez.
 */
export async function rankManufacturersDetailed(
  orderId: string,
  profiles: readonly ScoringProfile[],
  opts?: RankOptions
): Promise<RankedProfiles> {
  const wanted = [...new Set(profiles)];
  const byProfile = new Map<ScoringProfile, CandidateScore[]>();

  // CANLI sinyaller: varsayılanda BOŞ küme, yani bugünkü skor. Bir sinyalin
  // canlıya geçmesi ancak kendi *_LIVE anahtarının açıkça açılmasıyla olur
  // (config/scoring.ts) — ve o, partner gelirini oynatan bilinçli bir karardır.
  const liveSignals = signalsForProfile("live");
  // GÖLGE sinyalleri yalnız gölge geçişi istendiğinde okunur; canlı sıralamaya
  // hiçbir koşulda verilmez.
  const shadowSignals = opts?.phase5Shadow ? signalsForProfile("shadow") : NO_SIGNALS;
  const empty = (): RankedProfiles => {
    for (const p of wanted) byProfile.set(p, []);
    return {
      byProfile,
      phase5: opts?.phase5Shadow ? [] : null,
      phase5Signals: shadowSignals,
    };
  };
  if (wanted.length === 0) {
    return { byProfile, phase5: null, phase5Signals: shadowSignals };
  }

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: {
      shippingAddress: true,
      material: true,
      declinedManufacturerIds: true,
      productId: true,
      // Faz 5 sinyallerinin sipariş tarafındaki girdileri.
      needsPainting: true,
      style: true,
      figurineSize: true,
    },
  });
  if (!order) return empty();

  // Manufacturers who already declined or cancelled-after-accept for THIS order
  // must not be re-offered it — otherwise the admin candidate list (and any
  // auto-assignment caller) can ping-pong the order back to a refusing partner.
  const declinedIds = new Set(
    Array.isArray(order.declinedManufacturerIds)
      ? (order.declinedManufacturerIds as string[])
      : []
  );
  // Bu denemeye özgü dışlama. Sıralamanın İÇİNDE uygulanır (bkz. RankOptions):
  // kaydedilen karar, verilebilecek kararla birebir aynı olsun.
  const excludedIds = new Set(
    (opts?.excludeManufacturerIds ?? []).filter((id) => !!id)
  );

  const weightsByProfile = new Map<ScoringProfile, ScoringWeights>(
    wanted.map((p) => [p, getAssignmentWeights(p)] as const)
  );
  const weightsOf = (p: ScoringProfile) =>
    weightsByProfile.get(p) ?? getAssignmentWeights(p);
  // Bir sinyal, onu KULLANAN en az bir profil varsa yüklenir. Kullanmayan
  // profilin sonucunda değeri yine nötr yazılır (aşağıda), böylece ortak
  // yükleme tek bir profilin çıktısını bile değiştirmez.
  const needsOtd =
    wanted.some((p) => weightsOf(p).onTimeDelivery > 0) ||
    liveSignals.onTime ||
    shadowSignals.onTime;
  const needsBatch = wanted.some((p) => weightsOf(p).batchAffinity > 0);
  // Faz 5 yüklemeleri de aynı kurala tabi: sinyali KULLANAN bir taraf yoksa
  // sorgu hiç açılmaz. Kapalı bir sinyal sorguya mal olmamalı.
  const needsWeightedLoad = liveSignals.weightedLoad || shadowSignals.weightedLoad;
  const needsQc = liveSignals.qcRejections || shadowSignals.qcRejections;

  const shipping = order.shippingAddress as TurkishAddress | null;
  const orderCity = shipping?.il;
  const orderMaterial = order.material;

  const mfgs = await db.query.manufacturers.findMany({
    where: inArray(manufacturers.status, ["active"]),
  });

  if (mfgs.length === 0) return empty();

  // Bulk-compute current load for all active manufacturers.
  const loads = await db
    .select({
      manufacturerId: orders.manufacturerId,
      load: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(manufacturerBenchFilter())
    .groupBy(orders.manufacturerId);
  const loadMap = new Map<string, number>();
  for (const l of loads) {
    if (l.manufacturerId) loadMap.set(l.manufacturerId, l.load);
  }

  // ADET ağırlıklı yük (capacity-unit = C) — TEK ÖLÇÜDEN, enjekte edilerek.
  // Canlı ham sayımın YANINDA durur, onun yerine geçmez: hangisinin kapı
  // olduğunu sinyal belirler (bkz. RankOptions · capacities).
  const capacities = needsWeightedLoad ? opts?.capacities : undefined;

  // Batching signal. Skipped entirely when no requested profile weights it,
  // mirroring the OTD skip below — a disabled signal must not cost queries.
  const batchUnits = needsBatch
    ? await sameProductUnitsByManufacturer(
        await productIdsForOrder(orderId, order.productId)
      )
    : new Map<string, number>();

  // Atölye başına geçmiş sinyalleri: TÜM profiller VE gölge için bir kez.
  const history = new Map<
    string,
    {
      reliability: number;
      onTimeDelivery: number;
      qcJobs: number;
      qcRejectedJobs: number;
    }
  >();
  await Promise.all(
    mfgs.map(async (m) => {
      const [reliability, onTimeDelivery, qc] = await Promise.all([
        reliabilityScoreFor(m.id),
        // Hiçbir profil OTD'ye ağırlık vermiyorsa sorguyu hiç açma.
        needsOtd ? onTimeDeliveryScoreFor(m.id) : Promise.resolve(70),
        // QC geçmişi de aynı kurala tabi: sinyali kullanan taraf yoksa sorgu yok.
        needsQc ? qcRejectionHistoryFor(m.id) : Promise.resolve({ ...NEUTRAL_QC }),
      ]);
      history.set(m.id, {
        reliability,
        onTimeDelivery,
        qcJobs: qc.jobs,
        qcRejectedJobs: qc.rejectedJobs,
      });
    })
  );

  // Atölye satırları TEK KEZ kurulur; her profil ve gölge AYNI satırları
  // puanlar. Skor matematiği artık burada DEĞİL (saf `scoreManufacturers`):
  // "yeni sinyaller canlı skoru değiştirmedi" iddiası ancak saf bir fonksiyon
  // üzerinde, aynı girdiyle iki kez koşularak sayısal olarak sınanabilir.
  const rows: ManufacturerScoringRow[] = mfgs.map((m) => {
    const addr = m.address as TurkishAddress | null;
    const h = history.get(m.id);
    return {
      manufacturerId: m.id,
      companyName: m.companyName,
      il: addr?.il ?? null,
      ilce: addr?.ilce ?? null,
      phone: m.phone,
      email: m.email,
      iban: m.iban,
      capabilities: m.capabilities,
      coverageProvinces: m.coverageProvinces,
      requiresManualTaxReview: m.requiresManualTaxReview,
      acceptingOrders: m.acceptingOrders,
      paintsInHouse: m.paintsInHouse,
      strikeCount: m.strikeCount,
      maxConcurrentOrders: m.maxConcurrentOrders,
      currentLoad: loadMap.get(m.id) ?? 0,
      // Ölçülemediyse ham sayıya düşülür: "0 birim" demek, dolu bir atölyeyi
      // boş göstermek olurdu.
      loadUnits: capacities?.get(m.id)?.loadUnits ?? loadMap.get(m.id) ?? 0,
      loadUnitsMeasured: capacities?.has(m.id) ?? false,
      reliability: h?.reliability ?? 70,
      onTimeDelivery: h?.onTimeDelivery ?? 70,
      qcJobs: h?.qcJobs ?? 0,
      qcRejectedJobs: h?.qcRejectedJobs ?? 0,
      sameProductUnits: batchUnits.get(m.id) ?? 0,
    };
  });

  const scoringOrder: ManufacturerScoringOrder = {
    city: orderCity,
    material: orderMaterial,
    needsPainting: order.needsPainting,
    style: order.style,
    figurineSize: order.figurineSize,
    declinedManufacturerIds: [...declinedIds],
    excludeManufacturerIds: [...excludedIds],
  };

  for (const profile of wanted) {
    byProfile.set(
      profile,
      scoreManufacturers({
        order: scoringOrder,
        manufacturers: rows,
        weights: weightsOf(profile),
        // Mesafe modeli profile bağlıdır. Canlı profiller (v1/v2) kademeli
        // skoru kullanmaya devam eder; yalnız v3 gölgesi sürekli mesafeyle
        // puanlar.
        distanceModel: getDistanceModel(profile),
        // CANLI sinyaller — varsayılanda BOŞ küme, yani bugünkü skor.
        signals: liveSignals,
        coverageOf: opts?.coverageOf,
        largeFormatBlocked: opts?.largeFormatBlocked,
      })
    );
  }

  // FAZ 5 GÖLGESİ: aynı satırlar, yeni sinyaller, HİÇBİR yerleştirme.
  //
  // Ağırlık TABANI kararı veren profilin ağırlıklarıdır (`wanted[0]` —
  // sarmalayıcı otoriteyi hep başa koyar). `phase5Weights` yalnız `onTime`
  // sinyali açıkken yeni ağırlık kümesine geçer, kapalıyken canlının
  // ağırlıklarını aynen kullanır: böylece gölgede çıkan fark TEK bir sebebe
  // atfedilebilir kalır (iki değişkenli bir deneyin sonucu atfedilemez).
  const phase5 = opts?.phase5Shadow
    ? scoreManufacturers({
        order: scoringOrder,
        manufacturers: rows,
        weights: phase5Weights(shadowSignals, weightsOf(wanted[0])),
        distanceModel: PHASE5_DISTANCE_MODEL,
        signals: shadowSignals,
        coverageOf: opts?.coverageOf,
        largeFormatBlocked: opts?.largeFormatBlocked,
      })
    : null;

  return { byProfile, phase5, phase5Signals: shadowSignals };
}
