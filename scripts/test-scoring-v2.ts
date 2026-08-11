// Q7 scoring v2 — pure-logic tests for src/lib/config/manufacturer-scoring.ts
//
// Covers: weights config, env tuning, weightsVersion stamping, the
// shouldUseV2 modulo gate (determinism + distribution + boundary).
// Pure functions only — no DB required.
//
// Run: npx tsx scripts/test-scoring-v2.ts

import crypto from "node:crypto";
import {
  getAssignmentWeights,
  getCanaryPercent,
  shouldUseV2,
  V1_WEIGHTS,
  weightsVersion,
  type ScoringWeights,
} from "../src/lib/config/manufacturer-scoring";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Sum EVERY weight, not a hand-written list of the ones that existed when this
// test was written. Adding a sixth weight with a hand-written sum would leave
// this assertion passing while the effective total silently drifted off 1.0 —
// and consumers do not normalize, so every score would shift.
const sumWeights = (w: ScoringWeights) =>
  Object.values(w).reduce((a, b) => a + b, 0);

// ─── V1_WEIGHTS shape ────────────────────────────────────────────
const v1 = getAssignmentWeights("v1");
check("v1 weights match V1_WEIGHTS constant", v1 === V1_WEIGHTS);
check("v1.distance === 0.35", v1.distance === 0.35);
check("v1.load === 0.30", v1.load === 0.3);
check("v1.reliability === 0.18", v1.reliability === 0.18);
check("v1.onTimeDelivery === 0 (signal disabled)", v1.onTimeDelivery === 0);
check("v1.compliance === 0.05", v1.compliance === 0.05);
check("v1.batchAffinity === 0.12 (toplu üretim batching, live)", v1.batchAffinity === 0.12);

const v1Sum = sumWeights(v1);
check(
  "v1 weights sum to 1.0",
  Math.abs(v1Sum - 1) < 0.0001,
  `actual: ${v1Sum}`
);

// ─── v2 default weights ──────────────────────────────────────────
// Make sure none of MFG_W2_* env vars are set first.
delete process.env.MFG_W2_DISTANCE;
delete process.env.MFG_W2_LOAD;
delete process.env.MFG_W2_RELIABILITY;
delete process.env.MFG_W2_OTD;
delete process.env.MFG_W2_COMPLIANCE;
delete process.env.MFG_W2_BATCH;

const v2Default = getAssignmentWeights("v2");
check("v2.distance default 0.25", v2Default.distance === 0.25);
check("v2.load default 0.22", v2Default.load === 0.22);
check("v2.reliability default 0.14", v2Default.reliability === 0.14);
check("v2.onTimeDelivery default 0.22", v2Default.onTimeDelivery === 0.22);
check("v2.compliance default 0.05", v2Default.compliance === 0.05);
check("v2.batchAffinity default 0.12", v2Default.batchAffinity === 0.12);

const v2DefaultSum = sumWeights(v2Default);
check(
  "v2 default weights sum to 1.0",
  Math.abs(v2DefaultSum - 1) < 0.0001,
  `actual: ${v2DefaultSum}`
);

// Every weight must be env-tunable, or an operator can't dial a signal down
// in production without a deploy.
check(
  "every v2 weight has an env override",
  (() => {
    const envNames: Record<keyof ScoringWeights, string> = {
      distance: "MFG_W2_DISTANCE",
      load: "MFG_W2_LOAD",
      reliability: "MFG_W2_RELIABILITY",
      onTimeDelivery: "MFG_W2_OTD",
      compliance: "MFG_W2_COMPLIANCE",
      batchAffinity: "MFG_W2_BATCH",
    };
    for (const [key, envName] of Object.entries(envNames)) {
      process.env[envName] = "0.99";
      const tuned = getAssignmentWeights("v2");
      delete process.env[envName];
      if (tuned[key as keyof ScoringWeights] !== 0.99) return false;
    }
    return true;
  })()
);

