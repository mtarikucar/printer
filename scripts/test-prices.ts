import assert from "node:assert/strict";
import {
  figurinePriceKurus,
  finishSurchargeKurus,
  paintingPortionKurus,
  itemPriceKurus,
  UnpricedSizeError,
  FIGURINE_PRICE_KURUS,
  PAINTING_PORTION_KURUS,
} from "../src/lib/config/prices";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

test("kişiye özel figür tek fiyat: ₺3.499", () => {
  assert.equal(FIGURINE_PRICE_KURUS, 349900);
  assert.equal(figurinePriceKurus("standart", "resin"), 349900);
  // Argümanlar artık fiyatı etkilemiyor — tek ürün.
  assert.equal(figurinePriceKurus("standart", "filament"), 349900);
});

test("boyama taban fiyata dahil, bitiş ek ücreti yok", () => {
  assert.equal(finishSurchargeKurus("hand_painted"), 0);
  assert.equal(finishSurchargeKurus("paintable_kit"), 0);
  assert.equal(finishSurchargeKurus("luxe_display"), 0);
  assert.equal(finishSurchargeKurus("collector_raw"), 0);
  // Uçtan uca: standart figür + hand_painted = tam ₺3.499, ek yok.
  assert.equal(
    itemPriceKurus({ kind: "figure", size: "standart", material: "resin", finish: "hand_painted" }),
    349900
  );
});

test("boyacı payı bitiş ek ücretinden BAĞIMSIZ olarak korunur", () => {
  // Regresyon koruması: paintingPortionKurus eskiden değeri
  // FINISH_SURCHARGES_KURUS.hand_painted'tan okuyordu. Boyama taban fiyata
  // gömülüp o ek ücret 0'a indiği için, açık sabit olmasa boyacılar ₺0 alırdı.
  assert.equal(PAINTING_PORTION_KURUS, 100000);
  assert.equal(paintingPortionKurus("hand_painted"), 100000);
  assert.equal(paintingPortionKurus("luxe_display"), 100000);
  assert.notEqual(paintingPortionKurus("hand_painted"), finishSurchargeKurus("hand_painted"));
  // Boyama içermeyen eski bitişler 0 kalır.
  assert.equal(paintingPortionKurus("paintable_kit"), 0);
  assert.equal(paintingPortionKurus("collector_raw"), 0);
  assert.equal(paintingPortionKurus(null), 0);
});

test("emekli boyutlar fiyatlanamaz — elle teklife düşer", () => {
  for (const size of ["kucuk", "orta", "buyuk", "17,5 cm"]) {
    assert.throws(
      () => itemPriceKurus({ kind: "figure", size, material: "resin", finish: "hand_painted" }),
      UnpricedSizeError,
      `${size} için UnpricedSizeError beklenir`
    );
  }
});

test("Creative Lab düz fiyatları boyuttan etkilenmez", () => {
  // Creative Lab ürünleri figurineSize'ı nötr "orta" olarak saklıyor; "orta"
  // artık fiyatlanamaz olduğu için bu erken dönüşün korunması şart.
  assert.equal(
    itemPriceKurus({ kind: "keychain", size: "orta", material: "resin" }),
    14900
  );
  assert.equal(
    itemPriceKurus({ kind: "fridge_magnet", size: "orta", material: "resin" }),
    12900
  );
  assert.equal(itemPriceKurus({ kind: "lamp", size: "orta", material: "resin" }), 39900);
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
