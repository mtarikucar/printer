// Q10 — pure-logic tests for calculateUpsellAmount + UPSELL_PRICES_KURUS.
//
// Run: npx tsx scripts/test-upsells.ts

import {
  allocatePaytrBasket,
  calculateUpsellAmount,
  PRICES_KURUS,
  UPSELL_PRICES_KURUS,
  VALID_UPSELLS,
} from "../src/lib/config/prices";

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

// ─── Empty / null / undefined ────────────────────────────────────
check("[] returns 0", calculateUpsellAmount([]) === 0);
check("null returns 0", calculateUpsellAmount(null) === 0);
check("undefined returns 0", calculateUpsellAmount(undefined) === 0);

// ─── Single valid key ────────────────────────────────────────────
check(
  "['extra_paint'] returns extra_paint price",
  calculateUpsellAmount(["extra_paint"]) === UPSELL_PRICES_KURUS.extra_paint
);
check(
  "['gift_wrap'] returns gift_wrap price",
  calculateUpsellAmount(["gift_wrap"]) === UPSELL_PRICES_KURUS.gift_wrap
);
check(
  "['rush_shipping'] returns rush_shipping price",
  calculateUpsellAmount(["rush_shipping"]) === UPSELL_PRICES_KURUS.rush_shipping
);

// ─── All valid keys ──────────────────────────────────────────────
const allSum =
  UPSELL_PRICES_KURUS.extra_paint +
  UPSELL_PRICES_KURUS.gift_wrap +
  UPSELL_PRICES_KURUS.rush_shipping;
check(
  "all three keys sum correctly",
  calculateUpsellAmount(["extra_paint", "gift_wrap", "rush_shipping"]) === allSum
);

// ─── Duplicate keys deduped ──────────────────────────────────────
check(
  "duplicate extra_paint counted once",
  calculateUpsellAmount(["extra_paint", "extra_paint"]) ===
    UPSELL_PRICES_KURUS.extra_paint
);
check(
  "multiple dupes deduped",
  calculateUpsellAmount([
    "extra_paint",
    "gift_wrap",
    "extra_paint",
    "gift_wrap",
    "rush_shipping",
  ]) === allSum
);

// ─── Unknown keys silently dropped ───────────────────────────────
// Critical: server-trusts this via validator but the dedupe-skip
// behavior is the second line of defense.
check(
  "unknown key drops to 0",
  calculateUpsellAmount(["nonexistent_sku"]) === 0
);
check(
  "mix of valid + unknown drops only the unknown",
  calculateUpsellAmount(["extra_paint", "fake_addon"]) ===
    UPSELL_PRICES_KURUS.extra_paint
);

// ─── VALID_UPSELLS shape ─────────────────────────────────────────
check(
  "VALID_UPSELLS has 3 entries",
  VALID_UPSELLS.length === 3,
  `actual: ${VALID_UPSELLS.length}`
);
check(
  "VALID_UPSELLS includes extra_paint",
  VALID_UPSELLS.includes("extra_paint")
);
check(
  "VALID_UPSELLS includes gift_wrap",
  VALID_UPSELLS.includes("gift_wrap")
);
check(
  "VALID_UPSELLS includes rush_shipping",
  VALID_UPSELLS.includes("rush_shipping")
);

// ─── Price sanity (regression guard against accidental zero-out) ──
check(
  "extra_paint price > 0",
  UPSELL_PRICES_KURUS.extra_paint > 0,
  `actual: ${UPSELL_PRICES_KURUS.extra_paint}`
);
check(
  "rush_shipping is the most expensive (operational expectation)",
  UPSELL_PRICES_KURUS.rush_shipping > UPSELL_PRICES_KURUS.extra_paint &&
    UPSELL_PRICES_KURUS.rush_shipping > UPSELL_PRICES_KURUS.gift_wrap
);

// ─── allocatePaytrBasket — review C3 fix ─────────────────────────
//
// The basket allocator MUST guarantee:
//   1. Basket sum (in kuruş) == paymentAmountKurus exactly
//   2. No row has a negative price
//   3. Zero-allocated upsell rows are filtered out
//   4. Returns at least the figurine row

function basketSumKurus(rows: ReturnType<typeof allocatePaytrBasket>): number {
  return rows.reduce(
    (acc, r) => acc + Math.round(parseFloat(r.priceTRY) * 100) * r.quantity,
    0
  );
}

const label = (k: string) => `Upsell:${k}`;

// Case A: no upsells → only figurine row
const caseA = allocatePaytrBasket({
  paymentAmountKurus: PRICES_KURUS.orta,
  figurineName: "Figurin (Orta)",
  upsellAmountKurus: 0,
  upsellKeys: [],
  upsellLabel: label,
});
check("no upsells → 1 row", caseA.length === 1);
check(
  "no upsells → figurine = paymentAmount",
  caseA[0].priceTRY === (PRICES_KURUS.orta / 100).toFixed(2)
);
check("no upsells → sum equals paymentAmount", basketSumKurus(caseA) === PRICES_KURUS.orta);

// Case B: figurine + 3 upsells, no gift card
const upsellTotal =
  UPSELL_PRICES_KURUS.extra_paint +
  UPSELL_PRICES_KURUS.gift_wrap +
  UPSELL_PRICES_KURUS.rush_shipping;
