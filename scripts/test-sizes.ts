/**
 * Figurine size: normalization, display and the pricing guard.
 * Sizes became free text in migration 0036 — these lock in that a bespoke size
 * round-trips correctly AND that it can never be silently priced at ₺0.
 */
import assert from "node:assert/strict";
import {
  normalizeSizeInput,
  sizeDisplay,
  sizeDisplayTr,
  isSizePreset,
  formatCm,
  SIZE_PRESETS,
  SIZE_PRESET_KEYS,
  isLegacySizePreset,
  presetHeightMm,
} from "../src/lib/config/sizes";
import { itemPriceKurus, isPriceableSize, UnpricedSizeError } from "../src/lib/config/prices";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

/** assert-style case; reports through the same pass/fail counters as ok(). */
function test(name: string, fn: () => void) {
  try {
    fn();
    ok(name, true);
  } catch (e) {
    ok(name, false, e instanceof Error ? e.message : e);
  }
}

function norm(input: string): string | null {
  const r = normalizeSizeInput(input);
  return r.ok ? r.value : null;
}

console.log("\nnormalizeSizeInput");
ok('"18" → "18 cm"', norm("18") === "18 cm", norm("18"));
ok('"18 cm" → "18 cm"', norm("18 cm") === "18 cm", norm("18 cm"));
ok('"17.5cm" → "17,5 cm"', norm("17.5cm") === "17,5 cm", norm("17.5cm"));
ok('"17,5" → "17,5 cm"', norm("17,5") === "17,5 cm", norm("17,5"));
ok('"175 mm" → "17,5 cm"', norm("175 mm") === "17,5 cm", norm("175 mm"));
ok('"60mm" → "6 cm"', norm("60mm") === "6 cm", norm("60mm"));
ok('"15x10x22" → "15×10×22 cm"', norm("15x10x22") === "15×10×22 cm", norm("15x10x22"));
ok('"15 × 10 × 22 cm" kept', norm("15 × 10 × 22 cm") === "15×10×22 cm", norm("15 × 10 × 22 cm"));
ok('preset "orta" passes through', norm("orta") === "orta", norm("orta"));
ok('preset "ORTA" lowercased', norm("ORTA") === "orta", norm("ORTA"));
ok("empty → empty", norm("") === "", JSON.stringify(norm("")));
ok('"kocaman" rejected', norm("kocaman") === null);
ok("0 cm rejected (below range)", norm("0") === null);
ok("500 cm rejected (above range)", norm("500") === null);
ok("four dimensions rejected", norm("1x2x3x4") === null);
ok("over 40 chars rejected", norm("18 cm ".repeat(10)) === null);
// A normalized value must survive a second pass unchanged — the admin panels
// re-normalize whatever is already stored when the form is re-opened.
ok("idempotent: 17,5 cm", norm("17,5 cm") === "17,5 cm");
ok("idempotent: 15×10×22 cm", norm("15×10×22 cm") === "15×10×22 cm");

console.log("\ndisplay");
const d = { "sizes.orta": "Orta", "sizes.kucuk": "Küçük", "sizes.buyuk": "Büyük" };
ok('preset → "Orta (~8 cm)"', sizeDisplay("orta", d) === "Orta (~8 cm)", sizeDisplay("orta", d));
ok('preset short → "~8 cm"', sizeDisplay("orta", d, { short: true }) === "~8 cm");
ok('kucuk → "Küçük (~6 cm)"', sizeDisplayTr("kucuk") === "Küçük (~6 cm)", sizeDisplayTr("kucuk"));
ok('buyuk → "Büyük (~12 cm)"', sizeDisplayTr("buyuk") === "Büyük (~12 cm)");
ok("free-form passes through", sizeDisplay("17,5 cm", d) === "17,5 cm");
ok("free-form ignores short", sizeDisplayTr("17,5 cm", { short: true }) === "17,5 cm");
ok("null → empty string", sizeDisplay(null, d) === "" && sizeDisplayTr(undefined) === "");
ok("formatCm(80) = 8 cm", formatCm(80) === "8 cm", formatCm(80));
ok("formatCm(175) = 17,5 cm", formatCm(175) === "17,5 cm", formatCm(175));

