import assert from "node:assert/strict";
import { moneySplitEditBlock, validateMoneySplit } from "../src/lib/config/order-money-edit";

const open = { paymentStatus: "succeeded", status: "approved", manufacturerStatus: "accepted", painterId: null, shippedAt: null, workshopSessionId: null, manufacturerEarningExists: false, painterEarningExists: false };
assert.equal(moneySplitEditBlock(open), null);
for (const change of [
  { paymentStatus: "refunded" }, { status: "delivered" }, { status: "rejected" },
  { manufacturerStatus: "shipped" }, { painterId: "painter" }, { shippedAt: new Date() },
  { workshopSessionId: "session" }, { manufacturerEarningExists: true }, { painterEarningExists: true },
]) assert.ok(moneySplitEditBlock({ ...open, ...change }), JSON.stringify(change));
assert.equal(validateMoneySplit(10000, 6000, 4000), null);
assert.equal(validateMoneySplit(10000, 10000, 0), null); // Remove painting.
for (const pair of [[0, 10000], [6000, 3000], [10001, -1], [6000.5, 3999.5], [NaN, 0], [Infinity, 0]]) {
  assert.ok(validateMoneySplit(10000, pair[0], pair[1]));
}
console.log("order-money-edit: all passed");
