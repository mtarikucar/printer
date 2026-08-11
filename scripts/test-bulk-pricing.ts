import assert from "node:assert/strict";
import {
  computeSelectionPrice,
  pickTier,
  type ProductConfig,
} from "../src/lib/services/product-options";
import { validateTiers } from "../src/lib/services/product-tiers";
import {
  ABSOLUTE_MAX_LINE_QTY,
  BULK_DEFAULT_MAX_QTY,
  NORMAL_MAX_LINE_QTY,
  effectiveMaxQty,
} from "../src/lib/config/bulk";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

// A ₺30 keychain: 10+ → ₺26, 50+ → ₺22.
const KEYCHAIN: ProductConfig = {
  optionGroups: [],
  addons: [],
  tiers: [
    { minQuantity: 10, unitPriceKurus: 2600 },
    { minQuantity: 50, unitPriceKurus: 2200 },
  ],
};
const BASE = 3000;

// Same product with a paid option group and an add-on, to prove deltas stack
// on TOP of the tier price rather than being discounted with it.
const KEYCHAIN_WITH_EXTRAS: ProductConfig = {
  ...KEYCHAIN,
  optionGroups: [
    {
      id: "g1",
      name: "Renk",
      isRequired: false,
      choices: [
        { id: "c-plain", name: "Düz", priceDeltaKurus: 0, isDefault: true, hasImages: false },
        { id: "c-gold", name: "Altın kaplama", priceDeltaKurus: 500, isDefault: false, hasImages: false },
      ],
    },
  ],
  addons: [
    { id: "a-gift", name: "Hediye paketi", description: null, priceKurus: 900 },
  ],
};

// ─── pickTier ───────────────────────────────────────────────────────────────

test("pickTier: below the first rung there is no tier", () => {
  assert.equal(pickTier(KEYCHAIN.tiers, 1), null);
  assert.equal(pickTier(KEYCHAIN.tiers, 9), null);
});

test("pickTier: boundaries are inclusive and pick the HIGHEST reached rung", () => {
  assert.equal(pickTier(KEYCHAIN.tiers, 10)?.unitPriceKurus, 2600);
  assert.equal(pickTier(KEYCHAIN.tiers, 49)?.unitPriceKurus, 2600);
  assert.equal(pickTier(KEYCHAIN.tiers, 50)?.unitPriceKurus, 2200);
  assert.equal(pickTier(KEYCHAIN.tiers, 200)?.unitPriceKurus, 2200);
});

test("pickTier: unsorted input still yields the highest reached rung", () => {
  const shuffled = [
    { minQuantity: 50, unitPriceKurus: 2200 },
    { minQuantity: 10, unitPriceKurus: 2600 },
  ];
  assert.equal(pickTier(shuffled, 60)?.unitPriceKurus, 2200);
  assert.equal(pickTier(shuffled, 12)?.unitPriceKurus, 2600);
});

test("pickTier: empty ladder never matches", () => {
  assert.equal(pickTier([], 1000), null);
});

// ─── computeSelectionPrice ──────────────────────────────────────────────────

test("no tier reached → base price, list price identical, no tier recorded", () => {
  const p = computeSelectionPrice(KEYCHAIN, BASE, [], [], 9);
  assert.equal(p.unitPriceKurus, 3000);
  assert.equal(p.listUnitPriceKurus, 3000);
  assert.equal(p.appliedTierMinQuantity, null);
});

test("omitting quantity behaves exactly like quantity=1 (back-compat)", () => {
  const withArg = computeSelectionPrice(KEYCHAIN, BASE, [], [], 1);
  const withoutArg = computeSelectionPrice(KEYCHAIN, BASE, [], []);
  assert.deepEqual(withoutArg, withArg);
  assert.equal(withoutArg.unitPriceKurus, 3000);
});

