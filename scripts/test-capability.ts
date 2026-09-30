import assert from "node:assert/strict";
import {
  orderRequirements,
  capabilityMatch,
  capabilityScore,
  manufacturerSupportsAllMaterials,
  manufacturerSupportsMaterial,
  manufacturerSupportsPolymers,
  missingPolymerTags,
  quoteRequirements,
  quoteRequirementsFromSnapshot,
  unsupportedMaterials,
  LARGE_FORMAT_MIN_MM,
  POLYMER_CAPABILITY_PREFIX,
} from "../src/lib/services/capability";
import { SIZE_PRESETS, LEGACY_SIZE_PRESETS, presetHeightMm } from "../src/lib/config/sizes";
import { SEED_SNAPSHOT } from "../src/lib/config/quote-seed";
import type { FrozenQuotePart } from "../src/lib/config/quote-types";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

// ─── large_format threshold: mm, not tier key (2026-08-25) ──────────────────
// The rule used to be `figurineSize === "buyuk"`. When the catalogue collapsed
// to one 150 mm preset that key stopped existing on new orders, so NOTHING
// required large_format any more — 15 cm figures could be routed to a
// small-format manufacturer, silently. The rule is now a millimetre comparison
// against the height the retired "buyuk" tier used to have (120 mm), so the
// original operational intent survives any preset rename or resize.

test("the sellable preset is at least as tall as the old large tier", () => {
  // Guards the ruling itself: if someone shrinks the preset below the
  // threshold, this says so instead of the next test quietly flipping.
  assert.ok(
    SIZE_PRESETS[0].heightMm >= LARGE_FORMAT_MIN_MM,
    `preset ${SIZE_PRESETS[0].heightMm}mm < eşik ${LARGE_FORMAT_MIN_MM}mm`
  );
  assert.equal(
    LARGE_FORMAT_MIN_MM,
    presetHeightMm("buyuk"),
    "eşik, emekli 'buyuk' tier'ının yüksekliğinden koptu"
  );
});

test("the sellable preset requires large_format", () => {
  assert.deepEqual(orderRequirements({ figurineSize: SIZE_PRESETS[0].key }), [
    "large_format",
  ]);
});

test("retired buyuk still requires large_format", () => {
  assert.deepEqual(orderRequirements({ figurineSize: "buyuk" }), ["large_format"]);
});

test("retired tiers under the threshold still require nothing", () => {
  for (const p of LEGACY_SIZE_PRESETS) {
    if (p.heightMm >= LARGE_FORMAT_MIN_MM) continue;
    assert.deepEqual(orderRequirements({ figurineSize: p.key }), [], p.key);
  }
});

test("free-form bespoke size derives no requirement", () => {
  // A hand-priced, hand-assigned order: presetHeightMm returns null and we do
  // NOT invent a capability tag that would shrink the candidate pool.
  assert.deepEqual(orderRequirements({ figurineSize: "17,5 cm" }), []);
  assert.deepEqual(orderRequirements({ figurineSize: "15×10×22 cm" }), []);
  assert.deepEqual(orderRequirements({}), []);
  assert.deepEqual(orderRequirements({ figurineSize: "" }), []);
});

test("anime style requires anime capability", () => {
  assert.ok(orderRequirements({ style: "anime" }).includes("style_anime"));
});

test("small realistic has no special requirements", () => {
  assert.deepEqual(orderRequirements({ figurineSize: "kucuk", style: "realistic" }), []);
});

test("no requirements → every manufacturer matches", () => {
  assert.equal(capabilityMatch([], []), true);
  assert.equal(capabilityMatch(null, []), true);
});

test("matches only when all required tags are declared", () => {
  assert.equal(capabilityMatch(["large_format"], ["large_format"]), true);
  assert.equal(capabilityMatch(["style_anime"], ["large_format"]), false);
  assert.equal(capabilityMatch([], ["large_format"]), false);
});

test("score is fraction of required tags met", () => {
  assert.equal(capabilityScore(["large_format"], ["large_format", "style_anime"]), 0.5);
  assert.equal(capabilityScore([], ["large_format"]), 0);
  assert.equal(capabilityScore(["large_format", "style_anime"], ["large_format"]), 1);
  assert.equal(capabilityScore(null, []), 1);
});

