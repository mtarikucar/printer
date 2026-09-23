/**
 * Açılış sayfasının YAYIMLADIĞI fiyat çapaları ("₺74'den başlayan").
 *
 * Neden var: fiyat kapısı bütün gerçek teklif rakamlarını girişin arkasına
 * alıyor. Hiç rakam yayımlamayan bir hizmet sayfası, bir yapay zekâ arama
 * motorunun ya da müşterinin karşılaştırma yapabileceği tek şeyi — sayıyı —
 * vermez (bkz. spec §"Müşteri arayüzü" ve GEO notu: rakamsız tarif
 * alıntılanmıyor). Bu yüzden herkese açık TEK bir referans parça için fiyat
 * hesaplanır ve sayfada dayanağıyla birlikte yazılır.
 *
 * Referans parça SABİTTİR ve sayfada da yazılıdır: **20 mm küp, 1 adet,
 * standart teslim, katalog varsayılanı katman/doluluk, en ucuz renk, ilk
 * elle-fiyatlanmayan yüzey işlemi, KDV dahil**. Rakam katalogdan hesaplanır
 * (`priceUnitAuto`), elle yazılmaz: yönetici malzeme fiyatını değiştirdiğinde
 * açılış sayfası kendiliğinden doğrulanır.
 *
 * SAF MODÜL: DB yok, `server-only` yok — hem sayfalar hem birim testi import
 * eder.
 */
import { findFinish, leadTier, priceUnitAuto } from "@/lib/config/quote-pricing";
import { scaledGeometry } from "@/lib/config/quote-units";
import type {
  PartConfig,
  PartGeometry,
  PricingSnapshot,
  SnapshotMaterial,
  SnapshotTechnology,
} from "@/lib/config/quote-types";

/** Referans parçanın kenar uzunluğu (mm). Sayfadaki cümleyle aynı sayı. */
export const ANCHOR_EDGE_MM = 20;

/**
 * Çapanın dayanağı. Sayfada da, `Service` JSON-LD'sinde de AYNI cümle geçer:
 * Google'ın "yapısal veri görünen içerikle eşleşmeli" kuralı ve okurun rakamı
 * doğrulayabilmesi buna bağlı.
 */
export const ANCHOR_BASIS_TR = `${ANCHOR_EDGE_MM} mm küp, 1 adet, standart teslim, KDV dahil`;

/** Referans parça: dolu 20 mm küp, dosya birimi mm. */
const ANCHOR_GEOMETRY: PartGeometry = {
  volume: ANCHOR_EDGE_MM ** 3,
  area: 6 * ANCHOR_EDGE_MM ** 2,
  extents: { x: ANCHOR_EDGE_MM, y: ANCHOR_EDGE_MM, z: ANCHOR_EDGE_MM },
  bodyCount: 1,
  isWatertight: true,
  isVolume: true,
  volumeEstimated: false,
  faceCount: 12,
  wallP1: ANCHOR_EDGE_MM,
  wallP5: ANCHOR_EDGE_MM,
  overhangArea: ANCHOR_EDGE_MM ** 2,
  sourceUnits: null,
  objectCount: 1,
};

const ANCHOR_SCALED = scaledGeometry(ANCHOR_GEOMETRY, "mm", 1);

function technologyOf(snapshot: PricingSnapshot, key: string): SnapshotTechnology | null {
  return snapshot.technologies.find((t) => t.key === key) ?? null;
}

/**
 * Çapa için yüzey işlemi: `sortOrder` sırasında elle fiyatlanmayan İLK yüzey.
 *
 * `requiresManual` olanlar (boyalı, özel) anlık fiyat vermez; onlardan bir
 * "başlangıç fiyatı" türetmek, müşteriye hiç alamayacağı bir rakam yazmak
 * olurdu.
 */
function anchorFinishKey(snapshot: PricingSnapshot, technologyKey: string): string | null {
  const usable = snapshot.finishes
    .filter(
      (f) =>
        !f.requiresManual && (f.technologyKey === null || f.technologyKey === technologyKey)
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return usable[0]?.key ?? null;
}

function anchorConfig(
  snapshot: PricingSnapshot,
  tech: SnapshotTechnology,
  material: SnapshotMaterial,
  finishKey: string
): PartConfig | null {
  // Ek ücreti en düşük renk: "başlayan" fiyat, seçilebilecek en ucuz renkle
  // hesaplanır; katalogda ek ücretli renk varsa çapa onunla şişmez.
  const color = [...material.colors].sort((a, b) => a.surchargeKurus - b.surchargeKurus)[0];
  if (!color) return null;
  return {
    technologyKey: tech.key,
    materialKey: material.key,
    colorKey: color.key,
    finishKey,
    layerUm: tech.defaultLayerUm,
    infillPct: tech.defaultInfillPct,
    quantity: 1,
    units: "mm",
    scale: 1,
    criticalTolerance: false,
  };
}

/**
 * Tek malzemenin referans parça üzerindeki birim fiyatı (kuruş, KDV dahil).
 * Katalog o malzemeyi fiyatlayamıyorsa (yüzey yok, renk yok) null.
 */
export function materialAnchorKurus(
  snapshot: PricingSnapshot,
  material: SnapshotMaterial
): number | null {
  const tech = technologyOf(snapshot, material.technologyKey);
  if (!tech) return null;
  const finishKey = anchorFinishKey(snapshot, tech.key);
  if (!finishKey || !findFinish(snapshot, tech.key, finishKey)) return null;
  const config = anchorConfig(snapshot, tech, material, finishKey);
  if (!config) return null;

  return priceUnitAuto({
    snapshot,
    scaled: ANCHOR_SCALED,
    config,
    tier: leadTier(snapshot, "standard"),
    quantity: 1,
  }).unitKurus;
}

/** Teknolojinin çapası: malzemeleri içindeki EN DÜŞÜK birim fiyat. */
export function technologyAnchorKurus(
  snapshot: PricingSnapshot,
  technologyKey: string
): number | null {
  if (!technologyOf(snapshot, technologyKey)) return null;
  const prices = snapshot.materials
    .filter((m) => m.technologyKey === technologyKey)
    .map((m) => materialAnchorKurus(snapshot, m))
    .filter((p): p is number => p !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** Bütün kataloğun en düşük başlangıç fiyatı (başlık ve JSON-LD için). */
export function catalogAnchorKurus(snapshot: PricingSnapshot): number | null {
  const prices = snapshot.technologies
    .map((t) => technologyAnchorKurus(snapshot, t.key))
    .filter((p): p is number => p !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/**
 * Yayımlanan rakam: kuruş YUKARI yuvarlanarak tam liraya çevrilir.
 *
 * Yukarı yuvarlama zorunlu: "₺74'den başlayan" cümlesi gerçek fiyatın ALTINDA
 * bir sayı gösterirse müşteriye söylenen ile ödeme ekranındaki rakam çelişir.
 */
export function formatAnchorPrice(kurus: number): string {
  return `₺${Math.ceil(kurus / 100).toLocaleString("tr-TR")}`;
}

/** Sayfada geçen çapa cümlesi. Tek yerden üretilir ki her yerde aynı olsun. */
export function anchorSentence(kurus: number): string {
  return `${formatAnchorPrice(kurus)}'den başlayan`;
}

/** JSON-LD'nin beklediği ondalık dizgi (`"74.00"`). */
export function anchorJsonPrice(kurus: number): string {
  return (Math.ceil(kurus / 100)).toFixed(2);
}
