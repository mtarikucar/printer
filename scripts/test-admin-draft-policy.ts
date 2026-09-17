import assert from "node:assert/strict";
import { draftActionSchema, draftPermissions, draftLinesUpdate } from "../src/app/api/admin/drafts/[id]/_policy";
const draft = { status: "pending", promotedOrderId: null, paymentMethod: "bank_transfer", paytrMerchantOid: null, bankTransferReceiptKey: null, orderType: "marketplace", productId: null, parentReference: null, giftCardAmountKurus: 0, upsellAmountKurus: 0, attributionChannel: "whatsapp", finish: "raw", amountKurus: 10000, selectedAddons: [{ name: "Baskı", kind: "production", priceKurus: 10000 }] };
assert.equal(draftPermissions(draft).edit, null);
for (const status of ["confirmed", "expired", "cancelled", "failed", "awaiting_review"]) {
  assert.ok(draftPermissions({ ...draft, status }).edit);
  assert.ok(draftPermissions({ ...draft, status }).cancel);
}
assert.ok(draftPermissions({ ...draft, promotedOrderId: "paid" }).edit);
assert.ok(draftPermissions({ ...draft, paymentMethod: "card" }).edit);
assert.ok(draftPermissions({ ...draft, paymentMethod: "card" }).cancel);
assert.equal(draftPermissions({ ...draft, paymentMethod: "card" }).resend, null);
assert.ok(draftPermissions({ ...draft, bankTransferReceiptKey: "receipt" }).resend);
assert.ok(draftPermissions({ ...draft, giftCardAmountKurus: 1 }).cancel);
assert.ok(draftPermissions({ ...draft, parentReference: "cart" }).edit);
assert.equal(draftPermissions({ ...draft, productId: "product" }).extend, null);
assert.equal(draftPermissions({ ...draft, giftCardAmountKurus: 100 }).extend, null);
assert.ok(draftPermissions(draft, true).cancel);
const update = draftLinesUpdate(draft, [ { description: "Baskı", quantity: 3, unitPrice: "1.234,56", kind: "production" }, { description: "Boyama", quantity: 1, unitPrice: "50,25", kind: "painting" } ]);
assert.equal(update.amountKurus, 375393);
assert.equal(update.productionBaseKurus + update.paintingPriceKurus, update.amountKurus);
assert.equal(update.needsPainting, true);
assert.throws(() => draftLinesUpdate({ ...draft, finish: "hand_painted" }, [{ description: "Baskı", quantity: 1, unitPrice: "25", kind: "production" }]), /boyama/i);
for (const unitPrice of ["", "1.2345", "-1", "NaN", "0", "2000001"]) {
  assert.equal(draftActionSchema.safeParse({ action: "edit", reason: "Test gerekçe", expectedUpdatedAt: new Date().toISOString(), lines: [{ description: "Baskı", quantity: 1, unitPrice, kind: "production" }] }).success, false);
}
assert.equal(draftActionSchema.safeParse({ action: "cancel", reason: "x", expectedUpdatedAt: "bad" }).success, false);
console.log("Admin draft policy: all passed");
