import { groupPartnerPayables, type PayableMember, type PayableGroup, type BlockedPayableGroup, type PayableSource } from "./payout-claim";
export type { PayableMember, PayableGroup, BlockedPayableGroup } from "./payout-claim";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerEarnings, painterEarnings, payouts, painterPayouts, partnerAdjustments, orders, type PartnerAdjustment } from "@/lib/db/schema";
import { type PartnerKind } from "@/lib/config/partner-adjustments";
import type { MoneyTx } from "./money-partner-lock";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";
import { lockPartnerMoney } from "./money-partner-lock";
import { isPayoutLockBusy, PayoutClaimRaceError, payoutHoldsWhatItClaims, verifyClaimedPayableMembers } from "./payout-claim";
import { openEarningWhere } from "./earning-claimable";

export type { PartnerKind } from "@/lib/config/partner-adjustments";

export function partnerMoneyTables(kind: PartnerKind) {
  return kind === "manufacturer" ? {
    earning: manufacturerEarnings, earningOwner: manufacturerEarnings.manufacturerId,
    payout: payouts, payoutOwner: payouts.manufacturerId,
    adjustmentOwner: partnerAdjustments.manufacturerId, adjustmentPayout: partnerAdjustments.manufacturerPayoutId,
    sourceKind: "manufacturer_earning" as const,
  } : {
    earning: painterEarnings, earningOwner: painterEarnings.painterId,
    payout: painterPayouts, payoutOwner: painterPayouts.painterId,
    adjustmentOwner: partnerAdjustments.painterId, adjustmentPayout: partnerAdjustments.painterPayoutId,
    sourceKind: "painter_earning" as const,
  };
}



export interface PartnerPayables {
  kind: PartnerKind;
  partnerId: string;
  claimableNet: number;
  /** Number of indivisible source groups, including zero-net groups. */
  claimableCount: number;
  hasZeroNetGroups: boolean;
  pendingPayoutNet: number;
  paidTransferNet: number;
  settledNettingNet: number;
  settledNettingCount: number;
  groups: PayableGroup[];
  blockedGroups: BlockedPayableGroup[];
  fingerprint: string;
  adjustmentHistory: PartnerAdjustment[];
  /** Actual batch membership (also includes members of blocked groups). */
  heldMembers: PayableMember[];
  heldNet: number;
  heldEarningCount: number;
  heldAdjustmentCount: number;
  payouts: PartnerPayablePayout[];
}

export interface PartnerPayablePayout {
  id: string;
  totalKurus: number;
  earningCount: number;
  adjustmentCount: number;
  status: "pending" | "paid";
  settlementKind: "transfer" | "netting";
  reference: string | null;
  adminEmail: string;
  createdAt: Date;
  paidAt: Date | null;
  voidedAt: Date | null;
  fingerprint: string;
  heldNet: number;
  heldEarningCount: number;
  heldAdjustmentCount: number;
  blockedGroups: BlockedPayableGroup[];
}

/** Checked safe sums for balance views; PostgreSQL integer writes check INT32 separately. */
export function sumMoney(values: readonly number[]): number {
  let total = BigInt(0);
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new RangeError("Invalid integer kuruş");
    total += BigInt(value);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError("Money total exceeds safe bounds");
  return Number(total);
}

export function payableFingerprint(kind: PartnerKind, id: string, members: readonly PayableMember[]): string {
  // Status intentionally excluded: a successful settlement replay sees the same
  // identities and amounts after pending -> paid/settled. State is gated apart.
  const rows = members.map(m => [m.sourceKind, m.id, m.orderId, m.netKurus, m.payoutId, m.offsetSourceKind ?? null, m.sourceId ?? null]);
  rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify([kind, id, rows])).digest("hex");
}


/**
 * No implicit gate or row locks: mutation callers must acquire the partner gate
 * FIRST and lock relevant orders before calling. Read-only callers use the
 * repeatable-read convenience wrapper below for one coherent balance snapshot.
 */
