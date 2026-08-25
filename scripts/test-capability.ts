import assert from "node:assert/strict";
import {
  orderRequirements,
  capabilityMatch,
  capabilityScore,
  manufacturerSupportsMaterial,
  LARGE_FORMAT_MIN_MM,
} from "../src/lib/services/capability";
import { SIZE_PRESETS, LEGACY_SIZE_PRESETS, presetHeightMm } from "../src/lib/config/sizes";

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
