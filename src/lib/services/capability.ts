// Manufacturer capability matching for assignment. `capabilities` is a string[]
// a manufacturer declares (materials, max sizes, styles). An order derives a set
// of required capability tags; a manufacturer matches when it declares them all.
// Pure + unit-tested (scripts/test-capability.ts). The existing Q7 ranker can use
// capabilityMatch as a hard filter and capabilityScore as a soft boost.

import type {
  FrozenQuotePart,
  PricingSnapshot,
  Vec3,
} from "@/lib/config/quote-types";
import { presetHeightMm } from "@/lib/config/sizes";

/**
 * Nominal height at which an order needs a large-format printer, in mm.
 *
 * Derived from the pre-2026-08-24 rule, which required `large_format` for the
 * retired "buyuk" tier — 120 mm. Keying off the tier KEY silently broke when
 * the catalogue collapsed to one 150 mm preset: `standart` is not "buyuk", so
 * every new order stopped requiring large_format even though it is TALLER than
 * the tier that used to require it. Comparing millimetres keeps the original
 * operational intent intact across any future preset rename or resize.
 */
export const LARGE_FORMAT_MIN_MM = 120;

export function orderRequirements(opts: {
  style?: string;
  figurineSize?: string;
}): string[] {
  const reqs: string[] = [];
  // `presetHeightMm` resolves every preset ever sold (current + retired) and
  // returns null for a free-form bespoke measurement ("17,5 cm"). Free-form
  // sizes only exist on orders an admin priced and assigned BY HAND, so there
  // is no automatic requirement to derive: adding a speculative large_format
  // tag there would shrink the candidate pool for orders a human is already
  // routing. Unknown height → no requirement, same as before.
  const heightMm = opts.figurineSize ? presetHeightMm(opts.figurineSize) : null;
  if (heightMm !== null && heightMm >= LARGE_FORMAT_MIN_MM) reqs.push("large_format");
  // Stylized work (anime/storybook/chibi) benefits from a manufacturer skilled in it.
  if (opts.style && ["anime", "storybook", "chibi"].includes(opts.style)) {
    reqs.push(`style_${opts.style}`);
  }
  return reqs;
}

export function capabilityMatch(
  capabilities: string[] | null | undefined,
  required: string[]
): boolean {
  if (required.length === 0) return true;
  const set = new Set(capabilities ?? []);
  return required.every((r) => set.has(r));
}

export function capabilityScore(
  capabilities: string[] | null | undefined,
  required: string[]
): number {
  if (required.length === 0) return 1;
  const set = new Set(capabilities ?? []);
  const hit = required.filter((r) => set.has(r)).length;
  return hit / required.length;
}

