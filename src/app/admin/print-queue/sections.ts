// Which manufacturing-queue section an order sits in. Pure and import-free so
// the client component can use it and a tsx script can check it.
//
// Every order lands in exactly one section. The old queue filtered each table
// separately, over status approved|printing only. Orders in QC or with a
// painter never appeared, and "Kargoya Hazır" meant manufacturerStatus
// 'printed', which is BEFORE QC. A manufacturer can only ship at qc_approved
// (canShipAfterQc in src/lib/services/qc.ts and the guarded UPDATE in
// src/app/api/manufacturer/orders/[id]/ship/route.ts). That route also refuses
// every workshop-session order: the admin ships the whole batch to the venue
// (src/app/api/admin/workshops/sessions/[id]/ship/route.ts), so a QC-approved
// workshop order has its own section instead of "Kargoya Hazır".

export type QueueSectionKey =
  | "unassigned"
  | "awaitingAcceptance"
  | "inProduction"
  | "qualityCheck"
  | "toPainter"
  | "withPainter"
  | "readyToShip"
  | "workshopBatch"
  | "other";

export interface QueueSectionInput {
  status: string;
  manufacturerStatus: string | null;
  needsPainting: boolean;
  painterId: string | null;
  manufacturerPaintsInHouse: boolean;
  /** Set when the order belongs to a workshop session (a batch for one venue). */
  workshopSessionId: string | null;
}

export function queueSection(o: QueueSectionInput): QueueSectionKey {
  // With a painter: the manufacturer's part is done and the figurine is
  // physically at the painter, whatever manufacturerStatus still says (it
  // stays qc_approved through the whole painter leg).
  if (o.status === "painting") return "withPainter";

  switch (o.manufacturerStatus ?? "unassigned") {
    case "unassigned":
      // Admin self-print (legacy): printing with no manufacturer at all.
      if (o.status === "printing") return "inProduction";
      // approved custom/upload work, or a paid marketplace order.
      if (o.status === "approved" || o.status === "paid") return "unassigned";
      return "other";
    case "assigned":
      return "awaitingAcceptance";
    case "accepted":
    case "printing":
      return "inProduction";
    // The QC round: photos not sent yet, waiting for the admin, or sent back.
    case "printed":
    case "qc_pending":
    case "qc_rejected":
      return "qualityCheck";
    case "qc_approved":
      // Workshop batch: the manufacturer ship route refuses it, and the batch
      // ship takes every QC-approved order of the session, painting or not.
      // So it waits for the admin's batch shipment, never for the manufacturer.
      if (o.workshopSessionId) return "workshopBatch";
      // Otherwise the same gate as the manufacturer ship route: no painting,
      // or a shop that paints in house and has not handed the job to a painter.
      if (!o.needsPainting) return "readyToShip";
      if (!o.painterId) return o.manufacturerPaintsInHouse ? "readyToShip" : "toPainter";
      // A painter is set but the order is not at `painting`: not a state any
      // route writes, so surface it rather than guess.
      return "other";
    default:
      return "other";
  }
}
