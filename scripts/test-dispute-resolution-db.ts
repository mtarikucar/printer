/** QA55433 only; fixture up creates a disposable schema, down drops only that schema. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { ResolveDisputeInput } from "../src/lib/config/dispute-resolution";

const connectionString=process.env.QA_MONEY_PG_URL;
if (!connectionString) throw new Error("QA_MONEY_PG_URL required");
const url=new URL(connectionString);
if (url.hostname!=="127.0.0.1" || url.port!=="55433") throw new Error("Refusing non-QA database");
const namespace=`dispute_${randomUUID().replaceAll("-","")}`;
const out=fs.mkdtempSync(path.join(os.tmpdir(),"dispute-ddl-"));
const admin=new pg.Client({connectionString});
let pool: pg.Pool | undefined,checks=0;
async function main() {
  await admin.connect();
  try {
    execFileSync("npx",["drizzle-kit","generate","--config=scripts/db/drizzle-scratch.config.ts"],{env:{...process.env,SCRATCH_OUT:out},stdio:"pipe"});
    const ddl=fs.readFileSync(path.join(out,fs.readdirSync(out).find(f=>f.endsWith(".sql"))!),"utf8").replace(/"public"\./g,"");
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await admin.query(`SET search_path TO ${namespace}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter(s=>s.trim())) await admin.query(statement);
    url.searchParams.set("options",`-c search_path=${namespace}`);
    process.env.DATABASE_URL=url.toString(); process.env.ADMIN_EMAIL="dispute-admin@test.invalid";
    const require=createRequire(path.join(process.cwd(),"scripts/test-dispute-resolution-db.ts"));
    const hooks: string[]=[];
    const fake=(file:string,exports:Record<string,unknown>)=>{const id=require.resolve(file);require.cache[id]={id,filename:id,loaded:true,exports} as NodeModule;};
    const hook=(kind:string)=>async(id:string)=>{hooks.push(`${kind}:${id}`);throw new Error("isolated external outage");};
    fake("../src/lib/services/refund-record-notices.ts",{kickRefundRecordNotices:hook("refund"),publishRefundRecordChanges:hook("realtime")});
    fake("../src/lib/services/refund-record-analytics.ts",{kickRefundRecordAnalytics:hook("analytics")});
    fake("../src/lib/services/dispute-notices.ts",{kickDisputeNotices:async(id:string,phase:string)=>hook(phase)(id)});
    fake("../src/lib/realtime/emit.ts",{emitCustomerNotification:hook("inbox")});
    const service=await import("../src/lib/services/dispute-resolution");
    const refunds=await import("../src/lib/services/order-refund-record");
    const {db}=await import("../src/lib/db"); pool=(db as unknown as {$client:pg.Pool}).$client;
    const actor={adminEmail:"decision-admin@test.invalid"};
    const user=(await admin.query("INSERT INTO users(email,full_name) VALUES('complainant@test.invalid','Complaint Owner') RETURNING id")).rows[0].id as string;
    let sequence=0;
    const order=async(amount=10000,gift=0,draftId:string|null=null)=>{
      const number=`DS-${++sequence}`;
      const id=(await admin.query(`INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,gift_card_amount_kurus,draft_id,paid_at)
        VALUES($1,$2,'checkout@test.invalid','Checkout Name','{}','bank_transfer','shipped',$3,$4,$5,now()-interval '1 day') RETURNING id`,[number,user,amount,gift,draftId])).rows[0].id as string;
      return {id,number};
    };
    const complaint=async(orderId:string)=> (await admin.query("INSERT INTO disputes(order_id,user_id,category,description) VALUES($1,$2,'damaged','Item arrived damaged') RETURNING id",[orderId,user])).rows[0].id as string;
    const request=async(disputeId:string,cash?:number,gift=0):Promise<ResolveDisputeInput>=>{
      const view=await service.readDisputeDecisionView(disputeId);
      assert.ok("dispute" in view,JSON.stringify(view));
      return {disputeId,operationKey:randomUUID(),expectedDecisionFingerprint:view.expectedDecisionFingerprint,action:"resolve",resolution:"The complaint has been reviewed",
        ...(cash!==undefined?{refund:{expectedFingerprint:view.refundView!.expectedFingerprint,reason:"Actual return for damaged item",allocations:[{orderId:view.dispute.orderId,cashKurus:cash,giftKurus:gift}],
          ...(cash?{cashEvidence:{method:"bank_transfer" as const,externalReference:randomUUID(),occurredAt:new Date(Date.now()-1000).toISOString(),bankTransferCompleted:true as const}}:{})}}:{})};
    };
    const row=async(id:string)=>(await admin.query("SELECT * FROM disputes WHERE id=$1",[id])).rows[0];
    const count=async(table:string)=>Number((await admin.query(`SELECT count(*) n FROM ${table}`)).rows[0].n);
    const test=async(name:string,run:()=>Promise<void>)=>{await run();checks++;console.log(`PASS ${name}`);};

    await test("decision-only unknown tender closes without changing money or fulfillment",async()=>{
      const o=await order(100,200),id=await complaint(o.id),input=await request(id);
      const before=(await admin.query("SELECT * FROM orders WHERE id=$1",[o.id])).rows[0],n=await count("order_refund_records");
      const result=await service.resolveDispute(input,actor);assert.ok(result.ok,JSON.stringify(result));assert.equal(result.refund,null);
      assert.equal((await row(id)).status,"resolved");assert.equal(await count("order_refund_records"),n);
      assert.deepEqual((await admin.query("SELECT * FROM orders WHERE id=$1",[o.id])).rows[0],before);
      const notice=(await admin.query("SELECT * FROM customer_notifications WHERE order_id=$1",[o.id])).rows;
      assert.equal(notice.length,1);assert.equal(notice[0].type,"dispute_update");assert.match(notice[0].body,/Bu kararla yeni iade kaydı oluşturulmadı/);
      assert.equal((await row(id)).decision_email_payload.messages[0].to,"complainant@test.invalid");
    });
    await test("partial cash refund and decision commit one combined customer notice; replay is immutable",async()=>{
      const o=await order(),id=await complaint(o.id),input=await request(id,3000);
      const result=await service.resolveDispute(input,actor);assert.ok(result.ok,JSON.stringify(result));assert.ok(result.refund);assert.equal(result.refund.cashKurus,3000);
      const header=(await admin.query("SELECT * FROM order_refund_records WHERE id=$1",[result.refund.refundId])).rows[0];
      assert.equal(header.operation_key,input.operationKey);assert.equal(header.email_state,"not_required");assert.deepEqual(header.email_payload,{});
      assert.equal(header.source_snapshot.customerNoticeOwner.disputeId,id);
      assert.equal((await admin.query("SELECT count(*) n FROM customer_notifications WHERE order_id=$1",[o.id])).rows[0].n,"1");
      await admin.query("UPDATE disputes SET decision_email_state='delivered',decision_email_next_attempt_at=NULL WHERE id=$1",[id]);
      const replay=await service.resolveDispute({...input,expectedDecisionFingerprint:"0".repeat(64),refund:{...input.refund!,expectedFingerprint:"0".repeat(64)}},actor);
      assert.ok(replay.ok,JSON.stringify(replay));assert.equal(replay.replayed,true);assert.equal(replay.refund!.refundId,result.refund.refundId);assert.equal(replay.decisionNotificationState,"delivered");
      assert.ok(hooks.includes(`analytics:${header.id}`));assert.ok(hooks.includes(`realtime:${header.id}`));assert.ok(hooks.includes(`decision:${id}`));
    });


    await test("changed intent or actor conflicts before closed/stale; other-key and legacy decisions stay closed",async()=>{
      const o=await order(),id=await complaint(o.id),input=await request(id);
      assert.ok((await service.resolveDispute(input,actor)).ok);
      for (const [command,who] of [[{...input,resolution:"A different reviewed outcome"},actor],[input,{adminEmail:"other@test.invalid"}],[{...input,action:"reject" as const},actor]] as const) {
        const result=await service.resolveDispute(command,who);assert.ok(!result.ok);assert.equal(result.code,"operation_conflict");
      }
      const other=await service.resolveDispute({...input,operationKey:randomUUID()},actor);assert.ok(!other.ok);assert.equal(other.code,"already_closed");
      const legacy=await complaint((await order()).id);await admin.query("UPDATE disputes SET status='rejected' WHERE id=$1",[legacy]);
      const refused=await service.resolveDispute(await request(legacy),actor);assert.ok(!refused.ok);assert.equal(refused.code,"already_closed");
      assert.equal((await row(legacy)).decision_snapshot,null);
    });

    await test("invalid optional money never closes a dispute or inserts refund evidence",async()=>{
      const o=await order(),id=await complaint(o.id),input=await request(id,3000),before=await count("order_refund_records");
      const invalid=[{...input,action:"reject"},{...input,clawback:true},
        {...input,refund:{...input.refund,cashEvidence:undefined}},
        {...input,refund:{...input.refund,cashEvidence:{...input.refund!.cashEvidence,occurredAt:new Date(Date.now()-172800000).toISOString()}}},
        {...input,refund:{...input.refund,allocations:[{orderId:(await order()).id,cashKurus:100,giftKurus:0}]}},
        {...input,refund:{...input.refund,allocations:[...input.refund!.allocations,{orderId:(await order()).id,cashKurus:100,giftKurus:0}]}}];
      for (const value of invalid) {const r=await service.resolveDispute(value as ResolveDisputeInput,actor);assert.ok(!r.ok);assert.equal(r.code,"invalid_evidence");}
      assert.equal((await row(id)).status,"open");assert.equal(await count("order_refund_records"),before);
      const unknown=await complaint((await order(100,200)).id),r=await service.resolveDispute(await request(unknown,50),actor);
      assert.ok(!r.ok);assert.equal(r.code,"lineage_unknown");assert.equal((await row(unknown)).status,"open");
      const over=await service.resolveDispute({...input,refund:{...input.refund!,allocations:[{orderId:o.id,cashKurus:10001,giftKurus:0}]}},actor);
      assert.ok(!over.ok);assert.equal(over.code,"over_refund");assert.equal((await row(id)).status,"open");
    });

    await test("financial and decision previews are independently enforced",async()=>{
      const o=await order(),id=await complaint(o.id),input=await request(id,1000);
      for (const command of [{...input,expectedDecisionFingerprint:"0".repeat(64)}, {...input,refund:{...input.refund!,expectedFingerprint:"0".repeat(64)}}]) {
        const result=await service.resolveDispute(command,actor);assert.ok(!result.ok);assert.equal(result.code,"stale");assert.equal((await row(id)).status,"open");
      }
      await admin.query("UPDATE disputes SET description='Changed complaint details' WHERE id=$1",[id]);
      const changed=await service.resolveDispute(input,actor);assert.ok(!changed.ok);assert.equal(changed.code,"stale");
      assert.ok((await service.resolveDispute(await request(id,1000),actor)).ok);
    });

    await test("complainant must match locked order even without money; anchor mutation is stale",async()=>{
      const o=await order(),id=await complaint(o.id),input=await request(id);
      const stranger=(await admin.query("INSERT INTO users(email,full_name) VALUES('stranger@test.invalid','Other') RETURNING id")).rows[0].id;
      await admin.query("UPDATE disputes SET user_id=$2 WHERE id=$1",[id,stranger]);
      const result=await service.resolveDispute(await request(id),actor);assert.ok(!result.ok);assert.equal(result.code,"lineage_unknown");assert.equal((await row(id)).status,"open");
      await admin.query("UPDATE disputes SET user_id=$2 WHERE id=$1",[id,user]);
      const other=await order(),original=db.transaction.bind(db);let calls=0;
      db.transaction=(async(...args:Parameters<typeof db.transaction>)=>{if (++calls===1) await admin.query("UPDATE disputes SET order_id=$2 WHERE id=$1",[id,other.id]);return original(...args);}) as typeof db.transaction;
      try {const r=await service.resolveDispute(input,actor);assert.ok(!r.ok);assert.equal(r.code,"stale");} finally {db.transaction=original;}
    });

    const giftFor=async(orderId:string,amount:number)=>{
      const card=(await admin.query("INSERT INTO gift_cards(code,amount_kurus,balance_kurus,expires_at) VALUES($1,$2,0,now()+interval '1 year') RETURNING id",[randomUUID(),amount])).rows[0].id as string;
      const redemption=(await admin.query("INSERT INTO gift_card_redemptions(gift_card_id,order_id,amount_kurus,redeemed_by_user_id) VALUES($1,$2,$3,$4) RETURNING id",[card,orderId,amount,user])).rows[0].id as string;
      return {card,redemption};
    };
    const partner=async()=>(await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone) VALUES($1,'x','Test','Partner','0') RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id as string;
    const earningFor=async(orderId:string,partnerId:string,status="pending")=>{
      await admin.query("UPDATE orders SET manufacturer_id=$2 WHERE id=$1",[orderId,partnerId]);
      return (await admin.query("INSERT INTO manufacturer_earnings(order_id,manufacturer_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps,status) VALUES($1,$2,6000,0,6000,0,$3) RETURNING id",[orderId,partnerId,status])).rows[0].id as string;
    };
    await test("partial gift then final return preserves partner notices and reverses only pending originals",async()=>{
      const o=await order(10000,2000),{card}=await giftFor(o.id,2000),maker=await partner();await earningFor(o.id,maker);
      const first=await complaint(o.id),partial=await service.resolveDispute(await request(first,1000,500),actor);assert.ok(partial.ok,JSON.stringify(partial));
      assert.equal((await admin.query("SELECT status FROM manufacturer_earnings WHERE order_id=$1",[o.id])).rows[0].status,"pending");
      const next=await complaint(o.id),full=await service.resolveDispute(await request(next,7000,1500),actor);assert.ok(full.ok,JSON.stringify(full));assert.equal(full.refund!.orders[0].fullyReturned,true);
      assert.equal((await admin.query("SELECT balance_kurus FROM gift_cards WHERE id=$1",[card])).rows[0].balance_kurus,2000);
      const current=(await admin.query("SELECT manufacturer_id,payment_status,status FROM orders WHERE id=$1",[o.id])).rows[0];assert.equal(current.manufacturer_id,null);assert.equal(current.payment_status,"refunded");assert.equal(current.status,"shipped");
      assert.equal((await admin.query("SELECT status FROM manufacturer_earnings WHERE order_id=$1",[o.id])).rows[0].status,"reversed");
      const header=(await admin.query("SELECT email_payload FROM order_refund_records WHERE id=$1",[full.refund!.refundId])).rows[0];
      assert.equal(header.email_payload.messages.length,1);assert.equal(header.email_payload.messages[0].audience,"manufacturer");
      assert.equal((await admin.query("SELECT count(*) n FROM customer_notifications WHERE order_id=$1",[o.id])).rows[0].n,"2");
      const paid=await order(),paidMaker=await partner(),earning=await earningFor(paid.id,paidMaker,"paid"),paidBefore=(await admin.query("SELECT * FROM manufacturer_earnings WHERE id=$1",[earning])).rows[0];
      const paidResult=await service.resolveDispute(await request(await complaint(paid.id),10000),actor);assert.ok(paidResult.ok);assert.equal(paidResult.refund!.orders[0].originalReversal[0].outcome,"paid_retained");
      assert.deepEqual((await admin.query("SELECT * FROM manufacturer_earnings WHERE id=$1",[earning])).rows[0],paidBefore);
    });


    await test("netted originals and independent credits are immutable through a full dispute refund",async()=>{
      const o=await order(),maker=await partner(),earning=await earningFor(o.id,maker,"paid");
      const payout=(await admin.query(`INSERT INTO payouts(manufacturer_id,total_kurus,earning_count,adjustment_count,status,settlement_kind,admin_email,paid_at,paid_by)
        VALUES($1,0,1,1,'paid','netting','qa@test.invalid',now(),'qa@test.invalid') RETURNING id`,[maker])).rows[0].id;
      await admin.query("UPDATE manufacturer_earnings SET payout_id=$2 WHERE id=$1",[earning,payout]);
      await admin.query(`INSERT INTO partner_adjustments(order_id,manufacturer_id,kind,net_kurus,source_kind,source_id,source_snapshot,idempotency_key,request_hash,admin_email,reason,status,manufacturer_payout_id,settled_at)
        VALUES($1,$2,'unpaid_offset',-6000,'manufacturer_earning',$3,'{}',$4,'test','qa@test.invalid','Recorded offset','settled',$5,now())`,[o.id,maker,earning,randomUUID(),payout]);
      await admin.query(`INSERT INTO partner_adjustments(order_id,manufacturer_id,kind,net_kurus,idempotency_key,request_hash,admin_email,reason)
        VALUES($1,$2,'topup',500,$3,'test','qa@test.invalid','Independent partner compensation')`,[o.id,maker,randomUUID()]);
      const snapshot=async()=>({earning:(await admin.query("SELECT * FROM manufacturer_earnings WHERE id=$1",[earning])).rows,
        payout:(await admin.query("SELECT * FROM payouts WHERE id=$1",[payout])).rows,
        adjustments:(await admin.query("SELECT * FROM partner_adjustments WHERE order_id=$1 ORDER BY id",[o.id])).rows});
      const before=await snapshot(),result=await service.resolveDispute(await request(await complaint(o.id),10000),actor);
      assert.ok(result.ok,JSON.stringify(result));assert.equal(result.refund!.orders[0].originalReversal[0].outcome,"paid_retained");assert.deepEqual(await snapshot(),before);
    });

    await test("combined refund analytics retains recorded consent and only the actual partial delta",async()=>{
      const o=await order(10000,2000);await giftFor(o.id,2000);
      await admin.query("UPDATE orders SET havale_discount_kurus=1000,attribution=$2 WHERE id=$1",[o.id,JSON.stringify({consent:{analytics:false,marketing:false},visitorId:"qa-dispute"})]);
      await admin.query("INSERT INTO analytics_events(event_id,name,source,reference,value_kurus) VALUES($1,'purchase','server',$2,10000)",[`purchase:${o.number}`,o.number]);
      const first=await service.resolveDispute(await request(await complaint(o.id),3000,500),actor);assert.ok(first.ok);
      const header=(await admin.query("SELECT source_snapshot,analytics_state FROM order_refund_records WHERE id=$1",[first.refund!.refundId])).rows[0];
      assert.equal(header.analytics_state,"pending");assert.equal(header.source_snapshot.analytics.orders[0].attribution.consent.analytics,false);
      const allocation=(await admin.query("SELECT analytics_gross_kurus FROM order_refund_allocations WHERE refund_id=$1",[first.refund!.refundId])).rows[0];
      assert.equal(allocation.analytics_gross_kurus,3888);assert.ok(hooks.includes(`analytics:${first.refund!.refundId}`));
      const final=await service.resolveDispute(await request(await complaint(o.id),4000,1500),actor);assert.ok(final.ok);
      assert.equal(Number((await admin.query("SELECT sum(analytics_gross_kurus) n FROM order_refund_allocations WHERE order_id=$1",[o.id])).rows[0].n),10000);
    });

    await test("every refund/decision/notice failure rolls back all effects and permits the same key retry",async()=>{
      const o=await order(10000,2000),{card,redemption}=await giftFor(o.id,2000),maker=await partner(),earning=await earningFor(o.id,maker),id=await complaint(o.id),input=await request(id,8000,2000);
      const snapshot=async()=>{
        const counts=[];for(const table of ["order_refund_records","order_refund_allocations","gift_credit_returns","customer_notifications","manufacturer_notifications","admin_actions"]) counts.push(await count(table));
        const one=async(table:string,key:string)=>(await admin.query(`SELECT * FROM ${table} WHERE id=$1`,[key])).rows[0];
        return {counts,dispute:await row(id),order:await one("orders",o.id),card:await one("gift_cards",card),redemption:await one("gift_card_redemptions",redemption),earning:await one("manufacturer_earnings",earning)};
      };
      const before=await snapshot(),beforeHooks=hooks.length;
      await admin.query(`CREATE FUNCTION dispute_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected transaction failure'; END $$`);
      try {
        for (const [table,event] of [["order_refund_records","INSERT"],["order_refund_allocations","INSERT"],["gift_credit_returns","INSERT"],["gift_cards","UPDATE"],["manufacturer_earnings","UPDATE"],["orders","UPDATE"],["disputes","UPDATE"],["customer_notifications","INSERT"],["manufacturer_notifications","INSERT"],["admin_actions","INSERT"]]) {
          await admin.query(`CREATE TRIGGER dispute_test_fail AFTER ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION dispute_test_fail()`);
          try {const r=await service.resolveDispute(input,actor);assert.ok(!r.ok,table);assert.equal(r.code,"unavailable",table);assert.deepEqual(await snapshot(),before,table);assert.equal(hooks.length,beforeHooks);}
          finally {await admin.query(`DROP TRIGGER dispute_test_fail ON ${table}`);}
        }
      } finally {await admin.query("DROP FUNCTION dispute_test_fail()");}
      assert.ok((await service.resolveDispute(input,actor)).ok);
    });

    await test("matching decisions replay once; resolve versus reject and cross-order key races choose one owner",async()=>{
      const o=await order(),id=await complaint(o.id),input=await request(id,1000),before=await count("customer_notifications");
      const same=await Promise.all([service.resolveDispute(input,actor),service.resolveDispute(input,actor)]);
      assert.ok(same.every(r=>r.ok));assert.equal(same.filter(r=>r.ok&&r.replayed).length,1);assert.equal(await count("customer_notifications"),before+1);
      const second=await complaint((await order()).id),a=await request(second),b={...a,operationKey:randomUUID(),action:"reject" as const};
      const race=await Promise.all([service.resolveDispute(a,actor),service.resolveDispute(b,actor)]);assert.equal(race.filter(r=>r.ok).length,1);assert.equal(race.filter(r=>!r.ok&&r.code==="already_closed").length,1);
      const requests=await Promise.all([request(await complaint((await order()).id),1000),request(await complaint((await order()).id),1000)]);requests[1].operationKey=requests[0].operationKey;
      const crossed=await Promise.all(requests.map(command=>service.resolveDispute(command,actor)));assert.equal(crossed.filter(r=>r.ok).length,1);assert.equal(crossed.filter(r=>!r.ok&&r.code==="operation_conflict").length,1);
    });

    await test("unrelated standalone refund cannot be adopted and standalone 6c hash remains identical",async()=>{
      const o=await order(),id=await complaint(o.id),input=await request(id,1000);
      const standalone={...input.refund!,operationKey:input.operationKey,mode:"actual" as const};
      const result=await refunds.recordOrderRefund(standalone,actor);assert.ok(result.ok);
      const header=(await admin.query("SELECT * FROM order_refund_records WHERE id=$1",[result.refundId])).rows[0];
      const expected=createHash("sha256").update(JSON.stringify({version:1,action:"refund",scope:`order:${o.id}`,mode:"actual",allocations:standalone.allocations,cashEvidence:standalone.cashEvidence??null,reason:standalone.reason,adminEmail:actor.adminEmail})).digest("hex");
      assert.equal(header.request_hash,expected);
      const refused=await service.resolveDispute(input,actor);assert.ok(!refused.ok);assert.equal(refused.code,"operation_conflict");assert.equal((await row(id)).status,"open");
      const replay=await refunds.recordOrderRefund({...standalone,expectedFingerprint:"0".repeat(64)},actor);assert.ok(replay.ok);assert.equal(replay.replayed,true);
    });

    await test("sibling scope serialization protects actual limits without blocking a decision-only sibling",async()=>{
      const d=(await admin.query(`INSERT INTO order_drafts(reference,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,promoted_at)
        VALUES($1,$2,'checkout@test.invalid','Test','{}','bank_transfer','confirmed',10000,now()-interval '1 day') RETURNING id`,[randomUUID(),user])).rows[0].id;
      const a=await order(6000,0,d),b=await order(4000,0,d),ad=await complaint(a.id),bd=await complaint(b.id);
      const inputs=await Promise.all([request(ad,6000),request(bd,4000)]);
      const results=await Promise.all(inputs.map(command=>service.resolveDispute(command,actor)));assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>!r.ok&&r.code==="stale").length,1);
      const remaining=results[0].ok?bd:ad;
      assert.ok((await service.resolveDispute(await request(remaining),actor)).ok);
    });

    await test("assignment and earning discovery retries before adjudication, never taking a late gate",async()=>{
      const o=await order(),id=await complaint(o.id),old=await partner(),next=await partner();await admin.query("UPDATE orders SET manufacturer_id=$2 WHERE id=$1",[o.id,old]);
      const input=await request(id,1000),original=db.transaction.bind(db);let attempts=0;
      db.transaction=(async(...args:Parameters<typeof db.transaction>)=>{if (++attempts===1) await earningFor(o.id,next);return original(...args);}) as typeof db.transaction;
      try {const r=await service.resolveDispute(input,actor);assert.ok(!r.ok);assert.equal(r.code,"stale");assert.equal(attempts,2);} finally {db.transaction=original;}
      assert.equal((await row(id)).status,"open");assert.ok((await service.resolveDispute(await request(id,1000),actor)).ok);
    });

    await test("decision-only skips locked gift evidence and degraded optional reads remain honest",async()=>{
      const o=await order(10000,2000),{card}=await giftFor(o.id,2000),id=await complaint(o.id),input=await request(id);
      const locked=new pg.Client({connectionString:url.toString()});await locked.connect();await locked.query("BEGIN");
      try {await locked.query("SELECT id FROM gift_cards WHERE id=$1 FOR UPDATE",[card]);assert.ok((await service.resolveDispute(input,actor)).ok);} finally {await locked.query("ROLLBACK");await locked.end();}
      const original=db.transaction.bind(db);db.transaction=(async()=>{throw new Error("isolated financial reader outage");}) as typeof db.transaction;
      try {const view=await service.readDisputeDecisionView(id);assert.ok("dispute" in view);assert.equal(view.refundView,null);assert.ok(view.refundReadUnavailable);} finally {db.transaction=original;}
      for (const value of [randomUUID(),id+"\n"]) {const missing=await service.readDisputeDecisionView(value);assert.ok(!("dispute" in missing));assert.equal(missing.code,"not_found");}
    });

    await test("busy preserves the command and same-key retry succeeds after the scope lock is released",async()=>{
      const o=await order(),id=await complaint(o.id),input=await request(id,1000),locked=new pg.Client({connectionString:url.toString()});await locked.connect();await locked.query("BEGIN");
      try {await locked.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`refund-payment:order:${o.id}`]);const result=await service.resolveDispute(input,actor);assert.ok(!result.ok);assert.equal(result.code,"busy");assert.equal((await row(id)).status,"open");}
      finally {await locked.query("ROLLBACK");await locked.end();}
      assert.ok((await service.resolveDispute(input,actor)).ok);
    });

    await test("concurrent matching customer opens create one durable intent; changed complaint and strangers refuse",async()=>{
      const o=await order(),input={category:"damaged" as const,description:"  Item arrived damaged  "};
      const results=await Promise.all([service.openDispute(o.number,user,input),service.openDispute(o.number,user,input)]);assert.ok(results.every(r=>r.ok));assert.equal(results.filter(r=>r.ok&&r.replayed).length,1);
      const good=results[0];assert.ok(good.ok);const saved=await row(good.disputeId);assert.equal(saved.opening_email_state,"pending");assert.equal(saved.opening_email_payload.messages[0].to,process.env.ADMIN_EMAIL);assert.equal(saved.opening_email_payload.messages[0].description,"Item arrived damaged");
      const changed=await service.openDispute(o.number,user,{...input,description:"Different complaint details"});assert.ok(!changed.ok);assert.equal(changed.code,"already_open");
      const stranger=await service.openDispute(o.number,randomUUID(),input);assert.ok(!stranger.ok);assert.equal(stranger.code,"not_found");
      assert.ok((await service.resolveDispute(await request(good.disputeId),actor)).ok);assert.equal((await row(good.disputeId)).opening_email_state,"pending");
      assert.ok(hooks.includes(`opening:${good.disputeId}`));
    });

    await test("opening validates current shipment and required admin recipient atomically, preserving old duplicates",async()=>{
      const o=await order(),input={category:"damaged" as const,description:"Item arrived damaged"};await admin.query("UPDATE orders SET status='approved' WHERE id=$1",[o.id]);
      const early=await service.openDispute(o.number,user,input);assert.ok(!early.ok);assert.equal(early.code,"invalid_evidence");await admin.query("UPDATE orders SET status='delivered' WHERE id=$1",[o.id]);
      const email=process.env.ADMIN_EMAIL;delete process.env.ADMIN_EMAIL;
      try {const r=await service.openDispute(o.number,user,input);assert.ok(!r.ok);assert.equal(r.code,"unavailable");assert.equal((await admin.query("SELECT count(*) n FROM disputes WHERE order_id=$1",[o.id])).rows[0].n,"0");} finally {process.env.ADMIN_EMAIL=email;}
      const legacy1=await complaint(o.id),legacy2=await complaint(o.id);
      const replay=await service.openDispute(o.number,user,input);assert.ok(replay.ok);assert.equal(replay.replayed,true);assert.ok([legacy1,legacy2].includes(replay.disputeId));
      assert.deepEqual((await row(legacy1)).opening_email_payload,{});assert.deepEqual((await row(legacy2)).opening_email_payload,{});
      const second=await order();await admin.query(`CREATE FUNCTION opening_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'opening failure'; END $$`);
      await admin.query("CREATE TRIGGER opening_test_fail AFTER INSERT ON disputes FOR EACH ROW EXECUTE FUNCTION opening_test_fail()");
      try {const r=await service.openDispute(second.number,user,input);assert.ok(!r.ok);assert.equal(r.code,"unavailable");assert.equal((await admin.query("SELECT count(*) n FROM disputes WHERE order_id=$1",[second.id])).rows[0].n,"0");}
      finally {await admin.query("DROP TRIGGER opening_test_fail ON disputes");await admin.query("DROP FUNCTION opening_test_fail()");}
    });

    console.log(`${checks} dispute resolution DB checks passed`);
  } finally {
    await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);await admin.end();fs.rmSync(out,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