test("tier replaces the base price and records which rung fired", () => {
  const p = computeSelectionPrice(KEYCHAIN, BASE, [], [], 12);
  assert.equal(p.unitPriceKurus, 2600);
  assert.equal(p.listUnitPriceKurus, 3000);
  assert.equal(p.appliedTierMinQuantity, 10);

  const deep = computeSelectionPrice(KEYCHAIN, BASE, [], [], 80);
  assert.equal(deep.unitPriceKurus, 2200);
  assert.equal(deep.appliedTierMinQuantity, 50);
});

test("option deltas and add-ons stack ON TOP of the tier price, undiscounted", () => {
  // 1 unit: 3000 base + 500 option + 900 addon = 4400
  const single = computeSelectionPrice(
    KEYCHAIN_WITH_EXTRAS,
    BASE,
    ["c-gold"],
    ["a-gift"],
    1
  );
  assert.equal(single.unitPriceKurus, 4400);

  // 12 units: 2600 tier + the SAME 500 + 900 = 4000. The extras keep full price;
  // only the base moved. The saving is exactly the base discount (400).
  const bulk = computeSelectionPrice(
    KEYCHAIN_WITH_EXTRAS,
    BASE,
    ["c-gold"],
    ["a-gift"],
    12
  );
  assert.equal(bulk.unitPriceKurus, 4000);
  assert.equal(bulk.listUnitPriceKurus, 4400);
  assert.equal(bulk.listUnitPriceKurus - bulk.unitPriceKurus, BASE - 2600);
});

test("default choice is applied at tier prices too", () => {
  const p = computeSelectionPrice(KEYCHAIN_WITH_EXTRAS, BASE, [], [], 12);
  // "Düz" is the default (+0), no add-on selected.
  assert.equal(p.unitPriceKurus, 2600);
  assert.equal(p.selectedOptions.length, 1);
  assert.equal(p.selectedOptions[0].choiceName, "Düz");
});

test("a negative option delta still floors the unit price at 0, tier or not", () => {
  const cfg: ProductConfig = {
    optionGroups: [
      {
        id: "g",
        name: "İşleme",
        isRequired: false,
        choices: [
          { id: "cheap", name: "Ham", priceDeltaKurus: -9999, isDefault: false, hasImages: false },
        ],
      },
    ],
    addons: [],
    tiers: [{ minQuantity: 10, unitPriceKurus: 2600 }],
  };
  const p = computeSelectionPrice(cfg, BASE, ["cheap"], [], 12);
  assert.equal(p.unitPriceKurus, 0);
  assert.ok(p.listUnitPriceKurus >= 0);
});

test("listUnitPriceKurus is never below unitPriceKurus", () => {
  for (const qty of [1, 9, 10, 49, 50, 200]) {
    const p = computeSelectionPrice(KEYCHAIN_WITH_EXTRAS, BASE, ["c-gold"], ["a-gift"], qty);
    assert.ok(
      p.listUnitPriceKurus >= p.unitPriceKurus,
      `list < charged at qty ${qty}`
    );
  }
});

test("a product with no tiers is unaffected by quantity", () => {
  const plain: ProductConfig = { optionGroups: [], addons: [], tiers: [] };
  const one = computeSelectionPrice(plain, BASE, [], [], 1);
  const many = computeSelectionPrice(plain, BASE, [], [], 200);
  assert.equal(one.unitPriceKurus, many.unitPriceKurus);
  assert.equal(many.appliedTierMinQuantity, null);
});

// ─── Per-product aggregation (the rule resolveOrderLines applies) ───────────
// resolveOrderLines hits the DB, so we assert the pure rule it implements:
// two variant lines of ONE product are priced off their combined quantity.

