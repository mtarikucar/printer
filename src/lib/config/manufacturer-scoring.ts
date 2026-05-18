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
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const V1_WEIGHTS: ScoringWeights = {
  distance: 0.4,
  load: 0.35,
  reliability: 0.2,
  onTimeDelivery: 0,
  compliance: 0.05,
};

export function getAssignmentWeights(profile: ScoringProfile): ScoringWeights {
  if (profile === "v1") return V1_WEIGHTS;
  return {
    distance: envFloat("MFG_W2_DISTANCE", 0.3),
    load: envFloat("MFG_W2_LOAD", 0.25),
    reliability: envFloat("MFG_W2_RELIABILITY", 0.15),
    onTimeDelivery: envFloat("MFG_W2_OTD", 0.25),
    compliance: envFloat("MFG_W2_COMPLIANCE", 0.05),
  };
}

/**
 * Used as the `weights_version` value on
 * `manufacturer_assignment_evaluations`. Bump the v2 string (e.g.
 * "v2.1") when you change defaults so historic evaluations stay
 * grouped under their original weight set.
 */
export function weightsVersion(profile: ScoringProfile): string {
  return profile === "v1" ? "v1.0" : "v2.0";
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
