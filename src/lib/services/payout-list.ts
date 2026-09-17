import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, painters, orders } from "@/lib/db/schema";
import {
  checkedPayoutInteger, encodePayoutCursor, normalizePayoutListScope, payoutDisplayStatus, validatePayoutListQuery,
  type PayoutListScope, type PayoutListQuery, type PayoutPage, type PayoutListBaseRow,
  type PayoutListAdminRow, type PayoutListEarningLine, type PayoutRowForScope,
} from "@/lib/config/payout-list";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";
import type { MoneyTx } from "./money-partner-lock";
import { loadPartnerPayables, partnerMoneyTables } from "./partner-payables";

export type { PayoutPage, PayoutListScope, PayoutListQuery, PayoutListAdminRow, PayoutListPartnerRow } from "@/lib/config/payout-list";

/** Read only. Caller owns the repeatable-read snapshot (CSV can walk it to EOF). */
export async function loadPayoutPage<S extends PayoutListScope>(tx: MoneyTx, scope: S, query: PayoutListQuery): Promise<PayoutPage<S>> {
  const normalized = normalizePayoutListScope(scope);
  const { cursor } = validatePayoutListQuery(normalized, query);
  const t = partnerMoneyTables(normalized.kind);
  const predicates: SQL[] = [];
  if (normalized.partnerId) predicates.push(eq(t.payoutOwner, normalized.partnerId));
  switch (query.status) {
    case "pending": predicates.push(eq(t.payout.status, "pending"), isNull(t.payout.voidedAt)); break;
    case "paid": predicates.push(eq(t.payout.status, "paid"), eq(t.payout.settlementKind, "transfer"), isNull(t.payout.voidedAt)); break;
    case "netted": predicates.push(eq(t.payout.status, "paid"), eq(t.payout.settlementKind, "netting"), isNull(t.payout.voidedAt)); break;
    case "voided": predicates.push(isNotNull(t.payout.voidedAt)); break;
  }
  if (cursor) predicates.push(sql`(${t.payout.createdAt}, ${t.payout.id}) < (${cursor.lastTimestamp}::timestamp, ${cursor.lastId}::uuid)`);
  const found = await tx.select({
    batch: t.payout, partnerId: t.payoutOwner,
    // Plain SQL parameter comparisons preserve the DB's microseconds. Do not
    // pass this field through Drizzle's Date encoder or Date.toISOString().
    exactTimestamp: sql<string>`to_char(${t.payout.createdAt}, 'YYYY-MM-DD HH24:MI:SS.US')`,
  }).from(t.payout).where(and(...predicates)).orderBy(desc(t.payout.createdAt), desc(t.payout.id)).limit(query.limit + 1);
  const hasMore = found.length > query.limit, selected = found.slice(0, query.limit);
  if (!selected.length) return { rows: [], hasMore: false, nextCursor: null };

  const ownerIds = [...new Set(selected.map(row => row.partnerId))];
  const payoutIds = selected.map(row => row.batch.id);
  const partner = normalized.kind === "manufacturer" ? manufacturers : painters;
  const profiles = await tx.select({ id: partner.id, name: partner.companyName }).from(partner).where(inArray(partner.id, ownerIds));
  const banks = normalized.audience === "admin" ? await tx.select({
    id: partner.id, iban: partner.iban, accountHolder: partner.bankAccountHolder, bankName: partner.bankName,
    pendingIban: partner.pendingIban, reviewStatus: partner.ibanReviewStatus,
  }).from(partner).where(inArray(partner.id, ownerIds)) : [];
  const earningRows = await tx.select({
    payoutId: t.earning.payoutId, ownerId: t.earningOwner,
    orderId: t.earning.orderId, orderNumber: orders.orderNumber, grossKurus: t.earning.grossKurus,
    commissionKurus: t.earning.commissionKurus, netKurus: t.earning.netKurus, status: t.earning.status,
    createdAt: t.earning.createdAt, paymentStatus: orders.paymentStatus,
  }).from(t.earning).leftJoin(orders, eq(orders.id, t.earning.orderId)).where(and(
    inArray(t.earning.payoutId, payoutIds),
    normalized.partnerId ? eq(t.earningOwner, normalized.partnerId) : undefined,
  )).orderBy(t.earning.createdAt, t.earning.id);

  // Once per distinct owner in this page, on this same transaction. The full
  // reader continues to own source/offset membership and refund eligibility.
  const summaries = new Map<string, Awaited<ReturnType<typeof loadPartnerPayables>>>();
  for (const ownerId of ownerIds) summaries.set(ownerId, await loadPartnerPayables(tx, normalized.kind, ownerId));
  const rows = selected.map(({ batch, partnerId, exactTimestamp }) => {
    const profile = profiles.find(p => p.id === partnerId), summary = summaries.get(partnerId);
    const held = summary?.payouts.find(p => p.id === batch.id);
    // Unknown data must fail the page/export; never substitute zero or an empty
    // membership snapshot into an actionable financial record.
    if (!profile || !summary || !held) throw new Error("Payout history snapshot is incomplete");
    const earnings: PayoutListEarningLine[] = earningRows.filter(e => e.payoutId === batch.id && e.ownerId === partnerId).map(e => ({
      orderId: e.orderId, orderNumber: e.orderNumber ?? "—", grossKurus: checkedPayoutInteger(e.grossKurus),
      commissionKurus: checkedPayoutInteger(e.commissionKurus), netKurus: checkedPayoutInteger(e.netKurus), status: e.status,
      refunded: e.paymentStatus === REFUNDED_PAYMENT_STATUS, createdAt: e.createdAt.toISOString(),
    }));
    const adjustments = summary.adjustmentHistory.filter(a => (normalized.kind === "manufacturer" ? a.manufacturerPayoutId : a.painterPayoutId) === batch.id)
      .map(a => ({ id: a.id, orderId: a.orderId, netKurus: checkedPayoutInteger(a.netKurus), kind: a.kind,
        reason: a.reason, status: a.status, sourceKind: a.sourceKind, sourceId: a.sourceId }));
    const base: PayoutListBaseRow = {
      id: batch.id, kind: normalized.kind, partnerId, name: profile.name,
      totalKurus: checkedPayoutInteger(batch.totalKurus), earningCount: checkedPayoutInteger(batch.earningCount),
      adjustmentCount: checkedPayoutInteger(batch.adjustmentCount), status: batch.status,
      displayStatus: payoutDisplayStatus(batch), settlementKind: batch.settlementKind,
      createdAt: batch.createdAt.toISOString(), createdAtExact: exactTimestamp,
      paidAt: batch.paidAt?.toISOString() ?? null, voidedAt: batch.voidedAt?.toISOString() ?? null,
      reference: batch.reference, voidReason: batch.voidReason,
      requestedByPartner: batch.adminEmail === "manufacturer-request" || batch.adminEmail === "painter-request",
      expectedFingerprint: held.fingerprint, heldNet: checkedPayoutInteger(held.heldNet),
      heldEarningCount: checkedPayoutInteger(held.heldEarningCount), heldAdjustmentCount: checkedPayoutInteger(held.heldAdjustmentCount),
      blockedReason: held.blockedGroups.length ? "Bu partide ödenebilirliği doğrulanamayan kaynak veya düzeltme var. Transfer yapmayın; kayıtları inceleyin." : null,
      earnings, adjustments,
    };
    if (normalized.audience === "partner") return base;
    const bank = banks.find(b => b.id === partnerId);
    if (!bank) throw new Error("Payout owner bank data could not be read");
    const admin: PayoutListAdminRow = {
      ...base, bank: { iban: bank.iban, accountHolder: bank.accountHolder, bankName: bank.bankName,
        pendingIban: bank.pendingIban, ibanReviewPending: bank.reviewStatus === "pending" },
      adminEmail: batch.adminEmail, paidBy: batch.paidBy, voidedBy: batch.voidedBy, voidSnapshot: batch.voidSnapshot,
    };
    return admin;
  });
  const last = selected[selected.length - 1];
  return {
    rows: rows as PayoutRowForScope<S>[], hasMore,
    nextCursor: hasMore ? encodePayoutCursor(normalized, query.status, { lastTimestamp: last.exactTimestamp, lastId: last.batch.id }) : null,
  };
}

export async function readPayoutPage<S extends PayoutListScope>(scope: S, query: PayoutListQuery): Promise<PayoutPage<S>> {
  // Validate before opening a connection; invalid requests are not empty pages.
  const normalized = normalizePayoutListScope(scope);
  validatePayoutListQuery(normalized, query);
  return db.transaction(tx => loadPayoutPage(tx, normalized, query), { isolationLevel: "repeatable read", accessMode: "read only" });
}
