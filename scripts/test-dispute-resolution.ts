import assert from "node:assert/strict";
import {
  DISPUTE_CATEGORY_LABELS_TR, DISPUTE_STATUS_LABELS_TR, DisputePolicyError,
  normalizeOpenDisputeInput, normalizeResolveDisputeInput,
  type DisputeDecisionFailure, type DisputeDecisionView,
} from "../src/lib/config/dispute-resolution";
import { normalizeRecordRefundInput } from "../src/lib/config/order-refund";

let checks = 0;
const test = (name: string, run: () => void) => { run(); checks++; console.log(`PASS ${name}`); };
const now = new Date("2026-09-17T12:00:00Z");
const operationKey = "AAAAAAAA-0000-4000-8000-000000000001";
const disputeId = "BBBBBBBB-0000-4000-8000-000000000002";
const orderId = "CCCCCCCC-0000-4000-8000-000000000003";
const decision = () => ({ disputeId, operationKey, expectedDecisionFingerprint: "a".repeat(64),
  action: "resolve" as const, resolution: "  Müşteriyle görüşülerek çözüldü.  " });
const refund = () => ({ expectedFingerprint: "b".repeat(64),
  allocations: [{ orderId, cashKurus: 3000, giftKurus: 500 }], reason: "  Onaylanan kısmi iade  ",
  cashEvidence: { method: "card" as const, externalReference: " PayTR-Actual-123 ",
    occurredAt: "2026-09-17T14:00:00+03:00", paytrRefundCompleted: true as const } });
const invalid = (run: () => unknown) => assert.throws(run, (e: unknown) =>
  e instanceof DisputePolicyError && e.code === "invalid_evidence" && e.status === 400 && e.message.length > 0);

