/** Complaint opening and dispute reads; financial composition stays in its owning coordinator. */
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { disputes, orders } from "@/lib/db/schema";
import { DisputePolicyError, normalizeOpenDisputeInput } from "@/lib/config/dispute-resolution";
import type {
  DisputeDecisionFailure, DisputeDecisionResult, DisputeDecisionView,
  OpenDisputeInput, OpenDisputeResult, ResolveDisputeInput,
} from "@/lib/config/dispute-resolution";
import { RefundPolicyError } from "@/lib/config/order-refund";
import type { RefundActor } from "@/lib/config/order-refund";
import { disputeDecisionFingerprint, readOrderRefundView, recordDisputeDecisionWithRefund } from "./order-refund-record";
import type { DisputeEmailPayload } from "./dispute-notices";

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error!=="object") return;
  if ("code" in error && typeof error.code==="string") return error.code;
  return "cause" in error ? postgresCode(error.cause) : undefined;
}
function failure(error: unknown): DisputeDecisionFailure {
  if (error instanceof DisputePolicyError || error instanceof RefundPolicyError) return {ok:false,status:error.status,code:error.code,error:error.message};
  if (["55P03","40P01","40001"].includes(postgresCode(error)??"")) return {ok:false,status:409,code:"busy",error:"Sipariş başka bir işlemde güncelleniyor. Lütfen yeniden deneyin."};
  return {ok:false,status:503,code:"unavailable",error:"Anlaşmazlık kaydı şu anda tamamlanamıyor. Lütfen yeniden deneyin."};
}
function validId(value: string): string {
  if (typeof value!=="string" || value.length!==36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new DisputePolicyError("not_found","Anlaşmazlık bulunamadı.",404);
  }
  return value.toLowerCase();
}

export async function readDisputeDecisionView(disputeId: string): Promise<DisputeDecisionView | DisputeDecisionFailure> {
  try {
    const [row]=await db.select({dispute:disputes,orderNumber:orders.orderNumber}).from(disputes)
      .leftJoin(orders,eq(orders.id,disputes.orderId)).where(eq(disputes.id,validId(disputeId)));
    if (!row) throw new DisputePolicyError("not_found","Anlaşmazlık bulunamadı.",404);
    const d=row.dispute;
    const result: DisputeDecisionView={dispute:{id:d.id,orderId:d.orderId,orderNumber:row.orderNumber,category:d.category,description:d.description,
      status:d.status,resolution:d.resolution,resolvedAt:d.resolvedAt?.toISOString()??null,decisionOperationKey:d.decisionOperationKey,refundRecordId:d.refundRecordId},
      expectedDecisionFingerprint:disputeDecisionFingerprint(d),refundView:null};
    try { result.refundView=await readOrderRefundView(d.orderId); }
    catch { result.refundReadUnavailable="İade kayıtları şu anda okunamıyor. İade eklemeden anlaşmazlık kararı kaydedebilirsiniz."; }
    return result;
  } catch (error) { return failure(error); }
}

export async function resolveDispute(input: ResolveDisputeInput,actor: RefundActor): Promise<DisputeDecisionResult | DisputeDecisionFailure> {
  return recordDisputeDecisionWithRefund(input,actor);
}

export async function openDispute(orderNumber: string,userId: string,input: OpenDisputeInput): Promise<OpenDisputeResult | DisputeDecisionFailure> {
  try {
    const normalized=normalizeOpenDisputeInput(input),customerId=validId(userId);
    if (typeof orderNumber!=="string" || !orderNumber.trim()) throw new DisputePolicyError("not_found","Sipariş bulunamadı.",404);
    const result=await db.transaction(async tx=>{
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const [order]=await tx.select().from(orders).where(and(eq(orders.orderNumber,orderNumber),eq(orders.userId,customerId))).for("update");
      if (!order) throw new DisputePolicyError("not_found","Sipariş bulunamadı.",404);
      if (!["shipped","delivered"].includes(order.status)) throw new DisputePolicyError("invalid_evidence","Anlaşmazlık yalnız kargoya verilmiş veya teslim edilmiş siparişler için açılabilir.",400);
      // The owned order serializes check+insert; no uniqueness migration over legacy duplicates.
      const open=await tx.select().from(disputes).where(and(eq(disputes.orderId,order.id),eq(disputes.status,"open"))).orderBy(asc(disputes.createdAt),asc(disputes.id));
      const matching=open.find(d=>d.userId===customerId && d.category===normalized.category && d.description.trim()===normalized.description);
      if (matching) return {ok:true as const,disputeId:matching.id,replayed:true};
      if (open.length) throw new DisputePolicyError("already_open","Bu sipariş için açık bir anlaşmazlık zaten var.",409);
      const to=process.env.ADMIN_EMAIL?.trim();
      if (!to || !z.email().safeParse(to).success) throw new DisputePolicyError("unavailable","Anlaşmazlık bildirim adresi yapılandırılamadı. Lütfen daha sonra yeniden deneyin.",503);
      const id=randomUUID(),now=new Date();
      const payload: DisputeEmailPayload={version:1,messages:[{key:`${id}.opening`,to,kind:"opening",disputeId:id,
        orderNumber:order.orderNumber,customerName:order.customerName,category:normalized.category,description:normalized.description}]};
      await tx.insert(disputes).values({id,orderId:order.id,userId:customerId,...normalized,
        openingEmailPayload:payload,openingEmailProgress:{},openingEmailState:"pending",openingEmailNextAttemptAt:now});
      return {ok:true as const,disputeId:id,replayed:false};
    });
    try { const {kickDisputeNotices}=await import("./dispute-notices");void kickDisputeNotices(result.disputeId,"opening").catch(()=>{}); } catch { /* durable opening intent */ }
    return result;
  } catch (error) { return failure(error); }
}
