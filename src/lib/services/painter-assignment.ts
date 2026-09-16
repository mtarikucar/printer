import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, orders, painterActions, painters } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { MAP_UNIT_KM, provinceDistanceUnits, sameProvinceName } from "@/lib/data/province-distance";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";
// KAPASİTE TEK YERDEN OKUNUR. Bu dosya kendi tezgâh sorgusunu kurmuyor artık:
// ikinci bir kopya (`painterLoadUnitsByPainter`) ilkinden sessizce ayrışırdı ve
// ayrıştı da — ekranlar ağırlıklı birim sayarken uçlar iş sayısı sayıyordu.
import {
  loadPainterCapacities,
  painterHasRoom,
} from "@/lib/services/painter-capacity";
import {
  PAINTER_BAD_ACTIONS,
  PAINTER_GOOD_ACTIONS,
  PAINTER_HISTORY_LOOKBACK,
  PAINTER_MIN_HISTORY_SAMPLES,
  PAINTER_NEUTRAL_HISTORY_SCORE,
  PAINT_TURNAROUND_TARGET_DAYS,
  ROUTE_FLOOR_SCORE,
  ROUTE_FLOOR_UNITS,
  ROUTE_LEG_WEIGHTS,
  ROUTE_NEAR_SCORE,
  ROUTE_NEAR_UNITS,
  ROUTE_UNKNOWN_SCORE,
  getPainterWeights,
  type PainterScoringWeights,
} from "@/lib/config/painter-scoring";

/**
 * Boyacı sıralaması (Phase 4) — SAF skorlayıcı + onu besleyen yükleyici.
 *
 * İki yarı bilerek tek dosyada, üretici ikizindeki (`manufacturer-assignment.ts`)
 * düzenin aynısıyla: saf yarı `@/lib/db`ye DOKUNMAZ (fonksiyonların hiçbiri
 * sorgu açmaz), yükleyici yarısı veriyi toplayıp saf yarıyı çağırır.
 *
 * `server-only` YOK: boyacı ataması worker'dan da tetiklenecek (yanıtsız işin
 * 24 saat sonra yeniden yerleştirilmesi), ve `server-only` import eden bir
 * modül standalone Node worker'ını crash-loop'a sokar.
 *
 * DİKKAT — İSTEMCİ BİLEŞENİ BU MODÜLÜ IMPORT EDEMEZ: yükleyici yarısı `pg`yi
 * paketine sürükler. Admin ekranındaki "Boyacı ata" listesi bunu bir SUNUCU
 * bileşeninden ya da API rotasından okumalı. Kalibrasyon sayıları ve kapasite
 * kuralı istemciye de açık olan `@/lib/config/painter-scoring`te durur.
 *
 * GİZLİLİK: boyacı sözleşmesi v3.0 boyacının unvanını YALNIZCA işi devreden
 * üreticiye açıyor. Bu yüzden sıralama İÇ bir yüzeydir — public haritaya,
 * müşteri sayfalarına ya da boyacı kapsama alanına dönüşemez.
 */

// ─── Saf yarı: rota ─────────────────────────────────────────────────────────

/**
 * Mesafe → skor eğrisi: iki doğru parçası, kırılma ~300 km.
 * (Üretici sıralayıcısındaki `continuousDecay` ile AYNI; test parite tutar.)
 */
function routeDecay(units: number): number {
  const capped = Math.min(Math.max(units, 0), ROUTE_FLOOR_UNITS);
  if (capped <= ROUTE_NEAR_UNITS) {
    const drop = (100 - ROUTE_NEAR_SCORE) * (capped / ROUTE_NEAR_UNITS);
    return Math.round(100 - drop);
  }
  const beyond = (capped - ROUTE_NEAR_UNITS) / (ROUTE_FLOOR_UNITS - ROUTE_NEAR_UNITS);
  const drop = (ROUTE_NEAR_SCORE - ROUTE_FLOOR_SCORE) * beyond;
  return Math.round(ROUTE_NEAR_SCORE - drop);
}

/** Tek kargo bacağının skoru + çapa mesafesi (harita birimi; bilinmiyorsa null). */
export interface RouteLeg {
  score: number;
  units: number | null;
}

