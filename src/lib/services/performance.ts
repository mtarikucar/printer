// Manufacturer performance metrics + strike policy. Pure + unit-tested
// (scripts/test-performance.ts). Metrics are derived from the manufacturer_actions
// log; the strike threshold drives Faz 3 auto-suspension.

export interface ActionLite {
  action: string;
}

export interface PerfMetrics {
  accepted: number;
  declined: number;
  cancelled: number;
  shipped: number;
  submittedQc: number;
  total: number;
  /** accepted / (accepted + declined); 1 when there were no offers (no penalty). */
  acceptanceRate: number;
}

export function computeMetrics(actions: ActionLite[]): PerfMetrics {
  const count = (a: string) => actions.filter((x) => x.action === a).length;
  const accepted = count("accept");
  const declined = count("decline");
  const cancelled = count("cancel_after_accept");
  const shipped = count("ship");
  const submittedQc = count("submit_qc");
  const offered = accepted + declined;
  const acceptanceRate = offered === 0 ? 1 : accepted / offered;
  return {
    accepted,
    declined,
    cancelled,
    shipped,
    submittedQc,
    total: actions.length,
    acceptanceRate,
  };
}

// Reliability strikes (late ship, cancel-after-accept, QC fail) auto-suspend a
// manufacturer once they reach the threshold.
export const STRIKE_SUSPEND_THRESHOLD = 3;

export function shouldAutoSuspend(
  strikeCount: number,
  threshold: number = STRIKE_SUSPEND_THRESHOLD
): boolean {
  return strikeCount >= threshold;
}