const fullTotal = PRICES_KURUS.orta + upsellTotal;
const caseB = allocatePaytrBasket({
  paymentAmountKurus: fullTotal,
  figurineName: "Figurin (Orta)",
  upsellAmountKurus: upsellTotal,
  upsellKeys: ["extra_paint", "gift_wrap", "rush_shipping"],
  upsellLabel: label,
});
check("3 upsells → 4 rows (figurine + 3)", caseB.length === 4);
check(
  "3 upsells → figurine row = base price",
  caseB[0].priceTRY === (PRICES_KURUS.orta / 100).toFixed(2)
);
check("3 upsells → sum equals fullTotal", basketSumKurus(caseB) === fullTotal);
// Upsells should be sorted largest-first
check(
  "upsells sorted largest-first (rush_shipping should be 1st upsell row)",
  caseB[1].name === "Upsell:rush_shipping"
);

// Case C: critical — gift card covers figurine but not upsells (the C3 bug)
// Gift card = full price of kucuk (99,900). User adds rush_shipping (7,900).
// paymentAmount = 7900 (only upsell left to pay).
// Before fix: figurine row = 7900 - 7900 = 0; rush_shipping = 7900. Sum = 7900. OK actually.
// BEFORE fix bug: GC > figurine base. Let's exercise gift card > figurine bug:
// Total = kucuk (99900) + rush (7900) = 107800
// Gift card = 100000 (enough to cover figurine + a bit of upsell)
// paymentAmount = 107800 - 100000 = 7800
// upsellAmount = 7900 (rush_shipping)
// figurineGross = 7800 - 7900 = -100 (NEGATIVE — would break PayTR)
const caseC = allocatePaytrBasket({
  paymentAmountKurus: 7800,
  figurineName: "Figurin (Küçük)",
  upsellAmountKurus: UPSELL_PRICES_KURUS.rush_shipping,
  upsellKeys: ["rush_shipping"],
  upsellLabel: label,
});
check(
  "C3 edge: figurine row clamped to 0 (no negative)",
  parseFloat(caseC[0].priceTRY) >= 0,
  `got: ${caseC[0].priceTRY}`
);
check("C3 edge: sum still equals paymentAmount", basketSumKurus(caseC) === 7800);
check(
  "C3 edge: at least one row present",
  caseC.length >= 1
);

// Case D: gift card covers EVERYTHING but a tiny remainder (1 kuruş edge)
// Total = 99900 + 4900 (extra_paint) = 104800
// GC = 104799 → paymentAmount = 1
// upsellAmount = 4900
// figurineGross = -4899 → clamp to 0
// budget for upsells = 1
// extra_paint allocated = min(4900, 1) = 1 → row { priceTRY: "0.01" }
const caseD = allocatePaytrBasket({
  paymentAmountKurus: 1,
  figurineName: "Figurin",
  upsellAmountKurus: 4900,
  upsellKeys: ["extra_paint"],
  upsellLabel: label,
});
check(
  "1-kurus remainder: sum equals 1 kuruş",
  basketSumKurus(caseD) === 1
);
check(
  "1-kurus remainder: no negative rows",
  caseD.every((r) => parseFloat(r.priceTRY) >= 0)
);

// Case E: gift card covers everything except figurine entirely (upsell exact)
// paymentAmount = upsellAmount exactly
// figurineGross = 0 → clamp 0
// upsellBudget = paymentAmount → upsells get full price
const caseE = allocatePaytrBasket({
  paymentAmountKurus: 7900,
  figurineName: "Figurin",
  upsellAmountKurus: 7900,
  upsellKeys: ["rush_shipping"],
  upsellLabel: label,
});
check("upsell-only payment: 2 rows (figurine + 1 upsell)", caseE.length === 2);
check(
  "upsell-only payment: figurine row = 0",
  caseE[0].priceTRY === "0.00"
);
check(
  "upsell-only payment: upsell at full price",
  caseE[1].priceTRY === "79.00"
);
check(
  "upsell-only payment: sum equals 7900",
  basketSumKurus(caseE) === 7900
);

// Case F: zero-allocated upsells filtered out
// paymentAmount = figurine base only (no upsell budget left)
// upsells provided but allocation = 0 each
const caseF = allocatePaytrBasket({
  paymentAmountKurus: PRICES_KURUS.kucuk,
  figurineName: "Figurin",
  upsellAmountKurus: UPSELL_PRICES_KURUS.extra_paint,
  upsellKeys: ["extra_paint"],
  upsellLabel: label,
});
// figurineGross = kucuk - extra_paint = positive (99900 - 4900 = 95000)
// figurineRow = 95000
// upsellBudget = 99900 - 95000 = 4900
// extra_paint allocated = 4900 → row appears
check(
  "case F: normal flow with upsell (3 row variants tested via sum)",
  basketSumKurus(caseF) === PRICES_KURUS.kucuk
);

// Case G: unknown upsell key in upsellKeys — should be filtered, not crash
const caseG = allocatePaytrBasket({
  paymentAmountKurus: PRICES_KURUS.kucuk + 4900,
  figurineName: "Figurin",
  upsellAmountKurus: 4900,
  upsellKeys: ["extra_paint", "ghost_addon"],
  upsellLabel: label,
});
check(
  "unknown key dropped: sum still correct",
  basketSumKurus(caseG) === PRICES_KURUS.kucuk + 4900
);

// ─── Summary ─────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} upsells checks passed`);
if (fail > 0) process.exit(1);