/**
 * Bir bacağın skoru. Aynı il = 100 (çapası olmayan ama birebir aynı yazılmış
 * adlar da dâhil: "aynı yer" olduğu kesindir). İllerden biri tanınmıyorsa NÖTR
 * 30 — 0 olsaydı adresi eksik bir boyacı "ülkenin öbür ucu" sayılırdı, 100
 * olsaydı bilmediğimiz şey lehe yazılırdı.
 *
 * Boyacıda KAPSAMA (etki alanı) yoktur, o yüzden üretici eğrisindeki "pin
 * tabanı" burada yok: `painters` tablosunda kapsama kolonu bilinçli olarak
 * açılmadı (boyacıyı üretici/admin elle seçiyordu) ve sözleşme boyacı
 * kimliğini public bir kapsama haritasına taşımaya izin vermiyor.
 */
export function routeLegScore(
  from: string | null | undefined,
  to: string | null | undefined
): RouteLeg {
  if (sameProvinceName(from, to)) return { score: 100, units: 0 };
  const units = provinceDistanceUnits(from, to);
  if (units === null) return { score: ROUTE_UNKNOWN_SCORE, units: null };
  return { score: routeDecay(units), units };
}

export interface RouteVerdict {
  score: number;
  /** Üretici → boyacı (devir kargosu). */
  handoff: RouteLeg;
  /** Boyacı → müşteri (teslim kargosu). */
  delivery: RouteLeg;
}

/**
 * Rota skoru = platformun ÖDEDİĞİ iki bacağın ağırlıklı ortalaması.
 *
 * Üretici sıralamasında tek bacak vardı (atölye → müşteri). Boyamada baskı
 * fiziksel olarak önce boyacıya gider: yanlış boyacı iki kargoyu birden
 * uzatır. Tek bacağa (teslim) bakan bir skor, İstanbul'daki üreticiden
 * Hakkari'deki boyacıya koli yollayıp oradan İstanbul'a geri getiren bir
 * seçimi "mükemmel" diye puanlardı.
 */
export function routeScore(
  manufacturerIl: string | null | undefined,
  painterIl: string | null | undefined,
  customerIl: string | null | undefined
): RouteVerdict {
  const handoff = routeLegScore(manufacturerIl, painterIl);
  const delivery = routeLegScore(painterIl, customerIl);
  return {
    score: Math.round(
      handoff.score * ROUTE_LEG_WEIGHTS.handoff + delivery.score * ROUTE_LEG_WEIGHTS.delivery
    ),
    handoff,
    delivery,
  };
}

// ─── Saf yarı: yük, güvenilirlik, kalite, zamanında teslim ──────────────────

/**
 * Doluluk → 0-100. Boş tezgâh 100, kapasitesi dolan 0.
 *
 * `loadUnits` AĞIRLIKLI birimdir (bkz. painterLoadUnits), `max` ise boyacının
 * beyan ettiği eşzamanlı SİPARİŞ sayısı. Ölçü değişimi bilinçli: sahibin
 * kapasite kararı tam olarak "60 parçalık bir iş, tek parçalık bir işle aynı
 * yeri kaplamasın" demek.
 *
 * ADI NEDEN `loadScore` DEĞİL: üretici sıralayıcısı (manufacturer-assignment.ts)
 * aynı adla BAŞKA bir fonksiyon dışa veriyor ve o, ilk argüman olarak ağırlıksız
 * İŞ SAYISI alıyor. İki ad çakıştığı sürece yanlış modülden import etmek tek
 * satırlık bir dikkatsizlikti ve tip sistemi uyarmazdı: iki imza da
 * `(number, number) => number`. Sonuç sessiz olurdu — ağırlıklı birim, ağırlıksız
 * bir eşiğe vurulur ve boyacı ya kapasitesi varken elenir ya da dolu olduğu
 * hâlde uygun görünürdü.
 */
export function painterLoadScore(loadUnits: number, max: number): number {
  if (max <= 0) return 0;
  if (loadUnits >= max) return 0;
  return Math.max(0, Math.round((1 - loadUnits / max) * 100));
}

/** Son işlerdeki iyi/kötü eylem sayıları. */
export interface ReliabilityCounts {
  good: number;
  bad: number;
}