export async function loadPartnerPayables(tx: MoneyTx, kind: PartnerKind, id: string, options: { payoutId?: string } = {}): Promise<PartnerPayables> {
  const t = partnerMoneyTables(kind);
  const earnings = await tx.select({
    id: t.earning.id, orderId: t.earning.orderId, netKurus: t.earning.netKurus,
    status: t.earning.status, payoutId: t.earning.payoutId,
    paymentStatus: orders.paymentStatus, orderStatus: orders.status, foundOrder: orders.id,
  }).from(t.earning).leftJoin(orders, eq(orders.id, t.earning.orderId)).where(eq(t.earningOwner, id));
  const adjustments = await tx.select().from(partnerAdjustments).where(eq(t.adjustmentOwner, id)).orderBy(partnerAdjustments.createdAt, partnerAdjustments.id);
  const batches = await tx.select({
    id: t.payout.id, earningCount: t.payout.earningCount, adjustmentCount: t.payout.adjustmentCount,
    reference: t.payout.reference, adminEmail: t.payout.adminEmail, createdAt: t.payout.createdAt, paidAt: t.payout.paidAt,
    totalKurus: t.payout.totalKurus, status: t.payout.status,
    voidedAt: t.payout.voidedAt, settlementKind: t.payout.settlementKind,
  }).from(t.payout).where(eq(t.payoutOwner, id));
  const memberOfAdjustment = (a: PartnerAdjustment): PayableMember => ({
    sourceKind: "adjustment", id: a.id, orderId: a.orderId, netKurus: a.netKurus,
    status: a.status, payoutId: kind === "manufacturer" ? a.manufacturerPayoutId : a.painterPayoutId,
    sourceId: a.sourceId, offsetSourceKind: a.sourceKind,
  });
  const sources: PayableSource[] = earnings.map(e => ({
    ...e, sourceKind: t.sourceKind,
    eligible: e.foundOrder !== null && e.paymentStatus !== REFUNDED_PAYMENT_STATUS && e.orderStatus !== "rejected",
    // Keep the existing refund reason; cancellation does not prove a cash return.
    ineligibleReason: e.paymentStatus !== REFUNDED_PAYMENT_STATUS && e.orderStatus === "rejected"
      ? "order_cancelled" as const : undefined,
  }));
  // Independent positive compensation survives a customer refund by design.
  sources.push(...adjustments.filter(a => a.kind !== "unpaid_offset" && a.status !== "voided")
    .map(a => ({ ...memberOfAdjustment(a), eligible: true })));
  const offsets = adjustments.filter(a => a.kind === "unpaid_offset" && a.status !== "voided").map(memberOfAdjustment);
  const grouped = groupPartnerPayables(sources, offsets, options.payoutId);
  const allMembers = [...earnings.map(e => ({ ...e, sourceKind: t.sourceKind })), ...adjustments.map(memberOfAdjustment)];
  const heldMembers = options.payoutId ? allMembers.filter(m => m.payoutId === options.payoutId) : grouped.groups.flatMap(g => g.members);
  return {
    kind, partnerId: id, ...grouped,
    claimableNet: sumMoney(grouped.groups.map(g => g.netKurus)),
    claimableCount: grouped.groups.length, hasZeroNetGroups: grouped.groups.some(g => g.netKurus === 0),
    pendingPayoutNet: sumMoney(batches.filter(p => p.status === "pending" && !p.voidedAt).map(p => p.totalKurus)),
    paidTransferNet: sumMoney(batches.filter(p => p.status === "paid" && !p.voidedAt && p.settlementKind === "transfer").map(p => p.totalKurus)),
    settledNettingNet: sumMoney(batches.filter(p => p.status === "paid" && !p.voidedAt && p.settlementKind === "netting").map(p => p.totalKurus)),
    settledNettingCount: batches.filter(p => p.status === "paid" && !p.voidedAt && p.settlementKind === "netting").length,
    fingerprint: payableFingerprint(kind, id, heldMembers), adjustmentHistory: adjustments,
    heldMembers, heldNet: sumMoney(heldMembers.map(m => m.netKurus)),
    heldEarningCount: heldMembers.filter(m => m.sourceKind !== "adjustment").length,
    heldAdjustmentCount: heldMembers.filter(m => m.sourceKind === "adjustment").length,
    payouts: batches.map(batch => {
      const held = allMembers.filter(m => m.payoutId === batch.id);
      return {
        ...batch, fingerprint: payableFingerprint(kind, id, held),
        heldNet: sumMoney(held.map(m => m.netKurus)),
        heldEarningCount: held.filter(m => m.sourceKind !== "adjustment").length,
        heldAdjustmentCount: held.filter(m => m.sourceKind === "adjustment").length,
        blockedGroups: batch.status === "pending" && !batch.voidedAt
          ? groupPartnerPayables(sources, offsets, batch.id).blockedGroups : [],
      };
    }),
  };
}

