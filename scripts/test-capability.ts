import assert from "node:assert/strict";
import {
  orderRequirements,
  capabilityMatch,
  capabilityScore,
} from "../src/lib/services/capability";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

test("large figurine requires large_format", () => {
  assert.deepEqual(orderRequirements({ figurineSize: "buyuk" }), ["large_format"]);
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