/**
 * Güvenilirlik: iyi eylemlerin payı. Hiç kayıt yoksa nötr (yeni boyacı ne
 * ödüllendirilir ne cezalandırılır).
 */
export function reliabilityScore(counts: ReliabilityCounts): number {
  const total = counts.good + counts.bad;
  if (total <= 0) return PAINTER_NEUTRAL_HISTORY_SCORE;
  return Math.round((counts.good / total) * 100);
}

/** Bitmiş işlerin kaçı ikinci bir QC turuna kaldı. */
export interface QcQualityCounts {
  jobs: number;
  reworkJobs: number;
}

/**
 * QC kalitesi: ikinci tura KALMAYAN işlerin payı.
 *
 * Tur sayısının şiddeti (3. tur, 4. tur) bilinçli olarak ayrıştırılmaz:
 * operasyonel gerçek "iş yeniden yapıldı mı" sorusudur ve 3 turu 2 turdan
 * ayırt edecek hacim henüz yok. Hacim geldiğinde burası ortalama fazla tura
 * çevrilebilir; çağıranlar aynı kalır.
 */
export function qcQualityScore(counts: QcQualityCounts): number {
  if (counts.jobs < PAINTER_MIN_HISTORY_SAMPLES) return PAINTER_NEUTRAL_HISTORY_SCORE;
  const clean = Math.max(0, counts.jobs - counts.reworkJobs);
  return Math.round((clean / counts.jobs) * 100);
}

/**
 * Zamanında teslim: devir (assignedToPainterAt) → kargo (shippedAt) süresi.
 * Hedefte ya da altında 100, hedefin iki katında 0, arası doğrusal.
 */
export function onTimeScore(spansDays: readonly number[]): number {
  const usable = spansDays.filter((d) => Number.isFinite(d) && d >= 0);
  if (usable.length < PAINTER_MIN_HISTORY_SAMPLES) return PAINTER_NEUTRAL_HISTORY_SCORE;
  let sum = 0;
  for (const days of usable) {
    sum += Math.max(0, Math.min(100, 100 * (2 - days / PAINT_TURNAROUND_TARGET_DAYS)));
  }
  return Math.round(sum / usable.length);
}

// ─── Saf yarı: aday, girdi, skorlayıcı ──────────────────────────────────────

/**
 * Alt skorlar — adayın yanında TAŞINIR ki karar geri okunabilsin.
 *
 * `interface` DEĞİL `type`: TypeScript arayüzlere örtük indeks imzası vermez,
 * yani `Record<string, number>` bekleyen bir tüketici (değerlendirme satırını
 * JSON'a yazan yüzeyler tam olarak bunu bekliyor) arayüzü kabul edemez. Tip
 * takma adı aynı alanları aynı katılıkta doğrular ama o atamaya izin verir —
 * alternatifi, elle indeks imzası eklemek olurdu ve o, alan adı yazım
 * hatalarını da sessizce geçirirdi.
 */
export type PainterScoreParts = {
  route: number;
  load: number;
  reliability: number;
  qcQuality: number;
  onTime: number;
};

/**
 * Sıralamanın tek formülü. Ayrı fonksiyon, çünkü kalibrasyon ancak "bu mesafe
 * farkı şu yük farkını yener mi?" diye sınanabilir; testin formülü elle
 * kopyalaması hâlinde test, sıralayıcıyı değil kendi kopyasını doğrular.
 */
export function weightedPainterTotal(
  parts: PainterScoreParts,
  weights: PainterScoringWeights
): number {
  return (
    parts.route * weights.route +
    parts.load * weights.load +
    parts.reliability * weights.reliability +
    parts.qcQuality * weights.qcQuality +
    parts.onTime * weights.onTime
  );
}