function threwFor(name: string, size: string | undefined, finish = "hand_painted") {
  let caught = false;
  try {
    itemPriceKurus({ kind: "figure", size, material: "resin", finish });
  } catch (e) {
    caught = e instanceof UnpricedSizeError;
  }
  ok(name, caught);
}

console.log("\npricing guard");
ok("sellable preset is priceable", isSizePreset("standart") && isPriceableSize("standart"));
// Retired tiers resolve for display but must never reach the price tables —
// a legacy order is re-quoted by hand.
ok("retired tiers are not priceable", !isPriceableSize("orta") && !isPriceableSize("buyuk"));
ok("free-form is not priceable", !isPriceableSize("17,5 cm"));
ok("null is not priceable", !isPriceableSize(null));
test("sellable size prices without throwing", () => {
  // The amount itself is test-prices.ts' business; here we only lock in that
  // the guard lets the one sellable size through.
  const amount = itemPriceKurus({
    kind: "figure",
    size: "standart",
    material: "resin",
    finish: "hand_painted",
  });
  assert.equal(typeof amount, "number");
});
threwFor("retired tier throws instead of pricing a stale tier", "orta");
let threw = false;
try {
  itemPriceKurus({ kind: "figure", size: "17,5 cm", material: "resin", finish: "paintable_kit" });
} catch (e) {
  threw = e instanceof UnpricedSizeError;
}
ok("bespoke size throws instead of pricing ₺0", threw);
threw = false;
try {
  // collector_raw has a NEGATIVE surcharge — without the guard an unknown size
  // produced a negative total.
  itemPriceKurus({ kind: "figure", size: undefined, material: "resin", finish: "collector_raw" });
} catch (e) {
  threw = e instanceof UnpricedSizeError;
}
ok("missing size throws (no negative total)", threw);
ok(
  "flat-priced products are unaffected by size",
  itemPriceKurus({ kind: "keychain", material: "resin" }) > 0
);

console.log("\npresetler");
test("tek satılabilir preset: standart 15 cm", () => {
  assert.equal(SIZE_PRESETS.length, 1);
  assert.equal(SIZE_PRESETS[0].key, "standart");
  assert.equal(SIZE_PRESETS[0].heightMm, 150);
  assert.deepEqual([...SIZE_PRESET_KEYS], ["standart"]);
});

test("emekli tier'lar satılamaz ama çözülebilir", () => {
  for (const key of ["kucuk", "orta", "buyuk"]) {
    assert.equal(isSizePreset(key), false, `${key} satılabilir olmamalı`);
    assert.equal(isLegacySizePreset(key), true, `${key} emekli olarak tanınmalı`);
    assert.notEqual(presetHeightMm(key), null, `${key} yüksekliği çözülmeli`);
  }
  assert.equal(isSizePreset("standart"), true);
  assert.equal(isLegacySizePreset("standart"), false);
  assert.equal(presetHeightMm("standart"), 150);
  assert.equal(presetHeightMm("bilinmeyen"), null);
});

test("emekli boyutlar admin panelinde ham key olarak görünmez", () => {
  // Regresyon: sizeDisplay eskiden yalnızca SIZE_PRESETS'e bakıyordu; emekli
  // key'ler bulunamayınca fonksiyon ham "orta" string'ini döndürüyordu.
  assert.equal(sizeDisplayTr("orta"), "Orta (~8 cm)");
  assert.equal(sizeDisplayTr("buyuk", { short: true }), "~12 cm");
  assert.equal(sizeDisplayTr("standart"), "Standart (~15 cm)");
  // Serbest metin ölçü aynen geçer.
  assert.equal(sizeDisplayTr("17,5 cm"), "17,5 cm");
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
