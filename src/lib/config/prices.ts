import { isSizePreset, type SizePresetKey } from "./sizes";

export type FigurineMaterial = "resin" | "filament";

/**
 * Only the catalogue tiers have a price. A bespoke size ("17,5 cm") is quoted
 * by hand — the admin types the line-item price on the manual order.
 */
export function isPriceableSize(
  size: string | null | undefined
): size is SizePresetKey {
  return isSizePreset(size);
}

export class UnpricedSizeError extends Error {
  constructor(public readonly size: string | null | undefined) {
    super(`Fiyatlanamayan boyut: ${size ?? "(boş)"}`);
    this.name = "UnpricedSizeError";
  }
}

/**
 * Custom character figurine — ONE product since 2026-08-24: 15 cm, SLA resin,
 * professionally hand-painted, display-ready, free domestic shipping. No size
 * tiers, no material choice, no paint-kit variant. A different size or a custom
 * design is quoted by hand over WhatsApp (see `UnpricedSizeError`).
 *
 * Tune freely — this is the single source.
 */
export const FIGURINE_PRICE_KURUS = 349900;

/**
 * The painting share of `FIGURINE_PRICE_KURUS` — the painter partner's earning
 * base.
 *
 * Painting used to be a ₺1.000 `hand_painted` surcharge and
 * `paintingPortionKurus()` read the number straight out of
 * `FINISH_SURCHARGES_KURUS`. Now that painting is bundled into the base price
 * that surcharge is 0, so the share MUST be stated explicitly here. Delete this
 * constant and every painter earns ₺0 on every order.
 */
export const PAINTING_PORTION_KURUS = 100000;

/**
 * Price of a custom figurine. `size` and `material` are accepted for call-site
 * compatibility but no longer affect the price — there is one product.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility
export function figurinePriceKurus(_size?: string, _material?: string): number {
  return FIGURINE_PRICE_KURUS;
}

export type FigurineFinish =
  | "paintable_kit"
  | "hand_painted"
  | "collector_raw"
  | "luxe_display";

/**
 * Finish surcharges — all zero since 2026-08-24. The single product bundles
 * professional hand painting into `FIGURINE_PRICE_KURUS`, so there is no finish
 * price axis left. The table is kept (rather than deleted) because `finish` is
 * still stored per order and rows written before this date reference all four
 * values; `finishSurchargeKurus` must resolve them to 0 rather than `undefined`.
 */
export const FINISH_SURCHARGES_KURUS: Record<FigurineFinish, number> = {
  paintable_kit: 0,
  collector_raw: 0,
  hand_painted: 0,
  luxe_display: 0,
};

/**
 * The part of an order that pays for PROFESSIONAL PAINTING, i.e. the painter
 * partner's earning base. Reads the explicit `PAINTING_PORTION_KURUS` constant,
 * NOT the finish surcharge table — the surcharge is 0 now that painting is
 * bundled into the base price.
 *
 * Legacy orders whose finish never included painting still resolve to 0.
 */
export function paintingPortionKurus(finish: string | null | undefined): number {
  if (finish === "hand_painted" || finish === "luxe_display") {
    return PAINTING_PORTION_KURUS;
  }
  return 0;
}

/** Finishes fulfilled by a painter partner rather than the manufacturer. */
export function finishNeedsPainter(finish: string | null | undefined): boolean {
  return finish === "hand_painted" || finish === "luxe_display";
}

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

// Ceiling for any single order/line amount. Every money column is pg `integer`
// (int4, max 2,147,483,647 kuruş ≈ ₺21.4M); blowing past it raises a Postgres
// "integer out of range" and surfaces as an opaque 500 mid-checkout. ₺2M is far
// above any legitimate order while leaving an order of magnitude of headroom.
// Enforced on the admin manual-order route AND on customer checkout — bulk
// quantities make a 50-line × 200-unit cart trivially reachable.
export const MAX_AMOUNT_KURUS = 2_000_000_00;

// Professional painting is NOT a separate add-on price: it is bundled into
// FIGURINE_PRICE_KURUS and marked by the "hand_painted" figurine finish. Orders
// with that finish are routed to a painter partner, and PAINTING_PORTION_KURUS
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
/**
 * NOT used to price new orders anymore — `itemPriceKurus` refuses object/design
 * kinds with `UnpricedSizeError` (quote-only since 2026-08-24; see there). This
 * function is kept only for display/history of orders placed before that date
 * (their stored `size`/`material` can still be re-priced for a receipt or admin
 * view) — do not wire it back into checkout pricing.
 */
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

const FLAT_PRICED_KINDS: readonly string[] = ["keychain", "fridge_magnet", "lamp"];

/**
 * True for the Creative Lab kinds (keychain / fridge magnet / lamp) — flat
 * price, no size/material/finish axis. Single source for that kind list, used
 * both by `itemPriceKurus` below (to short-circuit before it ever looks at
 * size) and by the reorder route's reorderability guard (to know a retired/
 * neutral stored size like "orta" must NOT block a Creative Lab reorder).
 * Previously the same three-way `===` check was duplicated in both places;
 * a future edit to one (e.g. dropping "lamp") could silently drift from the
 * other with no test catching it.
 */
export function isFlatPricedKind(kind: string): boolean {
  return FLAT_PRICED_KINDS.includes(kind);
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
  const { kind, size, material, finish, volumeMm3 } = args;
  if (isFlatPricedKind(kind)) {
    // Flat price — size/material/finish do not apply to these products.
    return creativeLabPriceKurus(kind);
  }
  if (kind === "upload") {
    return uploadModelPriceKurus(volumeMm3 ?? 0, material) + objectFinishSurchargeKurus(finish);
  }
  // Sizes are free text since migration 0036, but the price tables only know
  // the three catalogue tiers. Anything else (a bespoke "17,5 cm") has no
  // catalogue price and MUST NOT fall through to `?? 0` — that silently
  // produced a ₺0 (or, with collector_raw, a negative) order.
  if (!isPriceableSize(size)) throw new UnpricedSizeError(size);
  // Object / design prints are QUOTE-ONLY since 2026-08-24. There is no sellable
  // size for them: the catalogue collapsed to a single 15 cm figurine tier, and
  // OBJECT_PRICES_KURUS has no "standart" key — so this branch used to fall
  // through `?? 0` and return a FREE order that `createOrderSchema` happily
  // accepted. Refusing to price them is the fix; the admin quotes by hand.
  if (kind === "object" || kind === "design") {
    throw new UnpricedSizeError(size);
  }
  return figurinePriceKurus(size, material) + finishSurchargeKurus(finish);
}
