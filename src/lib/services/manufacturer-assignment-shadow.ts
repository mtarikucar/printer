import { db } from "@/lib/db";
import { manufacturerAssignmentEvaluations } from "@/lib/db/schema";
import {
  rankManufacturersForOrder,
  type CandidateScore,
} from "@/lib/services/manufacturer-assignment";
import {
  getCanaryPercent,
  shouldUseV2,
  weightsVersion,
  type ScoringProfile,
} from "@/lib/config/manufacturer-scoring";

/**
 * Q7 shadow + canary wrapper.
 *
 * Returns the AUTHORITATIVE ranked candidate list for the order — what
 * the caller (admin UI, N12 reassign, automatic assignment) should act
 * on. Internally also runs the non-authoritative profile in parallel
 * and logs both winners to `manufacturer_assignment_evaluations` so
 * `/admin/scoring-evaluations` can show disagreement before we expand
 * the canary.
 *
 * Authoritative selection:
 *   - shouldUseV2(orderId, MANUFACTURER_SCORING_V2_PERCENT) === true → v2 wins
 *   - otherwise v1 wins (shadow mode default)
 *
 * Idempotent re-runs (e.g. N12 decline retry calling this for the same
 * orderId): the `(order_id, weights_version)` unique index +
 * onConflictDoNothing prevents duplicate evaluation rows. The
 * authoritative winner returned to the caller is still computed fresh.
 *
 * Failure isolation: shadow logging must NEVER block the assignment
 * decision. Logging errors are swallowed and console-warned; the
 * authoritative ranking still comes back.
 */
export async function rankForOrderWithShadow(
  orderId: string
): Promise<CandidateScore[]> {
  const percent = getCanaryPercent();
  const useV2 = shouldUseV2(orderId, percent);
  const authoritativeProfile: ScoringProfile = useV2 ? "v2" : "v1";
  const shadowProfile: ScoringProfile = useV2 ? "v1" : "v2";

  // Run both rankings in parallel. The authoritative one is what we
  // return; the shadow one is for the log row.
  const [authoritative, shadow] = await Promise.all([
    rankManufacturersForOrder(orderId, authoritativeProfile),
    rankManufacturersForOrder(orderId, shadowProfile),
  ]);

  // Best-effort logging — outside any transaction the caller may be in.
  void logEvaluation({
    orderId,
    authoritativeProfile,
    authoritative,
    shadow,
    shadowProfile,
  }).catch((err) => {
    console.warn("[Q7 shadow] evaluation log failed:", err);
  });

  return authoritative;
}

async function logEvaluation(args: {
  orderId: string;
  authoritativeProfile: ScoringProfile;
  authoritative: CandidateScore[];
  shadow: CandidateScore[];
  shadowProfile: ScoringProfile;
}) {
  const v1List = args.authoritativeProfile === "v1" ? args.authoritative : args.shadow;
  const v2List = args.authoritativeProfile === "v2" ? args.authoritative : args.shadow;
  const v1Winner = v1List.find((c) => c.eligible);
  const v2Winner = v2List.find((c) => c.eligible);

  // Persist top-3 score snapshots only — anything below rank 3 is
  // useless noise once we're looking at decision quality.
  const summarize = (list: CandidateScore[]) =>
    list
      .filter((c) => c.eligible)
      .slice(0, 3)
      .map((c) => ({
        manufacturerId: c.manufacturerId,
        companyName: c.companyName,
        totalScore: c.totalScore,
        scores: c.scores,
      }));

  await db
    .insert(manufacturerAssignmentEvaluations)
    .values({
      orderId: args.orderId,
      v1WinnerId: v1Winner?.manufacturerId ?? null,
      v2WinnerId: v2Winner?.manufacturerId ?? null,
      v1Scores: summarize(v1List),
      v2Scores: summarize(v2List),
      // Use the v2 weights_version so a future bump (`v2.1`) creates a
      // distinct row per order — v1 changes shouldn't ever happen so
      // we just key off v2.
      weightsVersion: weightsVersion("v2"),
      authoritative: args.authoritativeProfile,
    })
    .onConflictDoNothing({
      target: [
        manufacturerAssignmentEvaluations.orderId,
        manufacturerAssignmentEvaluations.weightsVersion,
      ],
    });
}