// ─── material capability (assignment hard-filter) ──────────────
test("legacy: null/empty capabilities → supports all materials", () => {
  assert.equal(manufacturerSupportsMaterial(null, "resin"), true);
  assert.equal(manufacturerSupportsMaterial(undefined, "filament"), true);
  assert.equal(manufacturerSupportsMaterial([], "resin"), true);
});

test("declared resin only → resin yes, filament no", () => {
  assert.equal(manufacturerSupportsMaterial(["material_resin"], "resin"), true);
  assert.equal(manufacturerSupportsMaterial(["material_resin"], "filament"), false);
});

test("declared filament only → filament yes, resin no", () => {
  assert.equal(manufacturerSupportsMaterial(["material_filament"], "filament"), true);
  assert.equal(manufacturerSupportsMaterial(["material_filament"], "resin"), false);
});

test("declared both → both yes", () => {
  const caps = ["material_resin", "material_filament"];
  assert.equal(manufacturerSupportsMaterial(caps, "resin"), true);
  assert.equal(manufacturerSupportsMaterial(caps, "filament"), true);
});

test("non-material capabilities only → not excluded on material", () => {
  assert.equal(manufacturerSupportsMaterial(["large_format"], "filament"), true);
});

// ─── anlık teklif siparişinin gereksinimleri (Faz 4) ────────────────────────
//
// Bir teklif siparişi TEK bir malzeme değil, parçalarının teknolojileri kadar
// malzeme ister; polimer (`pmat_*`) beyanı ise ESNEK kuraldır: hiç `pmat_*`
// beyan etmemiş atölye her polimeri basabilir sayılır. Canlıdaki üç atölyenin
// üçü de hiçbir yönlendirme etiketi taşımıyor — katı kural bugün atamayı
// herkes için durdururdu (manufacturer-assign.ts:207-216).

const frozenPart = (over: Partial<FrozenQuotePart> = {}): FrozenQuotePart => ({
  partId: "00000000-0000-4000-8000-000000000001",
  position: 0,
  name: "Parça",
  fileName: "parca.stl",
  sourceFormat: "stl",
  canonicalStlKey: "quotes/parca/canonical.stl",
  thumbnailKey: null,
  drawingKey: null,
  drawingName: null,
  scaleFactor: 1,
  technologyKey: "fdm",
  technologyName: "FDM (Filament)",
  materialKey: "pla",
  materialName: "PLA",
  colorName: "Beyaz",
  colorHex: "#F5F5F5",
  finishKey: "ham",
  finishName: "Ham",
  layerUm: 200,
  infillPct: 20,
  quantity: 1,
  dimensionsMm: { x: 40, y: 30, z: 20 },
  volumeCm3: 12,
  // Mesh parçası: üçgenler dosyadan geldi, çevrilecek bir B-rep yoktu.
  tessellationMm: null,
  unitKurus: 5000,
  lineKurus: 5000,
  note: null,
  dfmWarnings: [],
  ...over,
});

/** Küçük bir parçanın FDM kutusu — büyük format kuralını tetiklemez. */
const smallFdmPart = {
  orderMaterial: "filament" as const,
  polymerTag: null,
  dimsMm: { x: 40, y: 30, z: 20 },
  buildMm: { x: 250, y: 210, z: 210 },
};

test("teklif parçası yoksa hiçbir gereksinim doğmaz", () => {
  assert.deepEqual(quoteRequirements([]), {
    materials: [],
    polymerTags: [],
    largeFormat: false,
  });
});

test("iki teknoloji karışık teklifte İKİ malzeme de istenir", () => {
  assert.deepEqual(
    quoteRequirements([
      smallFdmPart,
      {
        orderMaterial: "resin",
        polymerTag: null,
        dimsMm: { x: 30, y: 30, z: 30 },
        buildMm: { x: 218, y: 122, z: 220 },
      },
      // Aynı teknolojiden ikinci parça listeyi ÇOĞALTMAZ.
      smallFdmPart,
    ]),
    { materials: ["filament", "resin"], polymerTags: [], largeFormat: false }
  );
});

