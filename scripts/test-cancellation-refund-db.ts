/** QA 55433 only; up = exact disposable schema/fixtures, down = drop that schema. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";
import pg from "pg";

/** Fake external boundaries before importing application services. No Redis or SMTP. */
export function installCancellationTestIO() {
  const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  const sent: unknown[] = [];
  const queue = { add: async (...args: unknown[]) => { sent.push(args); return { id: "fake" }; },
    getJob: async () => null, remove: async () => {}, close: async () => {} };
  const noops = new Proxy({}, { get: (_target, key) => key === "then" ? undefined : async () => {} });
  loader._load = function(name, ...args) {
    if (name === "bullmq") return { Queue: class {
      add = queue.add;
      getJob = queue.getJob;
      remove = queue.remove;
      close = queue.close;
    } };
    const parentFile = (args[0] as { filename?: string } | undefined)?.filename ?? "";
    if (/\/queue\/connection(?:\.ts)?$/.test(name)
      || (name === "./connection" && parentFile.includes("/lib/queue/"))) {
      return { getRedisConnection: () => ({}) };
    }
    if (/\/realtime\/(?:bus|emit)(?:\.ts)?$/.test(name) || /\/analytics\/server(?:\.ts)?$/.test(name)) return noops;
    if (name === "nodemailer") return { createTransport: () => ({ sendMail: async (mail: unknown) => {
      sent.push(mail); return { messageId: "fake" };
    } }) };
    return original.call(this, name, ...args);
  };
  return { sent, restore: () => { loader._load = original; } };
}

