import crypto from "node:crypto";

/**
 * Manufacturer scoring weights (Q7 rollout).
 *
 * v1 is the legacy formula — fixed weights, no on-time-delivery signal.
 * v2 adds OTD and rebalances toward reliability/responsiveness, with
 * env-tunable weights so we can refine without a deploy. Default v2
 * weights are intentionally close to v1 so the canary doesn't
 * dramatically shift winners on day 1 — fine-grained env tuning is the
 * mechanism for tilting toward OTD as data accumulates.
 *
 * Sum of v2 weights = 1.0; consumers don't normalize.
 */

export type ScoringProfile = "v1" | "v2";

export interface ScoringWeights {
  distance: number;
  load: number;
  reliability: number;
  onTimeDelivery: number;
  compliance: number;
  /**
   * Toplu üretim batching: favours a workshop that is ALREADY producing the
   * same product, so repeat orders of one item cluster into a single run
   * (one plate setup, one resin colour, one QC pass) instead of scattering.
   *
   * Deliberately modest — it reorders otherwise-comparable candidates; it must
   * not out-argue distance or capacity. It also never widens eligibility: the
   * material / capacity / previously-declined hard filters run unchanged, so
   * batching can't push work into a full shop.
   */
  batchAffinity: number;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * v1.1 rebalance: batchAffinity was carved out of distance (0.40 → 0.35),
 * load (0.35 → 0.30) and reliability (0.20 → 0.18). It ships enabled in v1
 * because v1 is the AUTHORITATIVE profile by default (the v2 canary is 0%),
 * and automatic batching of repeat bulk orders is a shipped requirement, not
 * an experiment. Consumers do not normalize — this must sum to exactly 1.0.
 */
export const V1_WEIGHTS: ScoringWeights = {
  distance: 0.35,
  load: 0.3,
  reliability: 0.18,
  onTimeDelivery: 0,
  compliance: 0.05,
  batchAffinity: 0.12,
};

export function getAssignmentWeights(profile: ScoringProfile): ScoringWeights {
  if (profile === "v1") return V1_WEIGHTS;
  return {
    distance: envFloat("MFG_W2_DISTANCE", 0.25),
    load: envFloat("MFG_W2_LOAD", 0.22),
    reliability: envFloat("MFG_W2_RELIABILITY", 0.14),
    onTimeDelivery: envFloat("MFG_W2_OTD", 0.22),
    compliance: envFloat("MFG_W2_COMPLIANCE", 0.05),
    batchAffinity: envFloat("MFG_W2_BATCH", 0.12),
  };
}

/**
 * Used as the `weights_version` value on
 * `manufacturer_assignment_evaluations`. Bump the string (e.g. "v2.1") when
 * you change defaults so historic evaluations stay grouped under the weight
 * set that actually produced them.
 *
 * Both bumped to .1 when batchAffinity was introduced: v1's other weights were
 * rebalanced to make room for it, so pre-change rows were scored by a
 * different algorithm and must not be compared against post-change ones.
 */
export function weightsVersion(profile: ScoringProfile): string {
  return profile === "v1" ? "v1.1" : "v2.1";
}

/**
 * Deterministic gate that maps an orderId to a 0-99 bucket via SHA-1.
 * Stable for the same orderId across retries — critical for the N12
 * decline retry path which re-evaluates the same order multiple times
 * and should never flip algorithms mid-flight.
 */
export function shouldUseV2(orderId: string, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  // SHA-1 first 8 hex chars → uint32 → mod 100. Stable across retries
  // for the same orderId so the N12 decline-retry path stays consistent.
  const hash = crypto.createHash("sha1").update(orderId).digest("hex");
  const bucket = parseInt(hash.slice(0, 8), 16) % 100;
  return bucket < percent;
}

export function getCanaryPercent(): number {
  return envFloat("MANUFACTURER_SCORING_V2_PERCENT", 0);
}
