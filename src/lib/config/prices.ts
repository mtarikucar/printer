export type FigurineMaterial = "resin" | "filament";

// Per-material price table (kuruş). Resin is the premium base (+₺400 per size
// step); filament (FDM) starts at ₺899 and steps +₺300. The resin premium grows
// with size (₺100/₺200/₺300) because resin material cost scales with volume.
// Tune values freely — this is the single source.
export const FIGURINE_PRICES_KURUS: Record<FigurineMaterial, Record<string, number>> = {
  resin: { kucuk: 99900, orta: 139900, buyuk: 179900 },
  filament: { kucuk: 89900, orta: 119900, buyuk: 149900 },
};

// Resin table kept as PRICES_KURUS for back-compat (existing size-only callers).
export const PRICES_KURUS: Record<string, number> = FIGURINE_PRICES_KURUS.resin;

// Price for a (size, material) combo. Unknown material → resin; unknown size → 0.
export function figurinePriceKurus(size: string, material: string): number {
  const m: FigurineMaterial = material === "filament" ? "filament" : "resin";
  return FIGURINE_PRICES_KURUS[m][size] ?? FIGURINE_PRICES_KURUS.resin[size] ?? 0;
}

export type FigurineFinish =
  | "paintable_kit"
  | "hand_painted"
  | "collector_raw"
  | "luxe_display";

/**
 * Finish/package surcharge (kuruş), added on top of the (size, material) base.
 * paintable_kit is the default (mini paint kit included, no surcharge).
 * collector_raw is enum-only for now (not surfaced in the create UI). Additive
 * so the base price table is untouched — tune freely.
 */
export const FINISH_SURCHARGES_KURUS: Record<FigurineFinish, number> = {
  // Boyanabilir Kit — default: resin print, sanded, primed + a mini paint kit.
  // Included in the base price (no surcharge).
  paintable_kit: 0,
  // Collector Raw — unpainted high-detail resin print, no paint kit. For
  // collectors/DIY who use their own paints; ₺100 less than the kit.
  collector_raw: -10000,
  // Hand-Painted — professional hand painting + QC photo + gift box. +₺1.000.
  hand_painted: 100000,
  // Luxe Display — premium base + name plate + hard case + full hand paint.
  // +₺1.000 over hand-painted for the display extras. +₺2.000 total.
  luxe_display: 200000,
};

// Surcharge for a finish key. Unknown finish → 0 (treated as the default kit).
export function finishSurchargeKurus(finish: string | null | undefined): number {
  if (!finish) return 0;
  return FINISH_SURCHARGES_KURUS[finish as FigurineFinish] ?? 0;
}

/**
 * Checkout add-on SKUs (Q10). All prices in kuruş. Keys are stable identifiers
 * persisted on `orderDrafts.upsells` + `orders.upsells`, so do NOT rename
 * without a migration: existing rows will become orphaned.
 *
 * Each key is also a dictionary key prefix:
 *   `upsell.<key>.label`        — human-readable title shown to customer
 *   `upsell.<key>.description`  — short blurb under the checkbox
 */
export const UPSELL_PRICES_KURUS: Record<string, number> = {
  extra_paint: 4900,
  gift_wrap: 2900,
  rush_shipping: 7900,
  // Digital deliverable: the print-ready STL + OBJ files of the customer's
  // design, downloadable after payment from their order page. The raw files
  // are otherwise never exposed (the preview only shows the GLB).
  digital_files: 9900,
};

export const VALID_UPSELLS = Object.keys(UPSELL_PRICES_KURUS) as Array<
  keyof typeof UPSELL_PRICES_KURUS
>;

/**
 * Compute the kuruş total for a (deduplicated, validated) list of upsell keys.
 * Unknown keys are silently dropped so a stale client can't pollute the total —
 * server-side validation still rejects unknown keys upstream via zod.
 */
export function calculateUpsellAmount(upsells: string[] | null | undefined): number {
  if (!upsells || upsells.length === 0) return 0;
  const seen = new Set<string>();
  let total = 0;
  for (const key of upsells) {
    if (seen.has(key)) continue;
    seen.add(key);
    const price = UPSELL_PRICES_KURUS[key];
    if (price) total += price;
  }
  return total;
}

export interface PaytrBasketRow {
  name: string;
  /** Two-decimal stringified TRY, e.g. "1399.00" — PayTR's format. */
  priceTRY: string;
  quantity: number;
}

