import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  createRefundRecordNoticeLane,
  createRefundRecordChangePublisher,
  type RefundRecordChanges,
  type RefundNoticeStore,
  type RefundRecordEmailPayload,
  type RefundEmailProgress,
  type RefundNoticeQueue,
} from "../src/lib/services/refund-record-notices";
import { renderRefundRecordEmail, sendEmail } from "../src/lib/services/email";

const id = "00000000-0000-4000-8000-000000000001";
const payload = (): RefundRecordEmailPayload => ({ version: 1, messages: [
  { key: "customer-order1", to: "customer@example.test", orderNumber: "ORD-1", customerName: "Ada",
    notice: { kind: "actual_refund", cashKurus: 3000, giftKurus: 500 } },
  { key: "customer-order2", to: "second-customer@example.test", orderNumber: "ORD-2", customerName: "Grace",
    notice: { kind: "actual_refund", cashKurus: 3000, giftKurus: 500 } },
] });

function fixture() {
  let now = new Date("2026-09-17T12:00:00Z");
  const row = { id, emailPayload: payload() as unknown, emailProgress: {} as RefundEmailProgress,
    emailState: "pending", emailLeaseUntil: null as Date | null, emailNextAttemptAt: null as Date | null };
  const sent: string[] = [];
  let failRecipient = "";
  let dbDown = false;
  let crashAfterAccept = false;
  let afterSend: (() => void) | undefined;
  const due = () => row.emailState === "pending"
    ? !row.emailNextAttemptAt || row.emailNextAttemptAt <= now
    : row.emailState === "delivering" && !!row.emailLeaseUntil && row.emailLeaseUntil <= now;
  const owns = (lease: Date) => {
    if (dbDown) throw new Error("database unavailable");
    return row.emailState === "delivering" && row.emailLeaseUntil?.getTime() === lease.getTime() && lease > now;
  };
  const store: RefundNoticeStore = {
    async claim(_id, _now, until) {
      if (!due()) return null;
      row.emailState = "delivering"; row.emailLeaseUntil = until;
      return structuredClone({ emailPayload: row.emailPayload, emailProgress: row.emailProgress });
    },
    async checkpoint(_id, lease, progress, _now, until) {
      if (!owns(lease)) return false;
      row.emailProgress = structuredClone(progress); row.emailLeaseUntil = until; return true;
    },
    async finish(_id, lease) {
      if (!owns(lease)) return false;
      row.emailState = "delivered"; row.emailLeaseUntil = null; return true;
    },
    async retry(_id, lease, progress, _now, next) {
      if (!owns(lease)) return false;
      row.emailState = "pending"; row.emailProgress = structuredClone(progress);
      row.emailNextAttemptAt = next; row.emailLeaseUntil = null; return true;
    },
    async findDue() { return due() ? [id] : []; },
  };
  let queueDown = false;
  let queueHung = false;
  let jobState: string | null = null;
  let adds = 0;
  const queue: RefundNoticeQueue = {
    async getJob(jobId) {
      assert.equal(jobId, `refund-email-${id}`);
      if (queueHung) return new Promise<never>(() => {});
      if (queueDown) throw new Error("redis unavailable");
      return jobState ? {
        async getState() { return jobState!; },
        async remove() { jobState = null; },
      } : undefined;
    },
    async add(name, data, options) {
      if (queueDown) throw new Error("redis unavailable");
      assert.equal(name, "refund_record_email");
      assert.deepEqual(data, { type: "refund_record_email", refundId: id });
      assert.equal(options.jobId, `refund-email-${id}`);
      adds++; jobState = "waiting";
    },
  };
  const lane = createRefundRecordNoticeLane({ store, queue, now: () => now,
    report: () => {},
    send: async (message) => {
      if (message.to === failRecipient) throw new Error("SMTP rejected");
      sent.push(message.to);
      afterSend?.();
      if (crashAfterAccept) { dbDown = true; crashAfterAccept = false; }
    },
  });
  return { row, sent, lane,
    advance: (ms = 10 * 60_000) => { now = new Date(now.getTime() + ms); },
    afterSend: (callback: () => void) => { afterSend = callback; },
    fail: (recipient: string) => { failRecipient = recipient; },
    crash: () => { crashAfterAccept = true; },
    restoreDb: () => { dbDown = false; },
    queueDown: (value: boolean) => { queueDown = value; },
    hangQueue: () => { queueHung = true; },
    job: (state: string) => { jobState = state; }, adds: () => adds,
  };
}

