import assert from "node:assert/strict";
import { allocateCartMoney } from "../src/lib/config/cart-money-allocation";
const split = allocateCartMoney({ itemAmounts: [10000, 30000], upsellAmount: 9900, amount: 49900, havaleDiscount: 1497, giftCardAmount: 20000 });
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
assert.equal(sum(split.amounts), 49900);
assert.equal(sum(split.upsells), 9900);
assert.equal(sum(split.gifts), 20000);
assert.equal(sum(split.discounts), 1497);
assert.deepEqual(split.upsells, [2475, 7425]);
assert.deepEqual(allocateCartMoney({ itemAmounts: [1, 1, 1], upsellAmount: 0, amount: 3, havaleDiscount: 1, giftCardAmount: 2 }).gifts, [0, 1, 1]);
for (let count = 1; count <= 20; count++) {
  const items = Array.from({ length: count }, (_, i) => i + 1);
  const amount = sum(items) + 7;
  const row = allocateCartMoney({ itemAmounts: items, upsellAmount: 7, amount, havaleDiscount: Math.floor(amount / 3), giftCardAmount: Math.ceil(amount / 2) });
  assert.equal(sum(row.amounts), amount);
  row.amounts.forEach((a, i) => assert.ok(a >= row.gifts[i] + row.discounts[i]));
}
assert.throws(() => allocateCartMoney({ itemAmounts: [100], upsellAmount: 5, amount: 100, havaleDiscount: 0, giftCardAmount: 0 }));
assert.throws(() => allocateCartMoney({ itemAmounts: [], upsellAmount: 0, amount: 0, havaleDiscount: 0, giftCardAmount: 0 }));
console.log("cart-money-allocation: all passed");
