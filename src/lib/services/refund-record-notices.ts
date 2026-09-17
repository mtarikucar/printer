import { z } from "zod";
import type { JobsOptions } from "bullmq";
import { emitOrderChanged, emitCustomerNotification, emitManufacturerNotification,
  emitPainterNotification } from "../realtime/emit";

// Worker-safe: no server-only imports, money writes, recipient lookups or in-app
// inserts. Core snapshots recipients in its money transaction; partner messages
// must specify their audience so the template describes stopped fulfillment.
const kurus = z.number().int().min(0).max(2_147_483_647);
const noticeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("actual_refund"), cashKurus: kurus, giftKurus: kurus })
    .refine((value) => value.cashKurus > 0 || value.giftKurus > 0),
  z.object({ kind: z.literal("cancellation"), giftKurus: kurus,
    cashRefundRequiredKurus: kurus.nullable(), giftReturnBlockedReason: z.string().optional() }),
  z.object({ kind: z.literal("no_collection") }),
]);
const messageSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/)
    .refine((key) => !["constructor", "prototype"].includes(key)),
  // One snapshotted recipient per message, never a comma-separated recipient list.
  to: z.email(), orderNumber: z.string().min(1), customerName: z.string(),
  locale: z.enum(["tr", "en"]).optional(), notice: noticeSchema,
  audience: z.enum(["customer", "manufacturer", "painter"]).optional(),
});
const payloadSchema = z.object({ version: z.literal(1), messages: z.array(messageSchema).min(1) })
  .refine(({ messages }) => new Set(messages.map((message) => message.key)).size === messages.length,
    "Refund email message keys must be unique");
const progressSchema = z.record(z.string(), z.object({
  attempts: z.number().int().nonnegative(), acceptedAt: z.iso.datetime().optional(), error: z.string().optional(),
}));

export type RefundRecordEmailPayload = z.infer<typeof payloadSchema>;
export type RefundRecordEmailMessage = z.infer<typeof messageSchema>;
export type RefundEmailProgress = z.infer<typeof progressSchema>;

/** A timestamp is the fencing token; every write checks ownership AND expiry. */
export interface RefundNoticeStore {
  claim(id: string, now: Date, until: Date): Promise<{ emailPayload: unknown; emailProgress: unknown } | null>;
  checkpoint(id: string, lease: Date, progress: RefundEmailProgress, now: Date, until: Date): Promise<boolean>;
  finish(id: string, lease: Date, now: Date): Promise<boolean>;
  retry(id: string, lease: Date, progress: RefundEmailProgress, now: Date, next: Date): Promise<boolean>;
  findDue(now: Date, limit: number): Promise<string[]>;
}
export interface RefundNoticeQueue {
  getJob(id: string): Promise<{ getState(): Promise<string>; remove(): Promise<void> } | undefined>;
  add(name: string, data: { type: "refund_record_email"; refundId: string }, options: JobsOptions): Promise<unknown>;
}
const LEASE_MS = 5 * 60_000;
const RECOVERY_BATCH = 100;
const KICK_TIMEOUT_MS = 2_000;

