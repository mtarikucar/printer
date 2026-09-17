import assert from "node:assert/strict";
import { createRefundRecordAnalyticsLane, type RefundAnalyticsStore, type RefundAnalyticsProgress,
  type RefundAnalyticsRecord, type RefundAnalyticsQueue } from "../src/lib/services/refund-record-analytics";
import { persistRefundAnalyticsEvent, deliverRefundAnalyticsGA4 } from "../src/lib/analytics/server";

const id = "00000000-0000-4000-8000-000000000001";
const allocationId = "00000000-0000-4000-8000-000000000002";
const orderId = "00000000-0000-4000-8000-000000000003";
const source = () => ({ analytics: { version: 1, orders: [{ orderId, orderNumber: "ORD-1",
  userId: null, productId: null, purchaseBasisKurus: 11000,
  attribution: { visitorId: "captured-visitor", consent: { analytics: true, marketing: false } },
}] } });
function fixture() {
  let now = new Date("2026-09-17T12:00:00Z");
  const record: RefundAnalyticsRecord = { kind: "refund", sourceSnapshot: source(), analyticsProgress: {},
    allocations: [{ id: allocationId, orderId, cashKurus: 3000, giftKurus: 0, analyticsGrossKurus: 3300 }] };
  let state = "pending";
  let token: string | null = null;
  let until = now;
  let next = now;
  let dbDown = false;
  let crash = false;
  let failLocal = false;
  let failGA4 = false;
  let failGA4Event: string | undefined;
  let afterPersist: (() => void) | undefined;
  let queued = 0;
  let queueDown = false;
  let jobState: string | null = null;
  let lastError: string | null = null;
  const persisted: string[] = [];
  const forwarded: string[] = [];
  const values: number[] = [];
  const due = () => state === "pending" && next <= now && (!token || until <= now);
  const owns = (owner: string) => {
    if (dbDown) throw new Error("DB unavailable");
    return state === "pending" && owner === token && until > now;
  };
  const store: RefundAnalyticsStore = {
    async claim(_id, owner, _at, leaseUntil) {
      if (!due()) return null;
      token = owner; until = leaseUntil; return structuredClone(record);
    },
    async checkpoint(_id, owner, progress, _at, leaseUntil) {
      if (!owns(owner)) return false;
      record.analyticsProgress = structuredClone(progress); until = leaseUntil; return true;
    },
    async finish(_id, owner, progress, _at, finalState) {
      if (!owns(owner)) return false;
      record.analyticsProgress = structuredClone(progress); state = finalState; token = null; lastError = null; return true;
    },
    async retry(_id, owner, progress, _at, retryAt, error) {
      if (!owns(owner)) return false;
      record.analyticsProgress = structuredClone(progress); token = null; next = retryAt; lastError = error; return true;
    },
    async findDue() { return due() ? [id] : []; },
  };
  const queue: RefundAnalyticsQueue = {
    async getJob(jobId) {
      assert.equal(jobId, `refund-analytics-${id}`);
      if (queueDown) throw new Error("Redis unavailable");
      return jobState ? { async getState() { return jobState!; }, async remove() { jobState = null; } } : undefined;
    },
    async add(name, data, opts) {
      assert.equal(name, "refund_record_analytics");
      assert.deepEqual(data, { type: "refund_record_analytics", refundId: id });
      assert.equal(opts.jobId, `refund-analytics-${id}`); queued++; jobState = "waiting";
    },
  };
  const lane = createRefundRecordAnalyticsLane({ store, queue, now: () => now, report: () => {},
    persist: async (event) => {
      if (failLocal) throw new Error("first party unavailable");
      persisted.push(event.eventId); values.push(event.valueKurus);
      afterPersist?.();
    },
    forward: async (event) => {
      // Fake adapter models GA4 transport; consent must be enforced by the lane.
      assert.equal(event.attribution?.consent?.analytics, true);
      if (failGA4 || event.eventId === failGA4Event) throw new Error("GA4 unavailable");
      forwarded.push(event.eventId);
      if (crash) { crash = false; dbDown = true; }
      return "accepted";
    },
  });
  return { record, lane, persisted, forwarded, values, progress: () => record.analyticsProgress as RefundAnalyticsProgress,
    state: () => state, error: () => lastError, queued: () => queued,
    advance: () => { now = new Date(now.getTime() + 10 * 60_000); },
    failLocal: (value: boolean) => { failLocal = value; }, failGA4: (value: boolean) => { failGA4 = value; },
    failGA4Event: (value: string | undefined) => { failGA4Event = value; },
    afterPersist: (callback: () => void) => { afterPersist = callback; },
    queueDown: (value: boolean) => { queueDown = value; }, job: (value: string) => { jobState = value; },
    crash: () => { crash = true; }, restore: () => { dbDown = false; },
    steal: () => { token = "new-owner"; },
  };
}

