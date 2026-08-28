/**
 * Model approval SLA — pure rule tests.
 *
 * The sweeper itself is database-bound, but the part that must never drift is
 * the ordering and the never-clauses: a clean `pass` is auto-approved and
 * nothing else happens to it, `warn`/`fail`/no-verdict are never auto-approved,
 * and a reminder goes out exactly once.
 */
import assert from "node:assert/strict";
import {
  planApprovalSweep,
  slaThresholds,
  SLA_DEFAULTS,
  type SweepInput,
} from "../src/lib/config/model-approval-sla";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

/** A freshly shown, undecided, clean-gate approval. */
const BASE: SweepInput = {
  verdict: "pass",
  ageHours: 1,
  hasToken: true,
  reminderSent: false,
  alreadyEscalated: false,
};

const input = (over: Partial<SweepInput> = {}): SweepInput => ({ ...BASE, ...over });

console.log("\nmodel approval SLA rules\n");

test("a fresh approval is left alone", () => {
  assert.deepEqual(planApprovalSweep(input()), []);
});

test("pass + 48h auto-approves", () => {
  assert.deepEqual(planApprovalSweep(input({ ageHours: 48 })), ["auto_approve"]);
});

test("pass one hour short of the threshold does nothing", () => {
  assert.deepEqual(planApprovalSweep(input({ ageHours: 47 })), []);
});

test("auto-approval is exclusive — no reminder, no escalation", () => {
  assert.deepEqual(planApprovalSweep(input({ ageHours: 400 })), ["auto_approve"]);
});

test("warn is NEVER auto-approved", () => {
  const actions = planApprovalSweep(input({ verdict: "warn", ageHours: 60 }));
  assert.ok(!actions.includes("auto_approve"));
});

test("fail is NEVER auto-approved", () => {
  const actions = planApprovalSweep(input({ verdict: "fail", ageHours: 200 }));
  assert.ok(!actions.includes("auto_approve"));
  assert.deepEqual(actions, ["remind", "escalate"]);
});

test("a missing verdict is missing evidence, not a silent yes", () => {
  const actions = planApprovalSweep(input({ verdict: null, ageHours: 60 }));
  assert.ok(!actions.includes("auto_approve"));
});

test("warn at 72h reminds", () => {
  assert.deepEqual(planApprovalSweep(input({ verdict: "warn", ageHours: 72 })), [
    "remind",
  ]);
});

test("a reminder is sent once, never twice", () => {
  const actions = planApprovalSweep(
    input({ verdict: "warn", ageHours: 100, reminderSent: true })
  );
  assert.deepEqual(actions, []);
});

test("7 days escalates, and does so only once", () => {
  const at7d = planApprovalSweep(
    input({ verdict: "warn", ageHours: 24 * 7, reminderSent: true })
  );
  assert.deepEqual(at7d, ["escalate"]);
  const again = planApprovalSweep(
    input({
      verdict: "warn",
      ageHours: 24 * 9,
      reminderSent: true,
      alreadyEscalated: true,
    })
  );
  assert.deepEqual(again, []);
});

test("remind comes before escalate when both are due", () => {
  assert.deepEqual(planApprovalSweep(input({ verdict: "warn", ageHours: 24 * 8 })), [
    "remind",
    "escalate",
  ]);
});

test("a tokenless order is never mailed, only escalated", () => {
  const actions = planApprovalSweep(
    input({ verdict: "pass", ageHours: 24 * 8, hasToken: false })
  );
  assert.deepEqual(actions, ["escalate"]);
});

test("thresholds come from the environment, with sane fallbacks", () => {
  const prev = process.env.AUTO_APPROVE_PASS_AFTER_H;

  process.env.AUTO_APPROVE_PASS_AFTER_H = "12";
  assert.equal(slaThresholds().autoApproveAfterH, 12);
  assert.deepEqual(planApprovalSweep(input({ ageHours: 13 }), slaThresholds()), [
    "auto_approve",
  ]);

  // Garbage and non-positive values fall back rather than auto-approving
  // everything the instant it is shown.
  process.env.AUTO_APPROVE_PASS_AFTER_H = "0";
  assert.equal(slaThresholds().autoApproveAfterH, SLA_DEFAULTS.autoApproveAfterH);
  process.env.AUTO_APPROVE_PASS_AFTER_H = "yarın";
  assert.equal(slaThresholds().autoApproveAfterH, SLA_DEFAULTS.autoApproveAfterH);

  if (prev === undefined) delete process.env.AUTO_APPROVE_PASS_AFTER_H;
  else process.env.AUTO_APPROVE_PASS_AFTER_H = prev;
});

console.log(
  failures === 0
    ? "\n✅ approval-sla: all checks passed"
    : `\n❌ approval-sla: ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
