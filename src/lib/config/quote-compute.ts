/**
 * Teklifin TEK hesap giriş noktası.
 *
 * Servisler, sunucu bileşenleri, ödeme rotası ve admin simülatörü fiyatı
 * BURADAN alır. İkinci bir hesap yolu olsaydı, müşteriye gösterilen tutar ile
 * tahsil edilen tutarın ayrışması an meselesi olurdu; ödeme rotası bu yüzden
 * istemciden gelen tutarı doğrulamaz, snapshot'tan yeniden hesaplar.
 *
 * SAF MODÜL: DB yok, `server-only` yok, `node:` import'u yok — BullMQ worker'ı
 * da import eder.
 */
import { KDV_RATE_BPS } from "@/lib/config/prices";
import { computeKdv } from "@/lib/services/finance";
import type {
  ComputedPart,
  ComputedQuote,
  DfmIssue,
  LeadOption,
  LeadTierKey,
  PartConfig,
  PartGeometry,
  PartPriceResult,
  PriceBreakPoint,
  PricingPartInput,
  PricingSnapshot,
  QuoteLevelInput,
  QuoteTotals,
  Vec3,
} from "@/lib/config/quote-types";
import { evaluatePartDfm, hasBlockingError, hasHardBlocker } from "@/lib/config/quote-dfm";
import { partPricingKey } from "@/lib/config/quote-keys";
import {
  addonLines,
  applyTierDays,
  leadTier,
  partLeadDaysBase,
  priceUnitAuto,
} from "@/lib/config/quote-pricing";
import { suggestUnits } from "@/lib/config/quote-units";

/** Fiyat verilemeyen parçanın müşteriye gösterilecek gerekçe türü. */
function refusalReason(issues: DfmIssue[]): "not_ready" | "dfm_error" | "config_invalid" {
  const codes = new Set(issues.filter((i) => i.severity === "error").map((i) => i.code));
  if (codes.has("analysis_pending") || codes.has("analysis_failed")) return "not_ready";
  if (codes.has("config_invalid")) return "config_invalid";
  return "dfm_error";
}

