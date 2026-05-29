import assert from "node:assert/strict";
import {
  computeMetrics,
  shouldAutoSuspend,
  STRIKE_SUSPEND_THRESHOLD,
} from "../src/lib/services/performance";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

test("counts actions by type", () => {
  const m = computeMetrics([
    { action: "accept" },
    { action: "accept" },
    { action: "decline" },
    { action: "ship" },
    { action: "submit_qc" },
    { action: "cancel_after_accept" },
  ]);
  assert.equal(m.accepted, 2);
  assert.equal(m.declined, 1);
  assert.equal(m.shipped, 1);
  assert.equal(m.submittedQc, 1);
  assert.equal(m.cancelled, 1);
  assert.equal(m.total, 6);
});

test("acceptance rate = accepted / (accepted + declined)", () => {
  const m = computeMetrics([
    { action: "accept" },
    { action: "accept" },
    { action: "accept" },
    { action: "decline" },
  ]);
  assert.equal(m.acceptanceRate, 0.75);
});

test("no offers → acceptance rate defaults to 1 (no penalty)", () => {
  const m = computeMetrics([]);
  assert.equal(m.acceptanceRate, 1);
  assert.equal(m.total, 0);
});

test("auto-suspend at/above threshold", () => {
  assert.equal(shouldAutoSuspend(STRIKE_SUSPEND_THRESHOLD), true);
  assert.equal(shouldAutoSuspend(STRIKE_SUSPEND_THRESHOLD + 2), true);
});

test("below threshold → no suspend", () => {
  assert.equal(shouldAutoSuspend(STRIKE_SUSPEND_THRESHOLD - 1), false);
  assert.equal(shouldAutoSuspend(0), false);
});

test("custom threshold respected", () => {
  assert.equal(shouldAutoSuspend(2, 2), true);
  assert.equal(shouldAutoSuspend(1, 2), false);
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
