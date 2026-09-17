/** Actual refund evidence. No provider calls, nested money transactions or legacy refund writers. */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adminActions, analyticsEvents, customerNotifications, disputes, users, giftCards, giftCardRedemptions, giftCreditReturns,
  manufacturerEarnings, manufacturerNotifications, manufacturers, orderDrafts,
  orderRefundAllocations, orderRefundRecords, orders, painterEarnings, painterNotifications, painters,
} from "@/lib/db/schema";
import {
  RefundPolicyError, giftReturnRemaining, normalizeRecordRefundInput, refundAnalyticsGross,
  refundRemainder, refundTenderBasis, sumRefundKurus, validateRefundCashEvidence,
} from "@/lib/config/order-refund";
import type {
  CancelPaidOrderInput, CancelPaidOrderResult, OrderRefundView, RecordRefundInput,
  RefundActor, RefundFailure, RefundKind, RefundNotificationState,
  RefundOriginalReversal, RefundResult,
} from "@/lib/config/order-refund";
import { DisputePolicyError, normalizeResolveDisputeInput } from "@/lib/config/dispute-resolution";
import type { DisputeDecisionFailure, DisputeDecisionResult, ResolveDisputeInput } from "@/lib/config/dispute-resolution";
import type { DisputeEmailPayload } from "./dispute-notices";
import { REJECTABLE_STATUSES, formatAdminNoteLine } from "@/lib/config/order-status-policy";
import { lockPartnerMoney } from "./money-partner-lock";
import type { MoneyTx, PartnerKind } from "./money-partner-lock";
import { GiftCreditReturnError, restoreGiftCreditTx } from "./gift-credit-return";
import { cancelParticipantSeatTx } from "./workshop-seat";
import { kickRefundRecordNotices, publishRefundRecordChanges } from "./refund-record-notices";
import type { RefundRecordEmailPayload } from "./refund-record-notices";
import { kickRefundRecordAnalytics } from "./refund-record-analytics";
import type { RefundAnalyticsSnapshot } from "./refund-record-analytics";
import { reversePartnerEarningTx } from "./partner-payables";

type Order = typeof orders.$inferSelect;
type Scope = { kind: "draft" | "order"; id: string; key: string };
type Partner = { kind: PartnerKind; id: string };
type Discovery = { scope: Scope; siblings: Order[]; partners: Partner[]; earningOwners: string[] };
type Redemption = typeof giftCardRedemptions.$inferSelect;
type Header = typeof orderRefundRecords.$inferSelect;
type Allocation = typeof orderRefundAllocations.$inferSelect;
type Basis = ReturnType<typeof refundTenderBasis>;
type Sibling = {
  order: Order; basis: Basis | null; cashReturned: number; giftReturned: number;
  legacy: boolean; giftIssue?: string; redemptions: Array<{ row: Redemption; remaining: number }>;
  remainingCash: number | null; remainingGift: number | null;
};
const lockedContext = Symbol("locked refund context");
/** The unexported brand is bound to the owning transaction. Request data cannot create this capability. */
type LockedRefundContext = {
  [lockedContext]: MoneyTx; discovery: Discovery; draft: typeof orderDrafts.$inferSelect | null;
  siblings: Sibling[]; headers: Header[]; allocations: Allocation[];
  fingerprint: string; lineageIssue?: string; giftIssue?: string; legacy: boolean;
  collectedAt: Date; payment: OrderRefundView["payment"];
};
class Rediscover extends Error {}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const keyOf = (p: Partner) => `${p.kind}:${p.id.toLowerCase()}`;
function fail(code: RefundFailure["code"], error: string, status: RefundFailure["status"] = 409): never {
  throw new RefundPolicyError(code, error, status);
}
function uuid(value: string): string {
  if (typeof value !== "string" || !UUID.test(value)) fail("invalid_evidence", "İşlem veya sipariş kimliği geçersiz.", 400);
  return value.toLowerCase();
}
function actorEmail(actor: RefundActor): string {
  if (!actor || typeof actor.adminEmail !== "string" || !actor.adminEmail.trim()) fail("invalid_evidence", "İşlemi yapan yönetici bilgisi gerekli.", 400);
  return actor.adminEmail.trim().toLowerCase();
}
function notificationState(state: Header["emailState"]): RefundNotificationState {
  return state === "delivered" ? "delivered" : state === "not_required" ? "not_required" : "pending";
}
function stableId(key: string): string {
  const hex = hash(key);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresCode(error.cause) : undefined;
}
function failure(error: unknown): RefundFailure {
  if (error instanceof GiftCreditReturnError) return { ok:false,status:409,code:error.code,error:error.message };
  if (error instanceof RefundPolicyError) return { ok:false,status:error.status,code:error.code,error:error.message };
  if (error instanceof Rediscover || ["55P03","40P01","40001"].includes(postgresCode(error) ?? "")) {
    return { ok:false,status:409,code:"busy",error:"Ödeme kayıtları başka bir işlemde güncelleniyor. Lütfen yeniden deneyin." };
  }
  return { ok:false,status:503,code:"unavailable",error:"İade kaydı tamamlanamadı. Kayıtları yenileyip aynı işlem anahtarıyla yeniden deneyin." };
}

async function discover(reader: Pick<MoneyTx,"select">, orderId: string): Promise<Discovery> {
  const [anchor] = await reader.select().from(orders).where(eq(orders.id,orderId));
  if (!anchor) fail("not_found","Sipariş bulunamadı.",404);
  const scope: Scope = anchor.draftId
    ? {kind:"draft",id:anchor.draftId,key:`draft:${anchor.draftId}`}
    : {kind:"order",id:anchor.id,key:`order:${anchor.id}`};
  const siblings = await reader.select().from(orders).where(scope.kind === "draft" ? eq(orders.draftId,scope.id) : eq(orders.id,scope.id)).orderBy(asc(orders.id));
  const ids = siblings.map(o=>o.id);
  const makerOwners = await reader.select({id:manufacturerEarnings.id,orderId:manufacturerEarnings.orderId,partnerId:manufacturerEarnings.manufacturerId}).from(manufacturerEarnings).where(inArray(manufacturerEarnings.orderId,ids));
  const painterOwners = await reader.select({id:painterEarnings.id,orderId:painterEarnings.orderId,partnerId:painterEarnings.painterId}).from(painterEarnings).where(inArray(painterEarnings.orderId,ids));
  const partners = new Map<string,Partner>();
  const add = (kind: PartnerKind,id: string | null) => { if (id) { const p={kind,id:id.toLowerCase()};partners.set(keyOf(p),p); } };
  for (const order of siblings) { add("manufacturer",order.manufacturerId);add("painter",order.painterId); }
  for (const owner of makerOwners) add("manufacturer",owner.partnerId);
  for (const owner of painterOwners) add("painter",owner.partnerId);
  return {scope,siblings,partners:[...partners.values()].sort((a,b)=>keyOf(a).localeCompare(keyOf(b))),
    earningOwners:[...makerOwners.map(e=>`manufacturer:${e.id}:${e.orderId}:${e.partnerId}`),...painterOwners.map(e=>`painter:${e.id}:${e.orderId}:${e.partnerId}`)].sort()};
}
function discoveryIdentity(d: Discovery) {
  return hash({scope:d.scope,orders:d.siblings.map(o=>o.id),partners:d.partners,earnings:d.earningOwners});
}

