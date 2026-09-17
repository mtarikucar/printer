import assert from "node:assert/strict";
import {
  assessAdjustmentGroup,
  isValidAdjustmentNet,
  remainingOffsetCapacityKurus,
} from "../src/lib/config/partner-adjustments";

let checks = 0;
function test(name: string, run: () => void) {
  run();
  checks++;
  console.log(`PASS ${name}`);
}

test("credits and offsets require the correct sign and bounded integer kuruş", () => {
  assert.equal(isValidAdjustmentNet("topup", 1), true);
  assert.equal(isValidAdjustmentNet("reprint", 2147483647), true);
  assert.equal(isValidAdjustmentNet("unpaid_offset", -2147483647), true);
  for (const n of [0, -1, 1.5, NaN, Infinity, 2147483648]) {
    assert.equal(isValidAdjustmentNet("topup", n), false);
    assert.equal(isValidAdjustmentNet("reprint", n), false);
  }
  for (const n of [0, 1, -1.5, -Infinity, -2147483648]) {
    assert.equal(isValidAdjustmentNet("unpaid_offset", n), false);
  }
});

test("multiple offsets consume only their source's balance", () => {
  assert.equal(remainingOffsetCapacityKurus(10000, [-3000, -2000]), 5000);
  assert.equal(remainingOffsetCapacityKurus(10000, [-10000]), 0);
  // A later Phase4 correction may reduce the source below authorized offsets.
  assert.equal(remainingOffsetCapacityKurus(2000, [-3000]), -1000);
});

test("invalid source and offset money is rejected rather than rounded or clamped", () => {
  for (const n of [-1, 0.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => remainingOffsetCapacityKurus(n, []), RangeError);
  }
  for (const n of [0, 1, -0.5, NaN, -2147483648]) {
    assert.throws(() => remainingOffsetCapacityKurus(10000, [n]), RangeError);
  }
});

const open = {
  sourceState: "open" as const,
  sourceEligible: true,
  sourceNetKurus: 10000,
  offsetNetKurus: [-3000],
};

test("eligible group includes offsets; a fully offset source permits zero netting", () => {
  assert.deepEqual(assessAdjustmentGroup(open), { eligible: true, netKurus: 7000 });
  assert.deepEqual(assessAdjustmentGroup({ ...open, offsetNetKurus: [-10000] }), {
    eligible: true, netKurus: 0,
  });
});

test("paid, reversed, missing, and batched sources cannot lend their debits to other earnings", () => {
  for (const sourceState of ["settled", "reversed", "missing", "batched"] as const) {
    assert.deepEqual(assessAdjustmentGroup({ ...open, sourceState }), {
      eligible: false, reason: sourceState, netKurus: null,
    });
  }
});

test("refund eligibility and a subsequent source reduction block the entire group", () => {
  assert.deepEqual(assessAdjustmentGroup({ ...open, sourceEligible: false }), {
    eligible: false, reason: "source_ineligible", netKurus: null,
  });
  assert.deepEqual(assessAdjustmentGroup({ ...open, sourceNetKurus: 2000 }), {
    eligible: false, reason: "offset_exceeds_source", netKurus: -1000,
  });
});

console.log(`${checks} partner-adjustment pure checks passed`);
