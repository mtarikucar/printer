import assert from "node:assert/strict";
import { trackingUrl, isCarrier, CARRIERS } from "../src/lib/services/carriers";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

test("yurtici builds a tracking URL containing the code", () => {
  const url = trackingUrl("yurtici", "1234567890");
  assert.ok(url && url.includes("yurticikargo") && url.includes("1234567890"));
});

test("aras builds a URL", () => {
  assert.ok(trackingUrl("aras", "AB12")?.includes("aras"));
});

test("code is URL-encoded", () => {
  const url = trackingUrl("ptt", "a b/c");
  assert.ok(url && url.includes("a%20b%2Fc"));
});

test("'other' carrier has no deep link → null", () => {
  assert.equal(trackingUrl("other", "123"), null);
});

test("null carrier → null", () => {
  assert.equal(trackingUrl(null, "123"), null);
});

test("null tracking number → null", () => {
  assert.equal(trackingUrl("yurtici", null), null);
});

test("unknown carrier → null", () => {
  assert.equal(trackingUrl("fedex", "123"), null);
});

test("isCarrier validates the known set", () => {
  assert.equal(isCarrier("yurtici"), true);
  assert.equal(isCarrier("fedex"), false);
  assert.equal(CARRIERS.length >= 5, true);
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