function realtimeFixture() {
  const manufacturerId = "00000000-0000-4000-8000-000000000011";
  const painterId = "00000000-0000-4000-8000-000000000012";
  const userId = "00000000-0000-4000-8000-000000000013";
  const record: RefundRecordChanges = { kind: "cancellation", orders: [{
    current: { orderId: id, orderNumber: "ORD-1", userId, manufacturerId: null, painterId: null,
      status: "rejected", manufacturerStatus: "unassigned", painterStatus: "unassigned" },
    basisSnapshot: { manufacturerId, painterId, before: { status: "printing", paymentStatus: "succeeded" },
      after: { status: "rejected", paymentStatus: "succeeded" } },
  }] };
  const changed: Array<RefundRecordChanges["orders"][number]["current"]> = [];
  const bells: string[] = [];
  let failRead = false;
  let failEvent = false;
  let loadOverride: (() => Promise<RefundRecordChanges | null>) | undefined;
  const publish = createRefundRecordChangePublisher({
    load: async (refundId) => {
      assert.equal(refundId, id);
      if (failRead) throw new Error("DB unavailable");
      return loadOverride ? loadOverride() : structuredClone(record);
    },
    emitOrderChanged: async (event) => { changed.push(event); if (failEvent) throw new Error("Redis unavailable"); },
    emitCustomerNotification: async (recipient) => { bells.push(`customer:${recipient}`); },
    emitManufacturerNotification: async (recipient) => { bells.push(`manufacturer:${recipient}`); },
    emitPainterNotification: async (recipient) => { bells.push(`painter:${recipient}`); },
    report: () => {},
  });
  return { record, changed, bells, publish, manufacturerId, painterId, userId,
    failRead: () => { failRead = true; }, failEvent: () => { failEvent = true; },
    load: (override: () => Promise<RefundRecordChanges | null>) => { loadOverride = override; },
  };
}

