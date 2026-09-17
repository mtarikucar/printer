/** Cancellation closes fulfillment; only recorded actual returns reduce money due. */
import { randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts, orders, workshopParticipants, workshopSessions } from "@/lib/db/schema";
import {
  participantCancelDisposition,
  seatReturnsToPool,
  sessionCancellable,
  WORKSHOP_SESSION_UNCANCELLABLE_STATUSES,
} from "@/lib/config/workshop";
import { cancelPaidOrder, readOrderRefundView } from "@/lib/services/order-refund-record";
import { cancelParticipantSeat } from "@/lib/services/workshop-seat";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { expireDraft } from "@/lib/services/order-draft";
import { sendWorkshopSessionCancelledEmail } from "@/lib/services/workshop-notify";

export interface WorkshopRefundObligation {
  orderId: string;
  orderNumber: string;
  fullName: string;
  cashRemainingKurus: number | null;
  giftRemainingKurus: number | null;
  legacyUnverified: boolean;
}
export interface WorkshopSessionCancelReport {
  cancelled: string[];
  refundRequiredOrders: WorkshopRefundObligation[];
  actualGiftReturnedKurus: number;
  alreadyCancelled: string[];
  alreadyShipped: string[];
  failed: string[];
  warning?: string;
}
export type CancelWorkshopSessionResult =
  | { ok: true; report: WorkshopSessionCancelReport }
  | { ok: false; reason: "not_found" | "not_cancellable" };
export type CancelWorkshopParticipantResult =
  | { ok: true; cancelled: true; alreadyCancelled: boolean; seatReleased: boolean;
      refundRequiredOrders: WorkshopRefundObligation[]; actualGiftReturnedKurus: number; warning?: string }
  | { ok: false; reason: "not_found" | "already_shipped" | "cancellation_failed" | "expire_failed" | "busy" };

type Participant = typeof workshopParticipants.$inferSelect;

async function paidCancellation(
  row: Participant,
  source: "workshop_session" | "workshop_participant",
  adminEmail: string,
): Promise<CancelWorkshopParticipantResult> {
  const orderId = row.orderId!;
  try {
    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!order) return { ok: false, reason: "cancellation_failed" };
    if (order.shippedAt || order.deliveredAt
      || participantCancelDisposition({ orderId, orderStatus: order.status }) === "already_shipped") {
      return { ok: false, reason: "already_shipped" };
    }
    const view = await readOrderRefundView(orderId);
    // No workshop locks precede the coordinator. It checks shipped status under
    // its order lock and invokes cancelParticipantSeatTx inside the same tx.
    const result = await cancelPaidOrder({
      orderId, operationKey: randomUUID(), expectedFingerprint: view.expectedFingerprint,
      source, reason: source === "workshop_session" ? "Atölye seansı iptal edildi" : "Atölye katılımı iptal edildi",
      workshop: { sessionId: row.sessionId, participantId: row.id,
        releaseSeat: source === "workshop_participant" },
    }, { adminEmail });
    if (!result.ok) {
      if (result.code === "busy") return { ok: false, reason: "busy" };
      const latest = await db.query.orders.findFirst({ where: eq(orders.id, orderId),
        columns: { status: true, shippedAt: true, deliveredAt: true } });
      return { ok: false, reason: latest?.shippedAt || latest?.deliveredAt
        || participantCancelDisposition({ orderId, orderStatus: latest?.status ?? null }) === "already_shipped"
        ? "already_shipped" : "cancellation_failed" };
    }
    const committed = {
      ok: true as const, cancelled: true as const, alreadyCancelled: result.replayed,
      seatReleased: result.seatReleased ?? false,
      actualGiftReturnedKurus: result.replayed ? 0 : result.giftReturnedKurus,
    };
    try {
      const current = await readOrderRefundView(orderId);
      const remaining = current.siblings.find(sibling => sibling.orderId === orderId);
      if (!remaining) throw new Error("Cancelled order missing from refund view");
      const hasObligation = remaining.legacyUnverified || remaining.remainingCashKurus === null
        || remaining.remainingGiftKurus === null || remaining.remainingCashKurus > 0 || remaining.remainingGiftKurus > 0;
      return { ...committed,
        refundRequiredOrders: hasObligation ? [{ orderId, orderNumber: remaining.orderNumber,
          fullName: row.fullName, cashRemainingKurus: remaining.remainingCashKurus,
          giftRemainingKurus: remaining.remainingGiftKurus, legacyUnverified: remaining.legacyUnverified }] : [],
      };
    } catch (error) {
      console.error("workshop cancellation committed; obligations unavailable", error);
      return { ...committed, refundRequiredOrders: [{ orderId, orderNumber: order.orderNumber,
        fullName: row.fullName, cashRemainingKurus: null, giftRemainingKurus: null,
        legacyUnverified: result.legacyUnverified }],
        warning: "Katılım iptal edildi. Güncel iade yükümlülükleri okunamadı; kaydı yenileyin.",
      };
    }
  } catch (error) {
    console.error("workshop paid cancellation failed", error);
    return { ok: false, reason: "cancellation_failed" };
  }
}