export async function readPartnerPayables(kind: PartnerKind, id: string, options: { payoutId?: string } = {}): Promise<PartnerPayables> {
  return db.transaction(tx => loadPartnerPayables(tx, kind, id, options), { isolationLevel: "repeatable read", accessMode: "read only" });
}

export interface PayoutConfirmation { expectedFingerprint: string; adminEmail: string }
export interface PayoutSettlementConfirmation extends PayoutConfirmation { settlementKind: "transfer" | "netting" }
export interface PayoutVoidInput extends PayoutConfirmation { reason: string; idempotencyKey: string }
export type PartnerPayoutFailure = { ok: false; reason: "not_found" | "busy" | "confirmation_required" | "stale_confirmation" | "blocked_groups" | "voided" | "already_paid" | "payload_conflict" | "invalid_request" };
export type PartnerPayoutMismatch = { ok: false; reason: "mismatch"; statedKurus: number; statedCount: number; heldKurus: number; heldCount: number };
export type PartnerPayoutPaidResult =
  | { ok: true; partnerId: string; totalKurus: number; settlementKind: "transfer" | "netting"; replayed: boolean }
  | PartnerPayoutFailure | PartnerPayoutMismatch;
export type PartnerPayoutVoidResult =
  | { ok: true; partnerId: string; totalKurus: number; settlementKind: "transfer" | "netting"; replayed: boolean }
  | PartnerPayoutFailure;
export type PartnerPayoutCreateResult =
  | { ok: true; payoutId: string; totalKurus: number; count: number; adjustmentCount: number; settlementKind: "transfer" | "netting" }
  | { ok: false; reason: "nothing_owed" | "busy" };

function integerTotal(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new RangeError("Payout total exceeds integer bounds");
  return value;
}

/** Partner gate already held. Lock order rows before any financial row locks. */
async function lockPayableOrders(tx: MoneyTx, kind: PartnerKind, id: string, payoutId?: string) {
  const t = partnerMoneyTables(kind);
  const earnings = await tx.select({ orderId: t.earning.orderId }).from(t.earning).where(and(
    eq(t.earningOwner, id), payoutId ? eq(t.earning.payoutId, payoutId) : eq(t.earning.status, "pending"),
  ));
  const adjustments = await tx.select({ orderId: partnerAdjustments.orderId }).from(partnerAdjustments).where(and(
    eq(t.adjustmentOwner, id), payoutId ? eq(t.adjustmentPayout, payoutId) : eq(partnerAdjustments.status, "pending"),
  ));
  const ids = [...new Set([...earnings, ...adjustments].map(r => r.orderId))].sort();
  if (ids.length) await tx.select({ id: orders.id }).from(orders).where(inArray(orders.id, ids)).orderBy(orders.id).for("update");
}

