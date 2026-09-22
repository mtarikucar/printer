/**
 * DfM (Design for Manufacturing) denetimi: bu parça ANLIK fiyatlanabilir mi,
 * yoksa müşterinin bilmesi gereken bir şey mi var?
 *
 * İki şiddet düzeyi iş anlamı taşır:
 *  - `error`   → anlık fiyat YOK; parça manuel teklife düşer (ya da düzeltilir).
 *  - `warning` → fiyat verilir ama müşteri ödemeden önce onaylar (`dfmAckKey`).
 *
 * Mesaj metinleri BURADA DEĞİL: kod + parametre döner, Türkçe cümleyi arayüz
 * `instantQuote.dfm.*` sözlüğünden kurar.
 *
 * SAF MODÜL: DB yok, `server-only` yok, `node:` import'u yok.
 */
import type {
  DfmCode,
  DfmIssue,
  PartDfmResult,
  PartGeometry,
  PricingPartInput,
  PricingSnapshot,
  ScaledGeometry,
  SnapshotTechnology,
} from "@/lib/config/quote-types";
import { dfmWarningKey } from "@/lib/config/quote-keys";
import { findFinish, findMaterial, findTechnology } from "@/lib/config/quote-pricing";
import { scaledGeometry, sortedExtents } from "@/lib/config/quote-units";

/** En büyük boyutu bunun altında olan bir parça basılamaz (mm). */
const MIN_LARGEST_DIMENSION_MM = 2;

/**
 * Geçerli bir manuel fiyat bile bu hataları AÇAMAZ: admin fiyat girse de
 * analizi bitmemiş, başarısız ya da kataloğa uymayan bir parça üretime giremez.
 * Diğer hatalar (büyük parça, boyalı yüzey, kritik tolerans, yüksek adet) zaten
 * "elle fiyatlansın" demektir ve manuel fiyatla kapanır.
 */
const MANUAL_PROOF_CODES: ReadonlySet<DfmCode> = new Set<DfmCode>([
  "analysis_pending",
  "analysis_failed",
  "config_invalid",
]);

/** Manuel fiyatın AÇAMAYACAĞI bir hata var mı? */
export function hasHardBlocker(issues: DfmIssue[]): boolean {
  return issues.some((i) => i.severity === "error" && MANUAL_PROOF_CODES.has(i.code));
}

