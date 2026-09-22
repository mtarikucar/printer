/**
 * Anlık teklif fiyat aritmetiği (spec §quote-pricing).
 *
 * Girdi yalnız DONDURULMUŞ katalog anlık görüntüsü + parça konfigürasyonudur:
 * aynı snapshot aynı fiyatı her zaman, her yerde (sunucu, worker, test) verir.
 * Admin kataloğu değiştirse bile açık teklifler kendi snapshot'ıyla bağlayıcı
 * kalır.
 *
 * Para TAMSAYI KURUŞ'tur ve fiyatlar KDV DAHİLDİR. Yuvarlama tek bir yerde,
 * birim fiyatta yapılır: `line = unit × qty` her zaman tutar, böylece müşteriye
 * gösterilen birim fiyat ile satır toplamı asla bir kuruş ayrışmaz.
 *
 * SAF MODÜL: DB yok, `server-only` yok, `node:` import'u yok — BullMQ worker'ı
 * da import eder.
 */
import type {
  AddonLine,
  LeadTier,
  LeadTierKey,
  PartConfig,
  PartPriceBreakdown,
  PricingSnapshot,
  QtyBreak,
  ScaledGeometry,
  SnapshotFinish,
  SnapshotMaterial,
  SnapshotTechnology,
} from "@/lib/config/quote-types";

export function findTechnology(s: PricingSnapshot, key: string): SnapshotTechnology | null {
  return s.technologies.find((t) => t.key === key) ?? null;
}

export function findMaterial(
  s: PricingSnapshot,
  techKey: string,
  key: string
): SnapshotMaterial | null {
  return s.materials.find((m) => m.key === key && m.technologyKey === techKey) ?? null;
}

/** `technologyKey === null` olan yüzey işlemleri her teknolojiye uygundur. */
export function findFinish(
  s: PricingSnapshot,
  techKey: string,
  key: string
): SnapshotFinish | null {
  return (
    s.finishes.find(
      (f) => f.key === key && (f.technologyKey === null || f.technologyKey === techKey)
    ) ?? null
  );
}

/** Adedin girdiği EN YÜKSEK kademenin indirimi (baz puan). */
export function qtyDiscountBps(breaks: QtyBreak[], qty: number): number {
  let bps = 0;
  let best = -1;
  for (const b of breaks) {
    if (qty >= b.minQty && b.minQty > best) {
      best = b.minQty;
      bps = b.discountBps;
    }
  }
  return bps;
}

/**
 * Teslim kademesi. Snapshot'ta yoksa NÖTR kademe döner (çarpan 1, gün farkı 0):
 * eksik bir kademe yüzünden fiyat hesabının patlaması, yanlış kademeyle
 * fiyatlamaktan daha kötüdür — arayüz zaten yalnız snapshot'taki kademeleri
 * gösterir.
 */
export function leadTier(s: PricingSnapshot, key: LeadTierKey): LeadTier {
  return (
    s.settings.leadTiers.find((t) => t.key === key) ?? {
      key,
      name: key,
      multiplierBps: 10000,
      daysDelta: 0,
      minDays: 0,
    }
  );
}

/** Baz puan paydası: 10000 bps = %100. */
const BPS_SCALE = 10000;

/**
 * Bir değerin `bps` baz puanlık kısmı. YUVARLAMA YOK — burada yuvarlamak
 * (`computeEarning` gibi) birim fiyatı adede bölmeden önce kuruş kaybettirir;
 * tek yuvarlama nihai birim fiyatta yapılır.
 */
function applyBps(value: number, bps: number): number {
  return (value * bps) / BPS_SCALE;
}

/**
 * Kayan nokta artığına karşı tampon: `4660 × 1.4` gibi tam bölünen çarpımlar
 * IEEE-754'te 6524.000000000001 çıkabilir ve `Math.ceil` bir kuruş fazla yazar.
 */
const CEIL_EPSILON = 1e-9;

function ceilKurus(value: number): number {
  return Math.ceil(value - CEIL_EPSILON);
}

/**
 * Bir parçanın OTOMATİK birim fiyatı (KDV dahil kuruş) ve dökümü.
 *
 * ÖN KOŞUL: konfig snapshot'a uygun olmalı (`evaluatePartDfm` → `config_invalid`
 * yoksa). `computeQuote` bunu garanti eder; doğrudan çağıran biri geçersiz
 * konfig verirse fonksiyon sessizce yanlış fiyat üretmek yerine hata atar.
 */