function adjustmentMembership(kind: PartnerKind, payoutId: string | null) {
  return kind === "manufacturer" ? { manufacturerPayoutId: payoutId } : { painterPayoutId: payoutId };
}

export async function createPartnerPayout(kind: PartnerKind, id: string, adminEmail: string): Promise<PartnerPayoutCreateResult> {
  try {
    return await db.transaction(async tx => {
      await lockPartnerMoney(tx, kind, id);
      await lockPayableOrders(tx, kind, id);
      const t = partnerMoneyTables(kind), view = await loadPartnerPayables(tx, kind, id);
      // Zero groups get their own explicit netting batch, never a bank transfer.
      const positive = view.groups.filter(g => g.netKurus > 0);
      const groups = positive.length ? positive : view.groups.filter(g => g.netKurus === 0);
      if (!groups.length) return { ok: false as const, reason: "nothing_owed" as const };
      const settlementKind = positive.length ? "transfer" as const : "netting" as const;
      const members = groups.flatMap(g => g.members);
      const earningIds = members.filter(m => m.sourceKind !== "adjustment").map(m => m.id);
      const adjustmentIds = members.filter(m => m.sourceKind === "adjustment").map(m => m.id);
      const totalKurus = integerTotal(sumMoney(members.map(m => m.netKurus)));
      const values = { totalKurus: 0, earningCount: 0, adjustmentCount: 0, adminEmail, settlementKind };
      const [batch] = kind === "manufacturer"
        ? await tx.insert(payouts).values({ ...values, manufacturerId: id }).returning({ id: payouts.id })
        : await tx.insert(painterPayouts).values({ ...values, painterId: id }).returning({ id: painterPayouts.id });
      const stampedEarnings = earningIds.length ? await tx.update(t.earning).set({ payoutId: batch.id, updatedAt: new Date() })
        .where(and(inArray(t.earning.id, earningIds), eq(t.earningOwner, id), openEarningWhere(t.earning)))
        .returning({ id: t.earning.id, netKurus: t.earning.netKurus }) : [];
      const stampedAdjustments = adjustmentIds.length ? await tx.update(partnerAdjustments).set(adjustmentMembership(kind, batch.id))
        .where(and(inArray(partnerAdjustments.id, adjustmentIds), eq(t.adjustmentOwner, id), eq(partnerAdjustments.status, "pending"), isNull(t.adjustmentPayout)))
        .returning({ id: partnerAdjustments.id, netKurus: partnerAdjustments.netKurus }) : [];
      verifyClaimedPayableMembers(members, [
        ...stampedEarnings.map(m => ({ ...m, sourceKind: t.sourceKind })),
        ...stampedAdjustments.map(m => ({ ...m, sourceKind: "adjustment" })),
      ]);
      await tx.update(t.payout).set({ totalKurus, earningCount: stampedEarnings.length, adjustmentCount: stampedAdjustments.length }).where(eq(t.payout.id, batch.id));
      return { ok: true as const, payoutId: batch.id, totalKurus, count: stampedEarnings.length, adjustmentCount: stampedAdjustments.length, settlementKind };
    });
  } catch (error) {
    if (isPayoutLockBusy(error) || error instanceof PayoutClaimRaceError) return { ok: false, reason: "busy" };
    throw error;
  }
}

/** Discover without row locks, acquire owner gate, then revalidate under it. */
async function discoverPayoutOwner(tx: MoneyTx, kind: PartnerKind, payoutId: string) {
  const t = partnerMoneyTables(kind);
  const [row] = await tx.select({ partnerId: t.payoutOwner }).from(t.payout).where(eq(t.payout.id, payoutId));
  if (!row) return null;
  await lockPartnerMoney(tx, kind, row.partnerId);
  return row.partnerId;
}

