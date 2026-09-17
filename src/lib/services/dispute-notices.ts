import { z } from "zod";
import type { JobsOptions } from "bullmq";

export type DisputeNoticePhase = "opening" | "decision";
const phaseSchema = z.enum(["opening", "decision"]);
const messageFields = {
  key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/)
    .refine((key) => !["constructor", "prototype"].includes(key)),
  to: z.email(), disputeId: z.uuid(), orderNumber: z.string().min(1),
  customerName: z.string(), category: z.string().min(1),
};
const kurus = z.number().int().min(0).max(2_147_483_647);
const messageSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...messageFields, kind: z.literal("opening"), description: z.string().min(1) }),
  z.strictObject({ ...messageFields, kind: z.literal("decision"), resolution: z.string().min(10).max(2000),
    decision: z.enum(["resolved", "rejected"]), cashKurus: kurus.optional(), giftKurus: kurus.optional(),
  }).refine((message) => message.decision !== "rejected" || ((message.cashKurus ?? 0) === 0 && (message.giftKurus ?? 0) === 0),
    "A rejected dispute cannot claim a new refund"),
]);
const payloadSchema = z.strictObject({ version: z.literal(1), messages: z.array(messageSchema).min(1) })
  .refine(({ messages }) => new Set(messages.map((message) => message.key)).size === messages.length,
    "Dispute email keys must be unique within each phase");
const progressSchema = z.record(z.string(), z.strictObject({ attempts: z.number().int().nonnegative(),
  acceptedAt: z.iso.datetime().optional(), error: z.string().optional(),
}));

/** Core snapshots ADMIN_EMAIL for opening and the locked complaint owner for
 * decision. No worker may replace recipients or derive new financial effects. */
export type DisputeEmailPayload = z.infer<typeof payloadSchema>;
export type DisputeEmailMessage = z.infer<typeof messageSchema>;
export type DisputeEmailProgress = z.infer<typeof progressSchema>;
export interface DisputeNoticeStore {
  claim(id: string, phase: DisputeNoticePhase, at: Date, until: Date): Promise<{ payload: unknown; progress: unknown } | null>;
  checkpoint(id: string, phase: DisputeNoticePhase, lease: Date, progress: DisputeEmailProgress, at: Date, until: Date): Promise<boolean>;
  finish(id: string, phase: DisputeNoticePhase, lease: Date, at: Date): Promise<boolean>;
  retry(id: string, phase: DisputeNoticePhase, lease: Date, progress: DisputeEmailProgress, at: Date, next: Date): Promise<boolean>;
  findDue(phase: DisputeNoticePhase, at: Date, limit: number): Promise<string[]>;
}
export interface DisputeNoticeQueue {
  getJob(id: string): Promise<{ getState(): Promise<string>; remove(): Promise<void> } | undefined>;
  add(name: string, data: { type: "dispute_email"; disputeId: string; phase: DisputeNoticePhase }, options: JobsOptions): Promise<unknown>;
}