test("polimer etiketleri toplanır, tekilleşir, null olanlar atlanır", () => {
  assert.deepEqual(
    quoteRequirements([
      { ...smallFdmPart, polymerTag: "pmat_petg" },
      { ...smallFdmPart, polymerTag: null },
      { ...smallFdmPart, polymerTag: "pmat_petg" },
      { ...smallFdmPart, polymerTag: "pmat_tpu" },
    ]).polymerTags,
    ["pmat_petg", "pmat_tpu"]
  );
});

test("eşiği aşan parça büyük format ister, altındaki istemez", () => {
  const tall = (mm: number) => ({ ...smallFdmPart, dimsMm: { x: 20, y: 30, z: mm } });
  assert.equal(quoteRequirements([tall(LARGE_FORMAT_MIN_MM)]).largeFormat, true);
  assert.equal(quoteRequirements([tall(LARGE_FORMAT_MIN_MM - 1)]).largeFormat, false);
  // Eşiği TEK bir parçanın aşması yeter: sipariş bir bütün olarak atanıyor.
  assert.equal(
    quoteRequirements([smallFdmPart, tall(LARGE_FORMAT_MIN_MM + 40)]).largeFormat,
    true
  );
});

test("teknolojisinin baskı hacmine sığmayan parça da büyük format ister", () => {
  // Eşiğin ALTINDA ama makinenin kutusundan taşıyor: sığma kontrolü yönden
  // bağımsızdır (kenarlar küçükten büyüğe eşleştirilir).
  assert.equal(
    quoteRequirements([
      {
        ...smallFdmPart,
        dimsMm: { x: 100, y: 100, z: 100 },
        buildMm: { x: 90, y: 300, z: 300 },
      },
    ]).largeFormat,
    true
  );
  // Aynı parça, döndürülerek sığan bir kutuda gereksinim doğurmaz.
  assert.equal(
    quoteRequirements([
      {
        ...smallFdmPart,
        dimsMm: { x: 100, y: 20, z: 20 },
        buildMm: { x: 30, y: 30, z: 110 },
      },
    ]).largeFormat,
    false
  );
});

test("ölçüsü bilinmeyen kutu aday havuzunu DARALTMAZ", () => {
  // Bozuk sayı gelirse kural susar: eksik bir ölçü, yetenek talebi için
  // gerekçe değildir (largeFormatPlacementBlocked'ın istisnasıyla aynı duruş).
  assert.equal(
    quoteRequirements([
      {
        ...smallFdmPart,
        dimsMm: { x: Number.NaN, y: Number.NaN, z: Number.NaN },
        buildMm: { x: Number.NaN, y: Number.NaN, z: Number.NaN },
      },
    ]).largeFormat,
    false
  );
});

test("gereksinimler teklifin KENDİ katalog anlık görüntüsünden okunur", () => {
  assert.deepEqual(
    quoteRequirementsFromSnapshot(SEED_SNAPSHOT, [
      frozenPart({ technologyKey: "fdm", materialKey: "petg" }),
      frozenPart({ position: 1, technologyKey: "sla", materialKey: "tough_resin" }),
      // Etiketi olmayan malzeme (PLA) polimer talebi doğurmaz.
      frozenPart({ position: 2, technologyKey: "fdm", materialKey: "pla" }),
    ]),
    {
      materials: ["filament", "resin"],
      polymerTags: ["pmat_petg", "pmat_tough_resin"],
      largeFormat: false,
    }
  );
});

test("anlık görüntüde bulunmayan teknoloji sessizce ATLANIR", () => {
  // Teklif yeniden fiyatlanırken katalogdan kalkmış bir teknoloji: uydurma bir
  // malzeme yazmak siparişi yanlış atölyeye gönderirdi.
  assert.deepEqual(
    quoteRequirementsFromSnapshot(SEED_SNAPSHOT, [
      frozenPart({ technologyKey: "sls", materialKey: "pa12" }),
      frozenPart({ position: 1, technologyKey: "sla", materialKey: "standard_resin" }),
    ]),
    { materials: ["resin"], polymerTags: [], largeFormat: false }
  );
  // Hiçbir parça çözülemezse gereksinim YOKTUR: çağıran bugünkü kuralına döner.
  assert.equal(
    quoteRequirementsFromSnapshot(SEED_SNAPSHOT, [
      frozenPart({ technologyKey: "sls" }),
    ]),
    null
  );
  assert.equal(quoteRequirementsFromSnapshot(SEED_SNAPSHOT, []), null);
});

