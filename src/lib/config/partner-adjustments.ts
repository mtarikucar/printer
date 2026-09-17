/** Net partner compensation only; no customer price or commission calculation. */
export type PartnerKind = "manufacturer" | "painter";
export type AdjustmentKind = "topup" | "reprint" | "unpaid_offset";
export type AdjustmentSourceKind = "manufacturer_earning" | "painter_earning" | "adjustment";
export type AdjustmentStatus = "pending" | "settled" | "voided";
export type SettlementKind = "transfer" | "netting";

export const MAX_ADJUSTMENT_KURUS = 2_147_483_647;

export function isValidAdjustmentNet(kind: AdjustmentKind, netKurus: number): boolean {
  if (!Number.isSafeInteger(netKurus) || Math.abs(netKurus) > MAX_ADJUSTMENT_KURUS) return false;
  if (kind === "unpaid_offset") return netKurus < 0;
  return (kind === "topup" || kind === "reprint") && netKurus > 0;
}

/**
 * Pass every nonvoided offset against THIS source, never another order's debt.
 * Negative capacity is intentional: Phase4 reconciliation can reduce an open
 * source after authorization. Callers must block that group, not clamp its debt.
 */
export function remainingOffsetCapacityKurus(
  sourceNetKurus: number,
  offsetNetKurus: readonly number[]
): number {
  if (!Number.isSafeInteger(sourceNetKurus) || sourceNetKurus < 0 || sourceNetKurus > MAX_ADJUSTMENT_KURUS) {
    throw new RangeError("Invalid adjustment source net kuruş");
  }
  let capacity = BigInt(sourceNetKurus);
  for (const net of offsetNetKurus) {
    if (!isValidAdjustmentNet("unpaid_offset", net)) throw new RangeError("Invalid offset net kuruş");
    capacity += BigInt(net);
  }
  if (capacity < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError("Offset sum exceeds safe integer bounds");
  return Number(capacity);
}

export interface AdjustmentGroupInput {
  sourceState: "open" | "batched" | "settled" | "reversed" | "missing";
  /** Source-specific eligibility: refunded originals fail; independent credits need not. */
  sourceEligible: boolean;
  sourceNetKurus: number;
  offsetNetKurus: readonly number[];
}

export type AdjustmentGroupAssessment =
  | { eligible: true; netKurus: number }
  | {
      eligible: false;
      reason: "batched" | "settled" | "reversed" | "missing" | "source_ineligible" | "offset_exceeds_source";
      netKurus: number | null;
    };

/** Claim eligibility only. DB callers must validate ownership and lock all members. */
export function assessAdjustmentGroup(input: AdjustmentGroupInput): AdjustmentGroupAssessment {
  if (input.sourceState !== "open") return { eligible: false, reason: input.sourceState, netKurus: null };
  if (!input.sourceEligible) return { eligible: false, reason: "source_ineligible", netKurus: null };
  const netKurus = remainingOffsetCapacityKurus(input.sourceNetKurus, input.offsetNetKurus);
  if (netKurus < 0) return { eligible: false, reason: "offset_exceeds_source", netKurus };
  return { eligible: true, netKurus };
}
