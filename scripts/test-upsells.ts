// Q10 — pure-logic tests for calculateUpsellAmount + UPSELL_PRICES_KURUS.
//
// Run: npx tsx scripts/test-upsells.ts

import {
  calculateUpsellAmount,
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

// ─── Summary ─────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} upsells checks passed`);
if (fail > 0) process.exit(1);
