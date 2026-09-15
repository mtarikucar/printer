import crypto from "node:crypto";

/**
 * Manufacturer scoring weights (Q7 rollout).
 *
 * v1 is the legacy formula — fixed weights, no on-time-delivery signal.
 * v2 adds OTD and rebalances toward reliability/responsiveness, with
 * env-tunable weights so we can refine without a deploy. Default v2
 * weights are intentionally close to v1 so the canary doesn't
 * dramatically shift winners on day 1 — fine-grained env tuning is the
 * mechanism for tilting toward OTD as data accumulates.
 *
 * Sum of v2 weights = 1.0; consumers don't normalize.
 */

/**
 * v3, v1'in AĞIRLIKLARINI aynen kullanan ama mesafeyi SÜREKLİ ölçen gölge
 * profildir (Phase 1). Asla otoriter olmaz: `rankForOrderWithShadow` yalnızca
 * v1/v2 arasından otoriteyi seçer, v3 sadece loglanır (ranker-rollout kararı).
 */
export type ScoringProfile = "v1" | "v2" | "v3";

/**
 * Mesafe alt-skorunun nasıl hesaplandığı.
 *
 * "tiered"     — bugünkü 6 kademe (aynı il 100 / etki alanı 85 / aynı bölge 60
 *                / diğer 20). CANLI olan budur.
 * "continuous" — il çapalarından sürekli mesafe (Phase 1 gölge). Kocaeli→Düzce
 *                ile Edirne→Hakkari'yi artık aynı 20'ye basmaz.
 */
export type DistanceModel = "tiered" | "continuous";

/**
 * Profil → mesafe modeli. TEK yer: ranker ve gölge kaydı buradan okur, yoksa
 * "hangi satır hangi mesafe modeliyle üretildi" sorusu cevapsız kalır.
 */
export function getDistanceModel(profile: ScoringProfile): DistanceModel {
  return profile === "v3" ? "continuous" : "tiered";
}

