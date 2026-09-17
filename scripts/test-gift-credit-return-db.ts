/** Isolated QA only; recorded gift-return, draft release and promotion guards. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const originals = new Map<string, NodeJS.Module | undefined>();
function stub(modulePath: string, exports: unknown) {
  const id = require.resolve(modulePath); originals.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeJS.Module;
}
const connectionString = process.env.QA_MONEY_PG_URL;
if (!connectionString) throw new Error("QA_MONEY_PG_URL required");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55433") throw new Error("Refusing non-QA database");
const namespace = `gift_return_${Date.now()}_${process.pid}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "gift-return-ddl-"));
const admin = new pg.Client({connectionString});
let pool: pg.Pool | undefined;
let checks = 0;
const test = async (name:string, run:()=>Promise<void>) => {await run(); checks++; console.log(`PASS ${name}`);};
async function main() {
  // Fail before any DB connection if the required helper is missing.
  assert.ok(fs.existsSync("src/lib/services/gift-credit-return.ts"), "transaction gift-return helper exists");
  await admin.connect();
  try {
    execFileSync("npx",["drizzle-kit","generate","--config=scripts/db/drizzle-scratch.config.ts"],{env:{...process.env,SCRATCH_OUT:out},stdio:"ignore"});
    const ddl = fs.readFileSync(path.join(out,fs.readdirSync(out).find(f=>f.endsWith('.sql'))!),"utf8").replace(/"public"\./g,"");
    await admin.query(`CREATE SCHEMA ${namespace}`); await admin.query(`SET search_path TO ${namespace}`);
    // Drizzle's scratch generator puts ALTER FK before its referenced unique
    // index. Create tables/indexes first, then attach generated foreign keys.
    const statements=ddl.split('--> statement-breakpoint').filter(s=>s.trim());
    for(const statement of statements.filter(s=>!/^\s*ALTER TABLE/.test(s))) await admin.query(statement);
    for(const statement of statements.filter(s=>/^\s*ALTER TABLE/.test(s))) await admin.query(statement);
    url.searchParams.set('options',`-c search_path=${namespace}`); process.env.DATABASE_URL=url.toString();
    const {db}=await import('../src/lib/db'); pool=(db as typeof db & {$client:pg.Pool}).$client;
    const {restoreGiftCreditTx}=await import('../src/lib/services/gift-credit-return');
    // Exercise actual draft wrappers without queue, storage, notifications or generation.
    const noop = async () => undefined;
    stub('../src/lib/services/storage', { getPublicUrl: (key:string) => key });
    stub('../src/lib/services/order-confirm', { kickOffOrderProcessing: noop, kickOffMarketplaceOrder: noop });
    stub('../src/lib/services/workshop-notify', { sendWorkshopSeatReleasedEmail: noop });
    stub('../src/lib/services/workshop-seat', { findParticipantSeatByDraft: async () => null, releaseSeatForDraft: async () => ({status:'not_held'}) });
    stub('../src/lib/realtime/emit', { emitOrderChanged: noop });
    stub('../src/lib/realtime/bus', { publishRealtime: noop });
    stub('../src/lib/analytics/server', { recordPurchase: noop });
    stub('../src/lib/queue/queues', { getPaymentDeadlineQueue: () => ({remove:noop}), getEmailQueue:()=>({add:noop}), havaleExpireJobId:(id:string)=>id, havaleReminderJobId:(id:string)=>id, cardExpireJobId:(id:string)=>id });
    const drafts = await import('../src/lib/services/order-draft');
    const user=(await admin.query("INSERT INTO users(email,full_name) VALUES('gift-return@test.invalid','Redeemer') RETURNING id")).rows[0].id;
    const buyer=(await admin.query("INSERT INTO users(email,full_name) VALUES('gift-buyer@test.invalid','Buyer') RETURNING id")).rows[0].id;
    let seq=0;
    async function fixture(draftOnly=false, status='partially_used') {
      const draftId=(await admin.query("INSERT INTO order_drafts(reference,user_id,email,customer_name,shipping_address,payment_method,amount_kurus,gift_card_amount_kurus,status) VALUES($1,$2,'gift@test.invalid','Test','{}','card',10000,2000,$3) RETURNING id",[`GIFT-${++seq}`,user,draftOnly?'pending':'confirmed'])).rows[0].id;
      const orderId=draftOnly?null:(await admin.query("INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,amount_kurus,gift_card_amount_kurus,draft_id) VALUES($1,$2,'gift@test.invalid','Test','{}','card',10000,2000,$3) RETURNING id",[`ORDER-${seq}`,user,draftId])).rows[0].id;
      const cardId=(await admin.query("INSERT INTO gift_cards(code,amount_kurus,balance_kurus,status,buyer_user_id,expires_at) VALUES($1,10000,8000,$2,$3,'2099-01-01') RETURNING id",[`CARD-${seq}`,status,buyer])).rows[0].id;
      const redemptionId=(await admin.query("INSERT INTO gift_card_redemptions(gift_card_id,draft_id,order_id,amount_kurus,redeemed_by_user_id) VALUES($1,$2,$3,2000,$4) RETURNING id",[cardId,draftId,orderId,user])).rows[0].id;
      return {draftId,orderId,cardId,redemptionId};
    }
    async function parent(f:Awaited<ReturnType<typeof fixture>>, amount:number, kind='refund') {
      const id=(await admin.query("INSERT INTO order_refund_records(operation_key,request_hash,kind,payment_scope_key,draft_id,method,cash_amount_kurus,gift_amount_kurus,occurred_at,confirmed_at,admin_email,reason,source_snapshot,result_snapshot,email_payload,email_progress,email_state) VALUES($1,'hash',$2,$3,$4,'gift_credit',0,$5,now(),now(),'admin@test.invalid','Documented gift return','{}','{}','{}','{}','not_required') RETURNING id",[randomUUID(),kind,`draft:${f.draftId}`,f.draftId,amount])).rows[0].id;
      return (await admin.query("INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,$2,$3,0,$4,'{}') RETURNING id",[id,kind,f.orderId,amount])).rows[0].id;
    }
    const balance=async(id:string)=>(await admin.query('SELECT balance_kurus FROM gift_cards WHERE id=$1',[id])).rows[0].balance_kurus;
    const marker=async(id:string)=>(await admin.query('SELECT refunded_at FROM gift_card_redemptions WHERE id=$1',[id])).rows[0].refunded_at;
    const restore=async(f:Awaited<ReturnType<typeof fixture>>,amount:number,parentId:string)=>db.transaction(tx=>restoreGiftCreditTx(tx,{scope:{kind:'order',id:f.orderId!},parent:{refundAllocationId:parentId},allocations:[{redemptionId:f.redemptionId,amountKurus:amount}]}));
    await test('partial then final return credits original card despite different buyer, marker only at completion',async()=>{
      const f=await fixture(); const p=await parent(f,500);
      assert.deepEqual(await restore(f,500,p),{restoredKurus:500,allocations:[{redemptionId:f.redemptionId,restoredKurus:500,remainingKurus:1500}]});
      assert.equal(await balance(f.cardId),8500); assert.equal(await marker(f.redemptionId),null);
      await assert.rejects(restore(f,500,p)); assert.equal(await balance(f.cardId),8500);
      await restore(f,1500,await parent(f,1500)); assert.equal(await balance(f.cardId),10000); assert.ok(await marker(f.redemptionId));
      await assert.rejects(restore(f,1,await parent(f,1))); assert.equal(await balance(f.cardId),10000);
    });
    await test('legacy full marker consumes cap without ledger; expired card remains expired',async()=>{
      const old=await fixture(); await admin.query('UPDATE gift_card_redemptions SET refunded_at=now() WHERE id=$1',[old.redemptionId]);
      await assert.rejects(restore(old,1,await parent(old,1))); assert.equal(await balance(old.cardId),8000);
      const expired=await fixture(false,'expired'); await restore(expired,2000,await parent(expired,2000));
      assert.equal((await admin.query('SELECT status FROM gift_cards WHERE id=$1',[expired.cardId])).rows[0].status,'expired');
    });
    await test('foreign scope, wrong parent total and evidence-only parent refuse unchanged',async()=>{
      const f=await fixture(), other=await fixture();
      await assert.rejects(restore(f,500,await parent(other,500)));
      await assert.rejects(restore(f,500,await parent(f,600)));
      await assert.rejects(restore(f,500,await parent(f,500,'legacy_evidence')));
      assert.equal(await balance(f.cardId),8000);
    });
    await test('cancellation gift parent restores only its child on a shared card',async()=>{
      const a=await fixture(), b=await fixture();
      await admin.query('UPDATE orders SET draft_id=$1 WHERE id=$2',[a.draftId,b.orderId]);
      await admin.query('UPDATE gift_card_redemptions SET draft_id=NULL,gift_card_id=$1 WHERE id=$2',[a.cardId,b.redemptionId]);
      await admin.query('UPDATE gift_cards SET balance_kurus=6000 WHERE id=$1',[a.cardId]);
      await restore(a,2000,await parent(a,2000,'cancellation'));
      assert.equal(await balance(a.cardId),8000); assert.equal(await marker(b.redemptionId),null);
      const sibling={...b,draftId:a.draftId};
      await restore(sibling,2000,await parent(sibling,2000)); assert.equal(await balance(a.cardId),10000);
    });
    await test('duplicate redemption, foreign redemption/user and inconsistent original amount refuse',async()=>{
      const f=await fixture(), other=await fixture(), p=await parent(f,500);
      await assert.rejects(db.transaction(tx=>restoreGiftCreditTx(tx,{scope:{kind:'order',id:f.orderId!},parent:{refundAllocationId:p},allocations:[{redemptionId:f.redemptionId,amountKurus:250},{redemptionId:f.redemptionId,amountKurus:250}]})));
      await assert.rejects(db.transaction(tx=>restoreGiftCreditTx(tx,{scope:{kind:'order',id:f.orderId!},parent:{refundAllocationId:p},allocations:[{redemptionId:other.redemptionId,amountKurus:500}]})));
      await admin.query('UPDATE gift_card_redemptions SET redeemed_by_user_id=$1 WHERE id=$2',[buyer,f.redemptionId]);
      await assert.rejects(restore(f,500,p));
      await admin.query('UPDATE gift_card_redemptions SET redeemed_by_user_id=$1,amount_kurus=2100 WHERE id=$2',[user,f.redemptionId]);
      await assert.rejects(restore(f,500,p)); assert.equal(await balance(f.cardId),8000);
    });
    await test('concurrent over-return allows only one allocation; transaction rollback restores all writes',async()=>{
      const f=await fixture(); const a=await parent(f,1500), b=await parent(f,1500);
      const results=await Promise.allSettled([restore(f,1500,a),restore(f,1500,b)]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal(await balance(f.cardId),9500);
      const p=await parent(f,500);
      await assert.rejects(db.transaction(async tx=>{await restoreGiftCreditTx(tx,{scope:{kind:'order',id:f.orderId!},parent:{refundAllocationId:p},allocations:[{redemptionId:f.redemptionId,amountKurus:500}]});throw new Error('injected audit failure');}));
      assert.equal(await balance(f.cardId),9500); assert.equal(await marker(f.redemptionId),null);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM gift_credit_returns WHERE refund_allocation_id=$1',[p])).rows[0].n,0);
    });
    await test('card lock is acquired before waiting for an existing redemption lock',async()=>{
      const f=await fixture(), p=await parent(f,500);
      await admin.query('BEGIN');
      await admin.query('SELECT id FROM gift_card_redemptions WHERE id=$1 FOR UPDATE',[f.redemptionId]);
      let pidReady!: (pid:number)=>void;
      const pidPromise=new Promise<number>(resolve=>{pidReady=resolve;});
      const {sql}=await import('drizzle-orm');
      const running=db.transaction(async tx=>{
        const result=await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
        pidReady(Number(result.rows[0].pid));
        return restoreGiftCreditTx(tx,{scope:{kind:'order',id:f.orderId!},parent:{refundAllocationId:p},allocations:[{redemptionId:f.redemptionId,amountKurus:500}]});
      });
      // Observe the real SQL wait, then verify the card is already locked.
      try {
        const pid=await pidPromise; let waiting=false;
        for(let attempt=0;attempt<100;attempt++) {
          waiting=(await admin.query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting',[pid])).rows[0].waiting;
          if(waiting) break;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.ok(waiting,'helper waits on the redemption held by this transaction');
        await assert.rejects(admin.query('SELECT id FROM gift_cards WHERE id=$1 FOR UPDATE NOWAIT',[f.cardId]),(e:unknown)=>(e as {code?:string}).code==='55P03');
      } finally {await admin.query('ROLLBACK');await running;}
      assert.equal(await balance(f.cardId),8500);
    });
    await test('draft-only return requires matching expiry parent; confirmed reservation refuses',async()=>{
      const f=await fixture(true);
      await db.transaction(tx=>restoreGiftCreditTx(tx,{scope:{kind:'draft',id:f.draftId},parent:{expiredDraftId:f.draftId},allocations:[{redemptionId:f.redemptionId,amountKurus:2000}]}));
      assert.equal(await balance(f.cardId),10000); assert.ok(await marker(f.redemptionId));
      const confirmed=await fixture();
      await assert.rejects(db.transaction(tx=>restoreGiftCreditTx(tx,{scope:{kind:'draft',id:confirmed.draftId},parent:{expiredDraftId:confirmed.draftId},allocations:[{redemptionId:confirmed.redemptionId,amountKurus:2000}]})));
    });
    await test('no bare full-return export remains; recorded parent returns only partial residual',async()=>{
      assert.equal('refundGiftCardForOrder' in drafts,false);
      const f=await fixture(); await restore(f,500,await parent(f,500));
      await assert.rejects(restore(f,2000,await parent(f,2000))); assert.equal(await balance(f.cardId),8500);
      await restore(f,1500,await parent(f,1500)); assert.equal(await balance(f.cardId),10000);
      assert.equal((await admin.query('SELECT sum(amount_kurus)::int AS n FROM gift_credit_returns WHERE redemption_id=$1',[f.redemptionId])).rows[0].n,2000);
    });
    await test('expiry/failure wrappers record one reservation release and ignore confirmed children',async()=>{
      for(const run of [drafts.expireDraft, (id:string)=>drafts.failDraft(id,'Test failure')]) {
        const f=await fixture(true); await run(f.draftId); await run(f.draftId);
        assert.equal(await balance(f.cardId),10000);
        assert.equal((await admin.query('SELECT count(*)::int AS n FROM gift_credit_returns WHERE expired_draft_id=$1',[f.draftId])).rows[0].n,1);
      }
      const confirmed=await fixture(); await drafts.expireDraft(confirmed.draftId); assert.equal(await balance(confirmed.cardId),8000);
    });
    await test('promotion refuses an imported partial reservation return; clean promotion/expiry race has one winner',async()=>{
      const f=await fixture(true);
      await admin.query("INSERT INTO gift_credit_returns(redemption_id,gift_card_id,amount_kurus,expired_draft_id,balance_effect,balance_before_kurus,balance_after_kurus) VALUES($1,$2,100,$3,'restore',8000,8100)",[f.redemptionId,f.cardId,f.draftId]);
      await admin.query('UPDATE gift_cards SET balance_kurus=8100 WHERE id=$1',[f.cardId]);
      await assert.rejects(drafts.promoteDraftToOrder(f.draftId), /rezervasyonu iade/);
      await assert.rejects(drafts.expireDraft(f.draftId)); // immutable partial expiry claim cannot be rewritten
      assert.equal(await balance(f.cardId),8100);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM orders WHERE draft_id=$1',[f.draftId])).rows[0].n,0);
      const race=await fixture(true);
      const outcomes=await Promise.allSettled([drafts.promoteDraftToOrder(race.draftId),drafts.expireDraft(race.draftId)]);
      const row=(await admin.query('SELECT status FROM order_drafts WHERE id=$1',[race.draftId])).rows[0];
      assert.ok(['confirmed','expired'].includes(row.status));
      assert.equal(await balance(race.cardId),row.status==='confirmed'?8000:10000);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM orders WHERE draft_id=$1',[race.draftId])).rows[0].n,row.status==='confirmed'?1:0);
      if(row.status==='confirmed') assert.equal(outcomes[0].status,'fulfilled');
    });
    console.log(`${checks} gift credit return DB checks passed`);
  } finally {for(const [id,value] of originals){if(value)require.cache[id]=value;else delete require.cache[id];}await pool?.end();await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);await admin.end();fs.rmSync(out,{recursive:true,force:true});}
}
main().then(()=>process.exit(0)).catch(error=>{fs.rmSync(out,{recursive:true,force:true});console.error(error);process.exit(1);});
