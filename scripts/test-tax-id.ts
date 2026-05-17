import assert from "node:assert/strict";
import { parseTaxId } from "../src/lib/services/tax-id";

let passed = 0;
const cases: Array<[string, () => void]> = [];

function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

test("empty string → empty", () => {
  const r = parseTaxId("");
  assert.deepEqual(r, { ok: false, reason: "empty" });
});

test("whitespace-only → empty", () => {
  const r = parseTaxId("   \t  ");
  assert.deepEqual(r, { ok: false, reason: "empty" });
});

test("null → empty", () => {
  const r = parseTaxId(null);
  assert.deepEqual(r, { ok: false, reason: "empty" });
});

test("undefined → empty", () => {
  const r = parseTaxId(undefined);
  assert.deepEqual(r, { ok: false, reason: "empty" });
});

test("9 digits → invalid_length", () => {
  const r = parseTaxId("123456789");
  assert.deepEqual(r, { ok: false, reason: "invalid_length" });
});

test("12 digits → invalid_length", () => {
  const r = parseTaxId("123456789012");
  assert.deepEqual(r, { ok: false, reason: "invalid_length" });
});

// Known-valid VKNs from a public open-source validator's test suite
// (https://gist.github.com/sadikay/7847f15100efbdaf036fbec937639857)
const validVkns = ["3973535717", "2037637860", "2823097943", "2012460224"];
for (const vkn of validVkns) {
  test(`valid VKN ${vkn}`, () => {
    const r = parseTaxId(vkn);
    assert.deepEqual(r, { ok: true, type: "vkn", normalized: vkn });
  });
}

test("VKN with wrong checksum → invalid_checksum", () => {
  const r = parseTaxId("3973535711");
  assert.deepEqual(r, { ok: false, reason: "invalid_checksum" });
});

test("VKN all-9s → invalid_checksum", () => {
  const r = parseTaxId("9999999999");
  assert.deepEqual(r, { ok: false, reason: "invalid_checksum" });
});

// Hand-computed valid TCKN:
//   d[0..8] = 1,2,3,4,5,6,7,8,9
//   sumOdd = 1+3+5+7+9 = 25,  sumEven = 2+4+6+8 = 20
//   d[9] = (25*7 - 20) mod 10 = 5
//   d[10] = (1+2+3+4+5+6+7+8+9+5) mod 10 = 0
test("valid synthetic TCKN 12345678950", () => {
  const r = parseTaxId("12345678950");
  assert.deepEqual(r, { ok: true, type: "tckn", normalized: "12345678950" });
});

test("TCKN starting with 0 → invalid_format", () => {
  // Structural rule (first digit non-zero) is reported as invalid_format,
  // distinct from invalid_checksum where the math fails. This lets the UI
  // surface a clearer error message to the user.
  const r = parseTaxId("01234567890");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "invalid_format");
});

test("TCKN with wrong final digit → invalid_checksum", () => {
  const r = parseTaxId("12345678951");
  assert.deepEqual(r, { ok: false, reason: "invalid_checksum" });
});

test("input with spaces and dashes is normalized", () => {
  const r = parseTaxId("397-3535-717");
  assert.deepEqual(r, { ok: true, type: "vkn", normalized: "3973535717" });
});

test("input with spaces is normalized", () => {
  const r = parseTaxId("  3973 535 717  ");
  assert.deepEqual(r, { ok: true, type: "vkn", normalized: "3973535717" });
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