async function boundedKick(work: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Refund email queue kick timed out")), KICK_TIMEOUT_MS);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export function createRefundRecordNoticeLane(deps: {
  store: RefundNoticeStore;
  queue: RefundNoticeQueue;
  send(message: RefundRecordEmailMessage): Promise<void>;
  now?: () => Date;
  report?: (message: string, error: unknown) => void;
}) {
  const now = deps.now ?? (() => new Date());
  const report = (message: string, error: unknown) => {
    // Even an unavailable logger must not turn a committed refund into failure.
    try { (deps.report ?? console.error)(message, error); } catch { /* best effort */ }
  };
  async function enqueue(refundId: string) {
    z.uuid().parse(refundId);
    const jobId = `refund-email-${refundId}`;
    const existing = await deps.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state !== "completed" && state !== "failed" && state !== "unknown") return;
      if (state !== "unknown") await existing.remove();
    }
    await deps.queue.add("refund_record_email", { type: "refund_record_email", refundId }, {
      jobId, attempts: 1, removeOnComplete: true, removeOnFail: true,
    });
  }
  async function kick(refundId: string): Promise<void> {
    try { await boundedKick(() => enqueue(refundId)); }
    catch (error) { report(`Refund email kick failed for ${refundId}; durable recovery remains pending`, error); }
  }
  async function recover(): Promise<void> {
    const ids = await deps.store.findDue(now(), RECOVERY_BATCH);
    let failed = 0;
    for (const refundId of ids) {
      try { await enqueue(refundId); }
      catch (error) { failed++; report(`Refund email recovery failed for ${refundId}`, error); }
    }
    if (failed) throw new Error(`Refund email recovery could not queue ${failed} record(s)`);
  }
  async function deliver(refundId: string): Promise<void> {
    z.uuid().parse(refundId);
    const claimedAt = now();
    let lease = new Date(claimedAt.getTime() + LEASE_MS);
    const record = await deps.store.claim(refundId, claimedAt, lease);
    if (!record) return;
    // Invalid stored progress must never be reset: that could resend previously
    // accepted recipients. Fail visibly and let the lease expire for repair.
    const progress = progressSchema.parse(record.emailProgress);
    let currentKey = "_record";
    async function checkpoint() {
      const at = now();
      const until = new Date(at.getTime() + LEASE_MS);
      if (!await deps.store.checkpoint(refundId, lease, progress, at, until)) {
        throw new Error("Refund email delivery lease lost");
      }
      lease = until;
    }
    try {
      const payload = payloadSchema.parse(record.emailPayload);
      for (const message of payload.messages) {
        currentKey = message.key;
        if (progress[message.key]?.acceptedAt) continue;
        progress[message.key] = { attempts: (progress[message.key]?.attempts ?? 0) + 1 };
        // Persist attempt and renew lease before external I/O, never money locks.
        await checkpoint();
        await deps.send(message);
        // At least once: provider acceptance followed by a crash before this
        // checkpoint can duplicate mail. Job IDs do NOT offer SMTP exactly once.
        progress[message.key].acceptedAt = now().toISOString();
        await checkpoint();
      }
      if (!await deps.store.finish(refundId, lease, now())) throw new Error("Refund email delivery lease lost");
    } catch (error) {
      const entry = currentKey === "_record"
        ? { attempts: (progress[currentKey]?.attempts ?? 0) + 1 }
        : progress[currentKey] ?? { attempts: 1 };
      entry.error = (error instanceof Error ? error.message : "Refund email delivery failed").slice(0, 1000);
      progress[currentKey] = entry;
      const at = now();
      const delay = Math.min(3_600_000, 30_000 * 2 ** Math.min(entry.attempts - 1, 7));
      try { await deps.store.retry(refundId, lease, progress, at, new Date(at.getTime() + delay)); }
      catch (saveError) { report(`Refund email progress unavailable for ${refundId}; lease recovery required`, saveError); }
      throw error;
    }
  }
  return { kick, recover, deliver };
}

