import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { draftCommercialFingerprint } from "../src/lib/services/draft-commercial-consent";
const draft = {
  id: "draft", reference: "FIG-A", updatedAt: new Date("2026-09-17T00:00:00.000Z"),
  amountKurus: 10000, productionBaseKurus: 8000, paintingPriceKurus: 2000,
  giftCardAmountKurus: 0, havaleDiscountKurus: 0, quantity: 1,
  productTitleSnapshot: "Figür", selectedAddons: [{ name: "Baskı", priceKurus: 8000, kind: "production" }],
};
const token = draftCommercialFingerprint(draft);
assert.match(token, /^[a-f0-9]{64}$/);
assert.equal(draftCommercialFingerprint({ ...draft }), token);
assert.equal(draftCommercialFingerprint({ ...draft, selectedAddons: [{ kind: "production", priceKurus: 8000, name: "Baskı" }] }), token);
for (const change of [{ amountKurus: 10001 }, { productionBaseKurus: 7000, paintingPriceKurus: 3000 }, { productTitleSnapshot: "Yeni figür" }, { updatedAt: new Date("2026-09-17T00:00:01Z") }, { giftCardAmountKurus: 1 }, { selectedAddons: [{ name: "Yeni baskı", priceKurus: 8000, kind: "production" }] }]) {
  assert.notEqual(draftCommercialFingerprint({ ...draft, ...change }), token);
}
console.log("draft commercial fingerprint: 10 checks passed");

// The real DB suite proves the lock behavior; these pins keep the admin's
// displayed snapshot connected to that service, rather than a fresh API read.
const read = (path: string) => readFileSync(path, "utf8");
assert.match(read("src/app/admin/drafts/[id]/page.tsx"), /commercialFingerprint: draftCommercialFingerprint\(draft\)/);
assert.match(read("src/app/admin/drafts/[id]/client.tsx"), /commercialFingerprint: draft\.commercialFingerprint/);
const route = read("src/app/api/admin/orders/[id]/mark-havale-paid/route.ts");
assert.match(route, /promoteDraftToOrder\(draft\.id, \{ manualPaymentEvidence: \{ fingerprint: body\.commercialFingerprint \} \}\)/);
assert.match(route, /DraftPaymentEvidenceChangedError\) return NextResponse\.json\([^\n]*status: 409/);
const promotion = read("src/lib/services/order-draft.ts");
const promotionBody = promotion.slice(promotion.indexOf("export async function promoteDraftToOrder("));
assert.ok(promotionBody.indexOf('.for("update")') < promotionBody.indexOf("await assertEditedDraftConsent(tx, draft, options?.manualPaymentEvidence)"));
assert.match(promotionBody, /await assertEditedDraftConsent\(tx, draft, options\?\.manualPaymentEvidence\)/);
console.log("manual approval evidence wiring: 6 checks passed");
