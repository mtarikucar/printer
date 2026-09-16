/**
 * Boyacı kabul SLA'sı — saf kural sınamaları (veritabanı yok).
 *
 * Süpürmenin kendisi DB'ye bağlı, ama asla kaymaması gereken kısım karardır:
 *  • süre dolmadan hiçbir şey olmaz,
 *  • yalnız OTOMATİK atanmış iş kendiliğinden devredilir,
 *  • baz baskı yola çıkmış/ulaşmışsa iş TAŞINMAZ (kutu orada),
 *  • bayraklanmış sipariş ikinci kez bayraklanmaz (her saat e-posta yağmaz).
 */
import assert from "node:assert/strict";
import {
  PAINTER_ACCEPT_SLA_HOURS,
  planPainterAcceptSla,
  type PainterSlaInput,
} from "../src/lib/queue/workers/painter-accept-sla.worker";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

/** Yeni atanmış, otomatik seçilmiş, kutusu henüz yola çıkmamış bir iş. */
const BASE: PainterSlaInput = {
  ageHours: 1,
  autoAssigned: true,
  parcelOnTheWay: false,
  alreadyFlagged: false,
};

const input = (over: Partial<PainterSlaInput> = {}): PainterSlaInput => ({
  ...BASE,
  ...over,
});

console.log("\nboyacı kabul SLA kuralları\n");

test("süresi dolmamış iş kımıldamaz", () => {
  assert.deepEqual(planPainterAcceptSla(input()), []);
});

test("sınırın bir saat altındaki iş hâlâ kımıldamaz", () => {
  assert.deepEqual(
    planPainterAcceptSla(input({ ageHours: PAINTER_ACCEPT_SLA_HOURS - 1 })),
    []
  );
});

test("24 saat sessiz kalan OTOMATİK atama devredilir", () => {
  assert.deepEqual(planPainterAcceptSla(input({ ageHours: PAINTER_ACCEPT_SLA_HOURS })), [
    "reassign",
  ]);
});

test("elle atanmış iş devredilmez, yalnız bayraklanır", () => {
  assert.deepEqual(
    planPainterAcceptSla(input({ ageHours: 48, autoAssigned: false })),
    ["flag"]
  );
});

test("baz baskı yola çıktıysa otomatik atama bile devredilmez", () => {
  assert.deepEqual(
    planPainterAcceptSla(input({ ageHours: 48, parcelOnTheWay: true })),
    ["flag"]
  );
});

test("bayraklanmış sipariş ikinci kez bayraklanmaz", () => {
  assert.deepEqual(
    planPainterAcceptSla(
      input({ ageHours: 72, autoAssigned: false, alreadyFlagged: true })
    ),
    []
  );
});

test("bayrak, devri ENGELLEMEZ: otomatik iş yine de taşınır", () => {
  // Bayrak yalnız "admin'e bir kez haber verildi" demektir. Devir, işi
  // gerçekten ilerleten eylemdir ve bir nottan dolayı atlanmamalıdır.
  assert.deepEqual(
    planPainterAcceptSla(input({ ageHours: 48, alreadyFlagged: true })),
    ["reassign"]
  );
});

test("eşik dışarıdan verilebilir (ops ayarı)", () => {
  assert.deepEqual(planPainterAcceptSla(input({ ageHours: 6 }), 4), ["reassign"]);
  assert.deepEqual(planPainterAcceptSla(input({ ageHours: 3 }), 4), []);
});

if (failures > 0) {
  console.error(`\n${failures} sınama başarısız`);
  process.exit(1);
}
console.log("\nhepsi geçti");
