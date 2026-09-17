import { eq, inArray, sql } from "drizzle-orm";
import { giftCards, giftCardRedemptions, giftCreditReturns, orderDrafts, orders, orderRefundAllocations, orderRefundRecords } from "@/lib/db/schema";
import type { MoneyTx } from "./money-partner-lock";

export class GiftCreditReturnError extends Error {
  constructor(readonly code: "invalid_evidence" | "gift_history_unknown" | "over_refund", message: string) {
    super(message); this.name = "GiftCreditReturnError";
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 2147483647;
function refuse(message = "Hediye kartı iade geçmişi doğrulanamadı."): never { throw new GiftCreditReturnError("gift_history_unknown", message); }
function integer(value: number, positive = false): number {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > MAX) throw new GiftCreditReturnError("invalid_evidence", "Hediye kartı iade tutarı geçersiz.");
  return value;
}

export interface GiftCreditReturnInput {
  scope: { kind: "order" | "draft"; id: string };
  parent: { refundAllocationId: string } | { expiredDraftId: string };
  allocations: readonly { redemptionId: string; amountKurus: number }[];
}
export interface GiftCreditReturnResult {
  restoredKurus: number;
  allocations: { redemptionId: string; restoredKurus: number; remainingKurus: number }[];
}

/** Internal shared lock boundary for recorded returns and draft release.
 * Scope row must already be locked. Cards always precede redemption row locks.
 */
export async function lockGiftRedemptionsTx(tx: MoneyTx, ids: readonly string[]) {
  if (!ids.length) return { cards: [], redemptions: [] };
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  const discovered = await tx.select().from(giftCardRedemptions).where(inArray(giftCardRedemptions.id, [...ids]));
  if (discovered.length !== ids.length) refuse();
  const cardIds = [...new Set(discovered.map(r => r.giftCardId))].sort();
  const cards = await tx.select().from(giftCards).where(inArray(giftCards.id, cardIds)).orderBy(giftCards.id).for("update");
  if (cards.length !== cardIds.length) refuse();
  const redemptions = await tx.select().from(giftCardRedemptions).where(inArray(giftCardRedemptions.id, [...ids])).orderBy(giftCardRedemptions.id).for("update");
  if (redemptions.length !== ids.length || redemptions.some(r => !cardIds.includes(r.giftCardId))) refuse();
  return { cards, redemptions };
}

/** Parent coordinator owns replay and earlier partner/payment/order gates.
 * This helper takes no advisory gate, opens no transaction, and performs no IO
 * beyond this transaction. All validation completes before financial writes.
 */
export async function restoreGiftCreditTx(tx: MoneyTx, input: GiftCreditReturnInput): Promise<GiftCreditReturnResult> {
  if (!input || !input.scope || !["order", "draft"].includes(input.scope.kind) || !UUID.test(input.scope.id)
    || !input.parent || Object.keys(input.parent).length !== 1 || !Array.isArray(input.allocations) || !input.allocations.length) {
    throw new GiftCreditReturnError("invalid_evidence", "Hediye kartı iade isteği geçersiz.");
  }
  const parentId = "refundAllocationId" in input.parent ? input.parent.refundAllocationId : input.parent.expiredDraftId;
  if (typeof parentId !== "string" || !UUID.test(parentId)
    || (input.scope.kind === "order") !== ("refundAllocationId" in input.parent)) {
    throw new GiftCreditReturnError("invalid_evidence", "Hediye kartı iade kaynağı geçersiz.");
  }
  const requested = new Map<string, number>();
  let total = 0;
  for (const a of input.allocations) {
    if (!a || typeof a.redemptionId !== "string" || !UUID.test(a.redemptionId) || requested.has(a.redemptionId.toLowerCase())) {
      throw new GiftCreditReturnError("invalid_evidence", "Hediye kartı kullanım kaydı geçersiz veya yinelenmiş.");
    }
    requested.set(a.redemptionId.toLowerCase(), integer(a.amountKurus, true));
    total = integer(total + a.amountKurus);
  }
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  let userId: string;
  let draftId: string | null;
  let giftBasis: number;
  if (input.scope.kind === "order") {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.scope.id)).for("update");
    if (!order || order.paymentStatus === "refunded") refuse();
    userId = order.userId;
    draftId = order.draftId;
    giftBasis = integer(order.giftCardAmountKurus);
    const [parent] = await tx.select({ allocation: orderRefundAllocations, record: orderRefundRecords })
      .from(orderRefundAllocations).innerJoin(orderRefundRecords, eq(orderRefundRecords.id, orderRefundAllocations.refundId))
      .where(eq(orderRefundAllocations.id, parentId));
    if (!parent || parent.allocation.orderId !== order.id || parent.allocation.kind !== parent.record.kind
      || !["refund", "cancellation"].includes(parent.record.kind)
      || parent.allocation.giftKurus !== total
      || parent.record.paymentScopeKey !== (order.draftId ? `draft:${order.draftId}` : `order:${order.id}`)) refuse();
    const existing = await tx.select({ id: giftCreditReturns.id }).from(giftCreditReturns).where(eq(giftCreditReturns.refundAllocationId, parentId)).limit(1);
    if (existing.length) refuse("Bu iadenin hediye kartı sonucu zaten kaydedilmiş; üst işlem yeniden okunmalıdır.");
  } else {
    if (parentId.toLowerCase() !== input.scope.id.toLowerCase()) refuse();
    const [draft] = await tx.select().from(orderDrafts).where(eq(orderDrafts.id, input.scope.id)).for("update");
    if (!draft || !["pending", "awaiting_review"].includes(draft.status) || draft.promotedOrderId) refuse();
    userId = draft.userId;
    draftId = draft.id;
    giftBasis = integer(draft.giftCardAmountKurus);
  }
  const scopeRedemptions = await tx.select().from(giftCardRedemptions).where(input.scope.kind === "order"
    ? eq(giftCardRedemptions.orderId, input.scope.id) : eq(giftCardRedemptions.draftId, input.scope.id));
  if (scopeRedemptions.some(r => r.redeemedByUserId !== userId || (r.draftId !== null && r.draftId !== draftId)
    || (input.scope.kind === "draft" && r.orderId !== null))
    || scopeRedemptions.reduce((sum, r) => integer(sum + integer(r.amountKurus, true)), 0) !== giftBasis) refuse();
  const { cards, redemptions } = await lockGiftRedemptionsTx(tx, [...requested.keys()]);
  const history = await tx.select().from(giftCreditReturns).where(inArray(giftCreditReturns.redemptionId, [...requested.keys()]));
  const balances = new Map(cards.map(c => [c.id, integer(c.balanceKurus)]));
  const effects = redemptions.map(r => {
    if (r.redeemedByUserId !== userId || (input.scope.kind === "order"
      ? r.orderId !== input.scope.id.toLowerCase()
      : r.orderId !== null || r.draftId !== input.scope.id.toLowerCase())) refuse();
    const rows = history.filter(h => h.redemptionId === r.id);
    if (rows.some(h => h.giftCardId !== r.giftCardId || h.balanceEffect !== "restore")) refuse();
    const original = integer(r.amountKurus, true);
    const returned = rows.reduce((sum, h) => integer(sum + integer(h.amountKurus, true)), 0);
    if (returned > original) refuse();
    const available = r.refundedAt ? 0 : original - returned; // legacy full marker consumes the cap once
    const amount = requested.get(r.id)!;
    if (amount > available) throw new GiftCreditReturnError("over_refund", "Hediye kartı iadesi kalan kullanım tutarını aşıyor.");
    if (input.scope.kind === "draft" && (amount !== available || rows.some(h => h.expiredDraftId === parentId))) refuse("Taslak hediye kartı rezervasyonu tek işlemde kalan tutarıyla serbest bırakılmalıdır.");
    const before = balances.get(r.giftCardId)!;
    const after = integer(before + amount); balances.set(r.giftCardId, after);
    return { r, amount, before, after, remaining: available - amount };
  });
  for (const e of effects) {
    await tx.insert(giftCreditReturns).values({
      redemptionId: e.r.id, giftCardId: e.r.giftCardId, amountKurus: e.amount,
      ...("refundAllocationId" in input.parent ? { refundAllocationId: parentId } : { expiredDraftId: parentId }),
      balanceEffect: "restore", balanceBeforeKurus: e.before, balanceAfterKurus: e.after,
    });
    const card = cards.find(c => c.id === e.r.giftCardId)!;
    await tx.update(giftCards).set({ balanceKurus: e.after,
      status: card.status === "expired" ? "expired" : e.after >= card.amountKurus ? "active" : "partially_used",
      updatedAt: new Date(),
    }).where(eq(giftCards.id, card.id));
    if (e.remaining === 0) await tx.update(giftCardRedemptions).set({ refundedAt: new Date() }).where(eq(giftCardRedemptions.id, e.r.id));
  }
  return { restoredKurus: total, allocations: effects.map(e => ({ redemptionId: e.r.id, restoredKurus: e.amount, remainingKurus: e.remaining })) };
}