async function productionLane() {
  const [{ db }, { orderRefundRecords: records }, { and, or, eq, lte, gt, isNull, asc }, { getEmailQueue }] = await Promise.all([
    import("../db"), import("../db/schema"), import("drizzle-orm"), import("../queue/queues"),
  ]);
  const due = (at: Date) => and(
    // Evidence is historical annotation, never a new refund notice.
    or(eq(records.kind, "refund"), eq(records.kind, "cancellation")),
    or(
      and(eq(records.emailState, "pending"), or(isNull(records.emailNextAttemptAt), lte(records.emailNextAttemptAt, at))),
      and(eq(records.emailState, "delivering"), or(isNull(records.emailLeaseUntil), lte(records.emailLeaseUntil, at))),
    ),
  );
  const owns = (id: string, lease: Date, at: Date) => and(eq(records.id, id), eq(records.emailState, "delivering"),
    eq(records.emailLeaseUntil, lease), gt(records.emailLeaseUntil, at));
  const store: RefundNoticeStore = {
    async claim(id, at, until) {
      const [record] = await db.update(records).set({ emailState: "delivering", emailLeaseUntil: until })
        .where(and(eq(records.id, id), due(at)))
        .returning({ emailPayload: records.emailPayload, emailProgress: records.emailProgress });
      return record ?? null;
    },
    async checkpoint(id, lease, progress, at, until) {
      const rows = await db.update(records).set({ emailProgress: progress, emailLeaseUntil: until })
        .where(owns(id, lease, at)).returning({ id: records.id });
      return rows.length === 1;
    },
    async finish(id, lease, at) {
      const rows = await db.update(records).set({ emailState: "delivered", emailLeaseUntil: null, emailNextAttemptAt: null })
        .where(owns(id, lease, at)).returning({ id: records.id });
      return rows.length === 1;
    },
    async retry(id, lease, progress, at, next) {
      const rows = await db.update(records).set({ emailState: "pending", emailProgress: progress,
        emailLeaseUntil: null, emailNextAttemptAt: next }).where(owns(id, lease, at)).returning({ id: records.id });
      return rows.length === 1;
    },
    async findDue(at, limit) {
      const rows = await db.select({ id: records.id }).from(records).where(due(at))
        .orderBy(asc(records.emailNextAttemptAt), asc(records.id)).limit(limit);
      return rows.map((row) => row.id);
    },
  };
  return createRefundRecordNoticeLane({ store, queue: getEmailQueue(), send: async (message) => {
    const { sendEmail } = await import("./email");
    await sendEmail({ type: "refund_record_notice", ...message, refundNotice: message.notice });
  } });
}

/** Post-commit only. Resolves even when Redis, module loading or logging fails. */
export async function kickRefundRecordNotices(refundId: string): Promise<void> {
  try { await boundedKick(async () => (await productionLane()).kick(refundId)); }
  catch (error) {
    try { console.error(`Refund email kick unavailable for ${refundId}; durable intent retained`, error); } catch { /* no throw */ }
  }
}
export async function deliverRefundRecordNotices(refundId: string): Promise<void> {
  await (await productionLane()).deliver(refundId);
}
export async function recoverRefundRecordNotices(): Promise<void> {
  await (await productionLane()).recover();
}

export interface RefundRecordChanges {
  kind: "refund" | "cancellation" | "legacy_evidence";
  orders: Array<{
    basisSnapshot: unknown;
    current: { orderId: string; orderNumber: string; userId: string | null;
      manufacturerId: string | null; painterId: string | null;
      status: string | null; manufacturerStatus: string | null; painterStatus: string | null };
  }>;
}
const refundChangeBasis = z.object({
  manufacturerId: z.uuid().nullable().optional(), painterId: z.uuid().nullable().optional(),
  after: z.object({ paymentStatus: z.string().optional() }).optional(),
});

/** Refund-only post-commit refresh. The inbox rows already exist; never recreate
 * them here. Replays reread current state instead of broadcasting historic status. */