/** P4-C1 sözleşmesi: sıralamanın dışarıya verdiği tek satır. */
export interface PainterCandidate {
  painterId: string;
  companyName: string;
  eligible: boolean;
  /** Türkçe; yalnız `eligible === false` iken dolu. */
  ineligibleReason?: string;
  score: number;
  parts: PainterScoreParts;
  // ── Sözleşmenin üstüne, AÇIKLANABİLİRLİK için taşınan alanlar ──────────────
  // Admin ekranı "neden bu boyacı" sorusunu skordan geri çıkaramaz; değerlendirme
  // satırı da (P4-C3) bunları saklarsa karar yıllar sonra da okunabilir kalır.
  il: string | null;
  currentLoadUnits: number;
  maxConcurrentOrders: number;
  /** İnsan okuyacağı kısa gerekçe listesi (Türkçe). */
  reasons: string[];
  /** Rota gerekçesi: iki bacağın mesafesi (harita birimi; bilinmiyorsa null). */
  route: { handoffUnits: number | null; deliveryUnits: number | null };
}

/** Skorlayıcının beklediği ham boyacı satırı — DB tiplerine bağlı DEĞİL. */
export interface PainterScoringRow {
  painterId: string;
  companyName: string;
  /** `address.il`; yoksa null. */
  il: string | null;
  /** `painters.status`; "active" dışındaki her şey uygunsuzdur. */
  status: string;
  acceptingOrders: boolean;
  maxConcurrentOrders: number;
  /** AĞIRLIKLI yük (painterLoadUnits toplamı). */
  loadUnits: number;
  /** Ödeme bilgisi eksikse uyarı rozeti çıkar (kapı DEĞİL). */
  iban?: string | null;
  reliability: ReliabilityCounts;
  qcQuality: QcQualityCounts;
  /** Devir→kargo süreleri (gün). */
  onTimeSpansDays: readonly number[];
}

export interface PainterScoringInput {
  order: {
    /** İşi devredecek üreticinin ili (devir kargosunun çıkış noktası). */
    manufacturerIl: string | null;
    /** Müşteri teslim ili. */
    customerIl: string | null;
    /** Bu siparişi daha önce reddetmiş boyacılar. */
    declinedPainterIds?: readonly string[];
    /** YALNIZ bu denemede dışlananlar (iş az önce bu boyacıdan geri alındı). */
    excludePainterIds?: readonly string[];
  };
  painters: readonly PainterScoringRow[];
  weights?: PainterScoringWeights;
}

/**
 * Bu DENEMEYE özgü dışlama gerekçesi. Sabit olarak durur ki çağıran "hiç aday
 * çıkmadı"yı anlatırken sebebi metin karşılaştırmadan ayırt edebilsin.
 */
export const PAINTER_EXCLUDED_THIS_ATTEMPT_REASON =
  "Bu deneme için dışlandı (iş az önce bu boyacıdan geri alındı)";

/**
 * SAF, KARARLI ve açıklanabilir sıralama: aynı girdi → aynı çıktı, IO yok.
 *
 * Uygunsuzluk sırası KURALIN KENDİSİDİR, çünkü admin'in gördüğü gerekçe bu
 * sıradan çıkar: en üstte bu denemeye özgü dışlama (iş az önce geri alındıysa
 * bugünkü sebep odur), sonra kalıcı ret kaydı, sonra hesap durumu, sonra
 * "iş almıyor", en sonda kapasite.
 */