/**
 * Allocate `paymentAmountKurus` across the figurine row and one row
 * per selected upsell so the basket sum exactly equals
 * paymentAmountKurus. Handles the edge case (review C3) where a gift
 * card covers most of the figurine but the upsell total exceeds the
 * remaining payment — the naive "figurine = payment - upsells" math
 * would go negative and PayTR would reject the basket.
 *
 * Strategy: clamp the figurine row to 0 (never negative), then
 * distribute the remaining payment budget across upsells largest-first.
 * Zero-allocated upsell rows are filtered out so PayTR statement
 * doesn't show empty lines.
 *
 * Caller is responsible for ensuring `paymentAmountKurus >= 0` (fully
 * covered orders skip the PayTR path entirely).
 */
export function allocatePaytrBasket(args: {
  paymentAmountKurus: number;
  figurineName: string;
  upsellAmountKurus: number;
  upsellKeys: string[];
  upsellLabel: (key: string) => string;
}): PaytrBasketRow[] {
  const figurineGross = args.paymentAmountKurus - args.upsellAmountKurus;
  let figurineRowKurus = Math.max(0, figurineGross);
  let upsellBudget = args.paymentAmountKurus - figurineRowKurus;

  const sortedUpsells = [...args.upsellKeys].sort(
    (a, b) => (UPSELL_PRICES_KURUS[b] ?? 0) - (UPSELL_PRICES_KURUS[a] ?? 0)
  );

  const upsellBasketRows: PaytrBasketRow[] = [];
  for (const key of sortedUpsells) {
    const full = UPSELL_PRICES_KURUS[key] ?? 0;
    const allocated = Math.max(0, Math.min(full, upsellBudget));
    upsellBudget -= allocated;
    if (allocated > 0) {
      upsellBasketRows.push({
        name: args.upsellLabel(key),
        priceTRY: (allocated / 100).toFixed(2),
        quantity: 1,
      });
    }
  }
  figurineRowKurus += upsellBudget;

  return [
    {
      name: args.figurineName,
      priceTRY: (figurineRowKurus / 100).toFixed(2),
      quantity: 1,
    },
    ...upsellBasketRows,
  ];
}

// ─── Finance (Faz 2) ────────────────────────────────────────────────────────
// Platform commission: the share of each paid order the platform keeps; the
// manufacturer/painter is paid the remainder. Basis points (3500 = 35%). Tune
// freely — but keep the manufacturer + painter onboarding agreements in sync
// (they state the rate explicitly).
export const PLATFORM_COMMISSION_RATE_BPS = 3500;

// Turkish VAT (KDV) applied to customer invoices. Catalogue prices are
// KDV-inclusive, so the invoice breaks the paid total into base + KDV.
export const KDV_RATE_BPS = 2000; // 20%

// Professional painting is NOT a separate add-on price: it is the existing
// "hand_painted" figurine finish (see FINISH_SURCHARGES_KURUS.hand_painted).
// Orders with that finish are routed to a painter partner, and its surcharge
// becomes the painter's earning base — see src/app/api/orders/route.ts.

// ─── Faz 3: customer-uploaded model pricing (geometry-based) ─────────────────
// Price is driven by the *scaled* print volume — the model-prep worker scales
// the mesh to the customer's target height, then measures volume. Resin is the
// premium material. All values in kuruş; tune freely.
export const UPLOAD_MODEL_BASE_KURUS: Record<FigurineMaterial, number> = {
  resin: 9900, // ₺99 setup/handling base
  filament: 6900, // ₺69
};
export const UPLOAD_MODEL_PER_CM3_KURUS: Record<FigurineMaterial, number> = {
  resin: 1500, // ₺15 / cm³
  filament: 900, // ₺9 / cm³
};
// Floors must at least cover packaging + free shipping (Yurtiçi ~₺100) on top
// of the manufacturer's 70% share — a ₺99 print order would ship at a loss.
export const UPLOAD_MODEL_MIN_KURUS: Record<FigurineMaterial, number> = {
  resin: 19900, // ₺199 floor
  filament: 14900, // ₺149 floor
};
// Above this auto price — or outside the print envelope — fall back to a manual
// quote rather than charging automatically.
export const UPLOAD_MODEL_MAX_AUTO_KURUS = 5_000_000; // ₺50,000
export const PRINT_ENVELOPE_MM = { x: 220, y: 220, z: 250 };

/**
 * Auto price (kuruş) for an uploaded model from its SCALED print volume.
 * `volumeMm3` is the volume after scaling to the target height. Unknown material
 * → resin. Rounded to the nearest ₺1, floored at the per-material minimum.
 */
export function uploadModelPriceKurus(volumeMm3: number, material: string): number {
  const m: FigurineMaterial = material === "filament" ? "filament" : "resin";
  const volumeCm3 = Math.max(0, volumeMm3) / 1000; // mm³ → cm³
  const raw = UPLOAD_MODEL_BASE_KURUS[m] + volumeCm3 * UPLOAD_MODEL_PER_CM3_KURUS[m];
  const rounded = Math.round(raw / 100) * 100; // nearest ₺1
  return Math.max(UPLOAD_MODEL_MIN_KURUS[m], rounded);
}