export async function settlePartnerPayout(kind: PartnerKind, payoutId: string, reference: string | null, confirmation?: PayoutSettlementConfirmation): Promise<PartnerPayoutPaidResult> {
  if (!confirmation?.expectedFingerprint || !confirmation.adminEmail?.trim() || !confirmation.settlementKind) return { ok: false, reason: "confirmation_required" };
  try {
    return await db.transaction(async tx => {
      const id = await discoverPayoutOwner(tx, kind, payoutId);
      if (!id) return { ok: false as const, reason: "not_found" as const };
      await lockPayableOrders(tx, kind, id, payoutId);
      const t = partnerMoneyTables(kind);
      const [batch] = await tx.select().from(t.payout).where(and(eq(t.payout.id, payoutId), eq(t.payoutOwner, id))).for("update");
      if (!batch) return { ok: false as const, reason: "not_found" as const };
      if (batch.voidedAt) return { ok: false as const, reason: "voided" as const };
      if (batch.settlementKind !== confirmation.settlementKind) return { ok: false as const, reason: "invalid_request" as const };
      const view = await loadPartnerPayables(tx, kind, id, { payoutId });
      if (view.fingerprint !== confirmation.expectedFingerprint) return { ok: false as const, reason: "stale_confirmation" as const };
      if (batch.status === "paid") {
        if (batch.reference !== reference || batch.paidBy !== confirmation.adminEmail) return { ok: false as const, reason: "payload_conflict" as const };
        return { ok: true as const, partnerId: id, totalKurus: batch.totalKurus, settlementKind: batch.settlementKind, replayed: true };
      }
      if (!payoutHoldsWhatItClaims({ statedKurus: batch.totalKurus, statedCount: batch.earningCount, heldKurus: view.heldNet, heldCount: view.heldEarningCount })
        || batch.adjustmentCount !== view.heldAdjustmentCount || !view.heldMembers.length) {
        return { ok: false as const, reason: "mismatch" as const, statedKurus: batch.totalKurus, statedCount: batch.earningCount,
          heldKurus: view.heldNet, heldCount: view.heldEarningCount };
      }
      if (view.blockedGroups.length || view.groups.flatMap(g => g.members).length !== view.heldMembers.length) return { ok: false as const, reason: "blocked_groups" as const };
      if (batch.settlementKind === "netting" ? batch.totalKurus !== 0 || reference !== null : batch.totalKurus <= 0) {
        return { ok: false as const, reason: "invalid_request" as const };
      }
      const now = new Date();
      await tx.update(t.payout).set({ status: "paid", paidAt: now, reference, paidBy: confirmation.adminEmail }).where(eq(t.payout.id, payoutId));
      await tx.update(t.earning).set({ status: "paid", updatedAt: now }).where(and(eq(t.earning.payoutId, payoutId), eq(t.earningOwner, id), eq(t.earning.status, "pending")));
      await tx.update(partnerAdjustments).set({ status: "settled", settledAt: now }).where(and(eq(t.adjustmentPayout, payoutId), eq(t.adjustmentOwner, id), eq(partnerAdjustments.status, "pending")));
      return { ok: true as const, partnerId: id, totalKurus: batch.totalKurus, settlementKind: batch.settlementKind, replayed: false };
    });
  } catch (error) {
    if (isPayoutLockBusy(error)) return { ok: false, reason: "busy" };
    throw error;
  }
}