async function main() {
  const connectionString = process.env.QA_MONEY_PG_URL;
  if (!connectionString) throw new Error("QA_MONEY_PG_URL required");
  const url = new URL(connectionString);
  if (url.hostname !== "127.0.0.1" || url.port !== "55433") throw new Error("Refusing non-QA database");
  const namespace = `cancellation_${randomUUID().replaceAll("-", "")}`;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cancellation-ddl-"));
  const admin = new pg.Client({ connectionString });
  const io = installCancellationTestIO();
  let pool: pg.Pool | undefined;
  let checks = 0;
  let failed = 0;
  let connected = false;
  try {
    await admin.connect();
    connected = true;
    execFileSync("npx", ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"], {
      env: { ...process.env, SCRATCH_OUT: out }, stdio: "pipe",
    });
    const ddl = fs.readFileSync(path.join(out, fs.readdirSync(out).find(f => f.endsWith(".sql"))!), "utf8").replace(/"public"\./g, "");
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await admin.query(`SET search_path TO ${namespace}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter(s => s.trim())) await admin.query(statement);
    url.searchParams.set("options", `-c search_path=${namespace}`);
    process.env.DATABASE_URL = url.toString();
    const service = await import("../src/lib/services/order-refund-record");
    const workshop = await import("../src/lib/services/workshop-cancel");
    const { workshopCancellationMoneyHtml } = await import("../src/lib/services/workshop-notify");
    const { db } = await import("../src/lib/db");
    pool = (db as unknown as { $client: pg.Pool }).$client;
    const actor = { adminEmail: "admin@test.invalid" };
    const user = (await admin.query("INSERT INTO users(email,full_name) VALUES('cancel@test.invalid','Cancel Test') RETURNING id")).rows[0].id;
    const venue = (await admin.query(`INSERT INTO workshop_venues(name,contact_name,contact_email,contact_phone,address)
      VALUES('QA venue','QA','venue@test.invalid','+905000000000','{}') RETURNING id`)).rows[0].id;
    const session = async (status = "open") => (await admin.query(`INSERT INTO workshop_sessions(venue_id,starts_at,capacity,booked_count,join_token,join_closes_at,deliver_by,price_per_seat_kurus,status)
      VALUES($1,now()+interval '20 days',10,1,$2,now()+interval '10 days',now()+interval '19 days',10000,$3) RETURNING id`, [venue, randomUUID(), status])).rows[0].id as string;
    const order = async (sessionId: string | null = null, gift = 0, status = "approved") => (await admin.query(`INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,gift_card_amount_kurus,workshop_session_id,paid_at)
      VALUES($1,$2,'cancel@test.invalid','Cancel Test','{}','bank_transfer',$3,10000,$4,$5,now()-interval '1 day') RETURNING id`, [randomUUID(),user,status,gift,sessionId])).rows[0].id as string;
    const participant = async (sessionId: string, orderId: string) => (await admin.query(`INSERT INTO workshop_participants(session_id,order_id,full_name,email,phone,photo_key,kvkk_consent_at,content_consent_at,status)
      VALUES($1,$2,'Cancel Test','cancel@test.invalid','+905000000000','test.jpg',now(),now(),'paid') RETURNING id`,[sessionId,orderId])).rows[0].id as string;
    const giftFor = async (orderId: string, amount: number) => {
      const card = (await admin.query("INSERT INTO gift_cards(code,amount_kurus,balance_kurus,expires_at) VALUES($1,$2,0,now()+interval '1 year') RETURNING id", [randomUUID(),amount])).rows[0].id;
      await admin.query("INSERT INTO gift_card_redemptions(gift_card_id,order_id,amount_kurus,redeemed_by_user_id) VALUES($1,$2,$3,$4)",[card,orderId,amount,user]);
      return card;
    };
    const cancelInput = async (orderId: string) => ({ orderId, operationKey: randomUUID(), expectedFingerprint: (await service.readOrderRefundView(orderId)).expectedFingerprint,
      source: "admin_reject" as const, reason: "Customer requested cancellation" });
    const state = async (id: string) => (await admin.query("SELECT status,payment_status,manufacturer_id,painter_id FROM orders WHERE id=$1",[id])).rows[0];
    const seatCount = async (id: string) => (await admin.query("SELECT booked_count FROM workshop_sessions WHERE id=$1",[id])).rows[0].booked_count;
    const test = async (name: string, run: () => Promise<void>) => {
      try { await run(); checks++; console.log(`PASS ${name}`); }
      catch (error) { failed++; console.error(`FAIL ${name}`, error); }
    };

    await test("reject closes fulfillment, restores only residual gift, leaves cash collected", async () => {
      const id = await order(null,2000), card = await giftFor(id,2000);
      const partial = await service.recordOrderRefund({ operationKey: randomUUID(), expectedFingerprint: (await service.readOrderRefundView(id)).expectedFingerprint,
        mode: "actual", allocations: [{orderId:id,cashKurus:0,giftKurus:500}], reason:"Partial gift return before cancellation" },actor);
      assert.ok(partial.ok,JSON.stringify(partial));
      const input = await cancelInput(id), first = await service.cancelPaidOrder(input,actor);
      assert.ok(first.ok,JSON.stringify(first)); assert.equal(first.giftReturnedKurus,1500); assert.equal(first.cashRefundRequiredKurus,8000);
      assert.deepEqual(await state(id),{status:"rejected",payment_status:"succeeded",manufacturer_id:null,painter_id:null});
      const again = await service.cancelPaidOrder(input,actor); assert.ok(again.ok); assert.equal(again.replayed,true);
      assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,2000);
      const allocation = (await admin.query("SELECT cash_kurus,gift_kurus FROM order_refund_allocations WHERE order_id=$1 AND kind='cancellation'",[id])).rows;
      assert.deepEqual(allocation,[{cash_kurus:0,gift_kurus:1500}]);
    });
    await test("admin rejection status is checked under lock after the caller snapshot", async () => {
      const id = await order(), input = await cancelInput(id);
      await admin.query("UPDATE orders SET status='shipped' WHERE id=$1",[id]);
      const result = await service.cancelPaidOrder(input,actor); assert.ok(!result.ok);
      const fresh = await service.cancelPaidOrder(await cancelInput(id),actor); assert.ok(!fresh.ok);
      assert.equal((await state(id)).status,"shipped");
    });
    await test("paid participant cancellation and seat release are atomic and repeat once", async () => {
      const sid = await session(), oid = await order(sid), pid = await participant(sid,oid);
      const first = await workshop.cancelWorkshopParticipant({ sessionId:sid,participantId:pid,...actor });
      assert.ok(first.ok,JSON.stringify(first)); assert.equal(first.seatReleased,true); assert.equal(await seatCount(sid),0);
      assert.equal(first.refundRequiredOrders[0].cashRemainingKurus,10000);
      const again = await workshop.cancelWorkshopParticipant({ sessionId:sid,participantId:pid,...actor });
      assert.ok(again.ok); assert.equal(again.seatReleased,false); assert.equal(again.alreadyCancelled,true);
      assert.equal(again.refundRequiredOrders[0].cashRemainingKurus,10000); assert.equal(await seatCount(sid),0);
      assert.equal((await state(oid)).payment_status,"succeeded");
    });
    await test("seat failure rolls back cancellation header, gift, order, audit and participant", async () => {
      const sid = await session(), oid = await order(sid,2000), pid = await participant(sid,oid), card = await giftFor(oid,2000);
      const counts = async () => (await admin.query(`SELECT (SELECT count(*) FROM order_refund_records) headers,
        (SELECT count(*) FROM order_refund_allocations) allocations,(SELECT count(*) FROM gift_credit_returns) gift,
        (SELECT count(*) FROM admin_actions) audit,(SELECT count(*) FROM customer_notifications) notices`)).rows[0];
      const before = await counts();
      await admin.query(`CREATE FUNCTION fail_seat() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected seat failure'; END $$`);
      await admin.query(`CREATE TRIGGER fail_seat BEFORE UPDATE ON workshop_sessions FOR EACH ROW EXECUTE FUNCTION fail_seat()`);
      try {
        const result = await workshop.cancelWorkshopParticipant({ sessionId:sid,participantId:pid,...actor }); assert.ok(!result.ok);
        assert.deepEqual(await counts(),before); assert.equal((await state(oid)).status,"approved");
        assert.equal((await admin.query("SELECT status FROM workshop_participants WHERE id=$1",[pid])).rows[0].status,"paid");
        assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,0);
        assert.equal(await seatCount(sid),1);
      } finally { await admin.query("DROP TRIGGER fail_seat ON workshop_sessions"); await admin.query("DROP FUNCTION fail_seat()"); }
    });
    await test("admin cancellation replay still closes the paid participant seat", async () => {
      const sid = await session(), oid = await order(sid), pid = await participant(sid,oid);
      assert.ok((await service.cancelPaidOrder(await cancelInput(oid),actor)).ok);
      const result = await workshop.cancelWorkshopParticipant({ sessionId:sid,participantId:pid,...actor });
      assert.ok(result.ok,JSON.stringify(result)); assert.equal(result.seatReleased,true); assert.equal(await seatCount(sid),0);
    });
    await test("workshop replay refuses a recorded shipment under the backend order lock", async () => {
      const sid = await session(), oid = await order(sid), pid = await participant(sid,oid);
      assert.ok((await service.cancelPaidOrder(await cancelInput(oid),actor)).ok);
      await admin.query("UPDATE orders SET shipped_at=now() WHERE id=$1",[oid]);
      const result = await service.cancelPaidOrder({ ...await cancelInput(oid), source:"workshop_participant",
        workshop:{sessionId:sid,participantId:pid,releaseSeat:true} },actor);
      assert.ok(!result.ok,"Replay must check shippedAt before touching the seat"); assert.equal(await seatCount(sid),1);
      assert.equal((await admin.query("SELECT status FROM workshop_participants WHERE id=$1",[pid])).rows[0].status,"paid");
    });
    await test("mismatched participant identity cannot cancel an unrelated order", async () => {
      const sid = await session(), oid = await order(sid), other = await order(sid), pid = await participant(sid,other);
      const result = await service.cancelPaidOrder({ ...await cancelInput(oid), source:"workshop_participant",
        workshop:{sessionId:sid,participantId:pid,releaseSeat:true} },actor);
      assert.ok(!result.ok); assert.equal((await state(oid)).status,"approved"); assert.equal(await seatCount(sid),1);
    });
    await test("concurrent participant cancellation releases one seat and records one cancellation", async () => {
      const sid = await session(), oid = await order(sid,2000), pid = await participant(sid,oid), card = await giftFor(oid,2000);
      const input = {sessionId:sid,participantId:pid,...actor};
      const outcomes = await Promise.all([workshop.cancelWorkshopParticipant(input),workshop.cancelWorkshopParticipant(input)]);
      assert.ok(outcomes.every(result=>result.ok),JSON.stringify(outcomes));
      assert.equal(outcomes.filter(result=>result.ok && result.seatReleased).length,1); assert.equal(await seatCount(sid),0);
      assert.equal((await admin.query("SELECT count(*)::int n FROM order_refund_allocations WHERE order_id=$1 AND kind='cancellation'",[oid])).rows[0].n,1);
      assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,2000);
    });
    await test("session-first close contention returns busy without waiting and rolls back cancellation", async () => {
      const sid = await session(), oid = await order(sid,2000), pid = await participant(sid,oid), card = await giftFor(oid,2000);
      const mfg = (await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone,status) VALUES($1,'x','QA','QA','+905000000000','active') RETURNING id",[randomUUID()+"@test.invalid"])).rows[0].id;
      await admin.query("UPDATE orders SET manufacturer_id=$1,manufacturer_status='accepted' WHERE id=$2",[mfg,oid]);
      await admin.query("INSERT INTO manufacturer_earnings(order_id,manufacturer_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps) VALUES($1,$2,10000,4000,6000,4000)",[oid,mfg]);
      const input = { ...await cancelInput(oid), source:"workshop_participant" as const,
        workshop:{sessionId:sid,participantId:pid,releaseSeat:true} };
      const snapshot = async () => (await admin.query(`SELECT
        (SELECT count(*) FROM order_refund_records) headers,
        (SELECT count(*) FROM order_refund_allocations) allocations,
        (SELECT count(*) FROM gift_credit_returns) returns,
        (SELECT count(*) FROM admin_actions) audit,
        (SELECT count(*) FROM customer_notifications) notices,
        (SELECT balance_kurus FROM gift_cards WHERE id=$1) balance,
        (SELECT status FROM manufacturer_earnings WHERE order_id=$2) earning_status,
        (SELECT status FROM workshop_participants WHERE id=$3) participant_status`,[card,oid,pid])).rows[0];
      const before = await snapshot();
      await admin.query("BEGIN");
      let attempt: ReturnType<typeof service.cancelPaidOrder> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // closeSession owns session first, then writes its orders. Keep that
        // session lock held until cancellation has finished, not just started.
        await admin.query("UPDATE workshop_sessions SET status='closed' WHERE id=$1",[sid]);
        attempt = service.cancelPaidOrder(input,actor);
        const result = await Promise.race([attempt, new Promise<"waiting">(resolve => {
          timer = setTimeout(() => resolve("waiting"),2000);
        })]);
        assert.notEqual(result,"waiting","Cancellation waited on session while holding its order lock");
        assert.ok(typeof result === "object" && !result.ok,JSON.stringify(result));
        assert.equal(result.code,"busy"); assert.equal(result.status,409);
        assert.deepEqual(await snapshot(),before);
        assert.equal((await state(oid)).status,"approved");
        assert.equal((await state(oid)).manufacturer_id,mfg);
        assert.equal(await seatCount(sid),1);
        const caller = await workshop.cancelWorkshopParticipant({sessionId:sid,participantId:pid,...actor});
        assert.ok(!caller.ok); assert.equal(caller.reason,"busy");
        // No cancellation order lock survives rollback: the session owner can
        // finish its order write without becoming the other half of a deadlock.
        await admin.query("SET LOCAL lock_timeout='500ms'");
        await admin.query("UPDATE orders SET updated_at=updated_at WHERE id=$1",[oid]);
        await admin.query("COMMIT");
      } finally {
        if (timer) clearTimeout(timer);
        await admin.query("ROLLBACK");
        await attempt;
      }
      const retried = await workshop.cancelWorkshopParticipant({sessionId:sid,participantId:pid,...actor});
      assert.ok(retried.ok,JSON.stringify(retried)); assert.equal(retried.seatReleased,false);
      assert.equal(await seatCount(sid),1); // the close committed; no open seat pool
      assert.equal((await state(oid)).status,"rejected");
      assert.equal((await state(oid)).payment_status,"succeeded");
      assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,2000);
    });
    await test("late audit failure rolls back money writes, pending reversal and seat together", async () => {
      const sid = await session(), oid = await order(sid,2000), pid = await participant(sid,oid), card = await giftFor(oid,2000);
      const mfg = (await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone,status) VALUES($1,'x','QA','QA','+905000000000','active') RETURNING id",[randomUUID()+"@test.invalid"])).rows[0].id;
      await admin.query("UPDATE orders SET manufacturer_id=$1,manufacturer_status='accepted' WHERE id=$2",[mfg,oid]);
      await admin.query("INSERT INTO manufacturer_earnings(order_id,manufacturer_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps) VALUES($1,$2,10000,4000,6000,4000)",[oid,mfg]);
      await admin.query(`CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$`);
      await admin.query(`CREATE TRIGGER fail_audit BEFORE INSERT ON admin_actions FOR EACH ROW EXECUTE FUNCTION fail_audit()`);
      try {
        const result = await workshop.cancelWorkshopParticipant({sessionId:sid,participantId:pid,...actor}); assert.ok(!result.ok);
        assert.equal((await state(oid)).status,"approved"); assert.equal((await state(oid)).manufacturer_id,mfg);
        assert.equal((await admin.query("SELECT status FROM manufacturer_earnings WHERE order_id=$1",[oid])).rows[0].status,"pending");
        assert.equal((await admin.query("SELECT status FROM workshop_participants WHERE id=$1",[pid])).rows[0].status,"paid");
        assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,0);
        assert.equal((await admin.query("SELECT count(*)::int n FROM order_refund_allocations WHERE order_id=$1",[oid])).rows[0].n,0);
        assert.equal(await seatCount(sid),1);
      } finally { await admin.query("DROP TRIGGER fail_audit ON admin_actions"); await admin.query("DROP FUNCTION fail_audit()"); }
    });
    await test("paid partner history remains immutable while pending original earnings reverse", async () => {
      const mfg = (await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone,status) VALUES($1,'x','QA','QA','+905000000000','active') RETURNING id",[randomUUID()+"@test.invalid"])).rows[0].id;
      for (const status of ["paid","pending"] as const) {
        const oid = await order();
        await admin.query("UPDATE orders SET manufacturer_id=$1,manufacturer_status='accepted' WHERE id=$2",[mfg,oid]);
        const earning = (await admin.query("INSERT INTO manufacturer_earnings(order_id,manufacturer_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps,status) VALUES($1,$2,10000,4000,6000,4000,$3) RETURNING *",[oid,mfg,status])).rows[0];
        const result = await service.cancelPaidOrder(await cancelInput(oid),actor); assert.ok(result.ok,JSON.stringify(result));
        const after = (await admin.query("SELECT * FROM manufacturer_earnings WHERE id=$1",[earning.id])).rows[0];
        if (status === "paid") assert.deepEqual(after,earning); else assert.equal(after.status,"reversed");
        assert.equal((await state(oid)).payment_status,"succeeded"); assert.equal((await state(oid)).manufacturer_id,null);
      }
    });
    await test("bulk retry shows current residual cash after an actual partial return", async () => {
      const sid = await session(), oid = await order(sid); await participant(sid,oid);
      const first = await workshop.cancelWorkshopSession({ sessionId:sid,...actor }); assert.ok(first.ok); assert.equal(first.report.refundRequiredOrders[0].cashRemainingKurus,10000);
      const actual = await service.recordOrderRefund({ operationKey:randomUUID(), expectedFingerprint:(await service.readOrderRefundView(oid)).expectedFingerprint,
        mode:"actual",allocations:[{orderId:oid,cashKurus:3000,giftKurus:0}],reason:"Confirmed actual cash return",
        cashEvidence:{method:"bank_transfer",externalReference:randomUUID(),occurredAt:new Date().toISOString(),bankTransferCompleted:true}},actor);
      assert.ok(actual.ok,JSON.stringify(actual));
      const retry = await workshop.cancelWorkshopSession({ sessionId:sid,...actor }); assert.ok(retry.ok);
      assert.equal(retry.report.refundRequiredOrders[0].cashRemainingKurus,7000); assert.equal(retry.report.cancelled.length,0);
      assert.equal(retry.report.alreadyCancelled.length,1); assert.equal(retry.report.actualGiftReturnedKurus,0);
    });
    await test("shipped refusal and closed-session seat counts are preserved", async () => {
      const sid = await session("closed"), oid = await order(sid,0,"shipped"), pid = await participant(sid,oid);
      const shipped = await workshop.cancelWorkshopParticipant({ sessionId:sid,participantId:pid,...actor });
      assert.ok(!shipped.ok); assert.equal(shipped.reason,"already_shipped"); assert.equal(await seatCount(sid),1);
      const live = await order(sid), other = await participant(sid,live);
      const closed = await workshop.cancelWorkshopParticipant({ sessionId:sid,participantId:other,...actor });
      assert.ok(closed.ok); assert.equal(closed.seatReleased,false); assert.equal(await seatCount(sid),1);
    });
    await test("ambiguous gift evidence remains an obligation and never invents balance", async () => {
      const sid = await session(), oid = await order(sid,2000), pid = await participant(sid,oid);
      const result = await workshop.cancelWorkshopParticipant({ sessionId:sid,participantId:pid,...actor });
      assert.ok(result.ok,JSON.stringify(result)); assert.equal(result.actualGiftReturnedKurus,0);
      assert.equal(result.refundRequiredOrders.length,1); assert.notEqual(result.refundRequiredOrders[0].giftRemainingKurus,0);
    });
    await test("cancellation copy distinguishes unknown, due and actual without arrival promises", async () => {
      const unknown = workshopCancellationMoneyHtml({paymentState:"unverified"}); assert.ok(!unknown.includes("tahsilat yapılmadı"));
      const due = workshopCancellationMoneyHtml({paymentState:"cancelled_cash_pending",cashRemainingKurus:8000,actualGiftReturnedKurus:2000});
      assert.ok(due.includes("bekliyor")); assert.ok(due.includes("geri yüklendi")); assert.ok(!due.includes("iş günü"));
      const actual = workshopCancellationMoneyHtml({paymentState:"actual_return",actualCashReturnedKurus:3000,actualGiftReturnedKurus:0});
      assert.ok(actual.includes("gerçekleştiği kaydedildi"));
    });
    console.log(`${checks} cancellation DB checks passed; ${failed} failed`);
    assert.equal(failed,0,"Cancellation DB regressions failed");
  } finally {
    try {
      await pool?.end();
      if (connected) await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    } finally {
      await admin.end(); io.restore(); fs.rmSync(out,{recursive:true,force:true});
    }
  }
}
if (process.argv[1]?.endsWith("test-cancellation-refund-db.ts")) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
