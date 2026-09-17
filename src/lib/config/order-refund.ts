/** Recorded refund evidence. Pure/client/worker safe; amounts are integer kuruş. */
export const MAX_REFUND_KURUS = 2_147_483_647;
export type RefundAllocationInput = { orderId: string; cashKurus: number; giftKurus: number };
export type RefundActor = { adminEmail: string };
export type RefundKind = "refund" | "cancellation" | "legacy_evidence";
export type RefundNotificationState = "pending" | "delivered" | "not_required";
export interface RecordRefundInput {
  operationKey: string;
  expectedFingerprint: string;
  mode: "actual" | "legacy_evidence";
  allocations: RefundAllocationInput[];
  cashEvidence?: {
    method: "card" | "bank_transfer";
    externalReference: string;
    occurredAt: string;
    paytrRefundCompleted?: true;
    bankTransferCompleted?: true;
  };
  reason: string;
}
export interface RefundOriginalReversal {
  kind: "manufacturer" | "painter";
  earningId?: string;
  outcome: "reversed" | "paid_retained" | "already_reversed" | "absent";
}
export interface RefundResult {
  ok: true; refundId: string; replayed: boolean;
  cashKurus: number; giftKurus: number;
  orders: Array<{ orderId: string; remainingCashKurus: number | null;
    remainingGiftKurus: number | null; fullyReturned: boolean;
    originalReversal: RefundOriginalReversal[] }>;
  notificationState: RefundNotificationState; warning?: string;
}
export type RefundFailureCode = "invalid_evidence" | "not_found" | "stale" | "over_refund"
  | "reference_used" | "operation_conflict" | "lineage_unknown" | "legacy_unverified"
  | "gift_history_unknown" | "busy" | "unavailable";
export interface RefundFailure {
  ok: false; status: 400 | 404 | 409 | 503; error: string; code: RefundFailureCode;
}
/** Only a confirmed refusal can release a pending browser intent. Auth, busy,
 * unknown responses and key conflicts cannot disprove an earlier commit. */
export function refundResponseAllowsNewIntent(status: number, code: unknown): boolean {
  return (status === 400 && code === "invalid_evidence")
    || (status === 404 && code === "not_found")
    || (status === 409 && ["stale", "over_refund", "reference_used", "lineage_unknown",
      "legacy_unverified", "gift_history_unknown"].includes(typeof code === "string" ? code : ""));
}
export class RefundPolicyError extends Error {
  constructor(public readonly code: RefundFailureCode, message: string,
    public readonly status: RefundFailure["status"] = 400) {
    super(message); this.name = "RefundPolicyError";
  }
}
export interface OrderRefundSibling {
  orderId: string; orderNumber: string; cashBasisKurus: number | null; giftBasisKurus: number | null;
  confirmedCashKurus: number; confirmedGiftKurus: number;
  remainingCashKurus: number | null; remainingGiftKurus: number | null;
  legacyUnverified: boolean; cancelled: boolean;
}
export interface OrderRefundView {
  payment: { scopeKey: string; method: string; collectionReference: string | null;
    evidenceLevel: "recorded"; invoiceBasisKurus: number | null; cashBasisKurus: number | null; giftBasisKurus: number | null };
  siblings: OrderRefundSibling[];
  history: Array<{ refundId: string; kind: RefundKind; occurredAt: string; recordedAt: string;
    adminEmail: string; reason: string; externalReference: string | null;
    cashKurus: number; giftKurus: number; allocations: RefundAllocationInput[];
    notificationState: RefundNotificationState }>;
  expectedFingerprint: string; canRecord: boolean; blockedReason?: string;
}
export interface CancelPaidOrderInput {
  orderId: string; operationKey: string; expectedFingerprint: string;
  source: "admin_reject" | "workshop_session" | "workshop_participant";
  reason: string;
  notes?: string;
  /** Trusted service adapter supplies the participant; backend revalidates its order/session. */
  workshop?: { sessionId: string; participantId: string; releaseSeat: boolean };
}
export interface CancelPaidOrderResult {
  ok: true; cancellationId: string; replayed: boolean; cancelled: true;
  giftReturnedKurus: number; cashRefundRequiredKurus: number | null;
  giftReturnBlockedReason?: string; legacyUnverified: boolean;
  notificationState: RefundNotificationState;
  seatReleased?: boolean;
}