export async function voidPartnerPayout(kind: PartnerKind, payoutId: string, input: PayoutVoidInput): Promise<PartnerPayoutVoidResult> {
  if (!input?.expectedFingerprint || !input.adminEmail?.trim() || !input.reason || input.reason.trim().length < 10
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.idempotencyKey ?? "")) return { ok: false, reason: "invalid_request" };
  const requestHash = createHash("sha256").update(JSON.stringify([kind, payoutId, input.expectedFingerprint, input.adminEmail, input.reason.trim()])).digest("hex");
  try {
    return await db.transaction(async tx => {
      const id = await discoverPayoutOwner(tx, kind, payoutId);
      if (!id) return { ok: false as const, reason: "not_found" as const };
      const t = partnerMoneyTables(kind);
      // Void does not change an order or need order eligibility; no order lock.
      const [batch] = await tx.select().from(t.payout).where(and(eq(t.payout.id, payoutId), eq(t.payoutOwner, id))).for("update");
      if (!batch) return { ok: false as const, reason: "not_found" as const };
      if (batch.voidedAt) {
        if (batch.voidOperationKey !== input.idempotencyKey || batch.voidRequestHash !== requestHash) return { ok: false as const, reason: "payload_conflict" as const };
        return { ok: true as const, partnerId: id, totalKurus: batch.totalKurus, settlementKind: batch.settlementKind, replayed: true };
      }
      if (batch.status !== "pending") return { ok: false as const, reason: "already_paid" as const };
      const view = await loadPartnerPayables(tx, kind, id, { payoutId });
      if (view.fingerprint !== input.expectedFingerprint) return { ok: false as const, reason: "stale_confirmation" as const };
      if (view.heldMembers.some(m => m.status === "paid" || m.status === "settled")) return { ok: false as const, reason: "blocked_groups" as const };
      await tx.update(t.payout).set({
        voidedAt: new Date(), voidedBy: input.adminEmail, voidReason: input.reason.trim(),
        voidOperationKey: input.idempotencyKey, voidRequestHash: requestHash,
        voidSnapshot: { fingerprint: view.fingerprint, heldNet: view.heldNet, heldEarningCount: view.heldEarningCount,
          heldAdjustmentCount: view.heldAdjustmentCount, members: view.heldMembers },
      }).where(eq(t.payout.id, payoutId));
      await tx.update(t.earning).set({ payoutId: null, updatedAt: new Date() }).where(and(eq(t.earning.payoutId, payoutId), eq(t.earningOwner, id), ne(t.earning.status, "paid")));
      await tx.update(partnerAdjustments).set(adjustmentMembership(kind, null)).where(and(eq(t.adjustmentPayout, payoutId), eq(t.adjustmentOwner, id), eq(partnerAdjustments.status, "pending")));
      return { ok: true as const, partnerId: id, totalKurus: batch.totalKurus, settlementKind: batch.settlementKind, replayed: false };
    });
  } catch (error) {
    if (isPayoutLockBusy(error)) return { ok: false, reason: "busy" };
    // The operation key is unique even across batches of this partner kind.
    if (error && typeof error === "object" && "cause" in error && (error.cause as { code?: string })?.code === "23505") return { ok: false, reason: "payload_conflict" };
    throw error;
  }
}

export interface ReversePartnerEarningResult {
  outcome: "reversed" | "paid_retained" | "already_reversed" | "absent";
  earningId?: string;
  /** Original recorded net, not cash transferred (a paid batch can be netting). */
  netKurus?: number;
  affectedPayoutIds: string[];
}

/**
 * Caller holds the expected partner's gate and the order row lock. No gate or
 * nested transaction here: reversal must commit/roll back with refund evidence.
 * Owner mismatch invalidates discovery, including for already closed earnings.
 */