test("two variant lines of one product are priced off their COMBINED quantity", () => {
  const red = 6;
  const blue = 6;
  const aggregate = red + blue;
  // Per-line pricing would leave both at base; aggregated they reach the 10+ rung.
  assert.equal(computeSelectionPrice(KEYCHAIN, BASE, [], [], red).unitPriceKurus, 3000);
  assert.equal(
    computeSelectionPrice(KEYCHAIN, BASE, [], [], aggregate).unitPriceKurus,
    2600
  );
  // Both lines must be charged the SAME aggregated unit price.
  const line1 = computeSelectionPrice(KEYCHAIN, BASE, [], [], aggregate);
  const line2 = computeSelectionPrice(KEYCHAIN, BASE, [], [], aggregate);
  assert.equal(line1.unitPriceKurus, line2.unitPriceKurus);
  assert.equal(line1.unitPriceKurus * aggregate, 2600 * 12);
});

// ─── effectiveMaxQty ────────────────────────────────────────────────────────

test("non-bulk products keep the historic 20-unit ceiling", () => {
  assert.equal(
    effectiveMaxQty({ bulkEnabled: false, bulkMaxQuantity: null }),
    NORMAL_MAX_LINE_QTY
  );
  // A stale bulkMaxQuantity must not leak through once the flag is off.
  assert.equal(
    effectiveMaxQty({ bulkEnabled: false, bulkMaxQuantity: 200 }),
    NORMAL_MAX_LINE_QTY
  );
});

test("bulk products use their own ceiling, defaulting to the global one", () => {
  assert.equal(
    effectiveMaxQty({ bulkEnabled: true, bulkMaxQuantity: null }),
    BULK_DEFAULT_MAX_QTY
  );
  assert.equal(effectiveMaxQty({ bulkEnabled: true, bulkMaxQuantity: 120 }), 120);
});

test("no configuration can exceed the absolute ceiling or fall below the normal one", () => {
  assert.equal(
    effectiveMaxQty({ bulkEnabled: true, bulkMaxQuantity: 99_999 }),
    ABSOLUTE_MAX_LINE_QTY
  );
  assert.equal(effectiveMaxQty({ bulkEnabled: true, bulkMaxQuantity: 0 }), NORMAL_MAX_LINE_QTY);
  assert.equal(effectiveMaxQty({ bulkEnabled: true, bulkMaxQuantity: -5 }), NORMAL_MAX_LINE_QTY);
});

// ─── validateTiers ──────────────────────────────────────────────────────────

const okArgs = {
  basePriceKurus: BASE,
  bulkMaxQuantity: null,
  bulkEnabled: true,
  ownerType: "admin" as const,
};

