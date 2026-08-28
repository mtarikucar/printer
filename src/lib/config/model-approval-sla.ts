/**
 * The three rules of the 3D approval SLA, as a pure function.
 *
 * They live here rather than inside the worker so they can be tested without a
 * database: the ordering ("a clean `pass` is auto-approved and nothing else
 * happens to it") and the never-clauses ("`warn`/`fail` are never auto-
 * approved", "a reminder goes out once") are the parts that must not drift.
 *
 * NOTE: no `import "server-only"` here — the BullMQ worker reaches this module.
 */

export type SweepAction = "auto_approve" | "remind" | "escalate";

export interface SlaThresholds {
  /** Hours after which a `pass` mesh is approved without the customer. */
  autoApproveAfterH: number;
  /** Hours after which the approval mail is re-sent, exactly once. */
  remindAfterH: number;
  /** Hours after which an admin-visible warning is written on the order. */
  escalateAfterH: number;
}

export const SLA_DEFAULTS: SlaThresholds = {
  autoApproveAfterH: 48,
  remindAfterH: 72,
  escalateAfterH: 24 * 7,
};

function envHours(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function slaThresholds(): SlaThresholds {
  return {
    autoApproveAfterH: envHours("AUTO_APPROVE_PASS_AFTER_H", SLA_DEFAULTS.autoApproveAfterH),
    remindAfterH: envHours("MODEL_APPROVAL_REMIND_AFTER_H", SLA_DEFAULTS.remindAfterH),
    escalateAfterH: envHours(
      "MODEL_APPROVAL_ESCALATE_AFTER_H",
      SLA_DEFAULTS.escalateAfterH
    ),
  };
}

export interface SweepInput {
  /** Newest print-gate verdict of the order; `null` when no mesh report exists. */
  verdict: string | null;
  /** Hours since the model was shown to the customer. */
  ageHours: number;
  /** Whether the order still carries its `/onay/<token>` capability. */
  hasToken: boolean;
  /** Whether a reminder was already sent for this approval row. */
  reminderSent: boolean;
  /** Whether the escalation note is already on the order. */
  alreadyEscalated: boolean;
}

/**
 * Which actions this order has earned, in the order they must be applied.
 *
 * An auto-approval is exclusive: the order leaves `awaiting_customer_approval`
 * in that same pass, so reminding or escalating it afterwards would be a
 * message about an order that is already in production.
 *
 * Anything other than an exact `pass` — `warn`, `fail`, or no verdict at all
 * (a missing mesh report is missing evidence, not a silent yes) — can only ever
 * be reminded and escalated. A human decides those.
 */
export function planApprovalSweep(
  input: SweepInput,
  t: SlaThresholds = SLA_DEFAULTS
): SweepAction[] {
  if (
    input.verdict === "pass" &&
    input.hasToken &&
    input.ageHours >= t.autoApproveAfterH
  ) {
    return ["auto_approve"];
  }

  const actions: SweepAction[] = [];
  // No token means no page to send the customer to; only the admin can help.
  if (input.hasToken && !input.reminderSent && input.ageHours >= t.remindAfterH) {
    actions.push("remind");
  }
  if (!input.alreadyEscalated && input.ageHours >= t.escalateAfterH) {
    actions.push("escalate");
  }
  return actions;
}
