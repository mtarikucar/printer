import assert from "node:assert/strict";
import { figurinePriceKurus, FIGURINE_PRICES_KURUS, PRICES_KURUS } from "../src/lib/config/prices";

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

test("filament = resin − ₺300 (30000 kuruş) per size", () => {
  assert.equal(figurinePriceKurus("kucuk", "filament"), 69900);
  assert.equal(figurinePriceKurus("orta", "filament"), 109900);
  assert.equal(figurinePriceKurus("buyuk", "filament"), 149900);
  for (const size of ["kucuk", "orta", "buyuk"]) {
    assert.equal(
      figurinePriceKurus(size, "resin") - figurinePriceKurus(size, "filament"),
      30000
    );
  }
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