export function scorePainters(input: PainterScoringInput): PainterCandidate[] {
  const weights = input.weights ?? getPainterWeights();
  const declined = new Set(input.order.declinedPainterIds ?? []);
  const excluded = new Set((input.order.excludePainterIds ?? []).filter(Boolean));

  const candidates = input.painters.map((p): PainterCandidate => {
    const route = routeScore(input.order.manufacturerIl, p.il, input.order.customerIl);
    const parts: PainterScoreParts = {
      route: route.score,
      load: painterLoadScore(p.loadUnits, p.maxConcurrentOrders),
      reliability: reliabilityScore(p.reliability),
      qcQuality: qcQualityScore(p.qcQuality),
      onTime: onTimeScore(p.onTimeSpansDays),
    };

    let eligible = true;
    let ineligibleReason: string | undefined;
    if (excluded.has(p.painterId)) {
      eligible = false;
      ineligibleReason = PAINTER_EXCLUDED_THIS_ATTEMPT_REASON;
    } else if (declined.has(p.painterId)) {
      eligible = false;
      ineligibleReason = "Bu siparişi daha önce reddetti";
    } else if (p.status !== "active") {
      eligible = false;
      ineligibleReason = "Hesap aktif değil";
    } else if (!p.acceptingOrders) {
      eligible = false;
      ineligibleReason = "İş almıyor";
      // EŞİK BURADA YENİDEN YAZILMAZ: uçların uyguladığı kapının TA KENDİSİ
      // çağrılır (`painterHasRoom`). Elle yazılmış bir `>=` karşılaştırması,
      // ekranın uçtan farklı bir sınırda dönmesi demekti; ölçülen kusur buydu.
    } else if (!painterHasRoom(p)) {
      eligible = false;
      ineligibleReason = "Kapasite dolu";
    }

    const reasons: string[] = [];
    if (route.handoff.units === 0) reasons.push("Üreticiyle aynı şehir");
    else if (route.handoff.units !== null && route.handoff.units <= ROUTE_NEAR_UNITS)
      reasons.push(`Üreticiye yakın (~${Math.round(route.handoff.units * MAP_UNIT_KM)} km)`);
    if (route.delivery.units === 0) reasons.push("Müşteriyle aynı şehir");
    else if (route.delivery.units !== null && route.delivery.units <= ROUTE_NEAR_UNITS)
      reasons.push(`Müşteriye yakın (~${Math.round(route.delivery.units * MAP_UNIT_KM)} km)`);
    if (parts.load >= 80) reasons.push("Düşük yük");
    else if (parts.load <= 30 && eligible) reasons.push("Yüksek yük");
    if (parts.reliability >= 85) reasons.push("Güvenilir");
    if (parts.qcQuality >= 90 && p.qcQuality.jobs >= PAINTER_MIN_HISTORY_SAMPLES)
      reasons.push("Kalite kontrolünden ilk turda geçiyor");
    if (parts.onTime >= 85 && p.onTimeSpansDays.length >= PAINTER_MIN_HISTORY_SAMPLES)
      reasons.push("Zamanında teslim ediyor");
    // IBAN bir KAPI değil (eski kayıtlarda boş olabilir ve atamayı dondurmak
    // işi büsbütün durdururdu); ödeme vakti sorun çıkaracağı için rozetle söylenir.
    if (p.iban !== undefined && !p.iban) reasons.push("⚠ IBAN eksik");

    return {
      painterId: p.painterId,
      companyName: p.companyName,
      eligible,
      ineligibleReason,
      score: Math.round(weightedPainterTotal(parts, weights)),
      parts,
      il: p.il,
      currentLoadUnits: p.loadUnits,
      maxConcurrentOrders: p.maxConcurrentOrders,
      reasons,
      route: { handoffUnits: route.handoff.units, deliveryUnits: route.delivery.units },
    };
  });

  // Uygun olanlar üstte, skora göre azalan. Eşitlikte unvan (Türkçe sıralama),
  // sonra id: SIRA VERİNİN GELİŞ SIRASINA BAĞLI OLAMAZ — aynı skorlu iki boyacı
  // arasında kazananı DB'nin satır sırası belirleseydi, aynı sipariş iki kez
  // sıralandığında farklı boyacıya gider ve kaydedilen karar açıklanamazdı.
  return candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    const byName = a.companyName.localeCompare(b.companyName, "tr");
    if (byName !== 0) return byName;
    return a.painterId.localeCompare(b.painterId);
  });
}

// ─── Yükleyici yarısı ───────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bir siparişin eylem günlüğünde "el değiştirme" izi bırakan eylemler. */
const HANDOVER_ACTIONS = ["admin_swapped_out", "admin_revoked"] as const;

export interface RankPaintersOptions {
  /** Bu denemede sıralamaya hiç girmemesi gereken boyacılar. */
  excludePainterIds?: readonly string[];
  /** Ağırlıkları dışarıdan verir (gölge/kalibrasyon koşuları için). */
  weights?: PainterScoringWeights;
}

/**
 * Siparişi boyayabilecek adayları sıralar.
 *
 * HATA POLİTİKASI — KAPIYI BESLEYEN OKUMA KAPALI DÜŞER: sipariş, boyacı
 * listesi ve YÜK okumaları bir kapıdır (kapasitesi dolan boyacıya iş
 * yazılamaz), bu yüzden hataları yutulmaz; fonksiyon fırlatır ve yerleştirmeyi
 * yapan taraf (P4-C2 `assignPainterAutomatically`) bunu "aday yok" diye ele
 * alıp işi admin kuyruğuna bırakır. GEÇMİŞ okumaları (güvenilirlik, QC, süre)
 * yalnız skoru gölgeler; onlarda hata nötr puana düşer ve loglanır — tek bir
 * yavaş sorgu yüzünden sipariş yerleştirilmeden kalmaz.
 */