// Whether a manufacturer can print the order's material. Material capabilities
// are declared as `material_<m>` tags in manufacturers.capabilities. Legacy
// behaviour: a manufacturer with no declared capabilities (or none of the
// `material_*` kind) is treated as able to print any material — so existing
// manufacturers keep receiving orders until they declare materials.
export function manufacturerSupportsMaterial(
  capabilities: string[] | null | undefined,
  material: string
): boolean {
  if (!capabilities || capabilities.length === 0) return true;
  const materialTags = capabilities.filter((c) => c.startsWith("material_"));
  if (materialTags.length === 0) return true;
  return materialTags.includes(`material_${material}`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * ANLIK TEKLİF SİPARİŞİNİN GEREKSİNİMLERİ
 *
 * Figür siparişi tek bir malzeme taşır (`orders.material`); TEKLİF siparişi ise
 * parçalarının teknolojileri kadar malzeme ve parçalarının polimerleri kadar
 * `pmat_*` etiketi ister. Kural burada, SAF hâlde durur: sıralayıcı ve atama
 * kapısı aynı cevabı aynı fonksiyondan alır.
 *
 * Gereksinimler ÖDENEN tanımdan (dondurulmuş parçalar + teklifin kendi katalog
 * anlık görüntüsü) türetilir, canlı katalogdan değil: müşteri neye para
 * ödediyse üretici onu basacak.
 * ────────────────────────────────────────────────────────────────────────── */

/** `print_materials.capability_tag` ailesinin öneki (`pmat_<slug>`). */
export const POLYMER_CAPABILITY_PREFIX = "pmat_";

/** Teklif parçasının atamayı ilgilendiren yüzü (saf; DB tipi değil). */
export interface QuoteRequirementPart {
  /** Parçanın teknolojisinin `orders.material` karşılığı. */
  orderMaterial: "resin" | "filament";
  /** Parçanın malzemesinin `pmat_*` etiketi; null = her atölye basabilir. */
  polymerTag: string | null;
  /** Ölçeklenmiş parça kutusu (mm). */
  dimsMm: Vec3;
  /** Parçanın teknolojisinin katalogdaki baskı hacmi (mm). */
  buildMm: Vec3;
}

export interface QuoteRequirements {
  /** Siparişin gerektirdiği `orders.material` değerleri (tekil, ilk görülme sırasıyla). */
  materials: Array<"resin" | "filament">;
  /** Gerekli `pmat_*` etiketleri (tekil, ilk görülme sırasıyla). */
  polymerTags: string[];
  /** Parçalardan biri büyük format makinesi istiyor mu. */
  largeFormat: boolean;
}

/**
 * Kutunun kenarları küçükten büyüğe. Sığma kontrolü YÖNDEN BAĞIMSIZDIR:
 * parça tezgâhta döndürülebilir (`ScaledGeometry.sortedMm` ile aynı duruş).
 *
 * Sayı okunamıyorsa `fallback` yazılır — çağıran, bilinmeyen bir ölçünün aday
 * havuzunu DARALTMAMASI için parça kutusuna 0, makine kutusuna ∞ verir.
 */
function sortedAxes(box: Vec3, fallback: number): [number, number, number] {
  const axes = [box.x, box.y, box.z].map((mm) => (Number.isFinite(mm) ? mm : fallback));
  axes.sort((a, b) => a - b);
  return axes as [number, number, number];
}

/**
 * Bu parça büyük format makinesi ister mi?
 *
 * İKİ tetik:
 *  1. en uzun kenarı `LARGE_FORMAT_MIN_MM` ve üstündeyse — figür tarafında
 *     yıllardır uygulanan ölçünün aynısı, tek eşik iki yüzeyde de geçerli;
 *  2. teknolojisinin KATALOGDAKİ baskı hacmine sığmıyorsa — sıradan bir
 *     makinenin kutusuna girmeyen iş, tanımı gereği büyük format işidir.
 */
function partNeedsLargeFormat(part: QuoteRequirementPart): boolean {
  const dims = sortedAxes(part.dimsMm, 0);
  if (dims[2] >= LARGE_FORMAT_MIN_MM) return true;
  const build = sortedAxes(part.buildMm, Number.POSITIVE_INFINITY);
  return dims.some((mm, axis) => mm > build[axis]);
}

/** Parçaların ortak gereksinimi. Parça yoksa hiçbir şey istenmez. */
export function quoteRequirements(
  parts: Array<QuoteRequirementPart>
): QuoteRequirements {
  const materials: Array<"resin" | "filament"> = [];
  const polymerTags: string[] = [];
  let largeFormat = false;
  for (const part of parts) {
    if (!materials.includes(part.orderMaterial)) materials.push(part.orderMaterial);
    if (part.polymerTag && !polymerTags.includes(part.polymerTag)) {
      polymerTags.push(part.polymerTag);
    }
    if (partNeedsLargeFormat(part)) largeFormat = true;
  }
  return { materials, polymerTags, largeFormat };
}

/**
 * Dondurulmuş parçalar + teklifin anlık görüntüsü → gereksinimler.
 *
 * Anlık görüntüde bulunmayan teknoloji ATLANIR (teklif yeniden fiyatlanırken
 * katalogdan kalkmış olabilir): uydurma bir malzeme yazmak siparişi yanlış
 * atölyeye gönderirdi. Hiçbir parça çözülemezse `null` döner ve çağıran
 * bugünkü kuralına (`orders.material` + figür eşiği) düşer.
 */
export function quoteRequirementsFromSnapshot(
  snapshot: PricingSnapshot,
  parts: readonly FrozenQuotePart[]
): QuoteRequirements | null {
  const resolved = parts.flatMap((part): QuoteRequirementPart[] => {
    const tech = snapshot.technologies.find((t) => t.key === part.technologyKey);
    if (!tech) return [];
    const material = snapshot.materials.find(
      (m) => m.key === part.materialKey && m.technologyKey === part.technologyKey
    );
    return [
      {
        orderMaterial: tech.orderMaterial,
        polymerTag: material?.capabilityTag ?? null,
        dimsMm: part.dimensionsMm,
        buildMm: tech.buildMm,
      },
    ];
  });
  if (resolved.length === 0) return null;
  return quoteRequirements(resolved);
}

/** Atölyenin beyanının yetmediği malzemeler (boş = sorun yok). */
export function unsupportedMaterials(
  capabilities: string[] | null | undefined,
  materials: readonly string[]
): string[] {
  return materials.filter((m) => !manufacturerSupportsMaterial(capabilities, m));
}

/** Siparişin İSTEDİĞİ her malzemeyi basabiliyor mu (tek malzemede eski kural). */
export function manufacturerSupportsAllMaterials(
  capabilities: string[] | null | undefined,
  materials: readonly string[]
): boolean {
  return unsupportedMaterials(capabilities, materials).length === 0;
}

/**
 * Atölyenin beyanının yetmediği `pmat_*` etiketleri (boş = sorun yok).
 *
 * ESNEK KURAL, `manufacturerSupportsMaterial`in yıllardır uyguladığının aynısı:
 * hiç `pmat_*` beyan etmemiş atölye HER polimeri basabilir sayılır. Canlıdaki
 * üç atölyenin üçü de hiçbir yönlendirme etiketi taşımıyor
 * (manufacturer-assign.ts:207-216); katı kural bugün atamayı herkes için
 * durdururdu.
 *
 * `pmat_*` ailesi DIŞINDAKİ bir talep de kimseyi elemez: katalogda yanlış
 * yazılmış bir etiket platformu durdurmamalı.
 */
export function missingPolymerTags(
  capabilities: string[] | null | undefined,
  tags: readonly string[]
): string[] {
  const required = tags.filter((t) => t.startsWith(POLYMER_CAPABILITY_PREFIX));
  if (required.length === 0) return [];
  const declared = (capabilities ?? []).filter((c) =>
    c.startsWith(POLYMER_CAPABILITY_PREFIX)
  );
  if (declared.length === 0) return [];
  return required.filter((t) => !declared.includes(t));
}

/** İstenen polimerlerin hepsini basabiliyor mu (esnek kural). */
export function manufacturerSupportsPolymers(
  capabilities: string[] | null | undefined,
  tags: readonly string[]
): boolean {
  return missingPolymerTags(capabilities, tags).length === 0;
}