export function refundKurus(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_REFUND_KURUS) {
    throw new RefundPolicyError("invalid_evidence", "İade tutarı geçerli bir tam kuruş tutarı olmalıdır.");
  }
  return value;
}
export function sumRefundKurus(values: readonly number[]): number {
  const sum = values.reduce((total, value) => total + BigInt(refundKurus(value)), BigInt(0));
  if (sum > BigInt(MAX_REFUND_KURUS)) throw new RefundPolicyError("invalid_evidence", "Toplam iade tutarı kayıt sınırını aşıyor.");
  return Number(sum);
}
export function refundTenderBasis(input: { amountKurus: number; havaleDiscountKurus: number; giftCardAmountKurus: number }) {
  const amount = refundKurus(input.amountKurus), discount = refundKurus(input.havaleDiscountKurus), gift = refundKurus(input.giftCardAmountKurus);
  if (discount + gift > amount) throw new RefundPolicyError("lineage_unknown", "Kayıtlı ödeme dağılımı tutarsız. İade öncesi ödeme kayıtlarını uzlaştırın.", 409);
  return { invoiceKurus: amount - discount, cashKurus: amount - discount - gift, giftKurus: gift };
}
export function refundRemainder(basis: { cashKurus: number; giftKurus: number }, returned: { cashKurus: number; giftKurus: number }) {
  const cashKurus = refundKurus(basis.cashKurus) - refundKurus(returned.cashKurus);
  const giftKurus = refundKurus(basis.giftKurus) - refundKurus(returned.giftKurus);
  if (cashKurus < 0 || giftKurus < 0) throw new RefundPolicyError("over_refund", "İade tutarı kayıtlı kalan tutarı aşıyor.", 409);
  return { cashKurus, giftKurus, fullyReturned: cashKurus === 0 && giftKurus === 0 };
}
/** A legacy full marker already consumes the whole entitlement, not marker + rows. */
export function giftReturnRemaining(originalKurus: number, restoredKurus: number, fullyReturned: boolean): number {
  const original = refundKurus(originalKurus), restored = refundKurus(restoredKurus);
  if (restored > original) throw new RefundPolicyError("gift_history_unknown", "Hediye kartı dönüş kayıtları tutarsız. Bakiye uzlaştırılması gerekiyor.", 409);
  return fullyReturned ? 0 : original - restored;
}
/** Delta of cumulative gross-equivalent, so the final return consumes rounding. */
export function refundAnalyticsGross(input: { originalGrossKurus: number; tenderKurus: number; previousReturnedKurus: number; returnedKurus: number }): number {
  const gross = refundKurus(input.originalGrossKurus), tender = refundKurus(input.tenderKurus);
  const before = refundKurus(input.previousReturnedKurus), delta = refundKurus(input.returnedKurus);
  if (before + delta > tender) throw new RefundPolicyError("over_refund", "İade toplamı ödeme tutarını aşıyor.", 409);
  if (tender === 0) return 0;
  return Number(BigInt(gross) * BigInt(before + delta) / BigInt(tender) - BigInt(gross) * BigInt(before) / BigInt(tender));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid(message = "İade bilgileri eksik veya geçersiz. Tutarı ve gerçekleşen işlem kanıtını kontrol edin."): never {
  throw new RefundPolicyError("invalid_evidence", message);
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value.toLowerCase();
}
function actualDate(value: unknown, now: Date): string {
  if (typeof value !== "string") invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalid("İadenin gerçekleştiği tarih ve saat, saat dilimiyle birlikte belirtilmelidir.");
  const [, y, m, d, h, min, sec] = match.map(Number);
  const date = new Date(value);
  const calendar = new Date(Date.UTC(y, m - 1, d));
  if (y < 2000 || calendar.getUTCFullYear() !== y || calendar.getUTCMonth() !== m - 1 || calendar.getUTCDate() !== d
    || h > 23 || min > 59 || sec > 59 || !Number.isFinite(date.getTime()) || date > now) {
    invalid("İade tarihi geçersiz veya gelecekte. Gerçekleşen işlemin tarihini girin.");
  }
  return date.toISOString();
}
export function normalizeRecordRefundInput(value: unknown, now = new Date()): RecordRefundInput {
  const input = object(value, ["operationKey", "expectedFingerprint", "mode", "allocations", "cashEvidence", "reason"]);
  const operationKey = uuid(input.operationKey);
  if (typeof input.expectedFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.expectedFingerprint)) invalid("İade ekranı güncel değil. Kaydı yeniden açın.");
  if (input.mode !== "actual" && input.mode !== "legacy_evidence") invalid();
  if (typeof input.reason !== "string" || input.reason.trim().length < 10 || input.reason.trim().length > 1000) invalid("İade gerekçesi 10–1000 karakter olmalıdır.");
  if (!Array.isArray(input.allocations) || input.allocations.length < 1 || input.allocations.length > 100) invalid();
  const seen = new Set<string>();
  const allocations = input.allocations.map(value => {
    const row = object(value, ["orderId", "cashKurus", "giftKurus"]);
    const orderId = uuid(row.orderId), cashKurus = refundKurus(row.cashKurus), giftKurus = refundKurus(row.giftKurus);
    if (seen.has(orderId) || sumRefundKurus([cashKurus, giftKurus]) === 0) invalid();
    seen.add(orderId);
    return { orderId, cashKurus, giftKurus };
  }).sort((a, b) => a.orderId.localeCompare(b.orderId));
  const cashTotal = sumRefundKurus(allocations.map(a => a.cashKurus));
  sumRefundKurus(allocations.flatMap(a => [a.cashKurus, a.giftKurus]));
  let cashEvidence: RecordRefundInput["cashEvidence"];
  if (cashTotal > 0) {
    const e = object(input.cashEvidence, ["method", "externalReference", "occurredAt", "paytrRefundCompleted", "bankTransferCompleted"]);
    if (e.method !== "card" && e.method !== "bank_transfer") invalid();
    if (typeof e.externalReference !== "string" || !e.externalReference.trim() || e.externalReference.trim().length > 200
      || /[\u0000-\u001f\u007f]/.test(e.externalReference)) invalid("Gerçekleşen iadenin işlem referansı zorunludur.");
    if (e.method === "card" ? e.paytrRefundCompleted !== true || e.bankTransferCompleted !== undefined
      : e.bankTransferCompleted !== true || e.paytrRefundCompleted !== undefined) invalid("İadenin ilgili ödeme kanalında tamamlandığını açıkça doğrulayın.");
    cashEvidence = { method: e.method, externalReference: e.externalReference.trim(), occurredAt: actualDate(e.occurredAt, now),
      ...(e.method === "card" ? { paytrRefundCompleted: true as const } : { bankTransferCompleted: true as const }) };
  } else if (input.cashEvidence !== undefined) invalid("Yalnız hediye kartı dönüşünde nakit işlem kanıtı girilmez.");
  return { operationKey, expectedFingerprint: input.expectedFingerprint, mode: input.mode,
    allocations, reason: input.reason.trim(), ...(cashEvidence ? { cashEvidence } : {}) };
}

/** Call against the locked recorded payment, not a method supplied by the client. */
export function validateRefundCashEvidence(input: RecordRefundInput, payment: { method: string; collectedAt: Date; now?: Date }): void {
  if (!input.cashEvidence) {
    if (input.allocations.some(a => a.cashKurus > 0)) invalid();
    return;
  }
  if (input.cashEvidence.method !== payment.method) invalid("İade kanalı, siparişin kayıtlı ödeme kanalıyla eşleşmiyor.");
  const occurred = new Date(actualDate(input.cashEvidence.occurredAt, payment.now ?? new Date()));
  if (!Number.isFinite(payment.collectedAt.getTime()) || occurred < payment.collectedAt) invalid("İade tarihi kayıtlı tahsilat tarihinden önce olamaz.");
}
