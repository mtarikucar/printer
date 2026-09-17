import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { JobsOptions } from "bullmq";
import type { Attribution } from "../analytics/types";
import type { RefundAnalyticsEventInput } from "../analytics/server";

// Refund-specific delivery only. Its lease lives in analyticsProgress, never in
// emailLeaseUntil. No money writes, live-order lookups or network under DB locks.
const amount = z.number().int().min(0).max(2_147_483_647);
const touch = z.object({
  utmSource: z.string().optional(), utmMedium: z.string().optional(), utmCampaign: z.string().optional(),
  utmContent: z.string().optional(), utmTerm: z.string().optional(), channel: z.string().optional(),
}).passthrough();
const attribution = z.object({ firstTouch: touch.optional(), lastTouch: touch.optional(),
  visitorId: z.string().optional(), sessionId: z.string().optional(),
  consent: z.object({ analytics: z.boolean(), marketing: z.boolean() }).optional(),
}).passthrough();
const snapshotSchema = z.object({ analytics: z.object({ version: z.literal(1), orders: z.array(z.object({
  orderId: z.uuid(), orderNumber: z.string().min(1), userId: z.string().nullable(), productId: z.string().nullable(),
  attribution: attribution.nullable(), purchaseBasisKurus: amount.nullable(),
})).refine((orders) => new Set(orders.map((order) => order.orderId)).size === orders.length) }) });
const allocationsSchema = z.array(z.object({ id: z.uuid(), orderId: z.uuid(), cashKurus: amount,
  giftKurus: amount, analyticsGrossKurus: amount })).min(1)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length);
const eventProgressSchema = z.object({ persistedAt: z.iso.datetime().optional(), ga4AcceptedAt: z.iso.datetime().optional(),
  ga4NotRequired: z.literal("consent_denied").optional(),
  skipped: z.enum(["missing_purchase_basis", "no_return", "legacy_evidence"]).optional(),
});
const progressSchema = z.object({ version: z.literal(1).default(1), attempts: z.number().int().nonnegative().default(0),
  events: z.record(z.uuid(), eventProgressSchema).default({}),
});
export type RefundAnalyticsProgress = z.infer<typeof progressSchema>;
export type RefundAnalyticsSnapshot = z.infer<typeof snapshotSchema>["analytics"];
export interface RefundAnalyticsRecord {
  kind: "refund" | "cancellation" | "legacy_evidence";
  sourceSnapshot: unknown;
  analyticsProgress: unknown;
  allocations: Array<{ id: string; orderId: string; cashKurus: number; giftKurus: number; analyticsGrossKurus: number }>;
}
export interface RefundAnalyticsStore {
  claim(id: string, token: string, at: Date, until: Date): Promise<RefundAnalyticsRecord | null>;
  checkpoint(id: string, token: string, progress: RefundAnalyticsProgress, at: Date, until: Date): Promise<boolean>;
  finish(id: string, token: string, progress: RefundAnalyticsProgress, at: Date, state: "recorded" | "not_required"): Promise<boolean>;
  retry(id: string, token: string, progress: RefundAnalyticsProgress, at: Date, next: Date, error: string): Promise<boolean>;
  findDue(at: Date, limit: number): Promise<string[]>;
}
export interface RefundAnalyticsQueue {
  getJob(id: string): Promise<{ getState(): Promise<string>; remove(): Promise<void> } | undefined>;
  add(name: string, data: { type: "refund_record_analytics"; refundId: string }, options: JobsOptions): Promise<unknown>;
}
const LEASE_MS = 5 * 60_000;