/**
 * Whether an uploaded model must go to a manual quote instead of auto pricing.
 * Trips when geometry isn't a closed volume, the auto price exceeds the cap, or
 * the bounding box exceeds the print envelope.
 */
export function uploadModelNeedsQuote(args: {
  isVolume: boolean | null;
  volumeMm3: number | null;
  boundingBoxMm: { x: number; y: number; z: number } | null;
  material: string;
}): boolean {
  if (!args.isVolume || !args.volumeMm3 || args.volumeMm3 <= 0) return true;
  if (uploadModelPriceKurus(args.volumeMm3, args.material) > UPLOAD_MODEL_MAX_AUTO_KURUS) {
    return true;
  }
  const bb = args.boundingBoxMm;
  if (
    bb &&
    (bb.x > PRINT_ENVELOPE_MM.x || bb.y > PRINT_ENVELOPE_MM.y || bb.z > PRINT_ENVELOPE_MM.z)
  ) {
    return true;
  }
  return false;
}

// ─── Per-type pricing + services (Faz 1) ─────────────────────────────────────
// Figure keeps the 4 character packages above. Object/design/upload are
// geometry prints with their own (lower) base table + a simpler finish set
// (raw/smoothed/painted) — "hand_painted/luxe_display" only make sense for
// character figurines.

// Object/design base — decorative prints, below figurine (no character sculpt).
export const OBJECT_PRICES_KURUS: Record<FigurineMaterial, Record<string, number>> = {
  resin: { kucuk: 79900, orta: 109900, buyuk: 149900 },
  filament: { kucuk: 54900, orta: 84900, buyuk: 119900 },
};
export function objectPriceKurus(size: string, material: string): number {
  const m: FigurineMaterial = material === "filament" ? "filament" : "resin";
  return OBJECT_PRICES_KURUS[m][size] ?? OBJECT_PRICES_KURUS.resin[size] ?? 0;
}

// Geometry-print finishes (object / design / upload).
export type ObjectFinish = "raw" | "smoothed" | "painted";
export const OBJECT_FINISH_SURCHARGES_KURUS: Record<ObjectFinish, number> = {
  raw: 0, // as-printed, supports removed
  smoothed: 15000, // +₺150 sanded + primed
  painted: 40000, // +₺400 single-colour / basic paint
};
export function objectFinishSurchargeKurus(finish: string | null | undefined): number {
  if (!finish) return 0;
  return OBJECT_FINISH_SURCHARGES_KURUS[finish as ObjectFinish] ?? 0;
}

// Design = an object produced from a 2D source → object pricing + object finishes.
export function designPriceKurus(size: string, material: string): number {
  return objectPriceKurus(size, material);
}

// ─── Creative Lab products (photo → keychain / fridge magnet / lamp) ──────────
// Flat-priced small physical products (no size/material/finish axis). The
// customer approves a fal.ai image, then the admin sculpts + prints the item.
// Tune values freely — this is the single source. (₺: keychain 149, magnet 129,
// lamp 399.)
export type CreativeLabKind = "keychain" | "fridge_magnet" | "lamp";
export const CREATIVE_LAB_PRICES_KURUS: Record<CreativeLabKind, number> = {
  keychain: 14900,
  fridge_magnet: 12900,
  lamp: 39900,
};
export function creativeLabPriceKurus(kind: string): number {
  return CREATIVE_LAB_PRICES_KURUS[kind as CreativeLabKind] ?? 0;
}

// ─── Dispatcher: one trusted entry point for a bespoke item's base+finish ────
export type ItemKind =
  | "figure"
  | "object"
  | "design"
  | "upload"
  | CreativeLabKind;
export function itemPriceKurus(args: {
  kind: ItemKind;
  size?: string; // figure / object / design
  material: string;
  finish?: string | null;
  volumeMm3?: number; // upload (scaled volume)
}): number {
  const { kind, size = "orta", material, finish, volumeMm3 } = args;
  if (kind === "keychain" || kind === "fridge_magnet" || kind === "lamp") {
    // Flat price — size/material/finish do not apply to these products.
    return creativeLabPriceKurus(kind);
  }
  if (kind === "upload") {
    return uploadModelPriceKurus(volumeMm3 ?? 0, material) + objectFinishSurchargeKurus(finish);
  }
  if (kind === "object" || kind === "design") {
    return objectPriceKurus(size, material) + objectFinishSurchargeKurus(finish);
  }
  return figurinePriceKurus(size, material) + finishSurchargeKurus(finish);
}
