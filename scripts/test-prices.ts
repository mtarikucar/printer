import assert from "node:assert/strict";
import {
  figurinePriceKurus,
  finishSurchargeKurus,
  FIGURINE_PRICES_KURUS,
  PRICES_KURUS,
} from "../src/lib/config/prices";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

test("resin base prices per size", () => {
  assert.equal(figurinePriceKurus("kucuk", "resin"), 99900);
  assert.equal(figurinePriceKurus("orta", "resin"), 139900);
  assert.equal(figurinePriceKurus("buyuk", "resin"), 179900);
});

test("filament base prices (₺899 floor, +₺300 steps)", () => {
  assert.equal(figurinePriceKurus("kucuk", "filament"), 89900);
  assert.equal(figurinePriceKurus("orta", "filament"), 119900);
  assert.equal(figurinePriceKurus("buyuk", "filament"), 149900);
  // Resin premium grows with size (resin material cost scales with volume).
  assert.equal(figurinePriceKurus("kucuk", "resin") - figurinePriceKurus("kucuk", "filament"), 10000);
  assert.equal(figurinePriceKurus("orta", "resin") - figurinePriceKurus("orta", "filament"), 20000);
  assert.equal(figurinePriceKurus("buyuk", "resin") - figurinePriceKurus("buyuk", "filament"), 30000);
});

test("finish surcharges: paint +₺1.000, luxe +₺2.000, raw −₺100", () => {
  assert.equal(finishSurchargeKurus("paintable_kit"), 0);
  assert.equal(finishSurchargeKurus("hand_painted"), 100000);
  assert.equal(finishSurchargeKurus("luxe_display"), 200000);
  assert.equal(finishSurchargeKurus("collector_raw"), -10000);
  // Ladder sanity: luxe is exactly hand-painted + display extras (+₺1.000).
  assert.equal(
    finishSurchargeKurus("luxe_display") - finishSurchargeKurus("hand_painted"),
    100000
  );
});

test("unknown material falls back to resin pricing", () => {
  assert.equal(figurinePriceKurus("orta", "bogus"), 139900);
  assert.equal(figurinePriceKurus("orta", ""), 139900);
});

test("unknown size → 0", () => {
  assert.equal(figurinePriceKurus("xxl", "resin"), 0);
});

test("PRICES_KURUS stays the resin table (back-compat)", () => {
  assert.equal(PRICES_KURUS.kucuk, 99900);
  assert.equal(PRICES_KURUS.orta, 139900);
  assert.equal(PRICES_KURUS.buyuk, 179900);
});

test("FIGURINE_PRICES_KURUS exposes both materials", () => {
  assert.equal(FIGURINE_PRICES_KURUS.resin.buyuk, 179900);
  assert.equal(FIGURINE_PRICES_KURUS.filament.buyuk, 149900);
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