export function priceUnitAuto(args: {
  snapshot: PricingSnapshot;
  scaled: ScaledGeometry;
  config: PartConfig;
  tier: LeadTier;
  quantity: number;
}): { unitKurus: number; breakdown: PartPriceBreakdown } {
  const { snapshot, scaled, config, tier, quantity } = args;

  const tech = findTechnology(snapshot, config.technologyKey);
  if (!tech) throw new Error(`Bilinmeyen teknoloji: ${config.technologyKey}`);
  const material = findMaterial(snapshot, config.technologyKey, config.materialKey);
  if (!material) throw new Error(`Bilinmeyen malzeme: ${config.materialKey}`);
  const finish = findFinish(snapshot, config.technologyKey, config.finishKey);
  if (!finish) throw new Error(`Bilinmeyen yüzey işlemi: ${config.finishKey}`);
  if (!(quantity > 0)) throw new Error(`Geçersiz adet: ${quantity}`);

  const volumeCm3 = scaled.volumeCm3;
  if (volumeCm3 === null) throw new Error("Hacim ölçülemeyen parça fiyatlanamaz");
  const areaCm2 = scaled.areaCm2;

  // 1) Efektif hacim: FDM içi boş basar (kabuk + doluluk), SLA katı basar.
  let effectiveVolumeCm3: number;
  if (tech.infillOptionsPct) {
    const shell = Math.min(volumeCm3, (areaCm2 * tech.shellMm) / 10);
    const infillPct = config.infillPct ?? tech.defaultInfillPct ?? 100;
    effectiveVolumeCm3 = shell + ((volumeCm3 - shell) * infillPct) / 100;
  } else {
    effectiveVolumeCm3 = volumeCm3;
  }

  // 2) Malzeme: destek yapıları da malzeme yer.
  const grams = effectiveVolumeCm3 * material.densityGCm3 * material.supportFactor;
  const materialCost = grams * material.priceKurusPerGram;

  // 3) Makine: hacimsel debi + katman sayısını belirleyen YÜKSEKLİK. Parça en
  // küçük boyutu dik gelecek şekilde yerleştirilir, bu yüzden z = en küçük boyut.
  const z = scaled.sortedMm[0];
  const layerUm = config.layerUm ?? tech.defaultLayerUm;
  const layerK = tech.defaultLayerUm / layerUm;
  const hours = (effectiveVolumeCm3 / tech.throughputCm3PerHour + z * tech.heightHoursPerMm) * layerK;
  const machineCost = hours * tech.machineRateKurusPerHour;

  // 4) Yüzey işlemi + renk ek ücreti.
  const finishCost = finish.fixedKurus + areaCm2 * finish.perCm2Kurus;
  const colorCost =
    material.colors.find((c) => c.key === config.colorKey)?.surchargeKurus ?? 0;

  // 5) Taban fiyat: küçücük bir parça bile tezgâhı işgal eder.
  const unitBase = Math.max(
    materialCost + machineCost + finishCost + colorCost,
    tech.minUnitPriceKurus
  );

  // 6) Adet indirimi, kurulum ücretinin adede bölünmesi ve kademe çarpanı.
  const discountBps = qtyDiscountBps(snapshot.settings.qtyBreaks, quantity);
  const unitDiscounted = applyBps(unitBase, BPS_SCALE - discountBps);
  const unitKurus = ceilKurus(
    applyBps((tech.setupFeeKurus + unitDiscounted * quantity) / quantity, tier.multiplierBps)
  );

  return {
    unitKurus,
    breakdown: {
      // Döküm BİLGİLENDİRİCİDİR: taban fiyat (minUnitPriceKurus) devreye
      // girdiğinde kalemlerin toplamı birim fiyatı vermez. Bağlayıcı olan
      // `unitKurus`tur.
      materialKurus: Math.round(materialCost),
      machineKurus: Math.round(machineCost),
      finishKurus: Math.round(finishCost),
      colorKurus: colorCost,
      setupKurus: tech.setupFeeKurus,
      qtyDiscountBps: discountBps,
      tierMultiplierBps: tier.multiplierBps,
      grams,
      hours,
      effectiveVolumeCm3,
    },
  };
}

/** Parçanın kademe UYGULANMAMIŞ iş günü tabanı. */
export function partLeadDaysBase(s: PricingSnapshot, config: PartConfig): number {
  const tech = findTechnology(s, config.technologyKey);
  const material = findMaterial(s, config.technologyKey, config.materialKey);
  const finish = findFinish(s, config.technologyKey, config.finishKey);
  return (tech?.baseLeadDays ?? 0) + (material?.leadDaysExtra ?? 0) + (finish?.leadDaysExtra ?? 0);
}

/** Kademe uygulanmış iş günü — hiçbir kademe kendi alt sınırının altına inemez. */
export function applyTierDays(base: number, tier: LeadTier): number {
  return Math.max(tier.minDays, base + tier.daysDelta);
}

/**
 * Seçili ek hizmetlerin satırları. Sıra snapshot'ın `sortOrder`'ıdır (girdi
 * sırası değil) ve snapshot'ta olmayan anahtarlar sessizce düşer — katalogdan
 * kaldırılmış bir ek hizmet eski teklifi bozmaz.
 */
export function addonLines(
  s: PricingSnapshot,
  addonKeys: string[],
  partCount: number,
  unitCount: number
): AddonLine[] {
  const selected = new Set(addonKeys);
  return s.addons
    .filter((a) => selected.has(a.key))
    .map((a) => {
      const multiplier =
        a.priceType === "per_part" ? partCount : a.priceType === "per_unit" ? unitCount : 1;
      return { key: a.key, name: a.name, kurus: a.priceKurus * multiplier };
    });
}