// ─── v2 env tuning ───────────────────────────────────────────────
process.env.MFG_W2_DISTANCE = "0.5";
process.env.MFG_W2_OTD = "0.1";
const v2Tuned = getAssignmentWeights("v2");
check("v2 picks up env override (distance)", v2Tuned.distance === 0.5);
check("v2 picks up env override (otd)", v2Tuned.onTimeDelivery === 0.1);
check(
  "v2 keeps default for non-overridden (load still 0.22)",
  v2Tuned.load === 0.22
);

// Clean up env for next tests
delete process.env.MFG_W2_DISTANCE;
delete process.env.MFG_W2_OTD;

// Malformed env → fallback
process.env.MFG_W2_DISTANCE = "not-a-number";
const v2Bad = getAssignmentWeights("v2");
check(
  "v2 malformed env falls back to default (NaN → 0.25)",
  v2Bad.distance === 0.25,
  `actual: ${v2Bad.distance}`
);
delete process.env.MFG_W2_DISTANCE;

process.env.MFG_W2_DISTANCE = "-1";
const v2Negative = getAssignmentWeights("v2");
check(
  "v2 negative env rejected, falls back to default",
  v2Negative.distance === 0.25,
  `actual: ${v2Negative.distance}`
);
delete process.env.MFG_W2_DISTANCE;

// ─── weightsVersion ──────────────────────────────────────────────
check("weightsVersion('v1') === 'v1.1'", weightsVersion("v1") === "v1.1");
check("weightsVersion('v2') === 'v2.1'", weightsVersion("v2") === "v2.1");

// ─── getCanaryPercent ────────────────────────────────────────────
delete process.env.MANUFACTURER_SCORING_V2_PERCENT;
check(
  "getCanaryPercent defaults to 0 (shadow mode)",
  getCanaryPercent() === 0
);

process.env.MANUFACTURER_SCORING_V2_PERCENT = "25";
check("getCanaryPercent reads env (25)", getCanaryPercent() === 25);
delete process.env.MANUFACTURER_SCORING_V2_PERCENT;

// ─── shouldUseV2 — boundary cases ────────────────────────────────
const sampleId = "FIG-ABC123_";
check(
  "shouldUseV2(_, 0) always false",
  shouldUseV2(sampleId, 0) === false
);
check(
  "shouldUseV2(_, 100) always true",
  shouldUseV2(sampleId, 100) === true
);
check(
  "shouldUseV2(_, -10) treated as 0",
  shouldUseV2(sampleId, -10) === false
);
check(
  "shouldUseV2(_, 200) treated as 100",
  shouldUseV2(sampleId, 200) === true
);

// ─── shouldUseV2 — determinism ───────────────────────────────────
// Critical for N12 decline retry: same orderId must land in same bucket
// across retries so the algorithm choice doesn't flip mid-flight.
let determinismOk = true;
for (let i = 0; i < 10; i++) {
  const a = shouldUseV2("FIG-DETERMINISM-TEST", 50);
  const b = shouldUseV2("FIG-DETERMINISM-TEST", 50);
  if (a !== b) {
    determinismOk = false;
    break;
  }
}
check("shouldUseV2 is deterministic for same id", determinismOk);

// ─── shouldUseV2 — distribution ──────────────────────────────────
// 1000 random ids with percent=50 should split roughly 50/50.
// Allow ±5pp tolerance.
let v2Count = 0;
const TOTAL = 1000;
for (let i = 0; i < TOTAL; i++) {
  const id = crypto.randomBytes(8).toString("hex");
  if (shouldUseV2(id, 50)) v2Count++;
}
const ratio = v2Count / TOTAL;
check(
  `shouldUseV2(_, 50) distribution close to 0.5 (got ${ratio.toFixed(3)})`,
  Math.abs(ratio - 0.5) < 0.05
);

// Same test at 10% — should be roughly 10%.
let v2Count10 = 0;
for (let i = 0; i < TOTAL; i++) {
  const id = crypto.randomBytes(8).toString("hex");
  if (shouldUseV2(id, 10)) v2Count10++;
}
const ratio10 = v2Count10 / TOTAL;
check(
  `shouldUseV2(_, 10) distribution close to 0.1 (got ${ratio10.toFixed(3)})`,
  Math.abs(ratio10 - 0.1) < 0.04
);

// ─── Summary ─────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} scoring-v2 checks passed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
