import assert from "node:assert/strict";
import {
  qcNextStatus,
  canUploadQcPhotos,
  canShipAfterQc,
  MAX_QC_PHOTOS_PER_ROUND,
  qcPhotosWouldExceed,
} from "../src/lib/services/qc";
import { QC_MAX_PHOTOS, QC_MAX_PHOTOS_HARD, qcPhotoCap } from "../src/lib/config/qc";

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

// ─── Parça sayısına göre üst sınır ──────────────────────────────
// Altı fotoğraf yirmi parçalık bir teklif siparişini ANLATAMAZ: tek figürün
// turu için doğru olan sayı, her parçanın kendi kanıtını isteyen bir işte
// üreticiyi eksik kanıt göndermeye zorlardı.
test("tek parçalı iş taban sınırda kalır (1 → 6)", () => {
  assert.equal(qcPhotoCap(1), QC_MAX_PHOTOS);
  assert.equal(qcPhotoCap(1), 6);
});

test("parça sayısı tabanı aşınca sınır parça+2 olur (10 → 12)", () => {
  assert.equal(qcPhotoCap(10), 12);
});

test("çok parçalı işte mutlak tavan uygulanır (30 → 24)", () => {
  assert.equal(qcPhotoCap(30), QC_MAX_PHOTOS_HARD);
  assert.equal(qcPhotoCap(30), 24);
});

test("parçasız (teklif olmayan) sipariş de taban sınırı alır", () => {
  assert.equal(qcPhotoCap(0), 6);
});

test("sınır tabandan aşağı düşmez ve tavanı aşmaz (0…100)", () => {
  for (let n = 0; n <= 100; n++) {
    const cap = qcPhotoCap(n);
    assert.ok(cap >= QC_MAX_PHOTOS && cap <= QC_MAX_PHOTOS_HARD, `n=${n} cap=${cap}`);
  }
});

// Okunamayan bir parça sayısı kapıyı AÇMAMALI: `existing + adding > NaN` her
// zaman false'tur, yani NaN bir sınır sınırsızlık demek olurdu.
test("sayı olmayan parça sayısı tabana düşer (kapı açılmaz)", () => {
  assert.equal(qcPhotoCap(Number.NaN), QC_MAX_PHOTOS);
  assert.equal(qcPhotoCap(Number.POSITIVE_INFINITY), QC_MAX_PHOTOS_HARD);
});

test("qcPhotosWouldExceed verilen sınırı uygular (varsayılan taban)", () => {
  assert.equal(qcPhotosWouldExceed(6, 1, qcPhotoCap(10)), false);
  assert.equal(qcPhotosWouldExceed(11, 2, qcPhotoCap(10)), true);
  assert.equal(qcPhotosWouldExceed(23, 1, qcPhotoCap(30)), false);
  assert.equal(qcPhotosWouldExceed(24, 1, qcPhotoCap(30)), true);
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
