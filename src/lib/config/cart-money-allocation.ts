/** Integer, deterministic largest-remainder allocation; never loses a kuruş. */
function allocate(total: number, weights: readonly number[]): number[] {
  const denominator = weights.reduce((a, b) => a + BigInt(b), BigInt(0));
  if (denominator === BigInt(0)) {
    if (total !== 0) throw new Error("CART_MONEY_WITHOUT_ITEMS");
    return weights.map(() => 0);
  }
  const products = weights.map(w => BigInt(w) * BigInt(total));
  const parts = products.map(p => Number(p / denominator));
  let remaining = total - parts.reduce((a, b) => a + b, 0);
  const ranked = products.map((p, i) => ({ i, remainder: p % denominator }))
    .sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  for (const { i } of ranked) {
    if (remaining === 0) break;
    parts[i]++; remaining--;
  }
  return parts;
}

/**
 * Split the frozen cart consideration, not current upsell prices. Entitlements
 * follow every applicable child; their one charged fee is allocated only once.
 * Gift credit is allocated AFTER the discount so rounding never makes a child
 * appear overpaid. No promotion is allowed to lose part of the collected price.
 */
export function allocateCartMoney(args: {
  itemAmounts: number[]; upsellAmount: number; amount: number;
  havaleDiscount: number; giftCardAmount: number;
}) {
  const numbers = [...args.itemAmounts, args.upsellAmount, args.amount, args.havaleDiscount, args.giftCardAmount];
  if (!args.itemAmounts.length || !numbers.every(n => Number.isSafeInteger(n) && n >= 0)
    || args.itemAmounts.some(n => n <= 0)
    || args.itemAmounts.reduce((a, b) => a + b, 0) + args.upsellAmount !== args.amount
    || args.havaleDiscount + args.giftCardAmount > args.amount) {
    throw new Error("CART_MONEY_MISMATCH");
  }
  const upsells = allocate(args.upsellAmount, args.itemAmounts);
  const amounts = args.itemAmounts.map((a, i) => a + upsells[i]);
  const discounts = allocate(args.havaleDiscount, amounts);
  const gifts = allocate(args.giftCardAmount, amounts.map((a, i) => a - discounts[i]));
  return { amounts, upsells, discounts, gifts };
}