async function boundedKick(work: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Refund analytics queue kick timed out")), 2_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function createRefundRecordAnalyticsLane(deps: {
  store: RefundAnalyticsStore; queue: RefundAnalyticsQueue;
  persist(event: RefundAnalyticsEventInput): Promise<void>;
  forward(event: RefundAnalyticsEventInput): Promise<"accepted" | "not_required">;
  now?: () => Date; report?: (message: string, error: unknown) => void;
}) {
  const now = deps.now ?? (() => new Date());
  const report = (message: string, error: unknown) => {
    try { (deps.report ?? console.error)(message, error); } catch { /* never undo a financial success */ }
  };
  async function enqueue(refundId: string) {
    z.uuid().parse(refundId);
    const jobId = `refund-analytics-${refundId}`;
    const job = await deps.queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (!["completed", "failed", "unknown"].includes(state)) return;
      if (state !== "unknown") await job.remove();
    }
    await deps.queue.add("refund_record_analytics", { type: "refund_record_analytics", refundId },
      { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  }
  async function kick(refundId: string): Promise<void> {
    try { await boundedKick(() => enqueue(refundId)); }
    catch (error) { report(`Refund analytics kick failed for ${refundId}; durable intent retained`, error); }
  }
  async function recover(): Promise<void> {
    const ids = await deps.store.findDue(now(), 100);
    let failed = 0;
    for (const id of ids) {
      try { await enqueue(id); } catch (error) { failed++; report(`Refund analytics recovery failed for ${id}`, error); }
    }
    if (failed) throw new Error(`Refund analytics recovery could not queue ${failed} record(s)`);
  }
  async function deliver(refundId: string): Promise<void> {
    z.uuid().parse(refundId);
    const token = randomUUID(), at = now();
    const record = await deps.store.claim(refundId, token, at, new Date(at.getTime() + LEASE_MS));
    if (!record) return;
    // Corrupt progress must never be cleared and turn accepted work into a resend.
    const progress = progressSchema.parse(record.analyticsProgress);
    async function checkpoint() {
      const at = now();
      if (!await deps.store.checkpoint(refundId, token, progress, at, new Date(at.getTime() + LEASE_MS))) {
        throw new Error("Refund analytics delivery lease lost");
      }
    }
    try {
      progress.attempts++;
      await checkpoint();
      const allocations = allocationsSchema.parse(record.allocations);
      if (record.kind === "legacy_evidence") {
        for (const allocation of allocations) progress.events[allocation.id] = { skipped: "legacy_evidence" };
      } else {
        const snapshot = snapshotSchema.parse(record.sourceSnapshot).analytics;
        for (const allocation of allocations) {
          const item = progress.events[allocation.id] ??= {};
          if (allocation.cashKurus === 0 && allocation.giftKurus === 0) { item.skipped = "no_return"; continue; }
          const order = snapshot.orders.find((order) => order.orderId === allocation.orderId);
          if (!order) throw new Error(`Refund analytics identity missing for allocation ${allocation.id}`);
          if (order.purchaseBasisKurus === null) { item.skipped = "missing_purchase_basis"; continue; }
          if (allocation.analyticsGrossKurus > order.purchaseBasisKurus) throw new Error("Refund analytics gross exceeds stored purchase basis");
          const event: RefundAnalyticsEventInput = { eventId: `refund:${refundId}:${allocation.id}`,
            orderNumber: order.orderNumber, valueKurus: allocation.analyticsGrossKurus,
            userId: order.userId, productId: order.productId, attribution: order.attribution as Attribution | null };
          if (!item.persistedAt) {
            await checkpoint();
            await deps.persist(event); // unique analytics_events.eventId makes retry idempotent
            item.persistedAt = now().toISOString();
            await checkpoint();
          }
          if (order.attribution?.consent?.analytics !== true) {
            item.ga4NotRequired = "consent_denied";
            await checkpoint();
          } else if (!item.ga4AcceptedAt) {
            await checkpoint();
            const result = await deps.forward(event);
            // Never silently downgrade a consented event to not_required.
            if (result !== "accepted") throw new Error("Refund analytics destination did not accept required event");
            item.ga4AcceptedAt = now().toISOString();
            // A crash in this window can duplicate vendor delivery. Its stable
            // event_id is supplied, but GA4 exactly-once processing is not promised.
            await checkpoint();
          }
        }
      }
      const finalState = allocations.every((allocation) => progress.events[allocation.id]?.skipped)
        ? "not_required" : "recorded";
      if (!await deps.store.finish(refundId, token, progress, now(), finalState)) throw new Error("Refund analytics delivery lease lost");
    } catch (error) {
      const at = now();
      const message = (error instanceof Error ? error.message : "Refund analytics delivery failed").slice(0, 1000);
      const delay = Math.min(3_600_000, 30_000 * 2 ** Math.min(progress.attempts - 1, 7));
      try { await deps.store.retry(refundId, token, progress, at, new Date(at.getTime() + delay), message); }
      catch (saveError) { report(`Refund analytics checkpoint failed for ${refundId}; lease recovery required`, saveError); }
      throw error;
    }
  }
  return { kick, recover, deliver };
}

async function productionLane() {
  const [{ db }, { orderRefundRecords: records, orderRefundAllocations: allocations }, { and, eq, asc, sql },
    { getEmailQueue }, { persistRefundAnalyticsEvent, deliverRefundAnalyticsGA4 }] = await Promise.all([
    import("../db"), import("../db/schema"), import("drizzle-orm"), import("../queue/queues"), import("../analytics/server"),
  ]);
  // UTC ISO timestamps are written exclusively by this lane and compare
  // lexicographically. No timestamp casts that let a corrupt row break a sweep.
  const due = (at: Date) => and(eq(records.analyticsState, "pending"),
    sql`COALESCE(${records.analyticsProgress}->'lease'->>'until', '') <= ${at.toISOString()}`,
    sql`COALESCE(${records.analyticsProgress}->>'nextAttemptAt', '') <= ${at.toISOString()}`);
  const owns = (id: string, token: string, at: Date) => and(eq(records.id, id), eq(records.analyticsState, "pending"),
    sql`${records.analyticsProgress}->'lease'->>'token' = ${token}`,
    sql`${records.analyticsProgress}->'lease'->>'until' > ${at.toISOString()}`);
  const store: RefundAnalyticsStore = {
    async claim(id, token, at, until) {
      const [record] = await db.update(records).set({
        analyticsProgress: sql`${records.analyticsProgress} || ${JSON.stringify({ lease: { token, until: until.toISOString() } })}::jsonb`,
      }).where(and(eq(records.id, id), due(at))).returning({ kind: records.kind,
        sourceSnapshot: records.sourceSnapshot, analyticsProgress: records.analyticsProgress });
      if (!record) return null;
      // The financial transaction has committed. Allocations are immutable; no
      // row locks remain held during either this read or destination delivery.
      const items = await db.select({ id: allocations.id, orderId: allocations.orderId, cashKurus: allocations.cashKurus,
        giftKurus: allocations.giftKurus, analyticsGrossKurus: allocations.analyticsGrossKurus })
        .from(allocations).where(eq(allocations.refundId, id)).orderBy(asc(allocations.id));
      return { ...record, allocations: items };
    },
    async checkpoint(id, token, progress, at, until) {
      const rows = await db.update(records).set({ analyticsProgress: { ...progress, lease: { token, until: until.toISOString() } } })
        .where(owns(id, token, at)).returning({ id: records.id });
      return rows.length === 1;
    },
    async finish(id, token, progress, at, state) {
      const rows = await db.update(records).set({ analyticsState: state, analyticsProgress: { ...progress },
        analyticsRecordedAt: state === "recorded" ? at : null, analyticsLastError: null })
        .where(owns(id, token, at)).returning({ id: records.id });
      return rows.length === 1;
    },
    async retry(id, token, progress, at, next, error) {
      const rows = await db.update(records).set({ analyticsProgress: { ...progress, nextAttemptAt: next.toISOString() },
        analyticsLastError: error }).where(owns(id, token, at)).returning({ id: records.id });
      return rows.length === 1;
    },
    async findDue(at, limit) {
      const rows = await db.select({ id: records.id }).from(records).where(due(at))
        .orderBy(asc(records.recordedAt), asc(records.id)).limit(limit);
      return rows.map((row) => row.id);
    },
  };
  return createRefundRecordAnalyticsLane({ store, queue: getEmailQueue(), persist: persistRefundAnalyticsEvent,
    forward: deliverRefundAnalyticsGA4 });
}

/** Call after commit. Queue/config/module failures can never fail the refund. */
export async function kickRefundRecordAnalytics(refundId: string): Promise<void> {
  try { await boundedKick(async () => (await productionLane()).kick(refundId)); }
  catch (error) { try { console.error(`Refund analytics kick unavailable for ${refundId}; durable intent retained`, error); } catch { /* no throw */ } }
}
export async function deliverRefundRecordAnalytics(refundId: string): Promise<void> {
  await (await productionLane()).deliver(refundId);
}
export async function recoverRefundRecordAnalytics(): Promise<void> {
  await (await productionLane()).recover();
}
