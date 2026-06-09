export type FigurineMaterial = "resin" | "filament";

// Per-material price table (kuruş). Resin is the premium base; filament (FDM)
// is ₺300 cheaper per size. Tune values freely — this is the single source.
export const FIGURINE_PRICES_KURUS: Record<FigurineMaterial, Record<string, number>> = {
  resin: { kucuk: 99900, orta: 139900, buyuk: 179900 },
  filament: { kucuk: 69900, orta: 109900, buyuk: 149900 },
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
  paintable_kit: 0,
  collector_raw: 0,
  hand_painted: 79900,
  luxe_display: 149900,
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
// manufacturer is paid the remainder. Basis points (3000 = 30%). Tune freely.
export const PLATFORM_COMMISSION_RATE_BPS = 3000;

// Turkish VAT (KDV) applied to customer invoices. Catalogue prices are
// KDV-inclusive, so the invoice breaks the paid total into base + KDV.
export const KDV_RATE_BPS = 2000; // 20%
