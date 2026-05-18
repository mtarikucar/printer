// Payment-related pure-logic tests (havale discount + bank details).
// Critical because havale discount feeds final amount sent to the
// customer's email + the OCR expected-amount tolerance check.
//
// Run: npx tsx scripts/test-payment.ts

import {
  calculateHavaleDiscount,
  HAVALE_DISCOUNT_RATE,
  HAVALE_DEADLINE_HOURS,
  HAVALE_REMINDER_HOURS,
} from "../src/lib/config/payment";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ─── Constants sanity ────────────────────────────────────────────
check(
  "HAVALE_DISCOUNT_RATE is 3%",
  HAVALE_DISCOUNT_RATE === 0.03,
  `actual: ${HAVALE_DISCOUNT_RATE}`
);
check(
  "HAVALE_DEADLINE_HOURS is 72h",
  HAVALE_DEADLINE_HOURS === 72,
  `actual: ${HAVALE_DEADLINE_HOURS}`
);
check(
  "HAVALE_REMINDER_HOURS < deadline (so reminder fires before expiry)",
  HAVALE_REMINDER_HOURS < HAVALE_DEADLINE_HOURS
);

// ─── calculateHavaleDiscount ─────────────────────────────────────
check("zero amount → 0 discount", calculateHavaleDiscount(0) === 0);
check("negative amount → 0 discount", calculateHavaleDiscount(-100) === 0);

// 1399.00 TL = 139900 kuruş → 3% = 4197 kuruş (₺41.97)
check(
  "139900 kuruş → 4197 kuruş discount",
  calculateHavaleDiscount(139900) === 4197,
  `actual: ${calculateHavaleDiscount(139900)}`
);

// 100000 kuruş = ₺1000.00 → 3% = 3000 kuruş = ₺30
check(
  "100000 kuruş → 3000 kuruş discount",
  calculateHavaleDiscount(100000) === 3000
);

// Math.floor — 33 kuruş (1 TL) → 3% = 0.99 → floored to 0
check(
  "33 kuruş → 0 (floored down)",
  calculateHavaleDiscount(33) === 0,
  `actual: ${calculateHavaleDiscount(33)}`
);

// 34 kuruş → 3% = 1.02 → floored to 1
check(
  "34 kuruş → 1 kuruş (floor boundary)",
  calculateHavaleDiscount(34) === 1
);

// Stress: 1 million kuruş
check(
  "1000000 kuruş → 30000 kuruş discount",
  calculateHavaleDiscount(1000000) === 30000
);

// Idempotent — calling twice returns same value
const first = calculateHavaleDiscount(139900);
const second = calculateHavaleDiscount(139900);
check("idempotent", first === second);

// Discount never exceeds amount (sanity guard against future bug)
const someAmount = 50000;
check(
  "discount never exceeds amount",
  calculateHavaleDiscount(someAmount) < someAmount
);

console.log(`\n${pass}/${pass + fail} payment checks passed`);
if (fail > 0) process.exit(1);