export async function rankPaintersForOrder(
  orderId: string,
  opts?: RankPaintersOptions
): Promise<PainterCandidate[]> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: {
      id: true,
      shippingAddress: true,
      declinedPainterIds: true,
      manufacturerId: true,
    },
  });
  if (!order) return [];

  const shipping = order.shippingAddress as TurkishAddress | null;
  const customerIl = shipping?.il ?? null;

  // Devir kargosunun çıkış noktası. Üretici atanmamışsa (elle yazılan sipariş)
  // bacak "bilinmiyor" olur ve nötr puanlanır — uydurulmuş bir il, parayı
  // yanlış yere akıtacak bir rota skoru üretirdi.
  let manufacturerIl: string | null = null;
  if (order.manufacturerId) {
    const mfg = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, order.manufacturerId),
      columns: { address: true },
    });
    manufacturerIl = (mfg?.address as TurkishAddress | null)?.il ?? null;
  }

  const rows = await db.query.painters.findMany({
    where: eq(painters.status, "active"),
    columns: {
      id: true,
      companyName: true,
      address: true,
      status: true,
      acceptingOrders: true,
      maxConcurrentOrders: true,
      iban: true,
    },
  });
  if (rows.length === 0) return [];

  // YÜK, ORTAK ÖLÇÜDEN. `loadPainterCapacities` var olan her boyacı için satır
  // döndürür (tezgâhı boş olanlar dâhil), iade edilmiş işi düşer ve ağırlığı
  // `painterLoadUnits` ile hesaplar — yani sıralama, uçların reddedeceği
  // boyacıyı "uygun" gösteremez.
  const caps = await loadPainterCapacities(rows.map((p) => p.id));

  // Geçmiş sinyalleri boyacı başına paralel. Sorgu sayısı: 1 sipariş + 1 üretici
  // + 1 boyacı listesi + 3 kapasite + 2N geçmiş + 1 el değiştirme taraması.
  const history = await Promise.all(
    rows.map(async (p) => ({
      painterId: p.id,
      ...(await historyFor(p.id)),
    }))
  );
  const historyById = new Map(history.map((h) => [h.painterId, h]));

  // El değiştirmiş siparişleri TEK sorguda ayıkla ve QC/süre geçmişinden çıkar:
  // devralınan bir işin QC turu ya da gecikmesi, işi devralan boyacının değil
  // ÖNCEKİNİN eseridir. Kime ait olduğu bilinemediği için ikisine de yazılmaz.
  const jobIds = history.flatMap((h) => h.jobs.map((j) => j.id));
  const tainted = await taintedOrderIds(jobIds);

  const scoringRows: PainterScoringRow[] = rows.map((p) => {
    const h = historyById.get(p.id);
    const jobs = (h?.jobs ?? []).filter((j) => !tainted.has(j.id));
    const spans: number[] = [];
    let reworkJobs = 0;
    for (const j of jobs) {
      if (j.round > 1) reworkJobs++;
      if (j.assignedAt && j.shippedAt) {
        spans.push((j.shippedAt.getTime() - j.assignedAt.getTime()) / DAY_MS);
      }
    }
    return {
      painterId: p.id,
      companyName: p.companyName,
      il: (p.address as TurkishAddress | null)?.il ?? null,
      status: p.status,
      acceptingOrders: p.acceptingOrders,
      maxConcurrentOrders: p.maxConcurrentOrders,
      loadUnits: caps.get(p.id)?.loadUnits ?? 0,
      iban: p.iban,
      reliability: h?.reliability ?? { good: 0, bad: 0 },
      qcQuality: { jobs: jobs.length, reworkJobs },
      onTimeSpansDays: spans,
    };
  });

  return scorePainters({
    order: {
      manufacturerIl,
      customerIl,
      declinedPainterIds: Array.isArray(order.declinedPainterIds)
        ? (order.declinedPainterIds as string[])
        : [],
      excludePainterIds: opts?.excludePainterIds,
    },
    painters: scoringRows,
    weights: opts?.weights,
  });
}