/** All partner gates precede the payment gate, draft, orders, cards and redemptions. */
async function withLockedPaymentScope<T>(orderId: string, run: (tx: MoneyTx,discovery: Discovery,draft: typeof orderDrafts.$inferSelect | null)=>Promise<T>): Promise<T> {
  for (let attempt=0;attempt<3;attempt++) {
    const discovered=await discover(db,orderId);
    try {
      return await db.transaction(async tx=>{
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        for (const partner of discovered.partners) await lockPartnerMoney(tx,partner.kind,partner.id);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`refund-payment:${discovered.scope.key}`},0))`);
        let draft: typeof orderDrafts.$inferSelect | null = null;
        if (discovered.scope.kind === "draft") {
          [draft] = await tx.select().from(orderDrafts).where(eq(orderDrafts.id,discovered.scope.id)).for("update");
        }
        await tx.select({id:orders.id}).from(orders).where(discovered.scope.kind === "draft" ? eq(orders.draftId,discovered.scope.id) : eq(orders.id,discovered.scope.id)).orderBy(asc(orders.id)).for("update");
        const current=await discover(tx,orderId);
        if (discoveryIdentity(current)!==discoveryIdentity(discovered)) throw new Rediscover();
        return run(tx,current,draft);
      });
    } catch (error) {
      // A unique operation key can race across different payment gates. Roll back,
      // then re-enter so the committed header decides replay versus conflict.
      if ((error instanceof Rediscover || postgresCode(error)==="23505") && attempt<2) continue;
      throw error;
    }
  }
  throw new Rediscover();
}

/** Existing 6c callers still receive their complete, branded financial context. */
async function coordinated<T>(orderId: string, run: (tx: MoneyTx,context: LockedRefundContext)=>Promise<T>): Promise<T> {
  return withLockedPaymentScope(orderId,async(tx,discovery,draft)=>run(tx,await loadContext(tx,discovery,draft)));
}

async function loadContext(tx: MoneyTx, discovery: Discovery, draft: typeof orderDrafts.$inferSelect | null): Promise<LockedRefundContext> {
  const {scope,siblings:rows}=discovery, ids=rows.map(o=>o.id);
  const headers=await tx.select().from(orderRefundRecords).where(eq(orderRefundRecords.paymentScopeKey,scope.key)).orderBy(asc(orderRefundRecords.recordedAt),asc(orderRefundRecords.id));
  const allocations=headers.length ? await tx.select().from(orderRefundAllocations).where(inArray(orderRefundAllocations.refundId,headers.map(h=>h.id))).orderBy(asc(orderRefundAllocations.id)) : [];
  const giftPredicate=scope.kind==="draft" ? or(inArray(giftCardRedemptions.orderId,ids),eq(giftCardRedemptions.draftId,scope.id)) : inArray(giftCardRedemptions.orderId,ids);
  const found=await tx.select().from(giftCardRedemptions).where(giftPredicate).orderBy(asc(giftCardRedemptions.id));
  const cardIds=[...new Set(found.map(r=>r.giftCardId))].sort();
  const cards=cardIds.length ? await tx.select({id:giftCards.id}).from(giftCards).where(inArray(giftCards.id,cardIds)).orderBy(asc(giftCards.id)).for("update") : [];
  const redemptions=await tx.select().from(giftCardRedemptions).where(giftPredicate).orderBy(asc(giftCardRedemptions.id)).for("update");
  if (hash(found.map(r=>[r.id,r.giftCardId]))!==hash(redemptions.map(r=>[r.id,r.giftCardId]))) throw new Rediscover();
  const returns=redemptions.length ? await tx.select().from(giftCreditReturns).where(inArray(giftCreditReturns.redemptionId,redemptions.map(r=>r.id))).orderBy(asc(giftCreditReturns.id)) : [];
  let lineageIssue: string | undefined;
  const tender=(row: Parameters<typeof refundTenderBasis>[0]): Basis | null=>{
    try { return refundTenderBasis(row); }
    catch (error) { if (!(error instanceof RefundPolicyError)) throw error;lineageIssue="Kayıtlı ödeme tutarları tutarsız. Tahsilat kayıtlarını uzlaştırın.";return null; }
  };
  const basis=rows.map(tender);
  let total: Basis | null=null;
  if (basis.every((b): b is Basis=>b!==null)) {
    try { total={invoiceKurus:sumRefundKurus(basis.map(b=>b.invoiceKurus)),cashKurus:sumRefundKurus(basis.map(b=>b.cashKurus)),giftKurus:sumRefundKurus(basis.map(b=>b.giftKurus))}; }
    catch (error) { if (!(error instanceof RefundPolicyError)) throw error;lineageIssue="Kayıtlı ödeme toplamı geçerli tutar sınırını aşıyor."; }
  }
  if (scope.kind==="draft") {
    if (!draft || draft.status!=="confirmed" || !draft.promotedAt) lineageIssue="Ödeme taslağının onay ve sipariş bağlantısı doğrulanamıyor.";
    else {
      const d=tender(draft);
      if (!d || !total || d.invoiceKurus!==total.invoiceKurus || d.cashKurus!==total.cashKurus || d.giftKurus!==total.giftKurus
        || rows.reduce((sum,o)=>sum+BigInt(o.amountKurus),BigInt(0))!==BigInt(draft.amountKurus)
        || rows.reduce((sum,o)=>sum+BigInt(o.havaleDiscountKurus),BigInt(0))!==BigInt(draft.havaleDiscountKurus)
        || rows.some(o=>o.paymentMethod!==draft.paymentMethod || o.userId!==draft.userId)
        || (draft.promotedOrderId && !ids.includes(draft.promotedOrderId))) {
        lineageIssue="Ödeme taslağı ve bağlı siparişlerin kayıtlı tutarları veya sahipliği uyuşmuyor.";
      }
    }
  } else if (rows[0].parentReference) lineageIssue="Ortak ödeme bağlantısı eksik. Ödeme kayıtlarını uzlaştırın.";
  if (rows.some((o,i)=>o.paymentMethod==="gift_card_full" && (basis[i]?.cashKurus??0)>0)) lineageIssue="Tam hediye kartı ödemesinde nakit tutarı bulunamaz. Tahsilat kayıtlarını uzlaştırın.";
  if (rows.some(o=>o.paymentStatus!=="succeeded" && o.paymentStatus!=="refunded")) lineageIssue="Siparişin başarılı tahsilat kaydı doğrulanamıyor.";
  let giftIssue: string | undefined;
  if (redemptions.some(r=>!r.orderId || !ids.includes(r.orderId) || (r.draftId && (scope.kind!=="draft" || r.draftId!==scope.id)))) {
    giftIssue="Hediye kartı kullanımının sipariş bağlantısı tutarsız. Bakiye uzlaştırılması gerekiyor.";
  }
  const siblings: Sibling[]=rows.map((order,index)=>{
    const own=redemptions.filter(r=>r.orderId===order.id), b=basis[index];
    const actual=allocations.filter(a=>a.orderId===order.id && a.kind!=="legacy_evidence");
    const cashReturned=sumRefundKurus(actual.map(a=>a.cashKurus));
    let issue=giftIssue;
    if (!b || sumRefundKurus(own.map(r=>r.amountKurus))!==b.giftKurus || own.some(r=>!cards.some(c=>c.id===r.giftCardId) || r.redeemedByUserId!==order.userId || (draft?.giftCardId && r.giftCardId!==draft.giftCardId))) {
      issue="Siparişin hediye tutarı ile kayıtlı kart kullanımı uyuşmuyor.";
    }
    const residuals=own.map(row=>{
      const restored=sumRefundKurus(returns.filter(r=>r.redemptionId===row.id && r.balanceEffect==="restore").map(r=>r.amountKurus));
      let remaining=0;
      try { remaining=giftReturnRemaining(row.amountKurus,restored,!!row.refundedAt); }
      catch (error) { if (!(error instanceof RefundPolicyError)) throw error;issue=error.message; }
      return {row,remaining};
    });
    const giftReturned=sumRefundKurus(residuals.map(r=>r.row.amountKurus-r.remaining));
    const provenFull=!!b && actual.some(a=>a.kind==="refund") && cashReturned===b.cashKurus && giftReturned===b.giftKurus && !issue;
    const legacy=order.paymentStatus==="refunded" && !provenFull;
    if (legacy && (!b || b.giftKurus>0) && own.some(r=>!r.refundedAt)) issue="Eski iadenin hediye kartı bakiyesine etkisi bilinmiyor.";
    if (b && (cashReturned>b.cashKurus || giftReturned>b.giftKurus)) lineageIssue="Kayıtlı iadeler tahsilat tutarını aşıyor. Kayıtları uzlaştırın.";
    return {order,basis:b,cashReturned,giftReturned,legacy,giftIssue:issue,redemptions:residuals,
      remainingCash:legacy || !b ? null : b.cashKurus-cashReturned,
      remainingGift:issue || legacy || !b ? null : b.giftKurus-giftReturned};
  });
  giftIssue ??=siblings.find(s=>s.giftIssue)?.giftIssue;
  if (lineageIssue) for (const sibling of siblings) { sibling.remainingCash=null;sibling.remainingGift=null; }
  // Delivery progress and card balance are deliberately not refund entitlement.
  const earnings=[
    ...await tx.select().from(manufacturerEarnings).where(inArray(manufacturerEarnings.orderId,ids)).orderBy(asc(manufacturerEarnings.id)),
    ...await tx.select().from(painterEarnings).where(inArray(painterEarnings.orderId,ids)).orderBy(asc(painterEarnings.id)),
  ];
  const fingerprint=hash({version:1,scope,draft:draft ? {id:draft.id,status:draft.status,amount:draft.amountKurus,discount:draft.havaleDiscountKurus,gift:draft.giftCardAmountKurus,card:draft.giftCardId,method:draft.paymentMethod,oid:draft.paytrMerchantOid,promotedAt:draft.promotedAt} : null,
    orders:rows.map(o=>({id:o.id,draftId:o.draftId,amount:o.amountKurus,discount:o.havaleDiscountKurus,gift:o.giftCardAmountKurus,paymentStatus:o.paymentStatus,status:o.status,method:o.paymentMethod,paidAt:o.paidAt,manufacturerId:o.manufacturerId,painterId:o.painterId,shippedAt:o.shippedAt,deliveredAt:o.deliveredAt})),
    headers:headers.map(h=>h.id),allocations:allocations.map(a=>({id:a.id,orderId:a.orderId,cash:a.cashKurus,gift:a.giftKurus})),redemptions,returns,earnings});
  return {[lockedContext]:tx,discovery,draft,siblings,headers,allocations,fingerprint,lineageIssue,giftIssue,legacy:siblings.some(s=>s.legacy),
    collectedAt:new Date(Math.max(...rows.map(o=>o.paidAt.getTime()),draft?.promotedAt?.getTime()??0)),
    payment:{scopeKey:scope.key,method:draft?.paymentMethod??rows[0].paymentMethod,collectionReference:draft ? draft.paytrMerchantOid??draft.reference : null,
      evidenceLevel:"recorded",invoiceBasisKurus:lineageIssue?null:total?.invoiceKurus??null,cashBasisKurus:lineageIssue?null:total?.cashKurus??null,giftBasisKurus:lineageIssue?null:total?.giftKurus??null}};
}

function view(context: LockedRefundContext): OrderRefundView {
  const blockedReason=context.lineageIssue ?? (context.legacy ? "Eski iadenin gerçekleşen tutarı bilinmiyor. Yeni iade için kayıtların uzlaştırılması gerekiyor." : context.giftIssue);
  return {payment:context.payment,siblings:context.siblings.map(s=>({orderId:s.order.id,orderNumber:s.order.orderNumber,cashBasisKurus:s.basis?.cashKurus??null,giftBasisKurus:s.basis?.giftKurus??null,
    confirmedCashKurus:s.cashReturned,confirmedGiftKurus:s.giftReturned,remainingCashKurus:s.remainingCash,remainingGiftKurus:s.remainingGift,legacyUnverified:s.legacy,cancelled:s.order.status==="rejected"})),
    history:context.headers.map(h=>({refundId:h.id,kind:h.kind,occurredAt:h.occurredAt.toISOString(),recordedAt:h.recordedAt.toISOString(),adminEmail:h.adminEmail,reason:h.reason,
      externalReference:h.externalReference,cashKurus:h.cashAmountKurus,giftKurus:h.giftAmountKurus,allocations:context.allocations.filter(a=>a.refundId===h.id).map(a=>({orderId:a.orderId,cashKurus:a.cashKurus,giftKurus:a.giftKurus})),notificationState:notificationState(h.emailState)})),
    expectedFingerprint:context.fingerprint,canRecord:!blockedReason && context.siblings.some(s=>(s.remainingCash??0)+(s.remainingGift??0)>0),...(blockedReason?{blockedReason}:{})};
}

/** Reads fail explicitly; no zero/empty fallback can authorize a refund. */
export async function readOrderRefundView(orderId: string): Promise<OrderRefundView> {
  try { return await coordinated(uuid(orderId),async (_tx,context)=>view(context)); }
  catch (error) { const result=failure(error);throw new RefundPolicyError(result.code,result.error,result.status); }
}

function sourceSnapshot(context: LockedRefundContext) {
  return {version:1,payment:context.payment,rawDraftTender:context.draft?{amountKurus:context.draft.amountKurus,havaleDiscountKurus:context.draft.havaleDiscountKurus,giftCardAmountKurus:context.draft.giftCardAmountKurus}:null,recordedCollectionAt:context.collectedAt.toISOString(),siblings:context.siblings.map(s=>({orderId:s.order.id,orderNumber:s.order.orderNumber,
    amountKurus:s.order.amountKurus,havaleDiscountKurus:s.order.havaleDiscountKurus,giftCardAmountKurus:s.order.giftCardAmountKurus,cashBasisKurus:s.basis?.cashKurus??null,giftBasisKurus:s.basis?.giftKurus??null,priorCashKurus:s.cashReturned,priorGiftKurus:s.giftReturned,legacyUnverified:s.legacy}))};
}
function basisSnapshot(s: Sibling,after: {status:Order["status"];paymentStatus:Order["paymentStatus"]}) {
  return {version:1,amountKurus:s.order.amountKurus,havaleDiscountKurus:s.order.havaleDiscountKurus,giftCardAmountKurus:s.order.giftCardAmountKurus,cashBasisKurus:s.basis?.cashKurus??null,giftBasisKurus:s.basis?.giftKurus??null,
    priorCashKurus:s.cashReturned,priorGiftKurus:s.giftReturned,manufacturerId:s.order.manufacturerId,painterId:s.order.painterId,
    before:{status:s.order.status,paymentStatus:s.order.paymentStatus},after,attribution:s.order.attribution??null};
}
async function replay(tx: MoneyTx,operationKey: string,requestHash: string,scope: Scope): Promise<Header | undefined> {
  const [prior]=await tx.select().from(orderRefundRecords).where(eq(orderRefundRecords.operationKey,operationKey));
  if (prior && (prior.requestHash!==requestHash || prior.paymentScopeKey!==scope.key)) fail("operation_conflict","Bu işlem anahtarı farklı bir iade veya iptal için kullanılmış.");
  return prior;
}
function requireCurrent(context: LockedRefundContext,expectedFingerprint: string) {
  if (context.fingerprint!==expectedFingerprint) fail("stale","Ödeme veya iade kayıtları değişti. Güncel tutarları yeniden açıp kontrol edin.");
}
function requireActual(context: LockedRefundContext) {
  if (context.lineageIssue) fail("lineage_unknown",context.lineageIssue);
  if (context.legacy) fail("legacy_unverified","Eski iadenin gerçekleşen tutarı bilinmiyor. Yeni iade kaydı öncesinde uzlaştırma gerekiyor.");
  if (context.giftIssue) fail("gift_history_unknown",context.giftIssue);
}
async function restoreGift(tx: MoneyTx,context: LockedRefundContext,sibling: Sibling,allocationId: string,amount: number) {
  if (!amount) return;
  let due=amount;
  const allocations=sibling.redemptions.flatMap(({row,remaining})=>{
    const take=Math.min(due,remaining);due-=take;
    return take ? [{redemptionId:row.id,amountKurus:take}] : [];
  });
  if (due) fail("gift_history_unknown","Hediye kartının kalan tutarı doğrulanamadı.");
  const restored=await restoreGiftCreditTx(tx,{scope:{kind:"order",id:sibling.order.id},parent:{refundAllocationId:allocationId},allocations});
  if (restored.restoredKurus!==amount) throw new Error("Gift restoration did not match refund allocation");
}
async function reverseOriginals(tx: MoneyTx,context: LockedRefundContext,s: Sibling): Promise<RefundOriginalReversal[]> {
  const results: RefundOriginalReversal[]=[];
  for (const kind of ["manufacturer","painter"] as const) {
    const t=kind==="manufacturer" ? manufacturerEarnings : painterEarnings;
    const [earning]=await tx.select().from(t).where(eq(t.orderId,s.order.id));
    const owner=earning ? ("manufacturerId" in earning ? earning.manufacturerId : earning.painterId) : undefined;
    if (owner && !context.discovery.partners.some(p=>p.kind===kind && p.id===owner.toLowerCase())) throw new Rediscover();
    if (!owner) { results.push({kind,outcome:"absent"});continue; }
    const result=await reversePartnerEarningTx(tx,{kind,orderId:s.order.id,expectedPartnerId:owner});
    results.push({kind,outcome:result.outcome,...(result.earningId?{earningId:result.earningId}:{})});
  }
  return results;
}
async function closeOrder(tx: MoneyTx,s: Sibling,reason: string,cancel: boolean): Promise<void> {
  const note=formatAdminNoteLine(`${cancel?"İptal":"Gerçekleşen tam iade"}: ${reason}`);
  await tx.update(orders).set({...(cancel?{status:"rejected" as const}:{paymentStatus:"refunded" as const}),
    manufacturerId:null,manufacturerStatus:"unassigned",painterId:null,painterStatus:"unassigned",updatedAt:new Date(),
    adminNotes:sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
  }).where(eq(orders.id,s.order.id));
}

/** Only the coordinator can supply the branded, transaction-bound context. */
export async function recordOrderRefundTx(tx: MoneyTx,context: LockedRefundContext,input: RecordRefundInput,actor: RefundActor): Promise<RefundResult> {
  return recordOrderRefundLocked(tx,context,input,actor);
}

type DisputeOrigin = { kind: "dispute_decision"; disputeId: string; decisionOperationKey: string };
/** Notice ownership can only be supplied by the private dispute composition. */
async function recordOrderRefundLocked(tx: MoneyTx,context: LockedRefundContext,input: RecordRefundInput,actor: RefundActor,origin?: DisputeOrigin): Promise<RefundResult> {
  if (context[lockedContext]!==tx) throw new TypeError("A locked refund context from this transaction is required");
  const adminEmail=actorEmail(actor), scope=context.discovery.scope;
  const requestHash=hash({version:1,action:"refund",scope:scope.key,mode:input.mode,allocations:input.allocations,cashEvidence:input.cashEvidence??null,reason:input.reason,adminEmail,...(origin?{disputeOrigin:origin}:{})});
  const prior=await replay(tx,input.operationKey,requestHash,scope);
  if (prior) return {...prior.resultSnapshot as unknown as RefundResult,replayed:true,notificationState:notificationState(prior.emailState)};
  requireCurrent(context,input.expectedFingerprint);
  if (context.lineageIssue) fail("lineage_unknown",context.lineageIssue);
  const evidenceOnly=input.mode==="legacy_evidence";
  if (!evidenceOnly) requireActual(context);
  // Annotation cannot establish a baseline on an otherwise live payment: that
  // would permit a subsequent actual refund to ignore the historical transfer.
  if (evidenceOnly && !context.legacy) fail("legacy_unverified","Geçmiş işlem kanıtı yalnız eski iadesi uzlaştırılmayı bekleyen ödemeye eklenebilir.");
  validateRefundCashEvidence(input,{method:context.payment.method,collectedAt:context.collectedAt});
  const cashKurus=sumRefundKurus(input.allocations.map(a=>a.cashKurus)),giftKurus=sumRefundKurus(input.allocations.map(a=>a.giftKurus));
  const kind: RefundKind=evidenceOnly ? "legacy_evidence" : "refund";
  const events=input.allocations.map(allocation=>{
    const s=context.siblings.find(s=>s.order.id===allocation.orderId);
    if (!s || !s.basis) fail("lineage_unknown","İade dağılımındaki siparişler aynı kayıtlı ödemeye bağlı değil.");
    let remainingCashKurus: number | null, remainingGiftKurus: number | null,fullyReturned=false;
    if (evidenceOnly) {
      if (!s.legacy) fail("legacy_unverified","Geçmiş iade kanıtı yalnız eski iade kaydı belirsiz olan siparişe eklenebilir.");
      const previous=context.allocations.filter(a=>a.orderId===s.order.id);
      // Evidence is capped against recorded source, without treating an unknown
      // historical restoration as permission to move the balance again.
      refundRemainder({cashKurus:s.basis.cashKurus,giftKurus:s.basis.giftKurus},{cashKurus:sumRefundKurus([...previous.map(a=>a.cashKurus),allocation.cashKurus]),giftKurus:sumRefundKurus([...previous.map(a=>a.giftKurus),allocation.giftKurus])});
      remainingCashKurus=s.remainingCash;remainingGiftKurus=s.remainingGift;
    } else {
      const remaining=refundRemainder({cashKurus:s.remainingCash!,giftKurus:s.remainingGift!},{cashKurus:allocation.cashKurus,giftKurus:allocation.giftKurus});
      remainingCashKurus=remaining.cashKurus;remainingGiftKurus=remaining.giftKurus;fullyReturned=remaining.fullyReturned;
    }
    return {s,allocation,id:randomUUID(),remainingCashKurus,remainingGiftKurus,fullyReturned};
  });
  if (cashKurus>0) {
    const existing=context.headers.find(h=>h.method===input.cashEvidence!.method && h.externalReferenceKey===input.cashEvidence!.externalReference);
    if (existing) fail("reference_used",`Bu işlem referansı daha önce kaydedilmiş. İade kaydı: ${existing.id}`);
  }
  const refundId=randomUUID(),now=new Date();
  const analytics=evidenceOnly ? {payload:{version:1 as const,orders:[] as AnalyticsOrder[]},gross:new Map<string,number>()} : await prepareAnalytics(tx,events.map(e=>({s:e.s,allocationId:e.id,returnedKurus:sumRefundKurus([e.allocation.cashKurus,e.allocation.giftKurus])})));
  const notices=evidenceOnly ? emptyNotices() : await prepareNotices(tx,input.operationKey,"refund",events.map(e=>({s:e.s,cashKurus:e.allocation.cashKurus,giftKurus:e.allocation.giftKurus,cashDue:e.remainingCashKurus,stopped:e.fullyReturned})),input.reason,!!origin);
  const resultOrders: RefundResult["orders"]=[];
  for (const e of events) {
    const originalReversal=e.fullyReturned && !evidenceOnly ? await reverseOriginals(tx,context,e.s) : [];
    resultOrders.push({orderId:e.s.order.id,remainingCashKurus:e.remainingCashKurus,remainingGiftKurus:e.remainingGiftKurus,fullyReturned:e.fullyReturned,originalReversal});
  }
  const result: RefundResult={ok:true,refundId,replayed:false,cashKurus,giftKurus,orders:resultOrders,notificationState:notices.payload.messages.length?"pending":"not_required",
    ...(resultOrders.some(o=>o.originalReversal.some(r=>r.outcome==="paid_retained"))?{warning:"Ödenmiş partner hakedişleri korundu."}:{})};
  await tx.insert(orderRefundRecords).values({id:refundId,operationKey:input.operationKey,requestHash,kind,paymentScopeKey:scope.key,
    draftId:scope.kind==="draft"?scope.id:null,standaloneOrderId:scope.kind==="order"?scope.id:null,
    method:input.cashEvidence?.method??"gift_credit",cashAmountKurus:cashKurus,giftAmountKurus:giftKurus,
    externalReference:input.cashEvidence?.externalReference??null,externalReferenceKey:input.cashEvidence?.externalReference??null,
    occurredAt:input.cashEvidence?new Date(input.cashEvidence.occurredAt):now,confirmedAt:now,adminEmail,reason:input.reason,
    sourceSnapshot:{...sourceSnapshot(context),analytics:analytics.payload,...(origin?{customerNoticeOwner:origin}:{})},analyticsState:analytics.gross.size?"pending":"not_required",resultSnapshot:{...result},emailPayload:result.notificationState==="not_required"?{}:notices.payload,emailProgress:{},emailState:result.notificationState,
    emailNextAttemptAt:result.notificationState==="pending"?now:null});
  for (const e of events) {
    await tx.insert(orderRefundAllocations).values({id:e.id,refundId,kind,orderId:e.s.order.id,cashKurus:e.allocation.cashKurus,giftKurus:e.allocation.giftKurus,
      basisSnapshot:basisSnapshot(e.s,{status:e.s.order.status,paymentStatus:e.fullyReturned?"refunded":e.s.order.paymentStatus}),
      analyticsGrossKurus:analytics.gross.get(e.id)??0});
    if (!evidenceOnly) {
      await restoreGift(tx,context,e.s,e.id,e.allocation.giftKurus);
      if (e.fullyReturned) await closeOrder(tx,e.s,input.reason,false);
    }
  }
  await insertNotices(tx,notices);
  for (const e of events) await tx.insert(adminActions).values({orderId:e.s.order.id,action:"refund",adminEmail,notes:`${input.reason}\nİşlem: ${input.operationKey}; kayıt: ${refundId}; tür: ${kind}`});
  return result;
}

export async function recordOrderRefund(input: RecordRefundInput,actor: RefundActor): Promise<RefundResult | RefundFailure> {
  try {
    const normalized=normalizeRecordRefundInput(input);
    const result=await coordinated(normalized.allocations[0].orderId,(tx,context)=>recordOrderRefundTx(tx,context,normalized,actor));
    await kickNotices(result.refundId,result.notificationState);
    return result;
  } catch (error) { return failure(error); }
}

/** Read-only fingerprint; delivery progress and financial previews are separate. */
export function disputeDecisionFingerprint(dispute: typeof disputes.$inferSelect): string {
  return hash({version:1,id:dispute.id,orderId:dispute.orderId,userId:dispute.userId,
    category:dispute.category,description:dispute.description,status:dispute.status,
    resolution:dispute.resolution,adminEmail:dispute.adminEmail,resolvedAt:dispute.resolvedAt,
    decisionOperationKey:dispute.decisionOperationKey,refundRecordId:dispute.refundRecordId});
}

/** A domain command, never an arbitrary transaction callback or context factory. */
export async function recordDisputeDecisionWithRefund(input: ResolveDisputeInput,actor: RefundActor): Promise<DisputeDecisionResult | DisputeDecisionFailure> {
  try {
    const command=normalizeResolveDisputeInput(input),adminEmail=actorEmail(actor);
    const [anchor]=await db.select({orderId:disputes.orderId}).from(disputes).where(eq(disputes.id,command.disputeId));
    if (!anchor) fail("not_found","Anlaşmazlık bulunamadı.",404);
    const intent=command.refund ? {allocations:command.refund.allocations,cashEvidence:command.refund.cashEvidence??null,reason:command.refund.reason} : null;
    const requestHash=hash({version:1,disputeId:command.disputeId,orderId:anchor.orderId,action:command.action,resolution:command.resolution,refund:intent,adminEmail});
    const committed=await withLockedPaymentScope(anchor.orderId,async(tx,discovery,draft)=>{
      const [dispute]=await tx.select().from(disputes).where(eq(disputes.id,command.disputeId)).for("update");
      if (!dispute) fail("not_found","Anlaşmazlık bulunamadı.",404);
      if (dispute.orderId!==anchor.orderId) fail("stale","Anlaşmazlığın sipariş bağlantısı değişti. Kaydı yeniden açın.");
      const order=discovery.siblings.find(o=>o.id===dispute.orderId)!;
      if (dispute.userId!==order.userId) fail("lineage_unknown","Anlaşmazlığı açan müşteri ile sipariş sahibi uyuşmuyor.");
      // Global key ownership is checked before stale/closed checks. A unique-key
      // race rolls back through the scope runner, then observes committed ownership.
      const [keyOwner]=await tx.select().from(disputes).where(eq(disputes.decisionOperationKey,command.operationKey));
      if (keyOwner) {
        if (keyOwner.id!==dispute.id || keyOwner.decisionRequestHash!==requestHash) fail("operation_conflict","Bu işlem anahtarı farklı bir anlaşmazlık kararı için kullanılmış.");
        const snapshot=keyOwner.decisionSnapshot as {version?:number;result?:DisputeDecisionResult} | null;
        if (snapshot?.version!==1 || !snapshot.result || snapshot.result.operationKey!==command.operationKey || snapshot.result.disputeId!==dispute.id) {
          fail("lineage_unknown","Kararın kayıtlı işlem makbuzu doğrulanamıyor.");
        }
        let refund=snapshot.result.refund;
        if (refund) {
          const [header]=await tx.select().from(orderRefundRecords).where(eq(orderRefundRecords.id,dispute.refundRecordId!));
          const allocations=header ? await tx.select().from(orderRefundAllocations).where(eq(orderRefundAllocations.refundId,header.id)) : [];
          if (!header || header.id!==refund.refundId || header.kind!=="refund" || header.operationKey!==command.operationKey
            || header.paymentScopeKey!==discovery.scope.key || allocations.length!==1 || allocations[0].orderId!==order.id || allocations[0].kind!=="refund"
            || allocations[0].cashKurus!==refund.cashKurus || allocations[0].giftKurus!==refund.giftKurus) {
            fail("lineage_unknown","Kararın bağlı iade kaydı doğrulanamıyor.");
          }
          refund={...refund,replayed:true,notificationState:notificationState(header.emailState)};
        } else if (dispute.refundRecordId) fail("lineage_unknown","Kararın bağlı iade kaydı doğrulanamıyor.");
        return {userId:dispute.userId,result:{...snapshot.result,refund,replayed:true,decisionNotificationState:notificationState(dispute.decisionEmailState)}};
      }
      if (dispute.status!=="open") throw new DisputePolicyError("already_closed","Bu anlaşmazlık için karar daha önce kaydedilmiş.",409);
      if (command.expectedDecisionFingerprint!==disputeDecisionFingerprint(dispute)) fail("stale","Anlaşmazlık kaydı değişti. Güncel kaydı yeniden açın.");
      // Snapshot the verified complainant, not a checkout email or a submitted recipient.
      const [customer]=await tx.select({email:users.email,name:users.fullName}).from(users).where(eq(users.id,dispute.userId));
      if (!customer || !z.email().safeParse(customer.email).success) fail("unavailable","Müşteri bildirim adresi doğrulanamıyor.",503);
      let refund: RefundResult | null=null;
      if (command.refund) {
        if (command.refund.allocations.length!==1 || command.refund.allocations[0].orderId!==dispute.orderId) {
          fail("invalid_evidence","Kararla birlikte yalnız bu anlaşmazlığın siparişine iade kaydedilebilir.",400);
        }
        const [prior]=await tx.select({id:orderRefundRecords.id}).from(orderRefundRecords).where(eq(orderRefundRecords.operationKey,command.operationKey));
        if (prior) fail("operation_conflict","Bu işlem anahtarı daha önce ayrı bir iade veya iptal için kullanılmış.");
        const context=await loadContext(tx,discovery,draft);
        const actual=normalizeRecordRefundInput({...command.refund,operationKey:command.operationKey,mode:"actual"});
        refund=await recordOrderRefundLocked(tx,context,actual,{adminEmail},{kind:"dispute_decision",disputeId:dispute.id,decisionOperationKey:command.operationKey});
      }
      const now=new Date(),status=command.action==="resolve"?"resolved" as const:"rejected" as const;
      const result: DisputeDecisionResult={ok:true,disputeId:dispute.id,orderId:order.id,operationKey:command.operationKey,status,
        resolution:command.resolution,resolvedAt:now.toISOString(),replayed:false,refund,decisionNotificationState:"pending"};
      const noticeKey=`${command.operationKey}.decision.${dispute.id}.${dispute.userId}`;
      const payload: DisputeEmailPayload={version:1,messages:[{key:noticeKey,to:customer.email,kind:"decision",disputeId:dispute.id,
        orderNumber:order.orderNumber,customerName:customer.name,category:dispute.category,resolution:command.resolution,decision:status,
        ...(refund?{cashKurus:refund.cashKurus,giftKurus:refund.giftKurus}:{})}]};
      const [updated]=await tx.update(disputes).set({status,resolution:command.resolution,adminEmail,resolvedAt:now,
        decisionOperationKey:command.operationKey,decisionRequestHash:requestHash,refundRecordId:refund?.refundId??null,
        decisionSnapshot:{version:1,result},decisionEmailPayload:payload,decisionEmailProgress:{},decisionEmailState:"pending",
        decisionEmailNextAttemptAt:now,decisionEmailLeaseUntil:null,
      }).where(and(eq(disputes.id,dispute.id),eq(disputes.status,"open"))).returning({id:disputes.id});
      if (!updated) throw new DisputePolicyError("already_closed","Bu anlaşmazlık için karar daha önce kaydedilmiş.",409);
      const money=refund ? `${refund.cashKurus} kuruş nakit iadesi ve ${refund.giftKurus} kuruş hediye kartı dönüşü kaydedildi.` : "Bu kararla yeni iade kaydı oluşturulmadı.";
      await tx.insert(customerNotifications).values({id:stableId(noticeKey),userId:dispute.userId,orderId:order.id,type:"dispute_update",
        title:status==="resolved"?"Anlaşmazlığınız sonuçlandırıldı":"Anlaşmazlığınız incelendi — işlem yok",
        body:`${order.orderNumber}: ${command.resolution} ${money}`});
      await tx.insert(adminActions).values({orderId:order.id,action:"edit",adminEmail,
        notes:`Anlaşmazlık kararı: ${status}; anlaşmazlık: ${dispute.id}; işlem: ${command.operationKey}; iade kaydı: ${refund?.refundId??"yok"}\n${command.resolution}`});
      return {userId:dispute.userId,result};
    });
    // Post-commit failures cannot turn a durable decision into a failed command.
    // Dynamic worker imports also keep existing standalone 6c callers independent.
    try { const {kickDisputeNotices}=await import("./dispute-notices");void kickDisputeNotices(committed.result.disputeId,"decision").catch(()=>{}); } catch { /* durable intent */ }
    try { const {emitCustomerNotification}=await import("@/lib/realtime/emit");void emitCustomerNotification(committed.userId).catch(()=>{}); } catch { /* best effort */ }
    if (committed.result.refund) await kickNotices(committed.result.refund.refundId,committed.result.refund.notificationState);
    return committed.result;
  } catch (error) {
    if (error instanceof DisputePolicyError) return {ok:false,status:error.status,code:error.code,error:error.message};
    return failure(error);
  }
}

function normalizeCancellation(input: CancelPaidOrderInput): CancelPaidOrderInput {
  if (!input || typeof input!=="object" || Object.keys(input).some(k=>!["orderId","operationKey","expectedFingerprint","source","reason","notes","workshop"].includes(k))
    || !["admin_reject","workshop_session","workshop_participant"].includes(input.source)
    || typeof input.expectedFingerprint!=="string" || !/^[0-9a-f]{64}$/.test(input.expectedFingerprint)
    || typeof input.reason!=="string" || input.reason.trim().length<10 || input.reason.trim().length>1000) {
    fail("invalid_evidence","İptal bilgileri eksik veya geçersiz. Gerekçeyi ve güncel sipariş kaydını kontrol edin.",400);
  }
  if (input.notes!==undefined && (typeof input.notes!=="string" || input.notes.trim().length>5000)) fail("invalid_evidence","Yönetici notu geçersiz.",400);
  if (input.source!=="admin_reject" && (!input.workshop || typeof input.workshop.releaseSeat!=="boolean")) fail("invalid_evidence","Atölye katılım bağlantısı gerekli.",400);
  if (input.source==="admin_reject" && input.workshop) fail("invalid_evidence","Bu işlem atölye katılımı taşıyamaz.",400);
  const workshop=input.workshop ? {participantId:uuid(input.workshop.participantId),sessionId:uuid(input.workshop.sessionId),releaseSeat:input.workshop.releaseSeat} : undefined;
  return {...input,orderId:uuid(input.orderId),operationKey:uuid(input.operationKey),reason:input.reason.trim(),...(input.notes?.trim()?{notes:input.notes.trim()}:{notes:undefined}),...(workshop?{workshop}:{})};
}

export async function cancelPaidOrder(input: CancelPaidOrderInput,actor: RefundActor): Promise<CancelPaidOrderResult | RefundFailure> {
  try {
    const normalized=normalizeCancellation(input),adminEmail=actorEmail(actor);
    const result=await coordinated(normalized.orderId,async (tx,context): Promise<CancelPaidOrderResult>=>{
      const scope=context.discovery.scope,s=context.siblings.find(s=>s.order.id===normalized.orderId)!;
      const requestHash=hash({version:1,action:"cancellation",scope:scope.key,orderId:normalized.orderId,source:normalized.source,workshop:normalized.workshop??null,reason:normalized.reason,notes:normalized.notes??null,adminEmail});
      const prior=await replay(tx,normalized.operationKey,requestHash,scope);
      if (normalized.source!=="admin_reject" && (s.order.shippedAt || s.order.deliveredAt || ["shipped","delivered"].includes(s.order.status))) {
        fail("invalid_evidence","Sevk edilmiş sipariş atölye iptaliyle kapatılamaz.",400);
      }
      const existing=prior??context.headers.find(h=>h.kind==="cancellation" && context.allocations.some(a=>a.refundId===h.id && a.orderId===s.order.id));
      if (existing) {
        const recorded=existing.resultSnapshot as unknown as CancelPaidOrderResult;
        const seatReleased=await cancelWorkshopSeat(tx,normalized);
        return {...recorded,replayed:true,...(normalized.workshop?{seatReleased}:{}),cashRefundRequiredKurus:s.remainingCash,legacyUnverified:s.legacy,notificationState:notificationState(existing.emailState)};
      }
      requireCurrent(context,normalized.expectedFingerprint);
      if (normalized.source==="admin_reject" && !REJECTABLE_STATUSES.includes(s.order.status) && s.order.status!=="rejected") {
        fail("invalid_evidence","Sipariş bu aşamada reddedilemez.",400);
      }
      if (s.order.paymentStatus!=="succeeded" && s.order.paymentStatus!=="refunded") fail("lineage_unknown","Siparişin tahsilat durumu doğrulanamıyor.");
      const giftReturnBlockedReason=context.lineageIssue??(context.legacy?"Eski iadenin hediye bakiyesine etkisi uzlaştırılmalı.":context.giftIssue);
      const giftReturnedKurus=giftReturnBlockedReason?0:s.remainingGift??0;
      const cashRefundRequiredKurus=s.remainingCash,cancellationId=randomUUID(),allocationId=randomUUID(),now=new Date();
      const analytics=await prepareAnalytics(tx,[{s,allocationId,returnedKurus:giftReturnedKurus}]);
      const notices=await prepareNotices(tx,normalized.operationKey,"cancellation",[{s,cashKurus:0,giftKurus:giftReturnedKurus,cashDue:cashRefundRequiredKurus,stopped:true,giftReturnBlockedReason:giftReturnBlockedReason && (!s.basis || s.basis.giftKurus>0)?giftReturnBlockedReason:undefined}],normalized.reason);
      const originalReversal=await reverseOriginals(tx,context,s);
      const seatReleased=await cancelWorkshopSeat(tx,normalized);
      const result: CancelPaidOrderResult={ok:true,cancellationId,replayed:false,cancelled:true,giftReturnedKurus,cashRefundRequiredKurus,legacyUnverified:s.legacy,...(normalized.workshop?{seatReleased}:{}),
        ...(giftReturnBlockedReason && (!s.basis || s.basis.giftKurus>0) ? {giftReturnBlockedReason}:{}),notificationState:notices.payload.messages.length?"pending":"not_required"};
      await tx.insert(orderRefundRecords).values({id:cancellationId,operationKey:normalized.operationKey,requestHash,kind:"cancellation",paymentScopeKey:scope.key,
        draftId:scope.kind==="draft"?scope.id:null,standaloneOrderId:scope.kind==="order"?scope.id:null,method:giftReturnedKurus?"gift_credit":"none",cashAmountKurus:0,giftAmountKurus:giftReturnedKurus,
        externalReference:null,externalReferenceKey:null,occurredAt:now,confirmedAt:now,adminEmail,reason:normalized.reason,
        sourceSnapshot:{...sourceSnapshot(context),source:normalized.source,notes:normalized.notes??null,originalReversal,analytics:analytics.payload},analyticsState:analytics.gross.size?"pending":"not_required",resultSnapshot:{...result},emailPayload:result.notificationState==="not_required"?{}:notices.payload,emailProgress:{},emailState:result.notificationState,
        emailNextAttemptAt:result.notificationState==="pending"?now:null});
      await tx.insert(orderRefundAllocations).values({id:allocationId,refundId:cancellationId,kind:"cancellation",orderId:s.order.id,cashKurus:0,giftKurus:giftReturnedKurus,
        basisSnapshot:{...basisSnapshot(s,{status:"rejected",paymentStatus:s.order.paymentStatus}),giftReturnBlockedReason:giftReturnBlockedReason??null},
        analyticsGrossKurus:analytics.gross.get(allocationId)??0});
      await restoreGift(tx,context,s,allocationId,giftReturnedKurus);
      await closeOrder(tx,s,normalized.notes?`${normalized.reason}\n${normalized.notes}`:normalized.reason,true);
      await insertNotices(tx,notices);
      await tx.insert(adminActions).values({orderId:s.order.id,action:"reject",adminEmail,notes:`${normalized.reason}${normalized.notes?`\n${normalized.notes}`:""}\nİşlem: ${normalized.operationKey}; kayıt: ${cancellationId}; nakit iade bekleyen: ${cashRefundRequiredKurus??"bilinmiyor"}`});
      return result;
    });
    await kickNotices(result.cancellationId,result.notificationState);
    return result;
  } catch (error) { return failure(error); }
}

type NoticeRows = {
  payload: RefundRecordEmailPayload;
  customer: Array<typeof customerNotifications.$inferInsert>;
  manufacturer: Array<typeof manufacturerNotifications.$inferInsert>;
  painter: Array<typeof painterNotifications.$inferInsert>;
};
function emptyNotices(): NoticeRows { return {payload:{version:1,messages:[]},customer:[],manufacturer:[],painter:[]}; }
async function prepareNotices(tx: MoneyTx,operationKey: string,kind: "refund" | "cancellation",events: Array<{
  s: Sibling; cashKurus: number; giftKurus: number; cashDue: number | null; stopped: boolean; giftReturnBlockedReason?: string;
}>,reason: string,customerNoticeOwnedByDecision=false): Promise<NoticeRows> {
  const notices=emptyNotices();
  for (const event of events) {
    const {s,cashKurus,giftKurus,cashDue}=event,order=s.order;
    const notice: RefundRecordEmailPayload["messages"][number]["notice"]=kind==="refund"
      ? {kind:"actual_refund",cashKurus,giftKurus}
      : {kind:"cancellation",giftKurus,cashRefundRequiredKurus:cashDue,...(event.giftReturnBlockedReason?{giftReturnBlockedReason:event.giftReturnBlockedReason}:{})};
    const title=kind==="refund" ? "Gerçekleşen iade kaydedildi" : "Sipariş iptal edildi";
    const body=kind==="refund"
      ? `${order.orderNumber}: ${cashKurus} kuruş nakit iadesi ve ${giftKurus} kuruş hediye kartı dönüşü kaydedildi.`
      : `${order.orderNumber}: sipariş iptal edildi. Hediye kartına dönen: ${giftKurus} kuruş. ${cashDue===null?"Nakit iade tutarı uzlaştırılmalı.":`Bekleyen nakit iade: ${cashDue} kuruş.`}${event.giftReturnBlockedReason?` ${event.giftReturnBlockedReason}`:""}`;
    const customerKey=`${operationKey}.customer.${order.id}.${order.userId}`;
    if (!customerNoticeOwnedByDecision) {
      notices.payload.messages.push({key:customerKey,audience:"customer",to:order.email,orderNumber:order.orderNumber,customerName:order.customerName,locale:order.locale==="en"?"en":"tr",notice});
      notices.customer.push({id:stableId(customerKey),userId:order.userId,orderId:order.id,type:kind==="refund"?"refund_recorded":"order_cancelled",title,body});
    }
    if (!event.stopped) continue;
    // IDs/emails are read from the pre-detach snapshot, inside the same tx.
    for (const partnerKind of ["manufacturer","painter"] as const) {
      const partnerId=partnerKind==="manufacturer"?order.manufacturerId:order.painterId;
      if (!partnerId) continue;
      const table=partnerKind==="manufacturer"?manufacturers:painters;
      const [partner]=await tx.select({email:table.email,contactPerson:table.contactPerson}).from(table).where(eq(table.id,partnerId));
      if (!partner) throw new Error("Refund recipient disappeared under locked order");
      const key=`${operationKey}.${partnerKind}.${order.id}.${partnerId}`;
      notices.payload.messages.push({key,audience:partnerKind,to:partner.email,orderNumber:order.orderNumber,customerName:partner.contactPerson,locale:"tr",notice});
      const row={id:stableId(key),orderId:order.id,type:"order_cancelled",subject:title,body:`${body} Gerekçe: ${reason}`};
      if (partnerKind==="manufacturer") notices.manufacturer.push({...row,manufacturerId:partnerId});
      else notices.painter.push({...row,painterId:partnerId});
    }
  }
  return notices;
}
async function insertNotices(tx: MoneyTx,notices: NoticeRows): Promise<void> {
  if (notices.customer.length) await tx.insert(customerNotifications).values(notices.customer);
  if (notices.manufacturer.length) await tx.insert(manufacturerNotifications).values(notices.manufacturer);
  if (notices.painter.length) await tx.insert(painterNotifications).values(notices.painter);
}
async function kickNotices(id: string,state: RefundNotificationState): Promise<void> {
  // Email and analytics have independent intent; one channel can be unnecessary.
  // Commit is authoritative even if queue startup or a future implementation of
  // the kick helper throws. The record already contains its recovery intent.
  try { if (state==="pending") void kickRefundRecordNotices(id).catch(()=>{}); } catch { /* durable pending intent */ }
  try { void kickRefundRecordAnalytics(id).catch(()=>{}); } catch { /* durable pending intent */ }
  try { void publishRefundRecordChanges(id).catch(()=>{}); } catch { /* refresh is best effort after commit */ }
}
async function cancelWorkshopSeat(tx: MoneyTx,input: CancelPaidOrderInput): Promise<boolean> {
  if (!input.workshop) return false;
  const result=await cancelParticipantSeatTx(tx,input.workshop.participantId,input.reason,{
    sessionId:input.workshop.sessionId,orderId:input.orderId,releaseSeat:input.workshop.releaseSeat,
  });
  return result.seatReleased;
}


/** Preserve the recorded purchase basis; absent/contradictory purchase evidence
 * creates no conversion. Intent is immutable and delivery uses allocation IDs. */
type AnalyticsOrder = RefundAnalyticsSnapshot["orders"][number];
async function prepareAnalytics(tx: MoneyTx,events: Array<{s:Sibling;allocationId:string;returnedKurus:number}>) {
  const payload:{version:1;orders:AnalyticsOrder[]}={version:1,orders:[]};
  const gross=new Map<string,number>();
  const purchases=await tx.select().from(analyticsEvents).where(and(eq(analyticsEvents.name,"purchase"),eq(analyticsEvents.source,"server"),
    inArray(analyticsEvents.eventId,events.map(e=>`purchase:${e.s.order.orderNumber}`))));
  for (const event of events) {
    const {s,allocationId,returnedKurus}=event;
    const snapshot:AnalyticsOrder={orderId:s.order.id,orderNumber:s.order.orderNumber,userId:s.order.userId,
      productId:s.order.productId,purchaseBasisKurus:null,attribution:s.order.attribution ? {
        ...s.order.attribution,
        firstTouch:s.order.attribution.firstTouch?{...s.order.attribution.firstTouch}:undefined,
        lastTouch:s.order.attribution.lastTouch?{...s.order.attribution.lastTouch}:undefined,
      }:null};
    payload.orders.push(snapshot);
    if (!returnedKurus || s.legacy || !s.basis) continue;
    const purchase=purchases.find(p=>p.eventId===`purchase:${s.order.orderNumber}`);
    if (!purchase || purchase.reference!==s.order.orderNumber || purchase.currency!=="TRY" || purchase.valueKurus!==s.order.amountKurus) continue;
    snapshot.purchaseBasisKurus=purchase.valueKurus;
    const valueKurus=refundAnalyticsGross({originalGrossKurus:purchase.valueKurus,tenderKurus:s.basis.invoiceKurus,
      previousReturnedKurus:sumRefundKurus([s.cashReturned,s.giftReturned]),returnedKurus});
    if (!valueKurus) continue;
    gross.set(allocationId,valueKurus);

  }
  return {payload,gross};
}
