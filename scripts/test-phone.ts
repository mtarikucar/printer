import assert from "node:assert";
import { z } from "zod";
import {
  normalizePhone,
  isValidPhone,
  formatPhoneDisplay,
  COUNTRIES,
  DEFAULT_COUNTRY,
  phoneField,
} from "../src/lib/phone";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("TR mobile with leading 0 and spaces → E.164", () => {
  assert.strictEqual(normalizePhone("0532 123 45 67", "TR"), "+905321234567");
});
check("TR mobile already +90 → E.164", () => {
  assert.strictEqual(normalizePhone("+90 532 123 45 67", "TR"), "+905321234567");
});
check("TR landline (Ankara) → E.164", () => {
  assert.strictEqual(normalizePhone("0312 123 45 67", "TR"), "+903121234567");
});
check("US number with explicit country → E.164", () => {
  assert.strictEqual(normalizePhone("(202) 555-0182", "US"), "+12025550182");
});
check("garbage → null", () => {
  assert.strictEqual(normalizePhone("not-a-phone", "TR"), null);
});
check("too short → null", () => {
  assert.strictEqual(normalizePhone("12345", "TR"), null);
});
check("isValidPhone agrees with normalizePhone", () => {
  assert.strictEqual(isValidPhone("0532 123 45 67", "TR"), true);
  assert.strictEqual(isValidPhone("nope", "TR"), false);
});
check("formatPhoneDisplay returns international form", () => {
  assert.strictEqual(formatPhoneDisplay("+905321234567"), "+90 532 123 45 67");
});
check("Türkiye is the default country and first in list", () => {
  assert.strictEqual(DEFAULT_COUNTRY, "TR");
  assert.strictEqual(COUNTRIES[0].iso, "TR");
});

check("phoneField accepts E.164 and passes through", () => {
  const schema = z.object({ phone: phoneField() });
  const r = schema.parse({ phone: "+905321234567" });
  assert.strictEqual(r.phone, "+905321234567");
});
check("phoneField normalizes a national TR number", () => {
  const schema = z.object({ phone: phoneField() });
  const r = schema.parse({ phone: "0532 123 45 67" });
  assert.strictEqual(r.phone, "+905321234567");
});
check("phoneField rejects garbage", () => {
  const schema = z.object({ phone: phoneField() });
  assert.throws(() => schema.parse({ phone: "nope" }));
});
check("phoneField().optional().nullable() allows null", () => {
  const schema = z.object({ phone: phoneField().nullable().optional() });
  assert.strictEqual(schema.parse({ phone: null }).phone, null);
  assert.strictEqual(schema.parse({}).phone, undefined);
});

console.log(`\nphone: ${passed} checks passed`);
