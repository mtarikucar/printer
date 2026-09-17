/** Dispute commands and receipts. Pure: safe for client, service and worker use. */
import {
  normalizeRecordRefundInput,
  RefundPolicyError,
  type OrderRefundView,
  type RecordRefundInput,
  type RefundFailure,
  type RefundFailureCode,
  type RefundNotificationState,
  type RefundResult,
} from "./order-refund";

export const DISPUTE_CATEGORY_LABELS_TR = {
  not_as_described: "Fotoğrafıma benzemedi",
  damaged: "Hasarlı geldi",
  not_received: "Hiç ulaşmadı",
  other: "Diğer",
} as const;
export const DISPUTE_STATUS_LABELS_TR = {
  open: "Açık",
  resolved: "Çözüldü",
  rejected: "İncelendi — işlem yok",
} as const;
export type DisputeCategory = keyof typeof DISPUTE_CATEGORY_LABELS_TR;
export type DisputeStatus = keyof typeof DISPUTE_STATUS_LABELS_TR;

export type ResolveDisputeInput = {
  disputeId: string;
  operationKey: string;
  expectedDecisionFingerprint: string;
  action: "resolve" | "reject";
  resolution: string;
  refund?: Omit<RecordRefundInput, "operationKey" | "mode">;
};
export type DisputeDecisionResult = {
  ok: true; disputeId: string; orderId: string; operationKey: string;
  status: "resolved" | "rejected"; resolution: string; resolvedAt: string;
  replayed: boolean; refund: RefundResult | null;
  decisionNotificationState: RefundNotificationState;
};
export type DisputeFailureCode = RefundFailureCode | "already_closed" | "already_open";
export type DisputeDecisionFailure = Omit<RefundFailure, "code"> & { code: DisputeFailureCode };
export type DisputeDecisionView = {
  dispute: {
    id: string; orderId: string; orderNumber: string | null;
    /** Historical categories remain readable even if no longer offered. */
    category: string; description: string; status: DisputeStatus;
    resolution: string | null; resolvedAt: string | null;
    decisionOperationKey: string | null; refundRecordId: string | null;
  };
  expectedDecisionFingerprint: string;
  refundView: OrderRefundView | null;
  refundReadUnavailable?: string;
};
export type OpenDisputeInput = { category: DisputeCategory; description: string };
export type OpenDisputeResult = { ok: true; disputeId: string; replayed: boolean };

export class DisputePolicyError extends Error {
  constructor(public readonly code: DisputeFailureCode, message: string,
    public readonly status: DisputeDecisionFailure["status"] = 400) {
    super(message); this.name = "DisputePolicyError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(message = "Anlaşmazlık bilgileri eksik veya geçersiz."): never {
  throw new DisputePolicyError("invalid_evidence", message);
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  if (Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || value.length !== 36 || !UUID.test(value)) invalid();
  return value.toLowerCase();
}

/** Service checks one allocation matching the locked dispute order. Hashes must
 * exclude both preview fingerprints; normalization deliberately retains them. */
export function normalizeResolveDisputeInput(value: unknown, now = new Date()): ResolveDisputeInput {
  const input = object(value, ["disputeId", "operationKey", "expectedDecisionFingerprint", "action", "resolution", "refund"]);
  const disputeId = uuid(input.disputeId), operationKey = uuid(input.operationKey);
  if (typeof input.expectedDecisionFingerprint !== "string" || input.expectedDecisionFingerprint.length !== 64
    || !/^[0-9a-f]{64}$/.test(input.expectedDecisionFingerprint)) {
    invalid("Anlaşmazlık ekranı güncel değil. Kaydı yeniden açın.");
  }
  if (input.action !== "resolve" && input.action !== "reject") invalid();
  if (typeof input.resolution !== "string" || input.resolution.trim().length < 10 || input.resolution.trim().length > 2000) {
    invalid("Karar gerekçesi 10–2000 karakter olmalıdır.");
  }
  let refund: ResolveDisputeInput["refund"];
  if (input.refund !== undefined) {
    if (input.action === "reject") invalid("Reddedilen anlaşmazlık kararına iade eklenemez.");
    const nested = object(input.refund, ["expectedFingerprint", "allocations", "cashEvidence", "reason"]);
    try {
      const normalized = normalizeRecordRefundInput({ ...nested, operationKey, mode: "actual" }, now);
      refund = { expectedFingerprint: normalized.expectedFingerprint, allocations: normalized.allocations,
        reason: normalized.reason, ...(normalized.cashEvidence ? { cashEvidence: normalized.cashEvidence } : {}) };
    } catch (error) {
      if (error instanceof RefundPolicyError) throw new DisputePolicyError(error.code, error.message, error.status);
      throw error;
    }
  }
  return { disputeId, operationKey, expectedDecisionFingerprint: input.expectedDecisionFingerprint,
    action: input.action, resolution: input.resolution.trim(), ...(refund ? { refund } : {}) };
}

export function normalizeOpenDisputeInput(value: unknown): OpenDisputeInput {
  const input = object(value, ["category", "description"]);
  if (typeof input.category !== "string" || !Object.hasOwn(DISPUTE_CATEGORY_LABELS_TR, input.category)) {
    invalid("Geçerli bir anlaşmazlık kategorisi seçin.");
  }
  if (typeof input.description !== "string" || input.description.trim().length < 5 || input.description.trim().length > 2000) {
    invalid("Anlaşmazlık açıklaması 5–2000 karakter olmalıdır.");
  }
  return { category: input.category as DisputeCategory, description: input.description.trim() };
}