export function createRefundRecordChangePublisher(deps: {
  load(refundId: string): Promise<RefundRecordChanges | null>;
  emitOrderChanged(event: RefundRecordChanges["orders"][number]["current"]): Promise<void>;
  emitCustomerNotification(userId: string): Promise<void>;
  emitManufacturerNotification(manufacturerId: string): Promise<void>;
  emitPainterNotification(painterId: string): Promise<void>;
  report?: (message: string, error: unknown) => void;
}) {
  return async function publish(refundId: string): Promise<void> {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = (error: unknown) => {
      try { (deps.report ?? console.error)(`Refund realtime refresh unavailable for ${refundId}`, error); } catch { /* non-fatal */ }
    };
    try {
      await Promise.race([(async () => {
        z.uuid().parse(refundId);
        const record = await deps.load(refundId);
        // A DB lookup that resolves after the deadline must not start publishing
        // its now-old result. Redis publications already started are best effort.
        if (expired || !record || record.kind === "legacy_evidence") return;
        const jobs: Array<() => Promise<void>> = [];
        const customers = new Set<string>(), manufacturers = new Set<string>(), painters = new Set<string>();
        for (const { current, basisSnapshot } of record.orders) {
          const parsed = refundChangeBasis.safeParse(basisSnapshot);
          if (!parsed.success) report(parsed.error);
          const before = parsed.success ? parsed.data : {};
          const primary = { ...current,
            manufacturerId: current.manufacturerId ?? before.manufacturerId ?? null,
            painterId: current.painterId ?? before.painterId ?? null };
          jobs.push(() => deps.emitOrderChanged(primary));
          // A later reassignment can precede a replay. Refresh both the historic
          // owner and the new owner, always using today's statuses for each.
          const formerManufacturer = before.manufacturerId && before.manufacturerId !== primary.manufacturerId ? before.manufacturerId : null;
          const formerPainter = before.painterId && before.painterId !== primary.painterId ? before.painterId : null;
          if (formerManufacturer || formerPainter) jobs.push(() => deps.emitOrderChanged({ ...current,
            userId: null, manufacturerId: formerManufacturer, painterId: formerPainter }));
          if (current.userId) customers.add(current.userId);
          // Match core's transaction-time notification policy. A partial refund
          // later replayed on a closed order did not create a partner inbox row.
          if (record.kind === "cancellation" || before.after?.paymentStatus === "refunded") {
            if (before.manufacturerId) manufacturers.add(before.manufacturerId);
            if (before.painterId) painters.add(before.painterId);
          }
        }
        for (const userId of customers) jobs.push(() => deps.emitCustomerNotification(userId));
        for (const manufacturerId of manufacturers) jobs.push(() => deps.emitManufacturerNotification(manufacturerId));
        for (const painterId of painters) jobs.push(() => deps.emitPainterNotification(painterId));
        // One failed surface must not prevent the others from refreshing.
        await Promise.all(jobs.map((job) => Promise.resolve().then(() => expired ? undefined : job()).catch(report)));
      })(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error("Refund realtime refresh timed out")); }, KICK_TIMEOUT_MS);
      })]);
    } catch (error) { report(error); }
    finally { expired = true; if (timer) clearTimeout(timer); }
  };
}

/** Main calls this after commit, independent of email/analytics delivery state.
 * Read-only DB access, no money locks, bounded and never rejects financial success. */
export async function publishRefundRecordChanges(refundId: string): Promise<void> {
  await createRefundRecordChangePublisher({
    async load(id) {
      const [{ db }, { orderRefundRecords, orderRefundAllocations, orders }, { eq }] = await Promise.all([
        import("../db"), import("../db/schema"), import("drizzle-orm"),
      ]);
      const [record] = await db.select({ kind: orderRefundRecords.kind }).from(orderRefundRecords)
        .where(eq(orderRefundRecords.id, id)).limit(1);
      if (!record || record.kind === "legacy_evidence") return record ? { kind: record.kind, orders: [] } : null;
      const rows = await db.select({ basisSnapshot: orderRefundAllocations.basisSnapshot,
        current: { orderId: orders.id, orderNumber: orders.orderNumber, userId: orders.userId,
          manufacturerId: orders.manufacturerId, painterId: orders.painterId,
          status: orders.status, manufacturerStatus: orders.manufacturerStatus, painterStatus: orders.painterStatus },
      }).from(orderRefundAllocations).innerJoin(orders, eq(orders.id, orderRefundAllocations.orderId))
        .where(eq(orderRefundAllocations.refundId, id));
      return { kind: record.kind, orders: rows };
    },
    emitOrderChanged, emitCustomerNotification, emitManufacturerNotification, emitPainterNotification,
  })(refundId);
}
