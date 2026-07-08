// Pure QC state machine for the PAINTER paint → QC → ship flow. Mirrors qc.ts
// (manufacturer) and is the single source of truth for painter QC transitions.

export type PainterOrderStatus =
  | "unassigned"
  | "assigned"
  | "accepted"
  | "painting"
  | "painted"
  | "qc_pending"
  | "qc_rejected"
  | "qc_approved"
  | "shipped";

export type PainterQcAction = "submit" | "approve" | "reject";

/** Max finished paint-job photos a painter may upload per QC round. */
export const MAX_PAINTER_QC_PHOTOS_PER_ROUND = 6;

// States from which the painter may still work on / submit the job for QC. The
// painter accepts, paints (optionally marking 'painting'/'painted'), then
// submits photos; a rejected round returns here for rework.
const SUBMITTABLE: PainterOrderStatus[] = [
  "accepted",
  "painting",
  "painted",
  "qc_rejected",
];

/**
 *   submit:  accepted|painting|painted|qc_rejected → qc_pending  (painter sends photos)
 *   approve: qc_pending                            → qc_approved (admin unlocks shipping)
 *   reject:  qc_pending                            → qc_rejected (admin sends back for rework)
 * Returns null if the action is not allowed from `current` (also makes
 * double-clicks a no-op since the second call no longer matches the guard).
 */
export function painterQcNextStatus(
  current: PainterOrderStatus,
  action: PainterQcAction
): PainterOrderStatus | null {
  switch (action) {
    case "submit":
      return SUBMITTABLE.includes(current) ? "qc_pending" : null;
    case "approve":
      return current === "qc_pending" ? "qc_approved" : null;
    case "reject":
      return current === "qc_pending" ? "qc_rejected" : null;
    default:
      return null;
  }
}

/** Painter may add QC photos only before submitting for review (or after a reject). */
export function canUploadPainterQcPhotos(current: PainterOrderStatus): boolean {
  return SUBMITTABLE.includes(current);
}

/** Shipping is gated behind admin painter-QC approval. */
export function canShipAfterPainterQc(current: PainterOrderStatus): boolean {
  return current === "qc_approved";
}

/** True when adding `adding` photos to `existing` would exceed the per-round cap. */
export function painterQcPhotosWouldExceed(existing: number, adding: number): boolean {
  return existing + adding > MAX_PAINTER_QC_PHOTOS_PER_ROUND;
}
