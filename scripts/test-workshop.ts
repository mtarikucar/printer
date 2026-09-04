import assert from "node:assert/strict";
import {
  WORKSHOP_FIGURE_PRICE_KURUS,
  WORKSHOP_COMMISSION_TIERS,
  workshopCommissionRateBps,
  deriveSessionDates,
  WORKSHOP_JOIN_CLOSES_DAYS_BEFORE,
  WORKSHOP_DELIVER_DAYS_BEFORE,
} from "../src/lib/config/workshop";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

// ─── Fiyat ──────────────────────────────────────────────────────────────────

test("atölye figürü ₺1.350", () => {
  assert.equal(WORKSHOP_FIGURE_PRICE_KURUS, 135000);
});

// ─── Komisyon merdiveni ─────────────────────────────────────────────────────
// commissionRateBps PLATFORMUN payıdır; üreticinin net payı 10000 − bps.

test("merdiven kademe sınırları", () => {
  const expected: Array<[number, number]> = [
    [1, 4000], [2, 4000],
    [3, 4500], [5, 4500],
    [6, 5000], [10, 5000],
    [11, 5500], [15, 5500],
    [16, 6000], [17, 6000], [100, 6000],
  ];
  for (const [n, bps] of expected) {
    assert.equal(
      workshopCommissionRateBps(n),
      bps,
      `${n} sipariş için ${bps} bekleniyordu, ${workshopCommissionRateBps(n)} geldi`
    );
  }
});

test("üretici payı sipariş arttıkça ASLA artmaz (monotonluk)", () => {
  let prev = -1;
  for (let n = 1; n <= 200; n++) {
    const bps = workshopCommissionRateBps(n);
    assert.ok(bps >= prev, `n=${n}: komisyon geriledi (${prev} → ${bps})`);
    prev = bps;
  }
});

test("oran her zaman [4000, 6000] aralığında", () => {
  for (const n of [0, 1, 7, 50, 1000, -3]) {
    const bps = workshopCommissionRateBps(n);
    assert.ok(bps >= 4000 && bps <= 6000, `n=${n} → ${bps}`);
  }
});

test("sıfır ve negatif sipariş en düşük komisyona düşer", () => {
  // Parti yoksa merdivenin ilk basamağı geçerlidir; üreticiyi cezalandırmaz.
  assert.equal(workshopCommissionRateBps(0), 4000);
  assert.equal(workshopCommissionRateBps(-1), 4000);
});

test("merdiven tanımı artan sırada ve boşluksuz", () => {
  let prevMin = 0;
  for (const t of WORKSHOP_COMMISSION_TIERS) {
    assert.ok(t.minOrders > prevMin, "minOrders artan olmalı");
    prevMin = t.minOrders;
  }
  assert.equal(WORKSHOP_COMMISSION_TIERS[0].minOrders, 1);
});

// ─── Tarih türetme ──────────────────────────────────────────────────────────

test("kapanış seanstan 5 gün, teslim 1 gün önce", () => {
  assert.equal(WORKSHOP_JOIN_CLOSES_DAYS_BEFORE, 5);
  assert.equal(WORKSHOP_DELIVER_DAYS_BEFORE, 1);
  const startsAt = new Date("2026-10-20T18:00:00.000Z");
  const d = deriveSessionDates(startsAt);
  assert.equal(d.joinClosesAt.toISOString(), "2026-10-15T18:00:00.000Z");
  assert.equal(d.deliverBy.toISOString(), "2026-10-19T18:00:00.000Z");
});

test("tarih türetme girdiyi değiştirmez", () => {
  const startsAt = new Date("2026-10-20T18:00:00.000Z");
  const before = startsAt.toISOString();
  deriveSessionDates(startsAt);
  assert.equal(startsAt.toISOString(), before, "startsAt mutasyona uğradı");
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