// NOT: boyacı başına ağırlıklı yükün İKİNCİ bir kopyası burada duruyordu
// (`painterLoadUnitsByPainter`). Silindi: kapasite ölçüsü artık yalnız
// `src/lib/services/painter-capacity.ts` içinde tanımlı ve okuyan da yazan da
// oradan besleniyor. Bir kopya daha açmak, ekranla ucun tekrar ayrışması
// demektir.

interface PainterHistory {
  reliability: ReliabilityCounts;
  jobs: { id: string; round: number; assignedAt: Date | null; shippedAt: Date | null }[];
}

/**
 * Bir boyacının son işlerinden güvenilirlik sayaçları ve bitmiş iş satırları.
 *
 * İADE EDİLMİŞ SİPARİŞ HER İKİ SORGUDA DA ELENİR: iade edilen bir işte boyacı
 * "bırak" dediğinde eylem günlüğüne yine `decline` düşüyor (koparmanın kaydı),
 * ama o bırakma bir ceza değildir — sipariş zaten kimseye gitmiyordu. Sayılsaydı
 * iade, boyacının sicilini bozardı; "temizlik hiçbir partneri cezalandıramaz"
 * kuralı tam olarak bunu yasaklıyor.
 *
 * Hata durumunda NÖTR döner (fırlatmaz): bu sinyaller yalnız skoru gölgeler,
 * kapıyı değil.
 */
async function historyFor(painterId: string): Promise<PainterHistory> {
  const empty: PainterHistory = { reliability: { good: 0, bad: 0 }, jobs: [] };
  try {
    const [actions, jobs] = await Promise.all([
      db
        .select({ action: painterActions.action })
        .from(painterActions)
        .innerJoin(orders, eq(painterActions.orderId, orders.id))
        .where(
          and(
            eq(painterActions.painterId, painterId),
            ne(orders.paymentStatus, REFUNDED_PAYMENT_STATUS)
          )
        )
        .orderBy(desc(painterActions.createdAt))
        .limit(PAINTER_HISTORY_LOOKBACK),
      db
        .select({
          id: orders.id,
          round: orders.painterQcRound,
          assignedAt: orders.assignedToPainterAt,
          shippedAt: orders.shippedAt,
        })
        .from(orders)
        .where(
          and(
            eq(orders.painterId, painterId),
            eq(orders.painterStatus, "shipped"),
            ne(orders.paymentStatus, REFUNDED_PAYMENT_STATUS)
          )
        )
        .orderBy(desc(orders.shippedAt))
        .limit(PAINTER_HISTORY_LOOKBACK),
    ]);

    let good = 0;
    let bad = 0;
    for (const a of actions) {
      if (PAINTER_GOOD_ACTIONS.includes(a.action)) good++;
      else if (PAINTER_BAD_ACTIONS.includes(a.action)) bad++;
      // Kalanlar (admin eylemleri) hiçbir yöne sayılmaz — bkz. PAINTER_NEUTRAL_ACTIONS.
    }
    return { reliability: { good, bad }, jobs };
  } catch (e) {
    console.error("painter history read failed (nötr puanla devam)", painterId, e);
    return empty;
  }
}

/** Boyacı değiştirilmiş / geri alınmış sipariş id'leri (QC ve süreden düşülür). */
async function taintedOrderIds(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  try {
    const rows = await db
      .selectDistinct({ orderId: painterActions.orderId })
      .from(painterActions)
      .where(
        and(
          inArray(painterActions.orderId, orderIds),
          inArray(painterActions.action, [...HANDOVER_ACTIONS])
        )
      );
    return new Set(rows.map((r) => r.orderId).filter((id): id is string => !!id));
  } catch (e) {
    // Okunamazsa hiçbir işi elemeyiz: kötü durumda devralınmış bir iş de
    // sayılır, ki bu skoru gölgeler — ama sıralamayı durdurmaz.
    console.error("painter handover scan failed (eleme yapılmadı)", e);
    return new Set();
  }
}
