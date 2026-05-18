export const PRICES_KURUS: Record<string, number> = {
  kucuk: 99900,
  orta: 139900,
  buyuk: 179900,
};

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