export async function reversePartnerEarningTx(tx: MoneyTx, input: {
  kind: PartnerKind; orderId: string; expectedPartnerId: string;
}): Promise<ReversePartnerEarningResult> {
  const { kind, orderId, expectedPartnerId } = input;
  const t = partnerMoneyTables(kind);
  const [earning] = await tx.select({
    id: t.earning.id, partnerId: t.earningOwner, status: t.earning.status,
    netKurus: t.earning.netKurus, payoutId: t.earning.payoutId,
  }).from(t.earning).where(eq(t.earning.orderId, orderId)).for("update");
  if (!earning) return { outcome: "absent", affectedPayoutIds: [] };
  if (earning.partnerId.toLowerCase() !== expectedPartnerId.toLowerCase()) {
    throw new PayoutClaimRaceError("Earning owner changed; rediscover partner gates before reversal");
  }
  const original = { earningId: earning.id, netKurus: earning.netKurus };
  if (earning.status === "paid") return { outcome: "paid_retained", ...original, affectedPayoutIds: [] };
  if (earning.status === "reversed") return { outcome: "already_reversed", ...original, affectedPayoutIds: [] };
  // Associated debits lose membership with their source. They remain as
  // historical pending adjustments and the shared reader blocks the group.
  const offsets = await tx.select().from(partnerAdjustments).where(and(
    eq(t.adjustmentOwner, expectedPartnerId), eq(partnerAdjustments.sourceKind, t.sourceKind),
    eq(partnerAdjustments.sourceId, earning.id), eq(partnerAdjustments.status, "pending"),
  ));
  const affectedBatches = [...new Set([earning.payoutId, ...offsets.map(a => kind === "manufacturer" ? a.manufacturerPayoutId : a.painterPayoutId)].filter((p): p is string => !!p))].sort();
  for (const payoutId of affectedBatches) {
    const [batch] = await tx.select({ status: t.payout.status, voidedAt: t.payout.voidedAt }).from(t.payout).where(and(eq(t.payout.id, payoutId), eq(t.payoutOwner, expectedPartnerId))).for("update");
    if (!batch || batch.status !== "pending" || batch.voidedAt) throw new PayoutClaimRaceError("Cannot reverse members of a closed payout");
  }
  await tx.update(t.earning).set({ status: "reversed", payoutId: null, updatedAt: new Date() }).where(and(eq(t.earning.id, earning.id), eq(t.earningOwner, expectedPartnerId), eq(t.earning.status, "pending")));
  if (offsets.length) await tx.update(partnerAdjustments).set(adjustmentMembership(kind, null)).where(inArray(partnerAdjustments.id, offsets.map(a => a.id)));
  for (const payoutId of affectedBatches) {
    const held = await loadPartnerPayables(tx, kind, expectedPartnerId, { payoutId });
    await tx.update(t.payout).set({ totalKurus: integerTotal(held.heldNet), earningCount: held.heldEarningCount, adjustmentCount: held.heldAdjustmentCount }).where(eq(t.payout.id, payoutId));
  }
  return { outcome: "reversed", ...original, affectedPayoutIds: affectedBatches };
}

export async function reversePartnerEarning(kind: PartnerKind, orderId: string): Promise<void> {
  const t = partnerMoneyTables(kind);
  const [owner] = await db.select({ partnerId: t.earningOwner }).from(t.earning).where(eq(t.earning.orderId, orderId));
  if (!owner) return;
  await db.transaction(async tx => {
    await lockPartnerMoney(tx, kind, owner.partnerId);
    await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).for("update");
    await reversePartnerEarningTx(tx, { kind, orderId, expectedPartnerId: owner.partnerId });
  });
}

export async function deleteEmptyPartnerPayout(kind: PartnerKind, payoutId: string): Promise<
  { ok: true; partnerId: string } | { ok: false; reason: "not_found" | "already_paid" } | { ok: false; reason: "has_earnings"; heldCount: number }
> {
  return db.transaction(async tx => {
    const id = await discoverPayoutOwner(tx, kind, payoutId);
    if (!id) return { ok: false as const, reason: "not_found" as const };
    const t = partnerMoneyTables(kind);
    const [batch] = await tx.select().from(t.payout).where(and(eq(t.payout.id, payoutId), eq(t.payoutOwner, id))).for("update");
    if (!batch) return { ok: false as const, reason: "not_found" as const };
    if (batch.status !== "pending" || batch.voidedAt) return { ok: false as const, reason: "already_paid" as const };
    const held = await loadPartnerPayables(tx, kind, id, { payoutId });
    if (held.heldMembers.length) return { ok: false as const, reason: "has_earnings" as const, heldCount: held.heldMembers.length };
    await tx.delete(t.payout).where(eq(t.payout.id, payoutId));
    return { ok: true as const, partnerId: id };
  });
}
