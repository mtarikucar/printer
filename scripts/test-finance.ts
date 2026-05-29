import assert from "node:assert/strict";
import { computeEarning, computeKdv } from "../src/lib/services/finance";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

// ─── computeEarning: platform commission split ──────────────────
test("30% commission on 139900 → net 97930", () => {
  const r = computeEarning(139900, 3000);
  assert.deepEqual(r, {
    grossKurus: 139900,
    commissionKurus: 41970,
    netKurus: 97930,
    commissionRateBps: 3000,
  });
});

test("30% commission on 100000 → 30000/70000", () => {
  const r = computeEarning(100000, 3000);
  assert.equal(r.commissionKurus, 30000);
  assert.equal(r.netKurus, 70000);
});

test("zero gross → all zero", () => {
  const r = computeEarning(0, 3000);
  assert.equal(r.commissionKurus, 0);
  assert.equal(r.netKurus, 0);
});

test("commission + net always reconcile to gross (rounding)", () => {
  for (const gross of [99900, 139900, 179900, 12345, 1]) {
    const r = computeEarning(gross, 2750);
    assert.equal(r.commissionKurus + r.netKurus, gross);
  }
});

test("0% commission → manufacturer gets everything", () => {
  const r = computeEarning(50000, 0);
  assert.equal(r.commissionKurus, 0);
  assert.equal(r.netKurus, 50000);
});

// ─── computeKdv: KDV-inclusive breakdown ────────────────────────
test("20% KDV on 120000 → 100000 + 20000", () => {
  const r = computeKdv(120000, 2000);
  assert.deepEqual(r, {
    subtotalKurus: 100000,
    kdvKurus: 20000,
    totalKurus: 120000,
    kdvRateBps: 2000,
  });
});

test("20% KDV on 139900 → 116583 + 23317", () => {
  const r = computeKdv(139900, 2000);
  assert.equal(r.subtotalKurus, 116583);
  assert.equal(r.kdvKurus, 23317);
  assert.equal(r.subtotalKurus + r.kdvKurus, 139900);
});

test("10% KDV on 110000 → 100000 + 10000", () => {
  const r = computeKdv(110000, 1000);
  assert.equal(r.subtotalKurus, 100000);
  assert.equal(r.kdvKurus, 10000);
});

test("subtotal + kdv always reconcile to total", () => {
  for (const total of [99900, 139900, 179900, 99999, 1]) {
    const r = computeKdv(total, 2000);
    assert.equal(r.subtotalKurus + r.kdvKurus, total);
  }
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