/** Existing unpaid draft/seat flow, with a post-expiry promotion check. */
async function cancelRow(
  row: Participant,
  source: "workshop_session" | "workshop_participant",
  adminEmail: string,
): Promise<CancelWorkshopParticipantResult> {
  if (row.orderId) return paidCancellation(row, source, adminEmail);
  try {
    if (row.draftId) {
      await expireDraft(row.draftId, {
        failureReason: "Atölye katılımı iptal edildi", cancelReason: "Katılım iptal edildi",
        notifySeatReleased: false,
      });
      // expireDraft is a no-op for confirmed drafts. A promotion that won the
      // race must enter the paid coordinator, never the standalone seat helper.
      const latest = await db.query.workshopParticipants.findFirst({ where: eq(workshopParticipants.id, row.id) });
      if (!latest) return { ok: false, reason: "not_found" };
      if (latest.orderId) return paidCancellation(latest, source, adminEmail);
      const draft = await db.query.orderDrafts.findFirst({ where: eq(orderDrafts.id, row.draftId), columns: { status: true } });
      if (!draft || !["expired", "failed"].includes(draft.status) || latest.status !== "cancelled") {
        return { ok: false, reason: "expire_failed" };
      }
      return { ok: true, cancelled: true, alreadyCancelled: row.status === "cancelled",
        seatReleased: row.status === "pending_payment", refundRequiredOrders: [], actualGiftReturnedKurus: 0 };
    }
    const session = await db.query.workshopSessions.findFirst({ where: eq(workshopSessions.id, row.sessionId), columns: { status: true } });
    const releaseSeat = source === "workshop_participant" && !!session && seatReturnsToPool(session.status);
    const changed = await cancelParticipantSeat(row.id, "Katılım iptal edildi", { releaseSeat });
    return { ok: true, cancelled: true, alreadyCancelled: !changed, seatReleased: changed && releaseSeat,
      refundRequiredOrders: [], actualGiftReturnedKurus: 0 };
  } catch (error) {
    console.error("workshop unpaid cancellation failed", error);
    return { ok: false, reason: "expire_failed" };
  }
}

export async function cancelWorkshopSession(input: {
  sessionId: string; adminEmail: string;
}): Promise<CancelWorkshopSessionResult> {
  const session = await db.query.workshopSessions.findFirst({ where: eq(workshopSessions.id, input.sessionId) });
  if (!session) return { ok: false, reason: "not_found" };
  if (!sessionCancellable(session.status)) return { ok: false, reason: "not_cancellable" };
  // Close admission before reading participants. Commit before entering any
  // money coordinator; never hold a workshop lock while acquiring partner gates.
  const [closed] = await db.update(workshopSessions).set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(workshopSessions.id, input.sessionId),
      notInArray(workshopSessions.status, [...WORKSHOP_SESSION_UNCANCELLABLE_STATUSES])))
    .returning({ id: workshopSessions.id });
  if (!closed) return { ok: false, reason: "not_cancellable" };
  const rows = await db.query.workshopParticipants.findMany({ where: eq(workshopParticipants.sessionId, input.sessionId) });
  const report: WorkshopSessionCancelReport = { cancelled: [], alreadyCancelled: [], alreadyShipped: [], failed: [],
    refundRequiredOrders: [], actualGiftReturnedKurus: 0 };
  for (const row of rows) {
    const result = await cancelRow(row, "workshop_session", input.adminEmail);
    if (!result.ok) {
      (result.reason === "already_shipped" ? report.alreadyShipped : report.failed).push(row.fullName);
      continue;
    }
    (result.alreadyCancelled ? report.alreadyCancelled : report.cancelled).push(row.fullName);
    report.refundRequiredOrders.push(...result.refundRequiredOrders);
    report.actualGiftReturnedKurus += result.actualGiftReturnedKurus;
    if (result.warning) report.warning = result.warning;
    // Paid notices (including combined gift restoration) belong to the backend's
    // transactional intent. Never send a second "refund" email from this caller.
    const latest = await db.query.workshopParticipants.findFirst({ where: eq(workshopParticipants.id, row.id), columns: { orderId: true } })
      .catch(error => { console.error("workshop cancellation notice context unavailable", error); return undefined; });
    if (latest && !latest.orderId && !result.alreadyCancelled) {
      await sendWorkshopSessionCancelledEmail({ sessionId: input.sessionId, fullName: row.fullName,
        email: row.email, paymentState: row.draftId ? "unverified" : "no_recorded_collection" })
        .catch(error => console.error("workshop cancellation email failed", error));
    }
  }
  if (session.manufacturerId && session.status !== "cancelled") {
    await notifyManufacturer({ manufacturerId: session.manufacturerId, type: "workshop_session",
      subject: "Atölye seansı iptal edildi",
      body: `Seans iptal edildi. ${report.cancelled.length + report.alreadyCancelled.length} katılım kapatıldı. `
        + `Sevk edilmiş ${report.alreadyShipped.length}, iptali tamamlanamayan ${report.failed.length} katılım ayrıca takip edilecek. `
        + "Müşterilere kalan iade yükümlülükleri ayrıca takip ediliyor.",
    }).catch(error => console.error("workshop manufacturer cancellation notice failed", error));
  }
  return { ok: true, report };
}

export async function cancelWorkshopParticipant(input: {
  sessionId: string; participantId: string; adminEmail: string;
}): Promise<CancelWorkshopParticipantResult> {
  const row = await db.query.workshopParticipants.findFirst({ where: and(
    eq(workshopParticipants.id, input.participantId), eq(workshopParticipants.sessionId, input.sessionId)) });
  if (!row) return { ok: false, reason: "not_found" };
  return cancelRow(row, "workshop_participant", input.adminEmail);
}
