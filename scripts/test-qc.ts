import assert from "node:assert/strict";
import {
  qcNextStatus,
  canUploadQcPhotos,
  canShipAfterQc,
  MAX_QC_PHOTOS_PER_ROUND,
  qcPhotosWouldExceed,
} from "../src/lib/services/qc";

let passed = 0;
const cases: Array<[string, () => void]> = [];

function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

// ─── State machine: submit ──────────────────────────────────────
test("submit from printed → qc_pending", () => {
  assert.equal(qcNextStatus("printed", "submit"), "qc_pending");
});

test("submit from qc_rejected → qc_pending (reprint loop)", () => {
  assert.equal(qcNextStatus("qc_rejected", "submit"), "qc_pending");
});

test("submit from accepted → null (not yet printed)", () => {
  assert.equal(qcNextStatus("accepted", "submit"), null);
});

test("submit from qc_pending → null (already submitted)", () => {
  assert.equal(qcNextStatus("qc_pending", "submit"), null);
});

test("submit from shipped → null", () => {
  assert.equal(qcNextStatus("shipped", "submit"), null);
});

// ─── State machine: approve ─────────────────────────────────────
test("approve from qc_pending → qc_approved", () => {
  assert.equal(qcNextStatus("qc_pending", "approve"), "qc_approved");
});

test("approve from printed → null", () => {
  assert.equal(qcNextStatus("printed", "approve"), null);
});

test("approve from qc_approved → null (idempotent guard)", () => {
  assert.equal(qcNextStatus("qc_approved", "approve"), null);
});

// ─── State machine: reject ──────────────────────────────────────
test("reject from qc_pending → qc_rejected", () => {
  assert.equal(qcNextStatus("qc_pending", "reject"), "qc_rejected");
});

test("reject from qc_approved → null (already approved)", () => {
  assert.equal(qcNextStatus("qc_approved", "reject"), null);
});

// ─── Upload guard ───────────────────────────────────────────────
test("can upload QC photos when printed", () => {
  assert.equal(canUploadQcPhotos("printed"), true);
});

test("can upload QC photos when qc_rejected", () => {
  assert.equal(canUploadQcPhotos("qc_rejected"), true);
});

test("cannot upload QC photos once qc_pending (awaiting admin)", () => {
  assert.equal(canUploadQcPhotos("qc_pending"), false);
});

test("cannot upload QC photos when accepted (not printed yet)", () => {
  assert.equal(canUploadQcPhotos("accepted"), false);
});

test("cannot upload QC photos when shipped", () => {
  assert.equal(canUploadQcPhotos("shipped"), false);
});

// ─── Ship guard ─────────────────────────────────────────────────
test("can ship only after qc_approved", () => {
  assert.equal(canShipAfterQc("qc_approved"), true);
});

test("cannot ship from printed (pre-QC)", () => {
  assert.equal(canShipAfterQc("printed"), false);
});

test("cannot ship from qc_pending", () => {
  assert.equal(canShipAfterQc("qc_pending"), false);
});

// ─── Photo count caps ───────────────────────────────────────────
test("max photos per round is 6", () => {
  assert.equal(MAX_QC_PHOTOS_PER_ROUND, 6);
});

test("5 existing + 1 new fits", () => {
  assert.equal(qcPhotosWouldExceed(5, 1), false);
});

test("5 existing + 2 new exceeds", () => {
  assert.equal(qcPhotosWouldExceed(5, 2), true);
});

test("6 existing + 1 new exceeds", () => {
  assert.equal(qcPhotosWouldExceed(6, 1), true);
});

test("0 existing + 6 new fits exactly", () => {
  assert.equal(qcPhotosWouldExceed(0, 6), false);
});

test("0 existing + 7 new exceeds", () => {
  assert.equal(qcPhotosWouldExceed(0, 7), true);
});

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log(`\n${passed}/${cases.length} passed`);