async function main() {
  let checks = 0;
  const test = async (name: string, run: () => unknown) => { await run(); checks++; console.log(`PASS ${name}`); };
  await test("queue outage after commit resolves; recovery queues the durable record", async () => {
    const f = fixture(); f.queueDown(true); await f.lane.kick(id);
    assert.equal(f.row.emailState, "pending"); f.queueDown(false);
    await f.lane.recover(); assert.equal(f.adds(), 1);
    await f.lane.recover(); assert.equal(f.adds(), 1);
  });
  await test("a stalled queue cannot keep the committed refund kick waiting indefinitely", async () => {
    const f = fixture(); f.hangQueue();
    const before = Date.now(); await f.lane.kick(id);
    assert.ok(Date.now() - before < 3_000); assert.equal(f.row.emailState, "pending");
  });
  await test("recovery reports an unavailable queue without discarding pending intent", async () => {
    const f = fixture(); f.queueDown(true);
    await assert.rejects(f.lane.recover(), /could not queue/);
    assert.equal(f.row.emailState, "pending"); assert.equal(f.sent.length, 0);
  });
  await test("recovery replaces completed/failed jobs and preserves active jobs", async () => {
    for (const state of ["completed", "failed", "active", "delayed", "waiting"]) {
      const f = fixture(); f.job(state); await f.lane.recover();
      assert.equal(f.adds(), ["completed", "failed"].includes(state) ? 1 : 0);
    }
  });
  await test("partial failure retries only the unaccepted recipient", async () => {
    const f = fixture(); f.fail("second-customer@example.test");
    await assert.rejects(f.lane.deliver(id), /SMTP rejected/);
    assert.equal(f.row.emailState, "pending");
    assert.ok(f.row.emailProgress["customer-order1"].acceptedAt);
    assert.equal(f.row.emailProgress["customer-order2"].attempts, 1);
    assert.match(f.row.emailProgress["customer-order2"].error!, /SMTP rejected/);
    await f.lane.deliver(id); assert.equal(f.sent.length, 1); // not due
    f.advance(); f.fail(""); await f.lane.deliver(id);
    assert.deepEqual(f.sent, ["customer@example.test", "second-customer@example.test"]);
    assert.equal(f.row.emailState, "delivered");
    await f.lane.deliver(id); assert.equal(f.sent.length, 2);
  });
  await test("concurrent deliveries use one record lease", async () => {
    const f = fixture(); await Promise.all([f.lane.deliver(id), f.lane.deliver(id)]);
    assert.equal(f.sent.length, 2); assert.equal(f.row.emailState, "delivered");
  });
  await test("recipient checkpoints renew the lease for batches longer than one lease", async () => {
    const f = fixture(); f.afterSend(() => f.advance(4 * 60_000));
    await f.lane.deliver(id); assert.equal(f.row.emailState, "delivered"); assert.equal(f.sent.length, 2);
  });
  await test("a stale worker cannot stamp acceptance or release a newer lease", async () => {
    const f = fixture();
    f.afterSend(() => {
      f.advance(); f.row.emailLeaseUntil = new Date("2026-09-17T12:15:00Z");
      f.row.emailProgress = { "customer-order1": { attempts: 9 } };
    });
    await assert.rejects(f.lane.deliver(id), /lease lost/);
    assert.equal(f.row.emailState, "delivering"); assert.equal(f.sent.length, 1);
    assert.equal(f.row.emailLeaseUntil?.toISOString(), "2026-09-17T12:15:00.000Z");
    assert.deepEqual(f.row.emailProgress, { "customer-order1": { attempts: 9 } });
  });
  await test("all recipients already accepted completes without sending again", async () => {
    const f = fixture();
    f.row.emailProgress = {
      "customer-order1": { attempts: 1, acceptedAt: "2026-09-17T11:00:00.000Z" },
      "customer-order2": { attempts: 2, acceptedAt: "2026-09-17T11:30:00.000Z" },
    };
    await f.lane.deliver(id); assert.equal(f.sent.length, 0); assert.equal(f.row.emailState, "delivered");
    await f.lane.recover(); assert.equal(f.adds(), 0);
  });
  await test("accepted then unstamped crash is explicitly at least once", async () => {
    const f = fixture(); f.crash(); await assert.rejects(f.lane.deliver(id), /database unavailable/);
    assert.equal(f.row.emailState, "delivering");
    assert.equal(f.row.emailProgress["customer-order1"].acceptedAt, undefined);
    f.restoreDb(); await f.lane.deliver(id); assert.equal(f.sent.length, 1);
    f.advance(); await f.lane.recover(); assert.equal(f.adds(), 1);
    await f.lane.deliver(id);
    assert.deepEqual(f.sent, ["customer@example.test", "customer@example.test", "second-customer@example.test"]);
    assert.equal(f.row.emailState, "delivered");
  });
  await test("not-required records never send", async () => {
    const f = fixture(); f.row.emailState = "not_required"; f.row.emailPayload = {};
    await f.lane.deliver(id); await f.lane.recover(); assert.equal(f.sent.length, 0); assert.equal(f.adds(), 0);
  });
  await test("invalid versions and duplicate message keys cannot silently complete", async () => {
    for (const bad of [{ version: 2, messages: payload().messages }, { version: 1, messages: [] },
      { version: 1, messages: [payload().messages[0], payload().messages[0]] }]) {
      const f = fixture(); f.row.emailPayload = bad;
      await assert.rejects(f.lane.deliver(id)); assert.equal(f.sent.length, 0);
      assert.notEqual(f.row.emailState, "delivered");
    }
  });
  await test("corrupt progress is never reset into duplicate delivery", async () => {
    const f = fixture(); Object.assign(f.row.emailProgress, { "customer-order1": { acceptedAt: "bad-date" } });
    await assert.rejects(f.lane.deliver(id)); assert.equal(f.sent.length, 0);
    assert.equal(f.row.emailProgress["customer-order1"].acceptedAt, "bad-date");
  });
  await test("templates distinguish actual cash/gift, pending cash, unknown and no collection; escape text", () => {
    const base = payload().messages[0];
    const actual = renderRefundRecordEmail({ ...base, locale: "en" });
    assert.match(actual.html, /30[.,]00/); assert.match(actual.html, /5[.,]00/);
    const gift = renderRefundRecordEmail({ ...base, locale: "en", notice: { kind: "actual_refund", cashKurus: 0, giftKurus: 500 } });
    assert.doesNotMatch(gift.html, /cash refund|business days|bank account/i);
    const cancelled = renderRefundRecordEmail({ ...base, customerName: "<script>", locale: "en",
      notice: { kind: "cancellation", giftKurus: 500, cashRefundRequiredKurus: 8000 } });
    assert.match(cancelled.html, /pending/i); assert.match(cancelled.html, /80[.,]00/);
    assert.match(cancelled.html, /&lt;script&gt;/); assert.doesNotMatch(cancelled.html, /<script>|business days/i);
    const unknown = renderRefundRecordEmail({ ...base, locale: "en",
      notice: { kind: "cancellation", giftKurus: 0, cashRefundRequiredKurus: null, giftReturnBlockedReason: "<unknown>" } });
    assert.match(unknown.html, /reconciliation/i); assert.match(unknown.html, /&lt;unknown&gt;/);
    const unpaid = renderRefundRecordEmail({ ...base, locale: "en", notice: { kind: "no_collection" } });
    assert.match(unpaid.html, /no .*collection/i); assert.doesNotMatch(unpaid.html, /refund completed/i);
    const turkish = renderRefundRecordEmail({ ...base, locale: "tr",
      notice: { kind: "cancellation", giftKurus: 500, cashRefundRequiredKurus: 8000 } });
    assert.match(turkish.html, /Bekleyen nakit iadesi/); assert.match(turkish.html, /geri yüklenen bakiye/);
    assert.doesNotMatch(turkish.html, /iş günü|hesabınıza ulaş/i);
  });
  await test("refund SMTP adapter requires recipient acceptance and uses the captured customer address", async () => {
    // Replace only SMTP I/O: exercise the real template and sendEmail branch.
    const SMTPTransport = createRequire(import.meta.url)("nodemailer/lib/smtp-transport") as {
      prototype: { send: (mail: { data: { to: string; html: string } },
        callback: (error: Error | null, info: { accepted: string[]; rejected: string[] }) => void) => void };
    };
    const original = SMTPTransport.prototype.send;
    let accept = false;
    SMTPTransport.prototype.send = (mail, callback) => {
      assert.equal(mail.data.to, "customer@example.test");
      assert.match(mail.data.html, /Gerçekleşen nakit iadesi/);
      callback(null, { accepted: accept ? [mail.data.to] : [], rejected: accept ? [] : [mail.data.to] });
    };
    try {
      const message = payload().messages[0];
      const params = { ...message, locale: "tr" as const, type: "refund_record_notice" as const, refundNotice: message.notice };
      await assert.rejects(sendEmail(params), /not accepted by SMTP/);
      accept = true; await sendEmail(params);
    } finally { SMTPTransport.prototype.send = original; }
  });
  await test("partner audiences receive stop-work instructions without customer refund claims", () => {
    for (const audience of ["manufacturer", "painter"] as const) {
      for (const notice of [payload().messages[0].notice,
        { kind: "cancellation" as const, giftKurus: 500, cashRefundRequiredKurus: 8000 }]) {
        const email = renderRefundRecordEmail({ ...payload().messages[0], locale: "en", audience, notice });
        assert.match(email.html, audience === "manufacturer" ? /Stop production/ : /Stop painting/);
        assert.match(email.html, /do not start a new shipment/);
        assert.doesNotMatch(email.html, /cash refund|gift credit|30[.,]00|5[.,]00|80[.,]00/i);
      }
    }
    const implicit = renderRefundRecordEmail(payload().messages[0]);
    const explicit = renderRefundRecordEmail({ ...payload().messages[0], audience: "customer" });
    assert.deepEqual(implicit, explicit);
  });
  await test("post-commit realtime reaches detached partners with current statuses and notification refreshes", async () => {
    const f = realtimeFixture(); await f.publish(id);
    assert.deepEqual(f.changed, [{ orderId: id, orderNumber: "ORD-1", userId: f.userId,
      manufacturerId: f.manufacturerId, painterId: f.painterId,
      status: "rejected", manufacturerStatus: "unassigned", painterStatus: "unassigned" }]);
    assert.deepEqual(f.bells.sort(), [`customer:${f.userId}`, `manufacturer:${f.manufacturerId}`, `painter:${f.painterId}`].sort());
    assert.equal(f.record.orders[0].current.manufacturerId, null); // read-only publisher
  });
  await test("partial refund refreshes current and former owners without inventing partner notifications", async () => {
    const f = realtimeFixture(); f.record.kind = "refund";
    f.record.orders[0].basisSnapshot = { manufacturerId: f.manufacturerId, painterId: f.painterId,
      after: { status: "printing", paymentStatus: "succeeded" } };
    const currentManufacturer = "00000000-0000-4000-8000-000000000014";
    const currentPainter = "00000000-0000-4000-8000-000000000015";
    Object.assign(f.record.orders[0].current, { status: "shipped", manufacturerId: currentManufacturer,
      manufacturerStatus: "shipped", painterId: currentPainter, painterStatus: "shipped" });
    await f.publish(id);
    assert.deepEqual(new Set(f.changed.map((event) => event.manufacturerId)), new Set([f.manufacturerId, currentManufacturer]));
    assert.deepEqual(new Set(f.changed.map((event) => event.painterId)), new Set([f.painterId, currentPainter]));
    assert.ok(f.changed.every((event) => event.status === "shipped" && event.manufacturerStatus === "shipped"));
    assert.deepEqual(f.bells, [`customer:${f.userId}`]);
  });
  await test("full return refreshes partner inboxes and replay rereads current state", async () => {
    const f = realtimeFixture(); f.record.kind = "refund";
    f.record.orders[0].basisSnapshot = { manufacturerId: f.manufacturerId, painterId: f.painterId,
      after: { status: "printing", paymentStatus: "refunded" } };
    f.record.orders[0].current.status = "delivered"; await f.publish(id);
    assert.equal(f.changed[0].status, "delivered"); assert.equal(f.bells.length, 3);
    f.record.orders[0].current.status = "rejected"; await f.publish(id);
    assert.equal(f.changed[1].status, "rejected");
  });
  await test("legacy evidence and missing records produce no realtime notices", async () => {
    const f = realtimeFixture(); f.record.kind = "legacy_evidence"; await f.publish(id);
    f.load(async () => null); await f.publish(id);
    assert.equal(f.changed.length, 0); assert.equal(f.bells.length, 0);
  });
  await test("realtime DB/event failures never reject committed success or block other refreshes", async () => {
    const db = realtimeFixture(); db.failRead(); await db.publish(id); assert.equal(db.changed.length, 0);
    const bus = realtimeFixture(); bus.failEvent();
    const result = { ok: true, refundId: id }; await bus.publish(id);
    assert.deepEqual(result, { ok: true, refundId: id }); assert.equal(bus.bells.length, 3);
  });
  await test("bounded realtime read cannot publish a stale snapshot after timeout", async () => {
    const f = realtimeFixture(); let release!: (record: RefundRecordChanges) => void;
    f.load(() => new Promise((resolve) => { release = resolve; }));
    const started = Date.now(); await f.publish(id); assert.ok(Date.now() - started < 3_000);
    release(f.record); await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.changed.length, 0); assert.equal(f.bells.length, 0);
  });
  console.log(`${checks} refund notice checks passed (fake DB, queue and email only)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
