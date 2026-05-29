// Pure QC (quality-control) state machine for the manufacturer print → ship
// flow. Dependency-free so it is the single source of truth for QC transitions,
// reused by every QC route and unit-tested in isolation (scripts/test-qc.ts).

export type ManufacturerOrderStatus =
  | "unassigned"
  | "assigned"
  | "accepted"
  | "printing"
  | "printed"
  | "qc_pending"
  | "qc_rejected"
  | "qc_approved"
  | "shipped";

export type QcAction = "submit" | "approve" | "reject";

/** Max finished-product photos a manufacturer may upload per QC round. */
export const MAX_QC_PHOTOS_PER_ROUND = 6;

/**
 * Next manufacturerStatus for a QC action, or null if the action is not allowed
 * from `current` (null = reject the request, which also makes double-clicks a
 * no-op since the second call no longer matches the guard state).
 *
 *   submit:  printed | qc_rejected → qc_pending   (manufacturer sends photos)
 *   approve: qc_pending            → qc_approved  (admin unlocks shipping)
 *   reject:  qc_pending            → qc_rejected  (admin sends back for reprint)
 */
export function qcNextStatus(
  current: ManufacturerOrderStatus,
  action: QcAction
): ManufacturerOrderStatus | null {
  switch (action) {
    case "submit":
      return current === "printed" || current === "qc_rejected"
        ? "qc_pending"
        : null;
    case "approve":
      return current === "qc_pending" ? "qc_approved" : null;
    case "reject":
      return current === "qc_pending" ? "qc_rejected" : null;
    default:
      return null;
  }
}

/** Manufacturer may add/remove QC photos only before submitting for review. */
export function canUploadQcPhotos(current: ManufacturerOrderStatus): boolean {
  return current === "printed" || current === "qc_rejected";
}

/** Shipping is gated behind admin QC approval. */
export function canShipAfterQc(current: ManufacturerOrderStatus): boolean {
  return current === "qc_approved";
}

/** True when adding `adding` photos to `existing` would exceed the per-round cap. */
export function qcPhotosWouldExceed(existing: number, adding: number): boolean {
  return existing + adding > MAX_QC_PHOTOS_PER_ROUND;
}