export function hasBlockingError(issues: DfmIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** 2 basamağa AŞAĞI yuvarlar — önerilen ölçek asla sığmayan bir değer olmamalı. */
function floorTo2(value: number): number {
  return Math.floor(value * 100 + 1e-9) / 100;
}

function fits(sortedMm: readonly number[], tech: SnapshotTechnology): boolean {
  const build = sortedExtents(tech.buildMm);
  return sortedMm.every((v, i) => v <= (build[i] as number));
}

/** Konfigürasyon snapshot'a uyuyor mu? */
function configInvalid(part: PricingPartInput, snapshot: PricingSnapshot): boolean {
  const { config } = part;
  const tech = findTechnology(snapshot, config.technologyKey);
  if (!tech) return true;
  const material = findMaterial(snapshot, config.technologyKey, config.materialKey);
  if (!material) return true;
  if (!material.colors.some((c) => c.key === config.colorKey)) return true;
  // `findFinish` teknoloji uyuşmazlığını da eler.
  if (!findFinish(snapshot, config.technologyKey, config.finishKey)) return true;
  if (config.layerUm !== null && !tech.layerOptionsUm.includes(config.layerUm)) return true;
  if (tech.infillOptionsPct === null) {
    // SLA katı basar: doluluk yüzdesi BOŞ olmak zorunda.
    if (config.infillPct !== null) return true;
  } else if (config.infillPct !== null && !tech.infillOptionsPct.includes(config.infillPct)) {
    return true;
  }
  if (!Number.isInteger(config.quantity) || config.quantity < 1) return true;
  if (!(config.scale > 0)) return true;
  return false;
}

function geometryIssues(
  scaled: ScaledGeometry,
  geometry: PartGeometry,
  snapshot: PricingSnapshot,
  tech: SnapshotTechnology,
  scale: number
): DfmIssue[] {
  const issues: DfmIssue[] = [];
  const sorted = scaled.sortedMm;

  if (scaled.volumeCm3 === null) {
    issues.push({ code: "no_volume", severity: "error" });
  } else if (!geometry.isVolume && geometry.volumeEstimated) {
    // Hacim ancak onarılmış kopyadan tahmin edilebildi: fiyat verilebilir ama
    // müşteri "ağırlık tahminî" olduğunu bilmeli.
    issues.push({ code: "not_watertight", severity: "warning" });
  }

  if (!fits(sorted, tech)) {
    const params: DfmIssue["params"] = {
      maxX: tech.buildMm.x,
      maxY: tech.buildMm.y,
      maxZ: tech.buildMm.z,
    };
    const alternative = snapshot.technologies.find((t) => t.key !== tech.key && fits(sorted, t));
    if (alternative) params.fitsTechnology = alternative.key;
    const build = sortedExtents(tech.buildMm);
    const ratio = Math.min(...sorted.map((v, i) => (build[i] as number) / v));
    // `fitScale` MUTLAK ölçektir: `config.scale` alanına DOĞRUDAN yazılacak değer
    // (arayüz mevcut ölçekle ÇARPMAZ, ATAR). `scale = 1` iken oran ile aynıdır.
    // Aşağı yuvarlanır ki önerilen ölçek her zaman gerçekten sığsın; 2 basamakta
    // 0'a düşüyorsa (çok küçük ölçek) parametre hiç yazılmaz.
    const fitScale = floorTo2(scale * ratio);
    if (fitScale > 0) params.fitScale = fitScale;
    issues.push({ code: "too_large", severity: "error", params });
  }

  if (sorted[2] < MIN_LARGEST_DIMENSION_MM) {
    issues.push({
      code: "too_small",
      severity: "error",
      params: { largestMm: roundTo(sorted[2], 2), minMm: MIN_LARGEST_DIMENSION_MM },
    });
  }

  if (scaled.wallP1Mm !== null && scaled.wallP1Mm < tech.minWallMm) {
    issues.push({
      code: "thin_walls",
      severity: "warning",
      params: { wallMm: roundTo(scaled.wallP1Mm, 1), minMm: tech.minWallMm },
    });
  }

  if (geometry.bodyCount > 1) {
    issues.push({
      code: "multiple_bodies",
      severity: "warning",
      params: { count: geometry.bodyCount },
    });
  }

  return issues;
}

/**
 * Parçanın DfM sonucu.
 *
 * `blocking` burada MANUEL FİYAT BİLİNMEDEN hesaplanır (hata varsa true), çünkü
 * manuel fiyatın geçerliliği seçili teslim KADEMESİNE bağlıdır ve bu fonksiyonun
 * imzasında kademe yoktur. Nihai `blocking` değerini `computeQuote` yazar; bir
 * yüzey "fiyat verilebilir mi" sorusunu DAİMA `ComputedPart.dfm`'den okumalıdır.
 */
export function evaluatePartDfm(
  part: PricingPartInput,
  snapshot: PricingSnapshot
): PartDfmResult {
  const issues: DfmIssue[] = [];
  const { config } = part;

  const invalid = configInvalid(part, snapshot);
  if (invalid) issues.push({ code: "config_invalid", severity: "error" });

  const tech = findTechnology(snapshot, config.technologyKey);
  const finish = findFinish(snapshot, config.technologyKey, config.finishKey);

  let scaled: ScaledGeometry | null = null;
  if (part.analysisStatus === "queued" || part.analysisStatus === "analyzing") {
    // Hata şiddetinde ama "manuel fiyat iste" değil "birkaç saniye bekle" demek.
    issues.push({ code: "analysis_pending", severity: "error" });
  } else if (part.analysisStatus === "failed" || part.geometry === null) {
    issues.push({ code: "analysis_failed", severity: "error" });
  } else {
    scaled = scaledGeometry(part.geometry, config.units, config.scale);
    // Konfig geçersiz olsa bile (ör. bilinmeyen renk) geometri kontrolleri
    // çalışır: müşteri iki sorunu tek seferde görsün.
    if (tech)
      issues.push(...geometryIssues(scaled, part.geometry, snapshot, tech, config.scale));
  }

  if (config.quantity > snapshot.settings.maxAutoQtyPerPart) {
    issues.push({
      code: "qty_over_auto",
      severity: "error",
      params: { quantity: config.quantity, maxQuantity: snapshot.settings.maxAutoQtyPerPart },
    });
  }

  if (finish?.requiresManual) {
    issues.push({ code: "finish_manual", severity: "error", params: { finish: finish.key } });
  }

  if (config.criticalTolerance) {
    issues.push({ code: "tolerance_manual", severity: "error" });
  }

  const warningCodes = issues.filter((i) => i.severity === "warning").map((i) => i.code);

  return {
    issues,
    blocking: hasBlockingError(issues),
    warningKey: warningCodes.length > 0 ? dfmWarningKey(warningCodes, part) : null,
    scaled,
  };
}