test("a well-formed ladder validates and comes back sorted", () => {
  const r = validateTiers({
    ...okArgs,
    tiers: [
      { minQuantity: 50, unitPriceKurus: 2200 },
      { minQuantity: 10, unitPriceKurus: 2600 },
    ],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.tiers.map((t) => t.minQuantity), [10, 50]);
});

test("seller-owned products may not carry tiers (v1 payout guard)", () => {
  const r = validateTiers({ ...okArgs, ownerType: "seller", tiers: [{ minQuantity: 10, unitPriceKurus: 2600 }] });
  assert.ok(!r.ok);
  assert.equal(r.error, "not_admin_product");
  // ...and flipping bulk on with no tiers is refused for the same reason.
  const r2 = validateTiers({ ...okArgs, ownerType: "seller", tiers: [] });
  assert.ok(!r2.ok);
  assert.equal(r2.error, "not_admin_product");
});

test("a seller product with bulk OFF and no tiers is fine (the common case)", () => {
  const r = validateTiers({
    ...okArgs,
    ownerType: "seller",
    bulkEnabled: false,
    tiers: [],
  });
  assert.ok(r.ok);
});

test("bulk cannot be enabled without at least one tier", () => {
  const r = validateTiers({ ...okArgs, tiers: [] });
  assert.ok(!r.ok);
  assert.equal(r.error, "bulk_without_tiers");
});

test("a tier starting at 1 is rejected (that is just the list price)", () => {
  const r = validateTiers({ ...okArgs, tiers: [{ minQuantity: 1, unitPriceKurus: 2600 }] });
  assert.ok(!r.ok);
  assert.equal(r.error, "min_quantity_too_low");
});

test("a tier beyond the absolute ceiling is rejected as unreachable", () => {
  const r = validateTiers({
    ...okArgs,
    tiers: [{ minQuantity: ABSOLUTE_MAX_LINE_QTY + 1, unitPriceKurus: 2600 }],
  });
  assert.ok(!r.ok);
  assert.equal(r.error, "min_quantity_too_high");
});

test("duplicate minQuantity is rejected", () => {
  const r = validateTiers({
    ...okArgs,
    tiers: [
      { minQuantity: 10, unitPriceKurus: 2600 },
      { minQuantity: 10, unitPriceKurus: 2500 },
    ],
  });
  assert.ok(!r.ok);
  assert.equal(r.error, "min_quantity_duplicate");
});

test("a tier at or above the base price is rejected", () => {
  for (const price of [BASE, BASE + 1]) {
    const r = validateTiers({ ...okArgs, tiers: [{ minQuantity: 10, unitPriceKurus: price }] });
    assert.ok(!r.ok);
    assert.equal(r.error, "price_not_below_base");
  }
});

test("a non-positive tier price is rejected", () => {
  const r = validateTiers({ ...okArgs, tiers: [{ minQuantity: 10, unitPriceKurus: 0 }] });
  assert.ok(!r.ok);
  assert.equal(r.error, "price_not_positive");
});

test("'buy more, pay more' is impossible — prices must strictly decrease", () => {
  const r = validateTiers({
    ...okArgs,
    tiers: [
      { minQuantity: 10, unitPriceKurus: 2200 },
      { minQuantity: 50, unitPriceKurus: 2600 },
    ],
  });
  assert.ok(!r.ok);
  assert.equal(r.error, "price_not_decreasing");

  // Equal prices are rejected too — a flat rung is a rung that does nothing.
  const flat = validateTiers({
    ...okArgs,
    tiers: [
      { minQuantity: 10, unitPriceKurus: 2600 },
      { minQuantity: 50, unitPriceKurus: 2600 },
    ],
  });
  assert.ok(!flat.ok);
  assert.equal(flat.error, "price_not_decreasing");
});

test("a ceiling below the top rung is rejected (the rung would be unreachable)", () => {
  const r = validateTiers({
    ...okArgs,
    bulkMaxQuantity: 30,
    tiers: [
      { minQuantity: 10, unitPriceKurus: 2600 },
      { minQuantity: 50, unitPriceKurus: 2200 },
    ],
  });
  assert.ok(!r.ok);
  assert.equal(r.error, "max_quantity_below_top_tier");

  // Exactly at the top rung is allowed.
  const exact = validateTiers({
    ...okArgs,
    bulkMaxQuantity: 50,
    tiers: [
      { minQuantity: 10, unitPriceKurus: 2600 },
      { minQuantity: 50, unitPriceKurus: 2200 },
    ],
  });
  assert.ok(exact.ok);
});

test("more than the allowed number of rungs is rejected", () => {
  const many = Array.from({ length: 6 }, (_, i) => ({
    minQuantity: (i + 1) * 10,
    unitPriceKurus: 2900 - i * 100,
  }));
  const r = validateTiers({ ...okArgs, bulkMaxQuantity: null, tiers: many });
  assert.ok(!r.ok);
  assert.equal(r.error, "too_many");
});

test("every validated ladder actually prices correctly end to end", () => {
  const r = validateTiers({
    ...okArgs,
    tiers: [
      { minQuantity: 25, unitPriceKurus: 2400 },
      { minQuantity: 100, unitPriceKurus: 1900 },
    ],
  });
  assert.ok(r.ok);
  const cfg: ProductConfig = { optionGroups: [], addons: [], tiers: r.tiers };
  assert.equal(computeSelectionPrice(cfg, BASE, [], [], 24).unitPriceKurus, 3000);
  assert.equal(computeSelectionPrice(cfg, BASE, [], [], 25).unitPriceKurus, 2400);
  assert.equal(computeSelectionPrice(cfg, BASE, [], [], 100).unitPriceKurus, 1900);
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
