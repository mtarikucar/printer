/** Isolated 55433 schema. Up: current schema + fixtures. Down: drop exact schema. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.QA_MONEY_PG_URL;
if (!connectionString) throw new Error("QA_MONEY_PG_URL required");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55433") throw new Error("Refusing non-QA database");
const namespace = `partner_payables_${Date.now()}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "partner-payables-ddl-"));
const admin = new pg.Client({ connectionString });
let checks = 0;
async function main() {
  await admin.connect();
  try {
    execFileSync("npx", ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"], { env: { ...process.env, SCRATCH_OUT: out }, stdio: "ignore" });
    const ddl = fs.readFileSync(path.join(out, fs.readdirSync(out).find(f => f.endsWith(".sql"))!), "utf8").replace(/"public"\./g, "");
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await admin.query(`SET search_path TO ${namespace}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter(s => s.trim())) await admin.query(statement);
    url.searchParams.set("options", `-c search_path=${namespace}`);
    process.env.DATABASE_URL = url.toString();
    const service = await import("../src/lib/services/partner-payables");
    const makers = await import("../src/lib/services/payouts");
    const painters = await import("../src/lib/services/painter-payouts");
    const { db } = await import("../src/lib/db");
    const { lockPartnerMoney } = await import("../src/lib/services/money-partner-lock");
    const { verifyClaimedPayableMembers } = await import("../src/lib/services/payout-claim");
    const user = (await admin.query("INSERT INTO users(email,full_name) VALUES('payables@test.invalid','Test') RETURNING id")).rows[0].id;
    let seq = 0;
    const order = async () => (await admin.query("INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,production_base_kurus,painting_price_kurus) VALUES($1,$2,'test@test.invalid','Test','{}','bank_transfer','approved',10000,6000,4000) RETURNING id", [`PAY-${++seq}`, user])).rows[0].id as string;
    const test = async (name: string, run: () => Promise<void>) => { await run(); checks++; console.log(`PASS ${name}`); };
    for (const kind of ["manufacturer", "painter"] as const) {
      const partnerTable = kind === "manufacturer" ? "manufacturers" : "painters";
      const batchTable = kind === "manufacturer" ? "payouts" : "painter_payouts";
      const earningTable = `${kind}_earnings`, ownerColumn = `${kind}_id`, membership = `${kind}_payout_id`;
      const partner = async () => (await admin.query(`INSERT INTO ${partnerTable}(email,password_hash,company_name,contact_person,phone) VALUES($1,'x','Test','Test','0') RETURNING id`, [`${randomUUID()}@test.invalid`])).rows[0].id as string;
      const earning = async (id: string, net = 6000) => {
        const orderId = await order();
        const row = (await admin.query(`INSERT INTO ${earningTable}(order_id,${ownerColumn},gross_kurus,commission_kurus,net_kurus,commission_rate_bps) VALUES($1,$2,$3,0,$3,0) RETURNING id`, [orderId,id,net])).rows[0];
        return { id: row.id as string, orderId };
      };
      const adjustment = async (id: string, orderId: string, net: number, source?: {kind:string;id:string}) => {
        const row = (await admin.query(`INSERT INTO partner_adjustments(order_id,${ownerColumn},kind,net_kurus,source_kind,source_id,source_snapshot,idempotency_key,request_hash,admin_email,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'hash','admin@test.invalid','Manual test adjustment') RETURNING id`, [orderId,id,net<0?'unpaid_offset':'reprint',net,source?.kind??null,source?.id??null,source?JSON.stringify(source):null,randomUUID()])).rows[0];
        return row.id as string;
      };
      const create = (id: string) => kind === "manufacturer" ? makers.createPayoutForManufacturer(id,"admin@test.invalid") : painters.createPayoutForPainter(id,"admin@test.invalid");
      const confirm = async (id: string, payoutId: string) => {
        const view=await service.readPartnerPayables(kind,id,{payoutId});
        return { adminEmail:"admin@test.invalid", expectedFingerprint:view.fingerprint, settlementKind:view.payouts.find(p=>p.id===payoutId)!.settlementKind };
      };
      const settle = (payoutId: string, args: Awaited<ReturnType<typeof confirm>>, reference: string|null = "BANK-1") => kind === "manufacturer" ? makers.markPayoutPaid(payoutId,reference,args) : painters.markPainterPayoutPaid(payoutId,reference,args);
      const voidBatch = (payoutId: string, args: Awaited<ReturnType<typeof confirm>>) => service.voidPartnerPayout(kind,payoutId,{...args,reason:"Cancel before bank transfer",idempotencyKey:randomUUID()});
      await test(`${kind}: duplicate claim holds the whole source+offset group once`, async () => {
        const id=await partner(), e=await earning(id);
        await adjustment(id,e.orderId,-2000,{kind:`${kind}_earning`,id:e.id});
        const results=await Promise.all([create(id),create(id)]);
        assert.equal(results.filter(r=>r.ok).length,1);
        const batch=results.find(r=>r.ok)!; assert.ok(batch.ok);
        assert.equal(batch.totalKurus,4000); assert.equal(batch.adjustmentCount,1);
        const view=await service.readPartnerPayables(kind,id,{payoutId:batch.payoutId});
        assert.equal(view.heldMembers.length,2); assert.equal(view.blockedGroups.length,0);
        const args=await confirm(id,batch.payoutId);
        assert.deepEqual(await settle(batch.payoutId,{...args,settlementKind:"netting"},null),{ok:false,reason:"invalid_request"});
        assert.equal((await settle(batch.payoutId,args)).ok,true);
        const replay=await settle(batch.payoutId,args); assert.ok(replay.ok); assert.equal(replay.replayed,true);
        assert.deepEqual(await settle(batch.payoutId,args,"different"),{ok:false,reason:"payload_conflict"});
        assert.equal((await service.readPartnerPayables(kind,id)).paidTransferNet,4000);
      });
      await test(`${kind}: reversal releases source debits and recomputes only remaining liability`, async () => {
        const id=await partner(), e=await earning(id), other=await earning(id,3000);
        const debit=await adjustment(id,e.orderId,-2000,{kind:`${kind}_earning`,id:e.id});
        const batch=await create(id); assert.ok(batch.ok); assert.equal(batch.totalKurus,7000);
        const stale=await confirm(id,batch.payoutId);
        await service.reversePartnerEarning(kind,e.orderId);
        const view=await service.readPartnerPayables(kind,id,{payoutId:batch.payoutId});
        assert.equal(view.heldNet,3000); assert.equal(view.heldAdjustmentCount,0);
        assert.deepEqual(view.heldMembers.map(m=>m.id),[other.id]);
        assert.equal((await admin.query(`SELECT ${membership} AS payout FROM partner_adjustments WHERE id=$1`,[debit])).rows[0].payout,null);
        assert.deepEqual(await settle(batch.payoutId,stale),{ok:false,reason:"stale_confirmation"});
        assert.equal((await settle(batch.payoutId,await confirm(id,batch.payoutId))).ok,true);
        let blocked=(await service.readPartnerPayables(kind,id)).blockedGroups;
        assert.equal(blocked[0].reason,"reversed");
        await admin.query(`DELETE FROM ${earningTable} WHERE id=$1`,[e.id]);
        blocked=(await service.readPartnerPayables(kind,id)).blockedGroups;
        assert.equal(blocked[0].reason,"missing");
      });
      await test(`${kind}: refund blocks original source but independent compensation remains payable`, async () => {
        const id=await partner(), e=await earning(id);
        await adjustment(id,e.orderId,2000);
        await admin.query("UPDATE orders SET payment_status='refunded' WHERE id=$1",[e.orderId]);
        const batch=await create(id); assert.ok(batch.ok); assert.equal(batch.totalKurus,2000); assert.equal(batch.count,0);
        assert.equal((await settle(batch.payoutId,await confirm(id,batch.payoutId))).ok,true);
        assert.equal((await service.readPartnerPayables(kind,id)).blockedGroups[0].reason,"source_ineligible");
        const second=await earning(id), claimed=await create(id); assert.ok(claimed.ok);
        const before=await confirm(id,claimed.payoutId);
        await admin.query("UPDATE orders SET payment_status='refunded' WHERE id=$1",[second.orderId]);
        assert.deepEqual(await settle(claimed.payoutId,before),{ok:false,reason:"blocked_groups"});
      });
      await test(`${kind}: void versus settlement has exactly one winner`, async () => {
        const id=await partner(); await earning(id);
        const batch=await create(id); assert.ok(batch.ok); const args=await confirm(id,batch.payoutId);
        const outcomes=await Promise.all([voidBatch(batch.payoutId,args),settle(batch.payoutId,args)]);
        assert.equal(outcomes.filter(r=>r.ok).length,1);
        const row=(await admin.query(`SELECT status,voided_at,total_kurus FROM ${batchTable} WHERE id=$1`,[batch.payoutId])).rows[0];
        assert.equal(row.total_kurus,6000); assert.notEqual(row.status==='paid',!!row.voided_at);
      });
      await test(`${kind}: void preserves audit/totals, releases groups and replays strictly`, async () => {
        const id=await partner(), e=await earning(id);
        await adjustment(id,e.orderId,-1000,{kind:`${kind}_earning`,id:e.id});
        const batch=await create(id); assert.ok(batch.ok);
        const args={...await confirm(id,batch.payoutId),reason:"Cancel before bank transfer",idempotencyKey:randomUUID()};
        const first=await service.voidPartnerPayout(kind,batch.payoutId,args); assert.ok(first.ok); assert.equal(first.replayed,false);
        const replay=await service.voidPartnerPayout(kind,batch.payoutId,args); assert.ok(replay.ok); assert.equal(replay.replayed,true);
        assert.deepEqual(await service.voidPartnerPayout(kind,batch.payoutId,{...args,reason:"Different cancellation reason"}),{ok:false,reason:"payload_conflict"});
        const row=(await admin.query(`SELECT total_kurus,earning_count,adjustment_count,void_snapshot,admin_email FROM ${batchTable} WHERE id=$1`,[batch.payoutId])).rows[0];
        assert.equal(row.total_kurus,5000); assert.equal(row.earning_count,1); assert.equal(row.adjustment_count,1);
        assert.equal(row.void_snapshot.members.length,2); assert.equal(row.admin_email,"admin@test.invalid");
        const view=await service.readPartnerPayables(kind,id); assert.equal(view.claimableNet,5000); assert.equal(view.pendingPayoutNet,0);
        assert.equal((await create(id)).ok,true);
      });
      await test(`${kind}: zero-net group uses explicit netting; positive source can itself have offsets`, async () => {
        const id=await partner(), orderId=await order();
        const credit=await adjustment(id,orderId,3000);
        await adjustment(id,orderId,-3000,{kind:"adjustment",id:credit});
        const view=await service.readPartnerPayables(kind,id); assert.equal(view.claimableCount,1); assert.equal(view.hasZeroNetGroups,true);
        const batch=await create(id); assert.ok(batch.ok); assert.equal(batch.settlementKind,"netting"); assert.equal(batch.totalKurus,0);
        const args=await confirm(id,batch.payoutId);
        assert.deepEqual(await settle(batch.payoutId,args),{ok:false,reason:"invalid_request"});
        const paid=await settle(batch.payoutId,args,null); assert.ok(paid.ok); assert.equal(paid.settlementKind,"netting");
        const after=await service.readPartnerPayables(kind,id); assert.equal(after.settledNettingCount,1); assert.equal(after.paidTransferNet,0);
      });
      await test(`${kind}: reduced source blocks the group without charging unrelated work`, async () => {
        const id=await partner(), e=await earning(id,6000); await earning(id,1000);
        await adjustment(id,e.orderId,-4000,{kind:`${kind}_earning`,id:e.id});
        await admin.query(`UPDATE ${earningTable} SET net_kurus=3000 WHERE id=$1`,[e.id]);
        const view=await service.readPartnerPayables(kind,id); assert.equal(view.claimableNet,1000); assert.equal(view.blockedGroups[0].reason,"offset_exceeds_source");
        const batch=await create(id); assert.ok(batch.ok); assert.equal(batch.totalKurus,1000);
      });
      await test(`${kind}: gate precedes order locks and release permits the waiting claim`, async () => {
        const id=await partner(); await earning(id);
        let release!:()=>void, acquired!:()=>void;
        const ready=new Promise<void>(resolve=>{acquired=resolve;}), barrier=new Promise<void>(resolve=>{release=resolve;});
        const first=db.transaction(async tx=>{await lockPartnerMoney(tx,kind,id.toUpperCase()); acquired(); await barrier;});
        await ready;
        let done=false; const contender=create(id).then(r=>{done=true;return r;});
        await new Promise(resolve=>setTimeout(resolve,60)); assert.equal(done,false);
        release(); await first; assert.equal((await contender).ok,true);
      });
      await test(`${kind}: Phase4 automatic reconciliation remains active and blocks newly excessive offsets`, async () => {
        const id=await partner(), e=await earning(id,10000);
        await admin.query("UPDATE orders SET commission_rate_bps=0 WHERE id=$1",[e.orderId]);
        await adjustment(id,e.orderId,-7000,{kind:`${kind}_earning`,id:e.id});
        const outcome=kind==="manufacturer" ? await makers.accrueEarning(e.orderId,id,10000) : await painters.accruePainterEarning(e.orderId,id,10000);
        assert.equal(outcome,"corrected");
        const row=(await admin.query(`SELECT gross_kurus,net_kurus FROM ${earningTable} WHERE id=$1`,[e.id])).rows[0];
        assert.equal(row.gross_kurus,kind==="manufacturer"?6000:4000);
        assert.equal(row.net_kurus,row.gross_kurus);
        const view=await service.readPartnerPayables(kind,id);
        assert.equal(view.claimableNet,0); assert.equal(view.blockedGroups[0].reason,"offset_exceeds_source");
      });
      await test(`${kind}: settlement waits for a refund order lock and then refuses`, async () => {
        const id=await partner(), e=await earning(id), batch=await create(id); assert.ok(batch.ok);
        const args=await confirm(id,batch.payoutId);
        await admin.query("BEGIN");
        try {
          await admin.query("UPDATE orders SET payment_status='refunded' WHERE id=$1",[e.orderId]);
          let done=false; const paying=settle(batch.payoutId,args).then(r=>{done=true;return r;});
          await new Promise(resolve=>setTimeout(resolve,60)); assert.equal(done,false);
          await admin.query("COMMIT");
          assert.deepEqual(await paying,{ok:false,reason:"blocked_groups"});
        } catch (error) { await admin.query("ROLLBACK"); throw error; }
      });
      await test(`${kind}: empty deletion preserves adjustment-only and void audit rows`, async () => {
        const id=await partner(), orderId=await order(); await adjustment(id,orderId,1000);
        const batch=await create(id); assert.ok(batch.ok);
        assert.deepEqual(await service.deleteEmptyPartnerPayout(kind,batch.payoutId),{ok:false,reason:"has_earnings",heldCount:1});
        assert.equal((await voidBatch(batch.payoutId,await confirm(id,batch.payoutId))).ok,true);
        assert.deepEqual(await service.deleteEmptyPartnerPayout(kind,batch.payoutId),{ok:false,reason:"already_paid"});
        assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${batchTable} WHERE id=$1`,[batch.payoutId])).rows[0].n,1);
      });
    }
    await test("stamp validation rejects equal totals with swapped individual amounts",async()=>{
      assert.throws(()=>verifyClaimedPayableMembers([{sourceKind:'adjustment',id:'a',netKurus:100},{sourceKind:'adjustment',id:'b',netKurus:200}], [{sourceKind:'adjustment',id:'a',netKurus:200},{sourceKind:'adjustment',id:'b',netKurus:100}]));
    });
    console.log(`${checks}/${checks} partner payables DB cases passed`);
  } finally {
    const { db } = await import("../src/lib/db");
    await (db as typeof db & { $client: pg.Pool }).$client.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end();
    fs.rmSync(out,{recursive:true,force:true});
  }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