async function main() {
  let checks = 0;
  const test = async (name: string, run: () => unknown) => { await run(); checks++; console.log(`PASS ${name}`); };
  await test("allocation event uses committed gross unchanged and does not reuse order event ID", async () => {
    const f = fixture(); await f.lane.deliver(id);
    assert.deepEqual(f.persisted, [`refund:${id}:${allocationId}`]);
    assert.deepEqual(f.forwarded, f.persisted); assert.deepEqual(f.values, [3300]); assert.equal(f.state(), "recorded");
    await f.lane.deliver(id); assert.equal(f.persisted.length, 1);
  });
  await test("failed GA4 remains pending and retries without repeating first-party persistence", async () => {
    const f = fixture(); f.failGA4(true); await assert.rejects(f.lane.deliver(id), /GA4 unavailable/);
    assert.equal(f.state(), "pending"); assert.match(f.error()!, /GA4/);
    assert.ok(f.progress().events[allocationId].persistedAt);
    assert.equal(f.progress().events[allocationId].ga4AcceptedAt, undefined);
    await f.lane.deliver(id); assert.equal(f.persisted.length, 1);
    f.failGA4(false); f.advance(); await f.lane.deliver(id);
    assert.equal(f.persisted.length, 1); assert.equal(f.forwarded.length, 1); assert.equal(f.state(), "recorded");
  });
  await test("failed first-party destination never forwards or marks recorded", async () => {
    const f = fixture(); f.failLocal(true); await assert.rejects(f.lane.deliver(id), /first party/);
    assert.equal(f.state(), "pending"); assert.equal(f.forwarded.length, 0);
  });
  await test("stored consent denial and missing consent forbid vendor delivery", async () => {
    for (const attribution of [null, {}, { consent: { analytics: false, marketing: true } }]) {
      const f = fixture(); const snapshot = source(); Object.assign(snapshot.analytics.orders[0], { attribution });
      f.record.sourceSnapshot = snapshot; await f.lane.deliver(id);
      assert.equal(f.persisted.length, 1); assert.equal(f.forwarded.length, 0);
      assert.equal(f.progress().events[allocationId].ga4NotRequired, "consent_denied"); assert.equal(f.state(), "recorded");
    }
  });
  await test("cancellation gift gets its exact gross event; zero-return cancellation emits nothing", async () => {
    const f = fixture(); f.record.kind = "cancellation";
    Object.assign(f.record.allocations[0], { cashKurus: 0, giftKurus: 500, analyticsGrossKurus: 550 });
    await f.lane.deliver(id); assert.deepEqual(f.values, [550]);
    const empty = fixture(); empty.record.kind = "cancellation";
    Object.assign(empty.record.allocations[0], { cashKurus: 0, giftKurus: 0, analyticsGrossKurus: 0 });
    await empty.lane.deliver(id); assert.equal(empty.persisted.length, 0); assert.equal(empty.state(), "not_required");
  });
  await test("missing purchase basis and legacy evidence never invent a refund event", async () => {
    const f = fixture(); const snapshot = source(); Object.assign(snapshot.analytics.orders[0], { purchaseBasisKurus: null });
    f.record.sourceSnapshot = snapshot; await f.lane.deliver(id);
    assert.equal(f.persisted.length, 0); assert.equal(f.progress().events[allocationId].skipped, "missing_purchase_basis");
    assert.equal(f.state(), "not_required");
    const legacy = fixture(); legacy.record.kind = "legacy_evidence"; await legacy.lane.deliver(id);
    assert.equal(legacy.persisted.length, 0); assert.equal(legacy.state(), "not_required");
  });
  await test("missing identity snapshot fails visibly instead of reporting delivered", async () => {
    const f = fixture(); f.record.sourceSnapshot = {};
    await assert.rejects(f.lane.deliver(id)); assert.equal(f.state(), "pending"); assert.equal(f.persisted.length, 0);
  });
  await test("concurrent workers hold one analytics lease independent of email", async () => {
    const f = fixture(); await Promise.all([f.lane.deliver(id), f.lane.deliver(id)]);
    assert.equal(f.persisted.length, 1); assert.equal(f.forwarded.length, 1);
  });
  await test("allocation progress skips accepted destinations when a later allocation fails", async () => {
    const f = fixture();
    const second = "00000000-0000-4000-8000-000000000004";
    const secondOrder = "00000000-0000-4000-8000-000000000005";
    f.record.allocations.push({ id: second, orderId: secondOrder, cashKurus: 0, giftKurus: 1000, analyticsGrossKurus: 1100 });
    const snapshot = source(); snapshot.analytics.orders.push({ ...snapshot.analytics.orders[0], orderId: secondOrder, orderNumber: "ORD-2" });
    f.record.sourceSnapshot = snapshot; f.failGA4Event(`refund:${id}:${second}`);
    await assert.rejects(f.lane.deliver(id));
    assert.deepEqual(f.values, [3300, 1100]); assert.equal(f.forwarded.length, 1);
    f.failGA4Event(undefined); f.advance(); await f.lane.deliver(id);
    assert.equal(f.persisted.length, 2); assert.deepEqual(f.forwarded, [`refund:${id}:${allocationId}`, `refund:${id}:${second}`]);
    assert.equal(f.state(), "recorded");
  });
  await test("missing purchase basis in a mixed record does not block the eligible allocation", async () => {
    const f = fixture(); const second = "00000000-0000-4000-8000-000000000004";
    const secondOrder = "00000000-0000-4000-8000-000000000005";
    f.record.allocations.push({ id: second, orderId: secondOrder, cashKurus: 1000, giftKurus: 0, analyticsGrossKurus: 0 });
    const snapshot = source(); snapshot.analytics.orders.push({ ...snapshot.analytics.orders[0], orderId: secondOrder, orderNumber: "ORD-2" });
    Object.assign(snapshot.analytics.orders[1], { purchaseBasisKurus: null });
    f.record.sourceSnapshot = snapshot; await f.lane.deliver(id);
    assert.equal(f.persisted.length, 1); assert.equal(f.state(), "recorded");
    assert.equal(f.progress().events[second].skipped, "missing_purchase_basis");
  });
  await test("a stale analytics worker cannot checkpoint over the new owner or start GA4", async () => {
    const f = fixture(); f.afterPersist(f.steal);
    await assert.rejects(f.lane.deliver(id), /lease lost/);
    assert.equal(f.persisted.length, 1); assert.equal(f.forwarded.length, 0);
    assert.equal(f.state(), "pending"); assert.equal(f.progress().events[allocationId].persistedAt, undefined);
  });
  await test("provider acceptance before checkpoint crash is at least once with stable event ID", async () => {
    const f = fixture(); f.crash(); await assert.rejects(f.lane.deliver(id), /DB unavailable/);
    assert.equal(f.state(), "pending"); f.restore(); await f.lane.deliver(id); assert.equal(f.forwarded.length, 1);
    f.advance(); await f.lane.recover(); assert.equal(f.queued(), 1); await f.lane.deliver(id);
    assert.equal(f.persisted.length, 1); assert.equal(f.forwarded.length, 2);
    assert.equal(f.forwarded[0], f.forwarded[1]); assert.equal(f.state(), "recorded");
  });
  await test("queue outage cannot fail committed refund; retained jobs are recovered", async () => {
    const f = fixture(); f.queueDown(true); await f.lane.kick(id); assert.equal(f.state(), "pending");
    f.queueDown(false); f.job("completed"); await f.lane.recover(); assert.equal(f.queued(), 1);
    await f.lane.recover(); assert.equal(f.queued(), 1);
  });
  await test("corrupt consent and progress fail visibly instead of clearing delivery evidence", async () => {
    const f = fixture(); const snapshot = source();
    Object.assign(snapshot.analytics.orders[0].attribution.consent, { analytics: "false" });
    f.record.sourceSnapshot = snapshot; await assert.rejects(f.lane.deliver(id));
    assert.equal(f.persisted.length, 0); assert.equal(f.forwarded.length, 0); assert.equal(f.state(), "pending");
    const corrupt = fixture(); corrupt.record.analyticsProgress = { version: 1, events: { [allocationId]: { persistedAt: "bad" } } };
    await assert.rejects(corrupt.lane.deliver(id));
    assert.equal(corrupt.progress().events[allocationId].persistedAt, "bad"); assert.equal(corrupt.persisted.length, 0);
  });
  await test("strict persistence helper propagates DB failure and uses supplied event identity", async () => {
    const event = { eventId: `refund:${id}:${allocationId}`, orderNumber: "ORD-1", valueKurus: 3300 };
    await assert.rejects(persistRefundAnalyticsEvent(event, async () => { throw new Error("DB rejected"); }), /DB rejected/);
    await persistRefundAnalyticsEvent(event, async (input) => {
      assert.equal(input.eventId, event.eventId); assert.equal(input.valueKurus, 3300); assert.equal(input.name, "refund");
    });
  });
  await test("strict GA4 accepts only success; no consent means no request; missing config stays pending", async () => {
    const event = { eventId: `refund:${id}:${allocationId}`, orderNumber: "ORD-1", valueKurus: 3300,
      attribution: source().analytics.orders[0].attribution };
    let requests = 0; let status = 503;
    const adapter = { measurementId: "fake-measurement", apiSecret: "fake-secret", request: async (_url: string, init: RequestInit) => {
      requests++; const body = JSON.parse(String(init.body));
      assert.equal(body.events[0].params.event_id, event.eventId);
      assert.equal(body.events[0].params.transaction_id, "ORD-1"); assert.equal(body.events[0].params.value, 33);
      return new Response(null, { status });
    } };
    await assert.rejects(deliverRefundAnalyticsGA4(event, adapter), /503/);
    status = 204; assert.equal(await deliverRefundAnalyticsGA4(event, adapter), "accepted");
    assert.equal(await deliverRefundAnalyticsGA4({ ...event, attribution: null }, adapter), "not_required");
    assert.equal(requests, 2);
    await assert.rejects(deliverRefundAnalyticsGA4(event, { ...adapter, apiSecret: "" }), /configuration/);
  });
  console.log(`${checks} refund analytics checks passed (fake DB, queue and provider only)`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