function bySortOrder<T extends { sortOrder: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Katalogdaki EN BÜYÜK baskı zarfı — birim önerisi için üst sınır. */
function largestBuild(snapshot: PricingSnapshot): Vec3 {
  return snapshot.technologies.reduce<Vec3>(
    (acc, t) => ({
      x: Math.max(acc.x, t.buildMm.x),
      y: Math.max(acc.y, t.buildMm.y),
      z: Math.max(acc.z, t.buildMm.z),
    }),
    { x: 0, y: 0, z: 0 }
  );
}

/**
 * Yeni bir parçanın başlangıç konfigürasyonu: kataloğun ilk (en düşük
 * `sortOrder`) geçerli seçenekleri + geometriden türeyen birim önerisi.
 */
export function defaultPartConfig(
  snapshot: PricingSnapshot,
  g: PartGeometry | null
): PartConfig {
  const tech = bySortOrder(snapshot.technologies)[0] ?? null;
  const material = tech
    ? bySortOrder(snapshot.materials.filter((m) => m.technologyKey === tech.key))[0] ?? null
    : null;
  const finish = tech
    ? bySortOrder(
        snapshot.finishes.filter((f) => f.technologyKey === null || f.technologyKey === tech.key)
      )[0] ?? null
    : null;

  return {
    technologyKey: tech?.key ?? "",
    materialKey: material?.key ?? "",
    colorKey: material?.colors[0]?.key ?? "",
    finishKey: finish?.key ?? "",
    layerUm: tech?.defaultLayerUm ?? null,
    infillPct: tech?.defaultInfillPct ?? null,
    quantity: 1,
    units: (g ? suggestUnits(g, largestBuild(snapshot)) : null) ?? "mm",
    scale: 1,
    criticalTolerance: false,
  };
}

interface TierResult {
  parts: ComputedPart[];
  totals: QuoteTotals;
}

function computeForTier(
  snapshot: PricingSnapshot,
  parts: PricingPartInput[],
  addonKeys: string[],
  tierKey: LeadTierKey
): TierResult {
  const tier = leadTier(snapshot, tierKey);
  const computedParts: ComputedPart[] = [];

  for (const part of parts) {
    const dfm = evaluatePartDfm(part, snapshot);
    const manualUnitKurus =
      part.manualPriceKey !== null && part.manualPriceKey === partPricingKey(part, tierKey)
        ? part.manualUnitPriceKurus
        : null;
    const manualValid = manualUnitKurus !== null;

    // Geçerli manuel fiyat, "elle fiyatlansın" anlamına gelen hataları kapatır;
    // analiz/konfig hatalarını kapatmaz.
    const blocking = manualValid ? hasHardBlocker(dfm.issues) : hasBlockingError(dfm.issues);
    const partDfm = { ...dfm, blocking };

    let price: PartPriceResult;
    if (blocking) {
      price = { ok: false, reason: refusalReason(dfm.issues) };
    } else {
      const leadDays = applyTierDays(partLeadDaysBase(snapshot, part.config), tier);
      if (manualUnitKurus !== null) {
        price = {
          ok: true,
          source: "manual",
          unitKurus: manualUnitKurus,
          lineKurus: manualUnitKurus * part.config.quantity,
          breakdown: null,
          // Manuel fiyat TEK adet-kademesi için verilmiştir; kademe tablosu
          // göstermek müşteriye tutmayacağımız bir söz vermek olurdu.
          priceBreaks: [],
          leadDays,
        };
      } else {
        const scaled = partDfm.scaled;
        if (scaled === null) {
          // Buraya düşmek imkânsız: geometrisi olmayan parça `analysis_failed`
          // ile engellenir. Yine de sessiz yanlış fiyat üretmeyelim.
          price = { ok: false, reason: "not_ready" };
        } else {
          const auto = priceUnitAuto({
            snapshot,
            scaled,
            config: part.config,
            tier,
            quantity: part.config.quantity,
          });
          const priceBreaks: PriceBreakPoint[] = snapshot.settings.priceBreakQuantities.map(
            (quantity) => ({
              quantity,
              unitKurus: priceUnitAuto({ snapshot, scaled, config: part.config, tier, quantity })
                .unitKurus,
            })
          );
          price = {
            ok: true,
            source: "auto",
            unitKurus: auto.unitKurus,
            lineKurus: auto.unitKurus * part.config.quantity,
            breakdown: auto.breakdown,
            priceBreaks,
            leadDays,
          };
        }
      }
    }

    computedParts.push({ id: part.id, dfm: partDfm, price });
  }

  const partCount = parts.length;
  const unitCount = parts.reduce((sum, p) => sum + p.config.quantity, 0);
  const lines = addonLines(snapshot, addonKeys, partCount, unitCount);
  const addonsKurus = lines.reduce((sum, l) => sum + l.kurus, 0);
  const partsKurus = computedParts.reduce((sum, p) => (p.price.ok ? sum + p.price.lineKurus : sum), 0);

  const allPriced = partCount > 0 && computedParts.every((p) => p.price.ok);
  const minOrderTopUpKurus = allPriced
    ? Math.max(0, snapshot.settings.minOrderKurus - (partsKurus + addonsKurus))
    : 0;
  const totalKurus = partsKurus + addonsKurus + minOrderTopUpKurus;
  const kdv = computeKdv(totalKurus, KDV_RATE_BPS);

  let leadDays: number | null = null;
  if (allPriced) {
    const partBase = parts.reduce((max, p) => Math.max(max, partLeadDaysBase(snapshot, p.config)), 0);
    const addonExtra = snapshot.addons
      .filter((a) => addonKeys.includes(a.key))
      .reduce((max, a) => Math.max(max, a.leadDaysExtra), 0);
    leadDays = applyTierDays(partBase + addonExtra, tier);
  }

  return {
    parts: computedParts,
    totals: {
      allPriced,
      partsKurus,
      addonLines: lines,
      addonsKurus,
      minOrderTopUpKurus,
      totalKurus,
      kdvExcludedKurus: kdv.subtotalKurus,
      kdvKurus: kdv.kdvKurus,
      leadDays,
    },
  };
}

/**
 * Teklifin tamamını hesaplar: parça başına DfM + fiyat, toplamlar, teslim
 * kademesi seçenekleri ve teklif düzeyindeki konular.
 *
 * `leadOptions` her kademeyi O KADEMEYLE yeniden hesaplar — kademe çarpanı
 * toplama sonradan uygulanamaz, çünkü birim fiyat yukarı yuvarlanır. Manuel
 * fiyatlar yalnız verildikleri kademede geçerlidir; diğer kademelerde parça
 * yeniden engellenir ve o kademenin toplamı `null` gösterilir.
 */
export function computeQuote(
  snapshot: PricingSnapshot,
  parts: PricingPartInput[],
  q: QuoteLevelInput
): ComputedQuote {
  const main = computeForTier(snapshot, parts, q.addonKeys, q.leadTier);

  const leadOptions: LeadOption[] = snapshot.settings.leadTiers.map((tier) => {
    const result =
      tier.key === q.leadTier ? main : computeForTier(snapshot, parts, q.addonKeys, tier.key);
    return {
      key: tier.key,
      name: tier.name,
      leadDays: result.totals.leadDays,
      totalKurus: result.totals.allPriced ? result.totals.totalKurus : null,
    };
  });

  const quoteIssues: DfmIssue[] = [];
  if (main.totals.totalKurus > snapshot.settings.maxAutoTotalKurus) {
    // Teklif DÜZEYİNDE "anlık fiyat sınırı aşıldı". Kendi kodu yok: parça
    // düzeyindeki `qty_over_auto` ile aynı sonuca (RFQ) çıkar, `reason` ayırır.
    quoteIssues.push({
      code: "qty_over_auto",
      severity: "error",
      params: { reason: "total", maxTotalKurus: snapshot.settings.maxAutoTotalKurus },
    });
  }

  return { parts: main.parts, totals: main.totals, leadOptions, quoteIssues };
}
