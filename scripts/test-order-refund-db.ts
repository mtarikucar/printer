/** Isolated QA 55433 only. Up: disposable schema/fixtures; down: drop that exact schema. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { createRequire } from "node:module";
import type { RecordRefundInput } from "../src/lib/config/order-refund";

const connectionString = process.env.QA_MONEY_PG_URL;
if (!connectionString) throw new Error("QA_MONEY_PG_URL required");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55433") throw new Error("Refusing non-QA database");
const namespace = `order_refund_${randomUUID().replaceAll("-", "")}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "order-refund-ddl-"));
const admin = new pg.Client({ connectionString });
let checks = 0;
let servicePool: pg.Pool | undefined;

async function main() {
  await admin.connect();
  try {
    execFileSync("npx", ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"], {
      env: { ...process.env, SCRATCH_OUT: out }, stdio: "pipe",
    });
    const ddl = fs.readFileSync(path.join(out, fs.readdirSync(out).find(f => f.endsWith(".sql"))!), "utf8").replace(/"public"\./g, "");
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await admin.query(`SET search_path TO ${namespace}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter(s => s.trim())) await admin.query(statement);
    url.searchParams.set("options", `-c search_path=${namespace}`);
    process.env.DATABASE_URL = url.toString();
    // Stub only the post-commit queue kick before loading the real money service.
    // No Redis connection, worker, provider or external email exists in this test.
    const require = createRequire(path.join(process.cwd(), "scripts/test-order-refund-db.ts"));
    const noticesPath = require.resolve("../src/lib/services/refund-record-notices.ts");
    require.cache[noticesPath] = { id:noticesPath,filename:noticesPath,loaded:true,
      exports:{ kickRefundRecordNotices:async () => { throw new Error("isolated queue outage"); }, publishRefundRecordChanges:async () => {} },
    } as NodeModule;
    const analyticsPath = require.resolve("../src/lib/services/refund-record-analytics.ts");
    require.cache[analyticsPath] = { id:analyticsPath,filename:analyticsPath,loaded:true,
      exports:{ kickRefundRecordAnalytics:async () => { throw new Error("isolated analytics queue outage"); } },
    } as NodeModule;
    const service = await import("../src/lib/services/order-refund-record");
    const { db } = await import("../src/lib/db");
    servicePool=(db as unknown as {$client:pg.Pool}).$client;
    const actor = { adminEmail: "refund-admin@test.invalid" };
    const user = (await admin.query("INSERT INTO users(email,full_name) VALUES('refund@test.invalid','Refund Test') RETURNING id")).rows[0].id as string;
    let seq = 0;
    const order = async (amount = 10000, gift = 0, draftId: string | null = null, method = "bank_transfer") => {
      const id = (await admin.query(`INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,gift_card_amount_kurus,draft_id,paid_at)
        VALUES($1,$2,'refund@test.invalid','Refund Test','{}',$3,'approved',$4,$5,$6,now()-interval '1 day') RETURNING id`, [`RF-${++seq}`, user, method, amount, gift, draftId])).rows[0].id as string;
      return id;
    };
    const draft = async (amount: number, gift = 0) => (await admin.query(`INSERT INTO order_drafts(reference,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,gift_card_amount_kurus,promoted_at)
      VALUES($1,$2,'refund@test.invalid','Refund Test','{}','bank_transfer','confirmed',$3,$4,now()-interval '1 day') RETURNING id`, [`DR-${++seq}`, user, amount, gift])).rows[0].id as string;
    const giftFor = async (orderId: string, amount: number, draftId: string | null = null) => {
      const card = (await admin.query("INSERT INTO gift_cards(code,amount_kurus,balance_kurus,expires_at) VALUES($1,$2,0,now()+interval '1 year') RETURNING id", [randomUUID(), amount])).rows[0].id as string;
      const redemption = (await admin.query("INSERT INTO gift_card_redemptions(gift_card_id,order_id,draft_id,amount_kurus,redeemed_by_user_id) VALUES($1,$2,$3,$4,$5) RETURNING id", [card,orderId,draftId,amount,user])).rows[0].id as string;
      return { card, redemption };
    };
    const request = async (id: string, cash: number, gift = 0): Promise<RecordRefundInput> => ({
      operationKey: randomUUID(), expectedFingerprint: (await service.readOrderRefundView(id)).expectedFingerprint,
      mode: "actual", allocations: [{ orderId: id, cashKurus: cash, giftKurus: gift }], reason: "Confirmed actual refund test",
      ...(cash ? { cashEvidence: { method: "bank_transfer" as const, externalReference: randomUUID(), occurredAt: new Date(Date.now()-1000).toISOString(), bankTransferCompleted: true as const } } : {}),
    });
    const count = async (table: string) => Number((await admin.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    const test = async (name: string, run: () => Promise<void>) => { await run(); checks++; console.log(`PASS ${name}`); };

    await test("partial preserves fulfillment; replay precedes stale and conflicting intent refuses", async () => {
      const id = await order(); const input = await request(id, 3000);
      const result = await service.recordOrderRefund(input, actor); assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.orders[0].remainingCashKurus, 7000);
      const replay = await service.recordOrderRefund({ ...input, expectedFingerprint: "0".repeat(64) }, actor);
      assert.ok(replay.ok); assert.equal(replay.replayed, true); assert.equal(replay.refundId, result.refundId);
      const conflict = await service.recordOrderRefund({ ...input, reason: "A different refund reason" }, actor);
      assert.ok(!conflict.ok); assert.equal(conflict.code, "operation_conflict");
      assert.equal((await admin.query("SELECT payment_status,status FROM orders WHERE id=$1", [id])).rows[0].payment_status, "succeeded");
      assert.equal((await service.readOrderRefundView(id)).history.length, 1);
      const stale = await service.recordOrderRefund({ ...input, operationKey: randomUUID(), cashEvidence: { ...input.cashEvidence!, externalReference: randomUUID() } }, actor);
      assert.ok(!stale.ok); assert.equal(stale.code, "stale");
    });

    await test("actual cash needs matching rail, reference, literal completion and valid occurrence", async () => {
      const id = await order(); const input = await request(id, 1000); const before = await count("order_refund_records");
      const invalid = [undefined, { ...input.cashEvidence!, externalReference: " " }, { ...input.cashEvidence!, bankTransferCompleted: undefined },
        { ...input.cashEvidence!, occurredAt: new Date(Date.now()+60000).toISOString() },
        { ...input.cashEvidence!, occurredAt: new Date(Date.now()-172800000).toISOString() },
        { ...input.cashEvidence!, method: "card" as const, paytrRefundCompleted: true as const },
      ];
      for (const cashEvidence of invalid) {
        const result = await service.recordOrderRefund({ ...input, cashEvidence }, actor);
        assert.ok(!result.ok); assert.equal(result.code, "invalid_evidence");
      }
      assert.equal(await count("order_refund_records"), before);
    });

    await test("same transfer allocated to confirmed draft children once; unknown siblings block", async () => {
      const d = await draft(10000); const a = await order(6000,0,d), b = await order(4000,0,d);
      const input = await request(a, 3000); input.allocations.push({ orderId:b,cashKurus:2000,giftKurus:0 });
      const result = await service.recordOrderRefund(input, actor); assert.ok(result.ok, JSON.stringify(result)); assert.equal(result.cashKurus, 5000);
      const reused = await request(b, 1000); reused.cashEvidence = input.cashEvidence;
      const duplicate = await service.recordOrderRefund(reused, actor); assert.ok(!duplicate.ok); assert.equal(duplicate.code,"reference_used");
      await admin.query("UPDATE orders SET payment_status='refunded' WHERE id=$1", [b]);
      const blocked = await service.recordOrderRefund(await request(a, 1000), actor); assert.ok(!blocked.ok); assert.equal(blocked.code,"legacy_unverified");
    });

    await test("concurrent sibling requests serialize, and incoherent child totals refuse", async () => {
      const d = await draft(10000); const a = await order(6000,0,d), b = await order(4000,0,d);
      const inputs=await Promise.all([request(a,6000),request(b,4000)]);
      const results = await Promise.all(inputs.map(input=>service.recordOrderRefund(input,actor)));
      assert.equal(results.filter(r=>r.ok).length,1);
      assert.equal(results.filter(r=>!r.ok && r.code==="stale").length,1);
      const remaining = results[0].ok ? b : a;
      const done = await service.recordOrderRefund(await request(remaining,results[0].ok?4000:6000),actor); assert.ok(done.ok);
      const bad = await draft(9999); const child = await order(10000,0,bad);
      const view = await service.readOrderRefundView(child); assert.equal(view.canRecord,false);
      const refused = await service.recordOrderRefund(await request(child,1000),actor); assert.ok(!refused.ok); assert.equal(refused.code,"lineage_unknown");
    });

    await test("partial gift plus final cash/gift returns exact residual and immutable redemption amount", async () => {
      const id = await order(10000,2000); const {card,redemption} = await giftFor(id,2000);
      const partial = await service.recordOrderRefund(await request(id,3000,500),actor); assert.ok(partial.ok,JSON.stringify(partial));
      assert.equal(partial.orders[0].remainingCashKurus,5000); assert.equal(partial.orders[0].remainingGiftKurus,1500);
      assert.equal((await admin.query("SELECT refunded_at FROM gift_card_redemptions WHERE id=$1",[redemption])).rows[0].refunded_at,null);
      const over = await service.recordOrderRefund(await request(id,0,1501),actor); assert.ok(!over.ok); assert.equal(over.code,"over_refund");
      const final = await service.recordOrderRefund(await request(id,5000,1500),actor); assert.ok(final.ok,JSON.stringify(final)); assert.equal(final.orders[0].fullyReturned,true);
      assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,2000);
      const row = (await admin.query("SELECT amount_kurus,refunded_at FROM gift_card_redemptions WHERE id=$1",[redemption])).rows[0];
      assert.equal(row.amount_kurus,2000); assert.ok(row.refunded_at);
      const view = await service.readOrderRefundView(id); assert.equal(view.siblings[0].confirmedGiftKurus,2000); assert.equal(view.siblings[0].remainingGiftKurus,0);
    });

    await test("cancellation records zero cash, restores gift once, and leaves cash pending", async () => {
      const id = await order(10000,2000); await giftFor(id,2000);
      const input = { orderId:id,operationKey:randomUUID(),expectedFingerprint:(await service.readOrderRefundView(id)).expectedFingerprint,source:"admin_reject" as const,reason:"Customer requested cancellation" };
      const first = await service.cancelPaidOrder(input,actor); assert.ok(first.ok,JSON.stringify(first));
      assert.equal(first.giftReturnedKurus,2000); assert.equal(first.cashRefundRequiredKurus,8000);
      const replay = await service.cancelPaidOrder(input,actor); assert.ok(replay.ok); assert.equal(replay.replayed,true);
      const repeated = await service.cancelPaidOrder({...input,operationKey:randomUUID()},actor); assert.ok(repeated.ok); assert.equal(repeated.replayed,true);
      const row = (await admin.query("SELECT status,payment_status FROM orders WHERE id=$1",[id])).rows[0]; assert.equal(row.status,"rejected"); assert.equal(row.payment_status,"succeeded");
      const paid = await service.recordOrderRefund(await request(id,8000),actor); assert.ok(paid.ok); assert.equal(paid.orders[0].fullyReturned,true);
    });

    await test("legacy evidence never moves balance/state/notices or unlocks actual money", async () => {
      const id=await order(10000,2000); const {card}=await giftFor(id,2000);
      await admin.query("UPDATE orders SET payment_status='refunded' WHERE id=$1",[id]);
      const before=await count("customer_notifications");
      const input=await request(id,1000); input.mode="legacy_evidence";
      const evidence=await service.recordOrderRefund(input,actor); assert.ok(evidence.ok,JSON.stringify(evidence)); assert.equal(evidence.notificationState,"not_required");
      assert.equal(evidence.orders[0].remainingCashKurus,null);
      assert.equal(await count("customer_notifications"),before);
      assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,0);
      const blocked=await service.recordOrderRefund(await request(id,1000),actor); assert.ok(!blocked.ok); assert.equal(blocked.code,"legacy_unverified");
    });

    await test("full refund reverses pending originals, retains paid originals and independent credits", async () => {
      for (const kind of ["manufacturer","painter"] as const) {
        for (const status of ["pending","paid"] as const) {
          const table=kind==="manufacturer"?"manufacturers":"painters";
          const partner=(await admin.query(`INSERT INTO ${table}(email,password_hash,company_name,contact_person,phone) VALUES($1,'x','Test','Partner','0') RETURNING id`,[`${randomUUID()}@test.invalid`])).rows[0].id;
          const id=await order();
          await admin.query(`UPDATE orders SET ${kind}_id=$2 WHERE id=$1`,[id,partner]);
          const earning=(await admin.query(`INSERT INTO ${kind}_earnings(order_id,${kind}_id,status,gross_kurus,commission_kurus,net_kurus,commission_rate_bps) VALUES($1,$2,$3,6000,0,6000,0) RETURNING id`,[id,partner,status])).rows[0].id;
          const credit=(await admin.query(`INSERT INTO partner_adjustments(order_id,${kind}_id,kind,net_kurus,idempotency_key,request_hash,admin_email,reason) VALUES($1,$2,'reprint',500,$3,'test','admin@test.invalid','Independent reprint compensation') RETURNING id`,[id,partner,randomUUID()])).rows[0].id;
          const before=(await admin.query(`SELECT * FROM ${kind}_earnings WHERE id=$1`,[earning])).rows[0];
          const result=await service.recordOrderRefund(await request(id,10000),actor);assert.ok(result.ok,JSON.stringify(result));
          assert.equal(result.orders[0].originalReversal.find(r=>r.kind===kind)?.outcome,status==="pending"?"reversed":"paid_retained");
          const after=(await admin.query(`SELECT * FROM ${kind}_earnings WHERE id=$1`,[earning])).rows[0];
          if (status==="paid") assert.deepEqual(after,before); else assert.equal(after.status,"reversed");
          assert.equal((await admin.query("SELECT status,net_kurus FROM partner_adjustments WHERE id=$1",[credit])).rows[0].net_kurus,500);
          const header=(await admin.query("SELECT email_payload,email_state FROM order_refund_records WHERE id=$1",[result.refundId])).rows[0];
          assert.equal(header.email_state,"pending");assert.equal(header.email_payload.messages.length,2);
          assert.deepEqual(header.email_payload.messages.map((m:{audience:string})=>m.audience),["customer",kind]);
          assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${kind}_notifications WHERE order_id=$1`,[id])).rows[0].n,1);
        }
      }
    });

    await test("gift-only rail with cash basis and legacy annotations on a live sibling refuse",async()=>{
      const id=await order(10000,0,null,"gift_card_full");
      assert.equal((await service.readOrderRefundView(id)).canRecord,false);
      const bad=await service.recordOrderRefund(await request(id,1000),actor);assert.ok(!bad.ok);assert.equal(bad.code,"lineage_unknown");
      const d=await draft(10000),a=await order(5000,0,d),b=await order(5000,0,d);
      await admin.query("UPDATE orders SET payment_status='refunded' WHERE id=$1",[a]);
      const input=await request(b,1000);input.mode="legacy_evidence";
      const live=await service.recordOrderRefund(input,actor);assert.ok(!live.ok);assert.equal(live.code,"legacy_unverified");
    });

    await test("same key races across payment scopes cannot write twice",async()=>{
      const a=await order(),b=await order();const inputs=await Promise.all([request(a,1000),request(b,1000)]);inputs[1].operationKey=inputs[0].operationKey;
      const results=await Promise.all(inputs.map(input=>service.recordOrderRefund(input,actor)));
      assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>!r.ok&&r.code==="operation_conflict").length,1);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM order_refund_records WHERE operation_key=$1",[inputs[0].operationKey])).rows[0].n,1);
    });

    await test("legacy full gift marker consumes cap once; ambiguous gift cancellation records the obligation",async()=>{
      const id=await order(10000,2000);const {card,redemption}=await giftFor(id,2000);
      await admin.query("UPDATE gift_card_redemptions SET refunded_at=now() WHERE id=$1",[redemption]);
      const view=await service.readOrderRefundView(id);assert.equal(view.siblings[0].remainingGiftKurus,0);
      const result=await service.recordOrderRefund(await request(id,8000),actor);assert.ok(result.ok);assert.equal(result.orders[0].fullyReturned,true);
      assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,0);
      const missing=await order(10000,2000);
      const bad=await service.recordOrderRefund(await request(missing,1000),actor);assert.ok(!bad.ok);assert.equal(bad.code,"gift_history_unknown");
      const cancelled=await service.cancelPaidOrder({orderId:missing,operationKey:randomUUID(),expectedFingerprint:(await service.readOrderRefundView(missing)).expectedFingerprint,source:"admin_reject",reason:"Cancel with gift reconciliation"},actor);
      assert.ok(cancelled.ok);assert.equal(cancelled.giftReturnedKurus,0);assert.equal(cancelled.cashRefundRequiredKurus,8000);assert.ok(cancelled.giftReturnBlockedReason);
    });

    await test("admin rejection guards, notes, and cancellation replay retain live obligations",async()=>{
      const id=await order();await admin.query("UPDATE orders SET status='printing' WHERE id=$1",[id]);
      const input={orderId:id,operationKey:randomUUID(),expectedFingerprint:(await service.readOrderRefundView(id)).expectedFingerprint,source:"admin_reject" as const,reason:"Admin cancellation request",notes:"  Preserve this operator note  "};
      const refused=await service.cancelPaidOrder(input,actor);assert.ok(!refused.ok);assert.equal(refused.code,"invalid_evidence");
      await admin.query("UPDATE orders SET status='approved',admin_notes='Existing operator note' WHERE id=$1",[id]);
      input.expectedFingerprint=(await service.readOrderRefundView(id)).expectedFingerprint;
      const cancelled=await service.cancelPaidOrder(input,actor);assert.ok(cancelled.ok);
      const notes=(await admin.query("SELECT admin_notes FROM orders WHERE id=$1",[id])).rows[0].admin_notes;
      assert.match(notes,/Existing operator note/);assert.match(notes,/Preserve this operator note/);
      const changed=await service.cancelPaidOrder({...input,notes:"Changed operator note"},actor);assert.ok(!changed.ok);assert.equal(changed.code,"operation_conflict");
      assert.ok((await service.recordOrderRefund(await request(id,3000),actor)).ok);
      const replay=await service.cancelPaidOrder(input,actor);assert.ok(replay.ok);assert.equal(replay.cashRefundRequiredKurus,7000);
    });

    await test("discovery retries when a new assigned partner and earning owner appear",async()=>{
      const partner=async()=>(await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone) VALUES($1,'x','Test','Partner','0') RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id as string;
      const oldOwner=await partner(),newOwner=await partner(),id=await order();
      await admin.query("UPDATE orders SET manufacturer_id=$2 WHERE id=$1",[id,oldOwner]);
      const input=await request(id,10000),original=db.transaction.bind(db);
      let attempts=0;
      db.transaction=(async (...args: Parameters<typeof db.transaction>)=>{
        attempts++;
        if (attempts===1) {
          // Happens after unlocked discovery, before its first gate is acquired.
          await admin.query("UPDATE orders SET manufacturer_id=$2 WHERE id=$1",[id,newOwner]);
          await admin.query("INSERT INTO manufacturer_earnings(order_id,manufacturer_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps) VALUES($1,$2,6000,0,6000,0)",[id,newOwner]);
        }
        return original(...args);
      }) as typeof db.transaction;
      try {
        const result=await service.recordOrderRefund(input,actor);assert.ok(!result.ok);assert.equal(result.code,"stale");assert.equal(attempts,2);
        assert.equal((await admin.query("SELECT status FROM manufacturer_earnings WHERE order_id=$1",[id])).rows[0].status,"pending");
      } finally {db.transaction=original;}
      const result=await service.recordOrderRefund(await request(id,10000),actor);assert.ok(result.ok);assert.equal(result.orders[0].originalReversal[0].outcome,"reversed");
    });

    await test("one identical concurrent operation returns one commit and one replay",async()=>{
      const id=await order(),input=await request(id,1000),before=await count("customer_notifications");
      const results=await Promise.all([service.recordOrderRefund(input,actor),service.recordOrderRefund(input,actor)]);
      assert.ok(results.every(r=>r.ok));assert.equal(results.filter(r=>r.ok&&r.replayed).length,1);
      assert.equal(await count("customer_notifications"),before+1);
    });

    await test("shared gift card preserves child shares and marker-only old returns cannot double credit",async()=>{
      const d=await draft(15000,3000),a=await order(5000,1000,d),b=await order(5000,2000,d);await order(5000,0,d);
      const {card,redemption}=await giftFor(a,1000,d);
      await admin.query("UPDATE gift_cards SET amount_kurus=3000 WHERE id=$1",[card]);
      await admin.query("UPDATE order_drafts SET gift_card_id=$2 WHERE id=$1",[d,card]);
      const second=(await admin.query("INSERT INTO gift_card_redemptions(gift_card_id,order_id,amount_kurus,redeemed_by_user_id) VALUES($1,$2,2000,$3) RETURNING id",[card,b,user])).rows[0].id;
      assert.ok((await service.recordOrderRefund(await request(a,0,1000),actor)).ok);
      assert.equal((await admin.query("SELECT refunded_at FROM gift_card_redemptions WHERE id=$1",[second])).rows[0].refunded_at,null);
      assert.ok((await service.recordOrderRefund(await request(b,0,500),actor)).ok);
      const view=await service.readOrderRefundView(a);assert.equal(view.siblings.find(s=>s.orderId===a)?.remainingGiftKurus,0);assert.equal(view.siblings.find(s=>s.orderId===b)?.remainingGiftKurus,1500);
      const amounts=(await admin.query("SELECT amount_kurus FROM gift_card_redemptions WHERE id=ANY($1::uuid[]) ORDER BY amount_kurus",[[redemption,second]])).rows.map(r=>r.amount_kurus);
      assert.deepEqual(amounts,[1000,2000]);assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,1500);
    });

    await test("failure at every intermediate money write rolls back the entire refund",async()=>{
      const id=await order(10000,2000),{card,redemption}=await giftFor(id,2000);
      const maker=(await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone) VALUES($1,'x','Test','Partner','0') RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
      await admin.query("UPDATE orders SET manufacturer_id=$2 WHERE id=$1",[id,maker]);
      const earning=(await admin.query("INSERT INTO manufacturer_earnings(order_id,manufacturer_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps) VALUES($1,$2,6000,0,6000,0) RETURNING id",[id,maker])).rows[0].id;
      const snapshot=async()=>{
        const counts=[];for(const table of ["order_refund_records","order_refund_allocations","gift_credit_returns","customer_notifications","manufacturer_notifications","admin_actions"]) counts.push(await count(table));
        const row=async(table:string,key:string)=>(await admin.query(`SELECT * FROM ${table} WHERE id=$1`,[key])).rows[0];
        return {counts,order:await row("orders",id),card:await row("gift_cards",card),redemption:await row("gift_card_redemptions",redemption),earning:await row("manufacturer_earnings",earning)};
      };
      const before=await snapshot();
      await admin.query(`CREATE FUNCTION refund_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected intermediate failure'; END $$`);
      try {
        for (const [table,event] of [["order_refund_records","INSERT"],["order_refund_allocations","INSERT"],["gift_credit_returns","INSERT"],["gift_cards","UPDATE"],["manufacturer_earnings","UPDATE"],["customer_notifications","INSERT"]]) {
          await admin.query(`CREATE TRIGGER refund_test_fail AFTER ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION refund_test_fail()`);
          try {
            const result=await service.recordOrderRefund(await request(id,8000,2000),actor);assert.ok(!result.ok);assert.equal(result.code,"unavailable");
            assert.deepEqual(await snapshot(),before,table);
          } finally {await admin.query(`DROP TRIGGER refund_test_fail ON ${table}`);}
        }
      } finally {await admin.query("DROP FUNCTION refund_test_fail()");}
    });

    await test("invalid stored tender cancels fulfillment with unknown obligations and no money movement",async()=>{
      for (const [amount,discount,gift] of [[1000,800,500],[-1000,0,0],[1000,-100,0]]) {
        const id=await order(amount,gift);
        await admin.query("UPDATE orders SET havale_discount_kurus=$2 WHERE id=$1",[id,discount]);
        const view=await service.readOrderRefundView(id);assert.equal(view.canRecord,false);assert.equal(view.payment.cashBasisKurus,null);assert.equal(view.siblings[0].remainingCashKurus,null);
        const actual=await service.recordOrderRefund(await request(id,100),actor);assert.ok(!actual.ok);assert.equal(actual.code,"lineage_unknown");
        const result=await service.cancelPaidOrder({orderId:id,operationKey:randomUUID(),expectedFingerprint:view.expectedFingerprint,source:"admin_reject",reason:"Stop fulfillment for reconciliation"},actor);
        assert.ok(result.ok,JSON.stringify(result));assert.equal(result.giftReturnedKurus,0);assert.equal(result.cashRefundRequiredKurus,null);assert.ok(result.giftReturnBlockedReason);
        const row=(await admin.query("SELECT status,payment_status FROM orders WHERE id=$1",[id])).rows[0];assert.equal(row.status,"rejected");assert.equal(row.payment_status,"succeeded");
        const header=(await admin.query("SELECT source_snapshot,analytics_state FROM order_refund_records WHERE id=$1",[result.cancellationId])).rows[0];
        assert.equal(header.source_snapshot.siblings[0].amountKurus,amount);assert.equal(header.source_snapshot.siblings[0].havaleDiscountKurus,discount);assert.equal(header.source_snapshot.siblings[0].giftCardAmountKurus,gift);assert.equal(header.analytics_state,"not_required");
      }
    });

    await test("analytics uses recorded purchase basis, proportional deltas and stored consent",async()=>{
      const id=await order(10000,2000);await giftFor(id,2000);
      await admin.query("UPDATE orders SET havale_discount_kurus=1000,attribution=$2 WHERE id=$1",[id,JSON.stringify({consent:{analytics:true,marketing:false},visitorId:"qa-refund-visitor"})]);
      const number=(await admin.query("SELECT order_number FROM orders WHERE id=$1",[id])).rows[0].order_number;
      await admin.query("INSERT INTO analytics_events(event_id,name,source,reference,value_kurus) VALUES($1,'purchase','server',$2,10000)",[`purchase:${number}`,number]);
      const first=await service.recordOrderRefund(await request(id,3000,500),actor);assert.ok(first.ok);
      const cancellation=await service.cancelPaidOrder({orderId:id,operationKey:randomUUID(),expectedFingerprint:(await service.readOrderRefundView(id)).expectedFingerprint,source:"admin_reject",reason:"Cancel after partial return"},actor);assert.ok(cancellation.ok);assert.equal(cancellation.giftReturnedKurus,1500);
      const last=await service.recordOrderRefund(await request(id,4000),actor);assert.ok(last.ok);
      const headers=(await admin.query("SELECT source_snapshot,analytics_state FROM order_refund_records WHERE id=ANY($1::uuid[])",[[first.refundId,cancellation.cancellationId,last.refundId]])).rows;
      assert.ok(headers.every(h=>h.analytics_state==="pending"));
      const snapshots=headers.flatMap(h=>h.source_snapshot.analytics.orders);
      assert.equal(snapshots.length,3);assert.ok(snapshots.every(e=>e.orderNumber===number&&e.purchaseBasisKurus===10000&&e.attribution.consent.analytics===true&&e.attribution.consent.marketing===false));
      const allocations=(await admin.query("SELECT sum(analytics_gross_kurus)::int AS gross FROM order_refund_allocations WHERE order_id=$1",[id])).rows[0];assert.equal(allocations.gross,10000);
      const absent=await order(),noPurchase=await service.recordOrderRefund(await request(absent,1000),actor);assert.ok(noPurchase.ok);
      assert.equal((await admin.query("SELECT analytics_state FROM order_refund_records WHERE id=$1",[noPurchase.refundId])).rows[0].analytics_state,"not_required");
      assert.equal(await count("analytics_events"),1); // No delivery runs from the money transaction.
    });

    await test("busy workshop session rolls back cancellation and the same key succeeds on retry",async()=>{
      const venue=(await admin.query("INSERT INTO workshop_venues(name,contact_name,contact_email,contact_phone,address) VALUES('QA contention','QA','venue@test.invalid','0','{}') RETURNING id")).rows[0].id;
      const session=(await admin.query(`INSERT INTO workshop_sessions(venue_id,starts_at,capacity,booked_count,join_token,join_closes_at,deliver_by,price_per_seat_kurus,status)
        VALUES($1,now()+interval '20 days',10,1,$2,now()+interval '10 days',now()+interval '19 days',10000,'open') RETURNING id`,[venue,randomUUID()])).rows[0].id as string;
      const id=await order(10000,2000),{card}=await giftFor(id,2000);
      await admin.query("UPDATE orders SET workshop_session_id=$2 WHERE id=$1",[id,session]);
      const participant=(await admin.query(`INSERT INTO workshop_participants(session_id,order_id,full_name,email,phone,photo_key,kvkk_consent_at,content_consent_at,status)
        VALUES($1,$2,'QA','refund@test.invalid','0','qa.jpg',now(),now(),'paid') RETURNING id`,[session,id])).rows[0].id as string;
      const maker=(await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone) VALUES($1,'x','Test','Partner','0') RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
      await admin.query("UPDATE orders SET manufacturer_id=$2 WHERE id=$1",[id,maker]);
      const earning=(await admin.query("INSERT INTO manufacturer_earnings(order_id,manufacturer_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps) VALUES($1,$2,6000,0,6000,0) RETURNING id",[id,maker])).rows[0].id;
      const input={orderId:id,operationKey:randomUUID(),expectedFingerprint:(await service.readOrderRefundView(id)).expectedFingerprint,
        source:"workshop_participant" as const,reason:"Cancel while session is busy",workshop:{sessionId:session,participantId:participant,releaseSeat:true}};
      const snapshot=async()=>{
        const counts=[];for(const table of ["order_refund_records","order_refund_allocations","gift_credit_returns","customer_notifications","manufacturer_notifications","admin_actions"]) counts.push(await count(table));
        const row=async(table:string,key:string)=>(await admin.query(`SELECT * FROM ${table} WHERE id=$1`,[key])).rows[0];
        return {counts,order:await row("orders",id),card:await row("gift_cards",card),participant:await row("workshop_participants",participant),session:await row("workshop_sessions",session),earning:await row("manufacturer_earnings",earning)};
      };
      const before=await snapshot();
      await admin.query("BEGIN");
      try {
        await admin.query("SELECT id FROM workshop_sessions WHERE id=$1 FOR UPDATE",[session]);
        const started=Date.now(),busy=await service.cancelPaidOrder(input,actor);
        assert.ok(!busy.ok);assert.equal(busy.code,"busy");assert.equal(busy.status,409);
        const elapsed=Date.now()-started;
        assert.deepEqual(await snapshot(),before);
        assert.ok(elapsed<2000,"Session contention must refuse promptly, without waiting for the five-second lock timeout");
      } finally {await admin.query("ROLLBACK");}
      assert.equal((await service.readOrderRefundView(id)).expectedFingerprint,input.expectedFingerprint);
      const retry=await service.cancelPaidOrder(input,actor);assert.ok(retry.ok,JSON.stringify(retry));assert.equal(retry.replayed,false);assert.equal(retry.seatReleased,true);assert.equal(retry.giftReturnedKurus,2000);assert.equal(retry.cashRefundRequiredKurus,8000);
      const again=await service.cancelPaidOrder(input,actor);assert.ok(again.ok);assert.equal(again.replayed,true);assert.equal(again.seatReleased,false);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM order_refund_records WHERE operation_key=$1",[input.operationKey])).rows[0].n,1);
      assert.equal((await admin.query("SELECT booked_count FROM workshop_sessions WHERE id=$1",[session])).rows[0].booked_count,0);
      assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,2000);
    });

    await test("late transaction failure rolls back header, allocation, gift, state, audit and notice", async () => {
      const id=await order(10000,2000); const {card}=await giftFor(id,2000);
      const tables=["order_refund_records","order_refund_allocations","gift_credit_returns","admin_actions","customer_notifications"];
      const before=[];for (const table of tables) before.push(await count(table));
      await admin.query(`CREATE FUNCTION refund_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected refund audit failure'; END $$`);
      await admin.query(`CREATE TRIGGER refund_test_fail BEFORE INSERT ON admin_actions FOR EACH ROW EXECUTE FUNCTION refund_test_fail()`);
      try {
        const result=await service.recordOrderRefund(await request(id,8000,2000),actor); assert.ok(!result.ok); assert.equal(result.code,"unavailable");
        const after=[];for (const table of tables) after.push(await count(table));assert.deepEqual(after,before);
        assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,0);
        assert.equal((await admin.query("SELECT payment_status FROM orders WHERE id=$1",[id])).rows[0].payment_status,"succeeded");
      } finally {
        await admin.query("DROP TRIGGER refund_test_fail ON admin_actions"); await admin.query("DROP FUNCTION refund_test_fail()");
      }
    });

    // Explicitly close this test's pool: no worker, queue, provider or real email is started.

    console.log(`${checks} order refund DB checks passed`);
  } finally {
    await servicePool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end();
    fs.rmSync(out,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
