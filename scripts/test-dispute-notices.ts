import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createDisputeNoticeLane, deliverDisputeNotices, recoverDisputeNotices, type DisputeEmailPayload, type DisputeEmailProgress,
  type DisputeNoticePhase, type DisputeNoticeStore, type DisputeNoticeQueue } from "../src/lib/services/dispute-notices";
import { renderDisputeEmail, sendEmail } from "../src/lib/services/email";

const id = "00000000-0000-4000-8000-000000000001";
const common = { key: "primary", disputeId: id, orderNumber: "ORD-1", customerName: "Ada", category: "damaged" };
const payload = (phase: DisputeNoticePhase): DisputeEmailPayload => ({ version: 1, messages: phase === "opening"
  ? [{ ...common, kind: "opening", to: "admin@example.test", description: "Ürün hasarlı olarak geldi." }]
  : [{ ...common, kind: "decision", to: "customer@example.test", decision: "resolved", resolution: "Şikayet incelendi ve çözümlendi." }] });

function fixture() {
  let now = new Date("2026-09-17T12:00:00Z");
  const phases = Object.fromEntries((["opening", "decision"] as const).map((phase) => [phase, {
    payload: payload(phase) as unknown, progress: {} as DisputeEmailProgress, state: "pending",
    lease: null as Date | null, next: null as Date | null,
  }])) as Record<DisputeNoticePhase, { payload: unknown; progress: DisputeEmailProgress; state: string; lease: Date | null; next: Date | null }>;
  let dbDown = false, queueDown = false, queueHung = false, crash = false;
  let failRecipient = "";
  let afterSend: (() => void) | undefined;
  const sent: string[] = [], adds: string[] = [];
  const jobs = new Map<string, string>();
  const due = (phase: DisputeNoticePhase) => {
    const row = phases[phase];
    return row.state === "pending" ? !row.next || row.next <= now
      : row.state === "delivering" && (!row.lease || row.lease <= now);
  };
  const owns = (phase: DisputeNoticePhase, lease: Date) => {
    if (dbDown) throw new Error("DB unavailable");
    return phases[phase].state === "delivering" && phases[phase].lease?.getTime() === lease.getTime() && lease > now;
  };
  const store: DisputeNoticeStore = {
    async claim(disputeId, phase, _at, until) {
      assert.equal(disputeId, id); if (!due(phase)) return null;
      phases[phase].state = "delivering"; phases[phase].lease = until;
      return structuredClone({ payload: phases[phase].payload, progress: phases[phase].progress });
    },
    async checkpoint(_id, phase, lease, progress, _at, until) {
      if (!owns(phase, lease)) return false;
      phases[phase].progress = structuredClone(progress); phases[phase].lease = until; return true;
    },
    async finish(_id, phase, lease) {
      if (!owns(phase, lease)) return false;
      phases[phase].state = "delivered"; phases[phase].lease = null; phases[phase].next = null; return true;
    },
    async retry(_id, phase, lease, progress, _at, next) {
      if (!owns(phase, lease)) return false;
      phases[phase].state = "pending"; phases[phase].lease = null;
      phases[phase].progress = structuredClone(progress); phases[phase].next = next; return true;
    },
    async findDue(phase) { return due(phase) ? [id] : []; },
  };
  const queue: DisputeNoticeQueue = {
    async getJob(jobId) {
      if (queueHung) return new Promise<never>(() => {});
      if (queueDown) throw new Error("Redis unavailable");
      return jobs.has(jobId) ? { async getState() { return jobs.get(jobId)!; }, async remove() { jobs.delete(jobId); } } : undefined;
    },
    async add(name, data, options) {
      assert.equal(name, "dispute_email"); assert.equal(data.disputeId, id);
      assert.equal(options.jobId, `dispute-email-${data.phase}-${id}`);
      adds.push(options.jobId!); jobs.set(options.jobId!, "waiting");
    },
  };
  const lane = createDisputeNoticeLane({ store, queue, now: () => now, report: () => {}, send: async (message) => {
    if (message.to === failRecipient) throw new Error("SMTP refused");
    sent.push(`${message.kind}:${message.to}`); afterSend?.();
    if (crash) { crash = false; dbDown = true; }
  } });
  return { phases, sent, adds, jobs, lane,
    advance: (ms = 600_000) => { now = new Date(now.getTime() + ms); },
    fail: (recipient: string) => { failRecipient = recipient; },
    crash: () => { crash = true; }, restore: () => { dbDown = false; },
    queueDown: (value: boolean) => { queueDown = value; }, hangQueue: () => { queueHung = true; },
    afterSend: (callback: () => void) => { afterSend = callback; },
  };
}