test("decision-only resolve and reject normalize without creating refund intent", () => {
  for (const action of ["resolve", "reject"] as const) {
    const result = normalizeResolveDisputeInput({ ...decision(), action }, now);
    assert.deepEqual(result, { ...decision(), action, disputeId: disputeId.toLowerCase(),
      operationKey: operationKey.toLowerCase(), resolution: decision().resolution.trim() });
    assert.equal(Object.hasOwn(result, "refund"), false);
  }
});
test("root resolution accepts trimmed 10 and 2000, refuses shorter/longer/nontext", () => {
  for (const length of [10, 2000]) assert.equal(normalizeResolveDisputeInput({ ...decision(), resolution: ` ${"x".repeat(length)} ` }).resolution.length, length);
  for (const resolution of ["x".repeat(9), "x".repeat(2001), "   ", 123, null, undefined]) invalid(() => normalizeResolveDisputeInput({ ...decision(), resolution }));
});
test("identity, action and fingerprint validation is strict", () => {
  for (const field of ["disputeId", "operationKey"] as const) {
    for (const value of ["bad", "", null, 42, ` ${operationKey}`, operationKey + "x", operationKey + "\n"]) invalid(() => normalizeResolveDisputeInput({ ...decision(), [field]: value }));
  }
  for (const expectedDecisionFingerprint of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "z".repeat(64), "a".repeat(64) + "\n", null]) invalid(() => normalizeResolveDisputeInput({ ...decision(), expectedDecisionFingerprint }));
  for (const action of ["resolved", "cancel", "reject ", null]) invalid(() => normalizeResolveDisputeInput({ ...decision(), action }));
});
test("root unknown fields, old clawback and caller-supplied actor refuse", () => {
  for (const key of ["clawback", "strike", "adminEmail", "orderId", "mode", "reason", "refundId"]) invalid(() => normalizeResolveDisputeInput({ ...decision(), [key]: false }));
  for (const value of [null, [], "resolve", 123, new Date()]) invalid(() => normalizeResolveDisputeInput(value));
});
test("UUIDs and decision fingerprints refuse all trailing line terminators", () => {
  for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    for (const field of ["disputeId", "operationKey"] as const) {
      invalid(() => normalizeResolveDisputeInput({ ...decision(), [field]: decision()[field] + suffix }));
    }
    invalid(() => normalizeResolveDisputeInput({ ...decision(), expectedDecisionFingerprint: "a".repeat(64) + suffix }));
  }
});
test("actual refund uses exactly the existing policy with the root UUID", () => {
  const input = { ...decision(), refund: refund() };
  const before = JSON.stringify(input);
  const result = normalizeResolveDisputeInput(input, now);
  const expected = normalizeRecordRefundInput({ ...refund(), operationKey, mode: "actual" }, now);
  assert.deepEqual({ ...result.refund, operationKey: result.operationKey, mode: "actual" }, expected);
  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.hasOwn(result.refund!, "operationKey"), false);
  assert.equal(Object.hasOwn(result.refund!, "mode"), false);
  assert.deepEqual(normalizeResolveDisputeInput(result, now), result);
});
test("nested override, legacy, old clawback and unknown fields cannot reach the refund helper", () => {
  for (const [key, value] of [["operationKey", operationKey], ["mode", "actual"], ["mode", "legacy_evidence"], ["clawback", false], ["adminEmail", "spoof@test.invalid"]] as const) {
    invalid(() => normalizeResolveDisputeInput({ ...decision(), refund: { ...refund(), [key]: value } }, now));
  }
  for (const value of [null, [], {}, false]) invalid(() => normalizeResolveDisputeInput({ ...decision(), refund: value }, now));
});
test("rejection cannot include a refund, including a gift-only return", () => {
  for (const value of [refund(), { expectedFingerprint: "b".repeat(64), reason: "Hediye karta iade", allocations: [{ orderId, cashKurus: 0, giftKurus: 500 }] }]) {
    invalid(() => normalizeResolveDisputeInput({ ...decision(), action: "reject", refund: value }, now));
  }
});
test("refund reason keeps 10..1000 even though root resolution permits 2000", () => {
  for (const length of [10, 1000]) assert.equal(normalizeResolveDisputeInput({ ...decision(), resolution: "x".repeat(2000), refund: { ...refund(), reason: ` ${"x".repeat(length)} ` } }, now).refund?.reason.length, length);
  for (const length of [9, 1001, 2000]) invalid(() => normalizeResolveDisputeInput({ ...decision(), refund: { ...refund(), reason: "x".repeat(length) } }, now));
});
test("refund policy failures become the same typed dispute failure", () => {
  invalid(() => normalizeResolveDisputeInput({ ...decision(), refund: { ...refund(), cashEvidence: { ...refund().cashEvidence, paytrRefundCompleted: false } } }, now));
  invalid(() => normalizeResolveDisputeInput({ ...decision(), refund: { ...refund(), cashEvidence: { ...refund().cashEvidence, occurredAt: "2026-09-18T00:00:00Z" } } }, now));
  for (const cashKurus of [-1, 0.5, "3000", Number.MAX_SAFE_INTEGER]) invalid(() => normalizeResolveDisputeInput({ ...decision(), refund: { ...refund(), allocations: [{ orderId, cashKurus, giftKurus: 0 }] } }, now));
  invalid(() => normalizeResolveDisputeInput({ ...decision(), refund: { ...refund(), allocations: [{ ...refund().allocations[0], unexpected: true }] } }, now));
});
test("gift-only refund does not invent cash evidence", () => {
  const value = { expectedFingerprint: "b".repeat(64), reason: "Hediye karta iade", allocations: [{ orderId, cashKurus: 0, giftKurus: 500 }] };
  const result = normalizeResolveDisputeInput({ ...decision(), refund: value }, now);
  assert.equal(result.refund?.cashEvidence, undefined);
  assert.equal(result.refund?.allocations[0].giftKurus, 500);
});
test("pure normalization leaves dispute-order matching and single-allocation policy to the locked service", () => {
  const value = refund();
  value.allocations.push({ orderId: "00000000-0000-4000-8000-000000000004", cashKurus: 100, giftKurus: 0 });
  assert.equal(normalizeResolveDisputeInput({ ...decision(), refund: value }, now).refund?.allocations.length, 2);
});
test("opening accepts existing categories and trims a 5..2000 description", () => {
  for (const category of Object.keys(DISPUTE_CATEGORY_LABELS_TR)) {
    for (const length of [5, 2000]) assert.deepEqual(normalizeOpenDisputeInput({ category, description: ` ${"x".repeat(length)} ` }), { category, description: "x".repeat(length) });
  }
});
test("opening refuses invalid category, description, nonobject or caller-owned identity", () => {
  const input = { category: "damaged", description: "Ürün hasarlı geldi." };
  for (const category of ["unknown", "toString", "__proto__", " damaged", null]) invalid(() => normalizeOpenDisputeInput({ ...input, category }));
  for (const description of ["1234", "x".repeat(2001), "  ", null, 123]) invalid(() => normalizeOpenDisputeInput({ ...input, description }));
  for (const key of ["userId", "orderId", "status", "clawback"]) invalid(() => normalizeOpenDisputeInput({ ...input, [key]: "anything" }));
  for (const value of [null, [], "damaged"]) invalid(() => normalizeOpenDisputeInput(value));
});
test("shared labels cover the existing category/status vocabulary", () => {
  assert.deepEqual(Object.keys(DISPUTE_CATEGORY_LABELS_TR).sort(), ["damaged", "not_as_described", "not_received", "other"]);
  assert.deepEqual(Object.keys(DISPUTE_STATUS_LABELS_TR).sort(), ["open", "rejected", "resolved"]);
  assert.equal(DISPUTE_STATUS_LABELS_TR.resolved, "Çözüldü");
  assert.ok(Object.values(DISPUTE_CATEGORY_LABELS_TR).every(label => label.length > 0));
});
test("closed/open conflicts and inherited refund failures use the common failure contract", () => {
  for (const code of ["already_closed", "already_open", "lineage_unknown", "operation_conflict"] as const) {
    const error = new DisputePolicyError(code, "İşlem çakışması.", 409);
    const failure: DisputeDecisionFailure = { ok: false, code: error.code, status: error.status, error: error.message };
    assert.equal(failure.code, code);
    assert.equal(error.name, "DisputePolicyError");
  }
  const view: DisputeDecisionView = { dispute: { id: disputeId, orderId, orderNumber: null,
    category: "historical_category", description: "Eski şikayet", status: "open", resolution: null,
    resolvedAt: null, decisionOperationKey: null, refundRecordId: null },
    expectedDecisionFingerprint: "a".repeat(64), refundView: null, refundReadUnavailable: "Ödeme kayıtları okunamadı." };
  assert.equal(view.refundView, null);
});
console.log(`${checks} dispute policy checks passed`);