export interface ScoringWeights {
  distance: number;
  load: number;
  reliability: number;
  onTimeDelivery: number;
  compliance: number;
  /**
   * Toplu üretim batching: favours a workshop that is ALREADY producing the
   * same product, so repeat orders of one item cluster into a single run
   * (one plate setup, one resin colour, one QC pass) instead of scattering.
   *
   * Deliberately modest — it reorders otherwise-comparable candidates; it must
   * not out-argue distance or capacity. It also never widens eligibility: the
   * material / capacity / previously-declined hard filters run unchanged, so
   * batching can't push work into a full shop.
   */
  batchAffinity: number;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * v1.1 rebalance: batchAffinity was carved out of distance (0.40 → 0.35),
 * load (0.35 → 0.30) and reliability (0.20 → 0.18). It ships enabled in v1
 * because v1 is the AUTHORITATIVE profile by default (the v2 canary is 0%),
 * and automatic batching of repeat bulk orders is a shipped requirement, not
 * an experiment. Consumers do not normalize — this must sum to exactly 1.0.
 */
export const V1_WEIGHTS: ScoringWeights = {
  distance: 0.35,
  load: 0.3,
  reliability: 0.18,
  onTimeDelivery: 0,
  compliance: 0.05,
  batchAffinity: 0.12,
};

/**
 * v3 ağırlıkları = v1 ağırlıkları, BİLEREK aynı nesne.
 *
 * v3'te tek bir değişken oynuyor: mesafe alt-skorunun nasıl hesaplandığı.
 * Ağırlıklar da kaysaydı gölge kaydında farklı çıkan bir kazananı "sürekli
 * mesafe yüzünden" diye okuyamazdık — iki değişkenli bir deneyin sonucu
 * atfedilemez. Ağırlık ayarı ayrı bir adımdır (Phase 5).
 */
export const V3_WEIGHTS: ScoringWeights = V1_WEIGHTS;

export function getAssignmentWeights(profile: ScoringProfile): ScoringWeights {
  if (profile === "v1") return V1_WEIGHTS;
  if (profile === "v3") return V3_WEIGHTS;
  return {
    distance: envFloat("MFG_W2_DISTANCE", 0.25),
    load: envFloat("MFG_W2_LOAD", 0.22),
    reliability: envFloat("MFG_W2_RELIABILITY", 0.14),
    onTimeDelivery: envFloat("MFG_W2_OTD", 0.22),
    compliance: envFloat("MFG_W2_COMPLIANCE", 0.05),
    batchAffinity: envFloat("MFG_W2_BATCH", 0.12),
  };
}

/**
 * Used as the `weights_version` value on
 * `manufacturer_assignment_evaluations`. Bump the string (e.g. "v2.1") when
 * you change defaults so historic evaluations stay grouped under the weight
 * set that actually produced them.
 *
 * Both bumped to .1 when batchAffinity was introduced: v1's other weights were
 * rebalanced to make room for it, so pre-change rows were scored by a
 * different algorithm and must not be compared against post-change ones.
 *
 * Bumped to .2 when partner coverage provinces became a distance tier (a
 * covered il now scores 85, between same-il 100 and same-region 60). The
 * weights did not move, but the meaning of the `distance` sub-score did, so
 * pre- and post-change evaluations are not comparable either.
 *
 * v1.2 / v2.2 Phase 1'de BİLEREK sabit kaldı: sürekli mesafe canlı skoru
 * değiştirmiyor, yalnız v3 gölgesinde çalışıyor (ranker-rollout kararı). Canlı
 * profiller sürekli mesafeye geçtiğinde (Phase 5 cutover) v1.3 / v2.3'e
 * çıkarılacak — o an eski satırlar başka bir algoritmanın ürünü olur.
 *
 * v3.0 = v1 ağırlıkları + sürekli mesafe. Her değerlendirmede canlı seçimin
 * YANINA ayrı bir satır olarak yazılır; `(order_id, weights_version)` tekil
 * indeksi sayesinde v2.2 satırıyla çakışmaz.
 */
export function weightsVersion(profile: ScoringProfile): string {
  if (profile === "v1") return "v1.2";
  if (profile === "v3") return "v3.0";
  return "v2.2";
}

/**
 * Deterministic 0-99 bucket for a key via SHA-1. Stable for the same key
 * across retries — critical for the N12 decline retry path which
 * re-evaluates the same order multiple times and should never flip
 * algorithms mid-flight.
 */
function bucketOf(key: string): number {
  const hash = crypto.createHash("sha1").update(key).digest("hex");
  return parseInt(hash.slice(0, 8), 16) % 100;
}

/** Yüzde kapısı: 0 → hiç, 100 → hep, arası deterministik kova. */
function percentGate(key: string, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return bucketOf(key) < percent;
}

export function shouldUseV2(orderId: string, percent: number): boolean {
  return percentGate(orderId, percent);
}

export function getCanaryPercent(): number {
  return envFloat("MANUFACTURER_SCORING_V2_PERCENT", 0);
}

/**
 * Mesafe gölgesinin ÖRNEKLEME oranı (%). VARSAYILAN 100: her atamada sürekli
 * mesafe karşılaştırması da çalışır — gölge döneminin tek amacı veri
 * toplamaktır, yarım veriyle Phase 5 cutover'ı tartışılamaz.
 *
 * NEDEN VAR: gölge karşılaştırması bedava değil (bkz. manufacturer-assignment
 * -shadow.ts'teki maliyet notu). Atama hacmi büyüdüğünde ya da tarama ekranı
 * tek istekte onlarca siparişi işlerken maliyeti kısmak gerekirse, kod
 * değişikliği değil TEK BİR ayar yeter: MANUFACTURER_DISTANCE_SHADOW_PERCENT=20
 * dendiğinde siparişlerin %20'si karşılaştırılır, kalanında yalnız canlı
 * sıralama çalışır ve v3.0 satırı hiç yazılmaz.
 */
export function getDistanceShadowPercent(): number {
  return envFloat("MANUFACTURER_DISTANCE_SHADOW_PERCENT", 100);
}

/**
 * Bu sipariş mesafe gölgesine girsin mi?
 *
 * Kova anahtarı BİLEREK "dist:" ile tuzlanır: v2 kanaryasıyla aynı hash
 * kullanılsaydı iki deney aynı siparişlerde üst üste düşerdi (kanaryaya giren
 * her sipariş aynı zamanda mesafe gölgesine de girer/girmezdi) ve iki ölçüm
 * birbirinin yanlılığını taşırdı. Aynı sipariş için sonuç yine kararlıdır —
 * reddedilip yeniden sıralanan sipariş deney ortasında taraf değiştirmez.
 */
export function shouldRunDistanceShadow(
  orderId: string,
  percent: number = getDistanceShadowPercent()
): boolean {
  return percentGate(`dist:${orderId}`, percent);
}