async function main() {
  let count = 0;
  const test = async (name: string, run: () => unknown) => { await run(); count++; console.log(`PASS ${name}`); };
  await test("opening admin and decision customer have independent leases and stable jobs", async () => {
    const f = fixture(); await f.lane.recover();
    assert.deepEqual(f.adds.sort(), [`dispute-email-opening-${id}`, `dispute-email-decision-${id}`].sort());
    await Promise.all([f.lane.deliver(id, "opening"), f.lane.deliver(id, "opening"), f.lane.deliver(id, "decision")]);
    assert.deepEqual(f.sent.sort(), ["opening:admin@example.test", "decision:customer@example.test"].sort());
    assert.equal(f.phases.opening.state, "delivered"); assert.equal(f.phases.decision.state, "delivered");
    await f.lane.deliver(id, "decision"); assert.equal(f.sent.length, 2);
  });
  await test("opening remains recoverable after decision completion", async () => {
    const f = fixture(); await f.lane.deliver(id, "decision"); await f.lane.recover();
    assert.deepEqual(f.adds, [`dispute-email-opening-${id}`]); await f.lane.deliver(id, "opening");
    assert.equal(f.phases.opening.state, "delivered");
  });
  await test("queue outage and hung queue cannot fail the committed opening or decision", async () => {
    const f = fixture(); f.queueDown(true);
    await Promise.all([f.lane.kick(id, "opening"), f.lane.kick(id, "decision")]);
    assert.equal(f.phases.opening.state, "pending"); assert.equal(f.phases.decision.state, "pending");
    f.queueDown(false); await f.lane.recover(); assert.equal(f.adds.length, 2);
    const hung = fixture(); hung.hangQueue(); const start = Date.now(); await hung.lane.kick(id, "opening");
    assert.ok(Date.now() - start < 3000); assert.equal(hung.phases.opening.state, "pending");
  });
  await test("recovery replaces terminal queue jobs without duplicating active work", async () => {
    for (const state of ["completed", "failed", "waiting", "active", "delayed"]) {
      const f = fixture(); f.phases.decision.state = "not_required";
      f.jobs.set(`dispute-email-opening-${id}`, state); await f.lane.recover();
      assert.equal(f.adds.length, ["completed", "failed"].includes(state) ? 1 : 0);
    }
  });
  await test("recipient retries skip accepted progress without touching the other phase", async () => {
    const f = fixture(); const p = payload("opening"); p.messages.push({ ...p.messages[0], key: "secondary", to: "second-admin@example.test" });
    f.phases.opening.payload = p; f.fail("second-admin@example.test");
    await assert.rejects(f.lane.deliver(id, "opening"), /SMTP refused/);
    assert.ok(f.phases.opening.progress.primary.acceptedAt); assert.equal(f.phases.decision.state, "pending");
    assert.deepEqual(f.phases.decision.progress, {}); await f.lane.deliver(id, "opening"); assert.equal(f.sent.length, 1);
    f.advance(); f.fail(""); await f.lane.deliver(id, "opening");
    assert.deepEqual(f.sent, ["opening:admin@example.test", "opening:second-admin@example.test"]);
    assert.equal(f.phases.opening.progress.secondary.attempts, 2);
  });
  await test("provider accepted then checkpoint crash recovers at least once", async () => {
    const f = fixture(); f.crash(); await assert.rejects(f.lane.deliver(id, "decision"), /DB unavailable/);
    assert.equal(f.phases.decision.state, "delivering"); assert.equal(f.phases.decision.progress.primary.acceptedAt, undefined);
    f.restore(); await f.lane.deliver(id, "decision"); assert.equal(f.sent.length, 1);
    f.advance(); await f.lane.recover(); await f.lane.deliver(id, "decision");
    assert.deepEqual(f.sent, ["decision:customer@example.test", "decision:customer@example.test"]);
  });
  await test("expired worker cannot stamp acceptance or overwrite newer phase progress", async () => {
    const f = fixture(); f.afterSend(() => {
      f.advance(); f.phases.opening.lease = new Date("2026-09-17T12:15:00Z");
      f.phases.opening.progress = { primary: { attempts: 9 } };
    });
    await assert.rejects(f.lane.deliver(id, "opening"), /lease lost/);
    assert.deepEqual(f.phases.opening.progress, { primary: { attempts: 9 } });
    assert.equal(f.phases.opening.state, "delivering"); assert.equal(f.phases.decision.lease, null);
  });
  await test("checkpoints renew a long recipient batch and all-accepted recovery sends nothing", async () => {
    const f = fixture(); const p = payload("opening");
    p.messages.push({ ...p.messages[0], key: "secondary", to: "second-admin@example.test" });
    f.phases.opening.payload = p; f.afterSend(() => f.advance(240_000)); await f.lane.deliver(id, "opening");
    assert.equal(f.phases.opening.state, "delivered"); assert.equal(f.sent.length, 2);
    const accepted = fixture(); accepted.phases.decision.progress = { primary: { attempts: 1, acceptedAt: "2026-09-17T11:00:00.000Z" } };
    await accepted.lane.deliver(id, "decision"); assert.equal(accepted.sent.length, 0); assert.equal(accepted.phases.decision.state, "delivered");
  });
  await test("historical no-intent records are not backfilled", async () => {
    const f = fixture(); for (const phase of ["opening", "decision"] as const) {
      f.phases[phase].state = "not_required"; f.phases[phase].payload = {};
      await f.lane.deliver(id, phase);
    }
    await f.lane.recover(); assert.equal(f.sent.length, 0); assert.equal(f.adds.length, 0);
  });
  await test("bad version, phase, dispute ID, duplicate keys and fabricated rejected-refund payloads fail closed", async () => {
    const opening = payload("opening"), decision = payload("decision");
    for (const bad of [{ ...opening, version: 2 }, { version: 1, messages: [] }, decision,
      { version: 1, messages: [opening.messages[0], opening.messages[0]] },
      { version: 1, messages: [{ ...opening.messages[0], disputeId: "00000000-0000-4000-8000-000000000002" }] }]) {
      const f = fixture(); f.phases.opening.payload = bad;
      await assert.rejects(f.lane.deliver(id, "opening")); assert.equal(f.sent.length, 0); assert.equal(f.phases.opening.state, "pending");
    }
    const f = fixture(); f.phases.decision.payload = { version: 1, messages: [{ ...decision.messages[0], decision: "rejected", cashKurus: 10 }] };
    await assert.rejects(f.lane.deliver(id, "decision")); assert.equal(f.sent.length, 0);
  });
  await test("corrupt accepted progress is preserved rather than reset", async () => {
    const f = fixture(); Object.assign(f.phases.opening.progress, { primary: { acceptedAt: "broken" } });
    await assert.rejects(f.lane.deliver(id, "opening")); assert.equal(f.sent.length, 0);
    assert.equal(f.phases.opening.progress.primary.acceptedAt, "broken");
  });
  await test("opening and combined decision copy are honest and escaped", () => {
    const opening = renderDisputeEmail({ ...payload("opening").messages[0], customerName: "<script>" });
    assert.match(opening.html, /&lt;script&gt;/); assert.match(opening.html, /Hasarlı/); assert.doesNotMatch(opening.html, /<script>/);
    const decision = payload("decision").messages[0]; assert.equal(decision.kind, "decision");
    if (decision.kind !== "decision") throw new Error("fixture");
    const noRefund = renderDisputeEmail(decision); assert.match(noRefund.html, /Bu kararla yeni iade kaydı oluşturulmadı/);
    const rejected = renderDisputeEmail({ ...decision, decision: "rejected" });
    assert.match(rejected.html, /şikayet.*reddedildi/i); assert.doesNotMatch(rejected.html, /sipariş.*iptal edildi/i);
    const actual = renderDisputeEmail({ ...decision, cashKurus: 3000, giftKurus: 500 });
    assert.match(actual.html, /30,00/); assert.match(actual.html, /5,00/); assert.doesNotMatch(actual.html, /iş günü|hesabınıza ulaş/i);
    const gift = renderDisputeEmail({ ...decision, giftKurus: 500 }); assert.doesNotMatch(gift.html, /nakit iadesi|banka/i);
  });
  await test("SMTP delivery uses captured recipient and requires actual provider acceptance", async () => {
    const SMTP = createRequire(import.meta.url)("nodemailer/lib/smtp-transport") as {
      prototype: { send(mail: { data: { to: string; html: string } }, callback: (error: Error | null, info: { accepted: string[]; rejected: string[] }) => void): void };
    };
    const original = SMTP.prototype.send; let accepted = false;
    SMTP.prototype.send = (mail, callback) => {
      assert.equal(mail.data.to, "admin@example.test"); assert.match(mail.data.html, /Ürün hasarlı/);
      callback(null, { accepted: accepted ? [mail.data.to] : [], rejected: accepted ? [] : [mail.data.to] });
    };
    try {
      const message = payload("opening").messages[0];
      const params = { type: "dispute_notice" as const, to: message.to, orderNumber: message.orderNumber,
        customerName: message.customerName, disputeNotice: message };
      await assert.rejects(sendEmail(params), /not accepted by SMTP/); accepted = true; await sendEmail(params);
    } finally { SMTP.prototype.send = original; }
  });
  await test("production SQL changes only its phase and fences every delivery write without filtering closed disputes", async () => {
    // Real Drizzle SQL, fake pg/queue/provider only: no socket or runtime rows.
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const require = createRequire(import.meta.url), saved = new Map<string, NodeJS.Module | undefined>();
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const smtp: string[] = [];
    const client = { query: async (config: { text: string }, values: unknown[]) => {
      const text = config.text; queries.push({ text, values });
      const phase = text.includes('"opening_email_state"') ? "opening" : "decision";
      if (text.startsWith("select")) return { rows: [] };
      assert.match(text, /^update "disputes" set /);
      const [set, where] = text.split(" where "); assert.ok(where);
      const other = phase === "opening" ? "decision" : "opening";
      assert.doesNotMatch(set, new RegExp(`"${other}_email_`));
      assert.doesNotMatch(set, /"(?:status|resolution|resolved_at|refund_record_id|decision_snapshot)"/);
      assert.doesNotMatch(where, /"status"/);
      assert.match(where, /"disputes"\."id" = \$/);
      if (text.includes(`returning "${phase}_email_payload"`)) {
        assert.ok(values.includes("pending") && values.includes("delivering"));
        assert.match(where, new RegExp(`"${phase}_email_lease_until" <= \\$`));
        return { rows: [[payload(phase), {}]] };
      }
      assert.ok(values.includes("delivering"));
      assert.match(where, new RegExp(`"${phase}_email_lease_until" = \\$`));
      assert.match(where, new RegExp(`"${phase}_email_lease_until" > \\$`));
      return { rows: [[id]] };
    } };
    const stub = (path: string, exports: unknown) => {
      const filename = require.resolve(path); saved.set(filename, require.cache[filename]);
      require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module;
    };
    try {
      stub("../src/lib/db", { db: drizzle(client as unknown as import("pg").Pool) });
      stub("../src/lib/queue/queues", { getEmailQueue: () => ({}) });
      stub("../src/lib/services/email", { sendEmail: async (params: { to: string; disputeNotice: { kind: string } }) => {
        smtp.push(`${params.disputeNotice.kind}:${params.to}`);
      } });
      await deliverDisputeNotices(id, "opening"); await deliverDisputeNotices(id, "decision");
      await recoverDisputeNotices();
      assert.deepEqual(smtp, ["opening:admin@example.test", "decision:customer@example.test"]);
      assert.equal(queries.filter((query) => query.text.startsWith("update")).length, 8);
      assert.equal(queries.filter((query) => query.text.startsWith("select")).length, 2);
    } finally {
      for (const [filename, prior] of saved) {
        if (prior) require.cache[filename] = prior; else delete require.cache[filename];
      }
    }
  });
  console.log(`${count} dispute notice checks passed (fake DB, queue and provider only)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