test("tohum kataloğunun polimer etiketleri kuralın önekini kullanır", () => {
  // Kural `pmat_` önekine bakıyor; katalog başka bir aile kullanırsa esnek
  // kural sessizce HER atölyeyi geçirir ve filtre ölü olur.
  assert.equal(POLYMER_CAPABILITY_PREFIX, "pmat_");
  for (const m of SEED_SNAPSHOT.materials) {
    assert.ok(
      m.capabilityTag === null || m.capabilityTag.startsWith(POLYMER_CAPABILITY_PREFIX),
      `${m.key}: ${m.capabilityTag}`
    );
  }
});

// ─── çoklu malzeme kapısı ───────────────────────────────────────────────────
test("tek malzemede yeni kapı eskisiyle aynı cevabı verir", () => {
  for (const caps of [null, [], ["material_resin"], ["material_filament"], ["large_format"]]) {
    for (const material of ["resin", "filament"]) {
      assert.equal(
        manufacturerSupportsAllMaterials(caps, [material]),
        manufacturerSupportsMaterial(caps, material),
        `${JSON.stringify(caps)} / ${material}`
      );
    }
  }
});

test("karışık teklif İKİ malzemeyi de beyan eden atölye ister", () => {
  const both = ["material_resin", "material_filament"];
  assert.equal(manufacturerSupportsAllMaterials(both, ["resin", "filament"]), true);
  assert.equal(
    manufacturerSupportsAllMaterials(["material_resin"], ["resin", "filament"]),
    false
  );
  assert.deepEqual(
    unsupportedMaterials(["material_resin"], ["resin", "filament"]),
    ["filament"]
  );
  // Beyanı olmayan (değerlendirilmemiş) atölye eskiden olduğu gibi kapsam dışı
  // kalmaz — karışık teklifte de.
  assert.equal(manufacturerSupportsAllMaterials(null, ["resin", "filament"]), true);
  assert.deepEqual(unsupportedMaterials(null, ["resin", "filament"]), []);
});

test("malzeme istenmiyorsa kapı kimseyi elemez", () => {
  assert.equal(manufacturerSupportsAllMaterials(["material_resin"], []), true);
});

// ─── polimer kapısı (esnek kural) ───────────────────────────────────────────
test("hiç pmat_* beyan etmeyen atölye her polimeri basabilir sayılır", () => {
  assert.equal(manufacturerSupportsPolymers(null, ["pmat_petg"]), true);
  assert.equal(manufacturerSupportsPolymers([], ["pmat_petg"]), true);
  assert.equal(
    manufacturerSupportsPolymers(["material_resin", "large_format"], ["pmat_petg"]),
    true
  );
  assert.deepEqual(missingPolymerTags(["material_resin"], ["pmat_petg"]), []);
});

test("yalnız pmat_pla beyan eden atölye PETG parçasını alamaz", () => {
  const caps = ["material_filament", "pmat_pla"];
  assert.equal(manufacturerSupportsPolymers(caps, ["pmat_petg"]), false);
  assert.deepEqual(missingPolymerTags(caps, ["pmat_petg"]), ["pmat_petg"]);
  assert.equal(manufacturerSupportsPolymers(caps, ["pmat_pla"]), true);
  assert.equal(manufacturerSupportsPolymers(caps, ["pmat_pla", "pmat_petg"]), false);
  assert.deepEqual(missingPolymerTags(caps, ["pmat_pla", "pmat_petg"]), ["pmat_petg"]);
});

test("polimer istenmiyorsa beyanı olan atölye de elenmez", () => {
  assert.equal(manufacturerSupportsPolymers(["pmat_pla"], []), true);
  assert.deepEqual(missingPolymerTags(["pmat_pla"], []), []);
});

test("pmat_* olmayan bir talep kimseyi elemez (ailesi dışında kural yok)", () => {
  // Katalogda yanlış yazılmış bir etiket, tüm atölyeleri kapatmamalı: esnek
  // kuralın amacı platformu durdurmamaktır.
  assert.equal(manufacturerSupportsPolymers(["pmat_pla"], ["material_resin"]), true);
  assert.deepEqual(missingPolymerTags(["pmat_pla"], ["material_resin"]), []);
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
