/** Pure API contract checks; no database access or external effects. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adjustmentCreateSchema, adjustmentCancelSchema } from "../src/lib/services/partner-adjustments";
import { payoutMarkPaidSchema, payoutVoidSchema, payoutFailure } from "../src/app/api/admin/payouts/_contract";

let checks = 0;
const test = (label: string, run: () => void) => { run(); checks++; console.log(`PASS ${label}`); };
const positive = {
  partnerKind: "manufacturer", partnerId: randomUUID(), kind: "topup", netKurus: 100,
  reason: "Üretim farkı için ek ödeme", idempotencyKey: randomUUID(), expectedFingerprint: "a".repeat(64),
};
test("positive credits are explicit integer net compensation", () => {
  assert.equal(adjustmentCreateSchema.safeParse(positive).success, true);
  assert.equal(adjustmentCreateSchema.safeParse({ ...positive, kind: "reprint" }).success, true);
  for (const netKurus of [0, -1, 0.5, 2147483648]) assert.equal(adjustmentCreateSchema.safeParse({ ...positive, netKurus }).success, false);
});
test("offset requires an identified source and a negative integer", () => {
  const offset = { ...positive, kind: "unpaid_offset", netKurus: -50, source: { kind: "manufacturer_earning", id: randomUUID() } };
  assert.equal(adjustmentCreateSchema.safeParse(offset).success, true);
  assert.equal(adjustmentCreateSchema.safeParse({ ...offset, source: undefined }).success, false);
  assert.equal(adjustmentCreateSchema.safeParse({ ...offset, netKurus: 50 }).success, false);
  assert.equal(adjustmentCreateSchema.safeParse({ ...offset, source: { ...offset.source, kind: "painter_earning" } }).success, false);
});
test("reason, idempotency and displayed fingerprint are required", () => {
  for (const change of [{ reason: "kısa" }, { idempotencyKey: "" }, { expectedFingerprint: "" }, { partnerId: "bad" }]) {
    assert.equal(adjustmentCreateSchema.safeParse({ ...positive, ...change }).success, false);
  }
});
test("caller cannot impersonate the actor or set payout/status fields", () => {
  for (const change of [{ adminEmail: "other@example.invalid" }, { status: "settled" }, { payoutId: randomUUID() }]) {
    assert.equal(adjustmentCreateSchema.safeParse({ ...positive, ...change }).success, false);
  }
});
test("cancellation has its own reason, operation and stale-state guard", () => {
  assert.equal(adjustmentCancelSchema.safeParse({ reason: positive.reason, idempotencyKey: randomUUID(), expectedFingerprint: positive.expectedFingerprint }).success, true);
  assert.equal(adjustmentCancelSchema.safeParse({ reason: "", idempotencyKey: randomUUID(), expectedFingerprint: positive.expectedFingerprint }).success, false);
});
test("netting normalizes the UI empty reference to database NULL", () => {
  const input = { kind: "manufacturer", expectedFingerprint: positive.expectedFingerprint, settlementKind: "netting", reference: "  " };
  assert.equal(payoutMarkPaidSchema.parse(input).reference, null);
  assert.equal(payoutMarkPaidSchema.safeParse({ ...input, reference: "BANK-123" }).success, false);
  assert.equal(payoutMarkPaidSchema.safeParse({ ...input, settlementKind: "transfer", reference: "BANK-123" }).success, true);
});
test("payout confirmation cannot omit the displayed kind or fingerprint", () => {
  const input = { kind: "painter", expectedFingerprint: positive.expectedFingerprint, settlementKind: "netting", reference: "" };
  for (const key of ["kind", "expectedFingerprint", "settlementKind"] as const) assert.equal(payoutMarkPaidSchema.safeParse({ ...input, [key]: undefined }).success, false);
  assert.equal(payoutMarkPaidSchema.safeParse({ ...input, adminEmail: "spoof@example.invalid" }).success, false);
});
test("payout void requires durable intent and rejects actor spoofing", () => {
  const input = { kind: "manufacturer", expectedFingerprint: positive.expectedFingerprint, reason: positive.reason, idempotencyKey: randomUUID() };
  assert.equal(payoutVoidSchema.safeParse(input).success, true);
  for (const change of [{ reason: "short" }, { idempotencyKey: "" }, { expectedFingerprint: "" }, { adminEmail: "spoof@example.invalid" }]) assert.equal(payoutVoidSchema.safeParse({ ...input, ...change }).success, false);
});
test("every service refusal has a renderable Turkish conflict or missing response", () => {
  for (const reason of ["not_found", "busy", "confirmation_required", "stale_confirmation", "blocked_groups", "voided", "already_paid", "payload_conflict", "invalid_request"] as const) {
    const response = payoutFailure({ ok: false, reason });
    assert.equal(response.status, reason === "not_found" ? 404 : 409);
    assert.ok(response.body.error.length > 10);
  }
  assert.match(payoutFailure({ ok: false, reason: "mismatch", statedKurus: 1000, heldKurus: 0, statedCount: 1, heldCount: 0 }).body.error, /Transfer yapmayın/);
});
console.log(`${checks} adjustment/payout API checks passed`);
