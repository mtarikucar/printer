/**
 * Toplu sipariş (bulk order) limits.
 *
 * The cart historically hard-coded a 20-unit ceiling in five places. Those
 * become the two constants below plus one per-product override, so a ₺25
 * keychain can be bought 200 at a time while an ordinary made-to-order figurine
 * stays capped at 20.
 *
 * Layering matters, because the Redis cart normalizer has no DB access:
 *   - ABSOLUTE_MAX_LINE_QTY is the DB-free sanity bound. It guards the Redis
 *     blob and the zod request schemas against a corrupted/hostile value.
 *   - effectiveMaxQty() is the authoritative, product-aware cap. It is applied
 *     where the product row is already loaded — cart hydrate (which is what the
 *     customer sees AND what checkout posts) and /api/orders.
 *
 * Pure module: no DB, no server-only import — safe from client components.
 */

/** Ceiling for a product that is not marked bulk-eligible (the historic value). */
export const NORMAL_MAX_LINE_QTY = 20;

/** Ceiling for a bulk product that sets no explicit `bulkMaxQuantity`. */
export const BULK_DEFAULT_MAX_QTY = 200;

/**
 * Hard ceiling for ANY single cart line, enforced without touching the DB.
 * Nothing may configure its way past this — `effectiveMaxQty` clamps to it.
 * Beyond this the customer is pointed at the WhatsApp/quote line instead.
 */
export const ABSOLUTE_MAX_LINE_QTY = 200;

/** Most tiers one product may define (keeps the ladder readable + the editor sane). */
export const MAX_TIERS_PER_PRODUCT = 5;

/** Lowest quantity a tier may start at — a tier at 1 is just the base price. */
export const MIN_TIER_QUANTITY = 2;

/** One rung of the volume ladder. See the productPriceTiers table. */
export interface PriceTierConfig {
  minQuantity: number;
  unitPriceKurus: number;
}

/**
 * The tier that applies at `quantity`: the highest rung whose minQuantity has
 * been reached, or null below the first rung. Tolerates unsorted input so a
 * caller that built the array by hand can't get a wrong price.
 *
 * Lives here rather than next to the pricing service so client components (the
 * product page's live price preview, the bulk order sheet) can show exactly
 * what the server will charge without importing the DB layer.
 */
export function pickTier(
  tiers: PriceTierConfig[],
  quantity: number
): PriceTierConfig | null {
  let best: PriceTierConfig | null = null;
  for (const t of tiers) {
    if (quantity < t.minQuantity) continue;
    if (!best || t.minQuantity > best.minQuantity) best = t;
  }
  return best;
}

/** The next rung the buyer has not reached yet — the "add N more" nudge. */
export function nextTier(
  tiers: PriceTierConfig[],
  quantity: number
): PriceTierConfig | null {
  return (
    [...tiers]
      .sort((a, b) => a.minQuantity - b.minQuantity)
      .find((t) => t.minQuantity > quantity) ?? null
  );
}

export interface BulkCapableProduct {
  bulkEnabled: boolean;
  bulkMaxQuantity: number | null;
}

/**
 * The authoritative per-line quantity ceiling for a product.
 *
 * A non-bulk product keeps the historic 20. A bulk product uses its own
 * `bulkMaxQuantity`, defaulting to BULK_DEFAULT_MAX_QTY, and can never exceed
 * ABSOLUTE_MAX_LINE_QTY — so turning `bulkEnabled` off, or misconfiguring
 * `bulkMaxQuantity`, always narrows the cap rather than widening it.
 */
export function effectiveMaxQty(product: BulkCapableProduct): number {
  if (!product.bulkEnabled) return NORMAL_MAX_LINE_QTY;
  const configured = product.bulkMaxQuantity ?? BULK_DEFAULT_MAX_QTY;
  // Guard against a nonsensical stored value (0, negative) locking the product
  // out of the cart entirely: never fall below the normal ceiling.
  return Math.min(
    ABSOLUTE_MAX_LINE_QTY,
    Math.max(NORMAL_MAX_LINE_QTY, configured)
  );
}
