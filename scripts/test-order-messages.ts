import assert from "node:assert/strict";
import {
  channelForSender,
  isUnread,
  countUnread,
  containsContactInfo,
} from "../src/lib/services/order-messages";

let passed = 0;
const cases: Array<[string, () => void]> = [];

function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

// ─── Channel derived from auth role (never from request body) ────
test("customer sender → customer_admin channel", () => {
  assert.equal(channelForSender("customer"), "customer_admin");
});

test("manufacturer sender → manufacturer_admin channel", () => {
  assert.equal(channelForSender("manufacturer"), "manufacturer_admin");
});

// ─── Unread, admin viewer ───────────────────────────────────────
test("admin: inbound customer msg, unseen → unread", () => {
  assert.equal(
    isUnread("admin", { senderType: "customer", readByAdminAt: null, readByCounterpartyAt: null }),
    true
  );
});

test("admin: inbound manufacturer msg, unseen → unread", () => {
  assert.equal(
    isUnread("admin", { senderType: "manufacturer", readByAdminAt: null, readByCounterpartyAt: null }),
    true
  );
});

test("admin: own (admin) msg → not unread", () => {
  assert.equal(
    isUnread("admin", { senderType: "admin", readByAdminAt: null, readByCounterpartyAt: null }),
    false
  );
});

test("admin: inbound msg already seen → not unread", () => {
  assert.equal(
    isUnread("admin", { senderType: "customer", readByAdminAt: new Date(), readByCounterpartyAt: null }),
    false
  );
});

// ─── Unread, counterparty viewer (customer or manufacturer) ─────
test("counterparty: admin msg unseen → unread", () => {
  assert.equal(
    isUnread("counterparty", { senderType: "admin", readByAdminAt: null, readByCounterpartyAt: null }),
    true
  );
});

test("counterparty: own msg → not unread", () => {
  assert.equal(
    isUnread("counterparty", { senderType: "customer", readByAdminAt: null, readByCounterpartyAt: null }),
    false
  );
});

test("counterparty: admin msg already seen → not unread", () => {
  assert.equal(
    isUnread("counterparty", { senderType: "admin", readByAdminAt: null, readByCounterpartyAt: new Date() }),
    false
  );
});

// ─── countUnread ────────────────────────────────────────────────
test("countUnread sums per viewer", () => {
  const msgs = [
    { senderType: "admin" as const, readByAdminAt: null, readByCounterpartyAt: null },     // unread for counterparty
    { senderType: "customer" as const, readByAdminAt: null, readByCounterpartyAt: null },  // unread for admin
    { senderType: "admin" as const, readByAdminAt: null, readByCounterpartyAt: new Date() }, // read by counterparty
  ];
  assert.equal(countUnread("counterparty", msgs), 1);
  assert.equal(countUnread("admin", msgs), 1);
});

// ─── Disintermediation heuristic ────────────────────────────────
test("plain text → no contact info", () => {
  assert.equal(containsContactInfo("Merhaba, siparişim ne zaman hazır olur?"), false);
});

test("order reference is not flagged as a phone", () => {
  assert.equal(containsContactInfo("siparişim FIG-2024-7 nerede"), false);
});

test("email is flagged", () => {
  assert.equal(containsContactInfo("bana ahmet@example.com adresinden ulaş"), true);
});

test("turkish mobile (spaced) is flagged", () => {
  assert.equal(containsContactInfo("beni ara 0532 123 45 67"), true);
});

test("turkish mobile (with country code) is flagged", () => {
  assert.equal(containsContactInfo("+90 532 123 45 67"), true);
});

test("http url is flagged", () => {
  assert.equal(containsContactInfo("şuraya bak https://wa.me/905321234567"), true);
});

test("www url is flagged", () => {
  assert.equal(containsContactInfo("www.instagram.com/figur"), true);
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