const LEASE_MS = 5 * 60_000;
async function boundedKick(work: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Dispute email queue kick timed out")), 2_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Dispute-specific delivery. No money, inbox, decision or order writes. */
export function createDisputeNoticeLane(deps: {
  store: DisputeNoticeStore; queue: DisputeNoticeQueue;
  send(message: DisputeEmailMessage): Promise<void>;
  now?: () => Date; report?: (message: string, error: unknown) => void;
}) {
  const now = deps.now ?? (() => new Date());
  const report = (message: string, error: unknown) => {
    try { (deps.report ?? console.error)(message, error); } catch { /* financial result stays committed */ }
  };
  async function enqueue(disputeId: string, phase: DisputeNoticePhase) {
    z.uuid().parse(disputeId); phaseSchema.parse(phase);
    const jobId = `dispute-email-${phase}-${disputeId}`;
    const existing = await deps.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (!["completed", "failed", "unknown"].includes(state)) return;
      if (state !== "unknown") await existing.remove();
    }
    await deps.queue.add("dispute_email", { type: "dispute_email", disputeId, phase },
      { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  }
  async function kick(disputeId: string, phase: DisputeNoticePhase): Promise<void> {
    try { await boundedKick(() => enqueue(disputeId, phase)); }
    catch (error) { report(`Dispute ${phase} email kick failed for ${disputeId}; intent retained`, error); }
  }
  async function recover(): Promise<void> {
    let failures = 0;
    for (const phase of ["opening", "decision"] as const) {
      try {
        const ids = await deps.store.findDue(phase, now(), 100);
        for (const id of ids) {
          try { await enqueue(id, phase); }
          catch (error) { failures++; report(`Dispute ${phase} recovery failed for ${id}`, error); }
        }
      } catch (error) { failures++; report(`Dispute ${phase} recovery scan failed`, error); }
    }
    if (failures) throw new Error(`Dispute email recovery had ${failures} failure(s)`);
  }
  async function deliver(disputeId: string, phase: DisputeNoticePhase): Promise<void> {
    z.uuid().parse(disputeId); phaseSchema.parse(phase);
    const at = now(); let lease = new Date(at.getTime() + LEASE_MS);
    const record = await deps.store.claim(disputeId, phase, at, lease);
    if (!record) return;
    // Never reset malformed accepted evidence; the worker failure is visible,
    // and expiry permits recovery after the stored record is repaired.
    const progress = progressSchema.parse(record.progress);
    let currentKey = "_record";
    async function checkpoint() {
      const at = now(), until = new Date(at.getTime() + LEASE_MS);
      if (!await deps.store.checkpoint(disputeId, phase, lease, progress, at, until)) {
        throw new Error("Dispute email delivery lease lost");
      }
      lease = until;
    }
    try {
      const payload = payloadSchema.parse(record.payload);
      // Validate the whole intent before sending its first message.
      if (payload.messages.some((message) => message.disputeId !== disputeId || message.kind !== phase)) {
        throw new Error("Dispute email payload does not match its record and phase");
      }
      for (const message of payload.messages) {
        currentKey = message.key;
        if (progress[currentKey]?.acceptedAt) continue;
        progress[currentKey] = { attempts: (progress[currentKey]?.attempts ?? 0) + 1 };
        await checkpoint();
        await deps.send(message);
        // At least once: SMTP acceptance followed by a crash before this write
        // may resend this recipient. It never replays the dispute/money mutation.
        progress[currentKey].acceptedAt = now().toISOString();
        await checkpoint();
      }
      if (!await deps.store.finish(disputeId, phase, lease, now())) throw new Error("Dispute email delivery lease lost");
    } catch (error) {
      const entry = currentKey === "_record" ? { attempts: (progress[currentKey]?.attempts ?? 0) + 1 }
        : progress[currentKey] ?? { attempts: 1 };
      progress[currentKey] = { ...entry, error: (error instanceof Error ? error.message : "Dispute email delivery failed").slice(0, 1000) };
      const at = now(), delay = Math.min(3_600_000, 30_000 * 2 ** Math.min(entry.attempts - 1, 7));
      try { await deps.store.retry(disputeId, phase, lease, progress, at, new Date(at.getTime() + delay)); }
      catch (saveError) { report(`Dispute ${phase} checkpoint unavailable for ${disputeId}; lease recovery required`, saveError); }
      throw error;
    }
  }
  return { kick, deliver, recover };
}

async function productionLane() {
  const [{ db }, { disputes }, { and, or, eq, lte, gt, isNull, asc }, { getEmailQueue }] = await Promise.all([
    import("../db"), import("../db/schema"), import("drizzle-orm"), import("../queue/queues"),
  ]);
  const columns = {
    opening: { payload: disputes.openingEmailPayload, progress: disputes.openingEmailProgress, state: disputes.openingEmailState,
      next: disputes.openingEmailNextAttemptAt, lease: disputes.openingEmailLeaseUntil },
    decision: { payload: disputes.decisionEmailPayload, progress: disputes.decisionEmailProgress, state: disputes.decisionEmailState,
      next: disputes.decisionEmailNextAttemptAt, lease: disputes.decisionEmailLeaseUntil },
  };
  const due = (phase: DisputeNoticePhase, at: Date) => {
    const c = columns[phase];
    // No status='open' predicate: opening intent remains due after resolution.
    return or(and(eq(c.state, "pending"), or(isNull(c.next), lte(c.next, at))),
      and(eq(c.state, "delivering"), or(isNull(c.lease), lte(c.lease, at))));
  };
  const owns = (id: string, phase: DisputeNoticePhase, lease: Date, at: Date) => {
    const c = columns[phase];
    return and(eq(disputes.id, id), eq(c.state, "delivering"), eq(c.lease, lease), gt(c.lease, at));
  };
  const patch = (phase: DisputeNoticePhase, value: {
    state?: "pending" | "delivering" | "delivered"; progress?: DisputeEmailProgress; lease?: Date | null; next?: Date | null;
  }) => phase === "opening" ? {
    openingEmailState: value.state, openingEmailProgress: value.progress,
    openingEmailLeaseUntil: value.lease, openingEmailNextAttemptAt: value.next,
  } : {
    decisionEmailState: value.state, decisionEmailProgress: value.progress,
    decisionEmailLeaseUntil: value.lease, decisionEmailNextAttemptAt: value.next,
  };
  const store: DisputeNoticeStore = {
    async claim(id, phase, at, until) {
      const c = columns[phase];
      const [record] = await db.update(disputes).set(patch(phase, { state: "delivering", lease: until }))
        .where(and(eq(disputes.id, id), due(phase, at))).returning({ payload: c.payload, progress: c.progress });
      return record ?? null;
    },
    async checkpoint(id, phase, lease, progress, at, until) {
      const rows = await db.update(disputes).set(patch(phase, { progress, lease: until }))
        .where(owns(id, phase, lease, at)).returning({ id: disputes.id });
      return rows.length === 1;
    },
    async finish(id, phase, lease, at) {
      const rows = await db.update(disputes).set(patch(phase, { state: "delivered", lease: null, next: null }))
        .where(owns(id, phase, lease, at)).returning({ id: disputes.id });
      return rows.length === 1;
    },
    async retry(id, phase, lease, progress, at, next) {
      const rows = await db.update(disputes).set(patch(phase, { state: "pending", progress, lease: null, next }))
        .where(owns(id, phase, lease, at)).returning({ id: disputes.id });
      return rows.length === 1;
    },
    async findDue(phase, at, limit) {
      const rows = await db.select({ id: disputes.id }).from(disputes).where(due(phase, at))
        .orderBy(asc(columns[phase].next), asc(disputes.id)).limit(limit);
      return rows.map((row) => row.id);
    },
  };
  return createDisputeNoticeLane({ store, queue: getEmailQueue(), send: async (message) => {
    const { sendEmail } = await import("./email");
    await sendEmail({ type: "dispute_notice", to: message.to, orderNumber: message.orderNumber,
      customerName: message.customerName, disputeNotice: message });
  } });
}

/** Post-commit only. Even queue/module/logger failures cannot reject success. */
export async function kickDisputeNotices(disputeId: string, phase: DisputeNoticePhase): Promise<void> {
  try { await boundedKick(async () => (await productionLane()).kick(disputeId, phase)); }
  catch (error) { try { console.error(`Dispute ${phase} email kick unavailable for ${disputeId}; intent retained`, error); } catch { /* non-fatal */ } }
}
export async function deliverDisputeNotices(disputeId: string, phase: DisputeNoticePhase): Promise<void> {
  await (await productionLane()).deliver(disputeId, phase);
}
export async function recoverDisputeNotices(): Promise<void> {
  await (await productionLane()).recover();
}
