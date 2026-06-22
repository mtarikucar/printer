// Pure-logic tests for the WhatsApp click-to-chat helpers.
//
// Run: npx tsx scripts/test-whatsapp.ts

import assert from "node:assert/strict";
import {
  WHATSAPP_NUMBER,
  buildWhatsAppUrl,
  toWhatsAppDigits,
} from "../src/lib/config/contact";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("WhatsApp helpers");

check("WHATSAPP_NUMBER is digits-only E.164 (no +)", () => {
  assert.match(WHATSAPP_NUMBER, /^\d{10,15}$/);
});

check("buildWhatsAppUrl() with no message → bare wa.me link", () => {
  assert.equal(buildWhatsAppUrl(), `https://wa.me/${WHATSAPP_NUMBER}`);
});

check("buildWhatsAppUrl(msg) url-encodes the text", () => {
  const url = buildWhatsAppUrl("Merhaba & dünya: sipariş?");
  assert.ok(url.startsWith(`https://wa.me/${WHATSAPP_NUMBER}?text=`));
  // spaces, &, :, ? must be encoded (no raw specials in the query)
  assert.ok(!url.slice(url.indexOf("?text=") + 6).includes(" "));
  assert.ok(url.includes("%26")); // &
  assert.ok(url.includes("d%C3%BCnya")); // ü encoded
});

check("toWhatsAppDigits: domestic 0-prefixed → 90…", () => {
  assert.equal(toWhatsAppDigits("0546 678 04 95"), "905466780495");
});

check("toWhatsAppDigits: bare 10-digit mobile → 90…", () => {
  assert.equal(toWhatsAppDigits("5466780495"), "905466780495");
});

check("toWhatsAppDigits: +90 formatted stays one 90", () => {
  assert.equal(toWhatsAppDigits("+90 546 678 04 95"), "905466780495");
});

check("toWhatsAppDigits: already-normalized passes through", () => {
  assert.equal(toWhatsAppDigits("905466780495"), "905466780495");
});

check("toWhatsAppDigits: international 0090 prefix is stripped cleanly", () => {
  assert.equal(toWhatsAppDigits("0090 546 678 04 95"), "905466780495");
});

console.log(`\n${passed} passed`);
