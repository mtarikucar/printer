import assert from "node:assert/strict";
import { refundTenderBasis, refundRemainder, giftReturnRemaining, refundAnalyticsGross,
  normalizeRecordRefundInput, validateRefundCashEvidence, RefundPolicyError, sumRefundKurus,
  refundResponseAllowsNewIntent } from "../src/lib/config/order-refund";

let checks = 0;
const test = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
const now = new Date("2026-09-17T12:00:00Z");
const input = () => ({ operationKey: "00000000-0000-4000-8000-000000000001", expectedFingerprint: "a".repeat(64), mode: "actual",
  reason: "Müşterinin talebi doğrultusunda iade", allocations: [{orderId: "00000000-0000-4000-8000-000000000002", cashKurus: 3000, giftKurus: 0}],
  cashEvidence: {method: "card", externalReference: " PayTR-123 ", occurredAt: "2026-09-17T14:00:00+03:00", paytrRefundCompleted: true} });
test("discount is not refundable tender", () => assert.deepEqual(refundTenderBasis({amountKurus:11000,havaleDiscountKurus:1000,giftCardAmountKurus:2000}), {invoiceKurus:10000,cashKurus:8000,giftKurus:2000}));
test("partial cash retains gift and remainder; final closes", () => {
  assert.deepEqual(refundRemainder({cashKurus:8000,giftKurus:2000},{cashKurus:3000,giftKurus:0}), {cashKurus:5000,giftKurus:2000,fullyReturned:false});
  assert.equal(refundRemainder({cashKurus:8000,giftKurus:2000},{cashKurus:8000,giftKurus:2000}).fullyReturned,true);
});
test("different tender cannot cover an over-return", () => assert.throws(() => refundRemainder({cashKurus:8000,giftKurus:2000},{cashKurus:0,giftKurus:2001}), RefundPolicyError));
test("invalid bases and overflow refuse", () => {
  assert.throws(() => refundTenderBasis({amountKurus:100,havaleDiscountKurus:80,giftCardAmountKurus:30}), RefundPolicyError);
  assert.throws(() => sumRefundKurus([2147483647,1]), RefundPolicyError);
  for (const bad of [NaN, Infinity, -1, 0.5]) assert.throws(() => sumRefundKurus([bad]), RefundPolicyError);
});
test("partial gift residual; legacy marker is not double counted", () => {
  assert.equal(giftReturnRemaining(2000,500,false),1500);
  assert.equal(giftReturnRemaining(2000,500,true),0);
  assert.equal(giftReturnRemaining(2000,0,true),0);
  assert.throws(() => giftReturnRemaining(2000,2001,true),RefundPolicyError);
});
test("gross analytics uses cumulative rounding and final remainder", () => {
  let total = 0;
  for (let previous = 0; previous < 7; previous++) total += refundAnalyticsGross({originalGrossKurus:11,tenderKurus:7,previousReturnedKurus:previous,returnedKurus:1});
  assert.equal(total,11);
  assert.equal(refundAnalyticsGross({originalGrossKurus:10000,tenderKurus:10000,previousReturnedKurus:0,returnedKurus:3000}),3000);
});
test("evidence normalized without changing reference case", () => {
  const result = normalizeRecordRefundInput(input(),now);
  assert.equal(result.cashEvidence?.externalReference,"PayTR-123");
  assert.equal(result.cashEvidence?.occurredAt,"2026-09-17T11:00:00.000Z");
  validateRefundCashEvidence(result,{method:"card",collectedAt:new Date("2026-09-16T12:00:00Z"),now});
});
test("reason-only old request cannot fabricate a refund", () => assert.throws(() => normalizeRecordRefundInput({reason:"Lütfen iade"},now),RefundPolicyError));
test("rail-specific literal confirmation required", () => {
  for (const confirmation of [false,"true",undefined]) {
    const value = input(); Object.assign(value.cashEvidence,{paytrRefundCompleted:confirmation});
    assert.throws(() => normalizeRecordRefundInput(value,now),RefundPolicyError);
  }
  const value = input(); Object.assign(value.cashEvidence,{bankTransferCompleted:true});
  assert.throws(() => normalizeRecordRefundInput(value,now),RefundPolicyError);
});
test("foreign rail, future or pre-collection occurrence refuse", () => {
  const result = normalizeRecordRefundInput(input(),now);
  assert.throws(() => validateRefundCashEvidence(result,{method:"bank_transfer",collectedAt:new Date("2026-09-16"),now}),RefundPolicyError);
  assert.throws(() => validateRefundCashEvidence(result,{method:"card",collectedAt:new Date("2026-09-17T11:30:00Z"),now}),RefundPolicyError);
  for (const occurredAt of ["2026-09-18T00:00:00Z","2026-02-30T00:00:00Z","2026-09-17","garbage"]) {
    const value=input(); value.cashEvidence.occurredAt=occurredAt;
    assert.throws(()=>normalizeRecordRefundInput(value,now),RefundPolicyError);
  }
});
test("duplicate order, zero amount, extra fields and money strings refuse", () => {
  const dup=input(); dup.allocations.push({...dup.allocations[0]});
  assert.throws(()=>normalizeRecordRefundInput(dup,now),RefundPolicyError);
  const zero=input(); zero.allocations[0].cashKurus=0;
  assert.throws(()=>normalizeRecordRefundInput(zero,now),RefundPolicyError);
  assert.throws(()=>normalizeRecordRefundInput({...input(),adminEmail:"spoof@example.test"},now),RefundPolicyError);
  const str=input(); Object.assign(str.allocations[0],{cashKurus:"3000"});
  assert.throws(()=>normalizeRecordRefundInput(str,now),RefundPolicyError);
});
test("gift-only input requires no fictional external transfer", () => {
  const value=input(); value.allocations[0]={...value.allocations[0],cashKurus:0,giftKurus:500};
  assert.throws(()=>normalizeRecordRefundInput(value,now),RefundPolicyError);
  const {cashEvidence: _cash, ...gift}=value; void _cash;
  const result=normalizeRecordRefundInput(gift,now);
  validateRefundCashEvidence(result,{method:"gift_card_full",collectedAt:new Date("2026-09-16"),now});
});
test("uncertain retry, expired session and key conflict retain original intent", () => {
  for (const [status, code] of [[409,"busy"],[409,"operation_conflict"],[401,undefined],
    [403,undefined],[429,undefined],[503,"unavailable"],[500,undefined],[409,"unknown"]] as const) {
    assert.equal(refundResponseAllowsNewIntent(status,code),false);
  }
  assert.equal(refundResponseAllowsNewIntent(409,"stale"),true);
  assert.equal(refundResponseAllowsNewIntent(409,"over_refund"),true);
  assert.equal(refundResponseAllowsNewIntent(400,"invalid_evidence"),true);
});
console.log(`${checks} refund policy checks passed`);
