/** Real services in a disposable QA55433 schema; no shared-table writes or sends. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { eq, sql } from "drizzle-orm";

const raw = process.env.QA_REFUND_FINANCIAL_DB_URL;
if (!raw) throw new Error("QA_REFUND_FINANCIAL_DB_URL must explicitly select QA55433");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa") throw new Error("Only printer_qa on loopback55433 is allowed");
const namespace = `refund_effects_${randomUUID().replaceAll("-", "")}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "refund-effects-ddl-"));
const admin = new pg.Client({ connectionString: raw });
let checks = 0;
async function main() {
  let pool: pg.Pool | undefined;
  await admin.connect();
  try {
    execFileSync("./node_modules/.bin/drizzle-kit", ["generate", "--config=scripts/db/drizzle-scratch.config.ts"], { env: { ...process.env, SCRATCH_OUT: out }, stdio: "ignore" });
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
    pool = (db as unknown as { $client: pg.Pool }).$client;
    const { orders } = await import("../src/lib/db/schema");
    const { claimableEarningWhere } = await import("../src/lib/services/earning-claimable");
    const { lockPartnerMoney } = await import("../src/lib/services/money-partner-lock");
    const user = (await admin.query("INSERT INTO users(email,full_name) VALUES('refund-effects@example.invalid','QA') RETURNING id")).rows[0].id;
    let seq = 0;
    const test = async (label: string, run: () => Promise<void>) => { await run(); checks++; console.log(`PASS ${label}`); };
    for (const kind of ["manufacturer", "painter"] as const) {
      const partners = kind === "manufacturer" ? "manufacturers" : "painters";
      const batches = kind === "manufacturer" ? "payouts" : "painter_payouts";
      const earnings = `${kind}_earnings`, owner = `${kind}_id`, membership = `${kind}_payout_id`;
      const partner = async () => (await admin.query(`INSERT INTO ${partners}(email,password_hash,company_name,contact_person,phone) VALUES($1,'x','QA','QA','0') RETURNING id`, [`${randomUUID()}@example.invalid`])).rows[0].id as string;
      const order = async (id: string) => (await admin.query(`INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,payment_status,status,amount_kurus,production_base_kurus,painting_price_kurus,commission_rate_bps,${owner}) VALUES($1,$2,'qa@example.invalid','QA','{}','bank_transfer','succeeded','approved',10000,6000,4000,0,$3) RETURNING id`, [`REF-EFFECT-${++seq}`, user, id])).rows[0].id as string;
      const earning = async (id: string, net = 6000) => {
        const orderId = await order(id);
        const row = (await admin.query(`INSERT INTO ${earnings}(order_id,${owner},gross_kurus,commission_kurus,net_kurus,commission_rate_bps) VALUES($1,$2,$3,0,$3,0) RETURNING id`, [orderId, id, net])).rows[0];
        return { id: row.id as string, orderId };
      };
      const adjustment = async (id: string, orderId: string, net: number, source?: string) => (await admin.query(`INSERT INTO partner_adjustments(order_id,${owner},kind,net_kurus,source_kind,source_id,source_snapshot,idempotency_key,request_hash,admin_email,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'hash','qa@example.invalid','Financial effects fixture') RETURNING id`, [orderId, id, net < 0 ? 'unpaid_offset' : 'reprint', net, source ? `${kind}_earning` : null, source ?? null, source ? '{}' : null, randomUUID()])).rows[0].id as string;
      const create = (id: string) => service.createPartnerPayout(kind, id, "qa@example.invalid");
      const accrue = (id: string, orderId: string) => kind === "manufacturer" ? makers.accrueEarning(orderId, id, 10000) : painters.accruePainterEarning(orderId, id, 10000);
      const reverse = (id: string, orderId: string, fail = false) => db.transaction(async tx => {
        await lockPartnerMoney(tx, kind, id);
        await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).for("update");
        const result = await service.reversePartnerEarningTx(tx, { kind, orderId, expectedPartnerId: id });
        if (fail) throw new Error("Injected outer transaction failure");
        return result;
      });
      const snapshot = async (id: string) => ({
        earnings: (await admin.query(`SELECT * FROM ${earnings} WHERE ${owner}=$1 ORDER BY id`, [id])).rows,
        adjustments: (await admin.query(`SELECT * FROM partner_adjustments WHERE ${owner}=$1 ORDER BY id`, [id])).rows,
        batches: (await admin.query(`SELECT * FROM ${batches} WHERE ${owner}=$1 ORDER BY id`, [id])).rows,
      });
      await test(`${kind}: cancellation blocks new accrual; payment remains succeeded`, async () => {
        const id = await partner(), orderId = await order(id);
        await admin.query("UPDATE orders SET status='rejected' WHERE id=$1", [orderId]);
        assert.equal(await accrue(id, orderId), "skipped_cancelled");
        assert.equal((await admin.query(`SELECT count(*)::int n FROM ${earnings} WHERE order_id=$1`, [orderId])).rows[0].n, 0);
        assert.equal((await admin.query("SELECT payment_status FROM orders WHERE id=$1", [orderId])).rows[0].payment_status, 'succeeded');
      });
      await test(`${kind}: cancellation blocks reconciliation and source claim, preserves independent credit`, async () => {
        const id = await partner(), e = await earning(id, 10000);
        await adjustment(id, e.orderId, -2000, e.id);
        const credit = await adjustment(id, e.orderId, 1500);
        await admin.query("UPDATE orders SET status='rejected' WHERE id=$1", [e.orderId]);
        const before = await snapshot(id);
        assert.equal(await accrue(id, e.orderId), "skipped_cancelled");
        assert.deepEqual(await snapshot(id), before);
        const view = await service.readPartnerPayables(kind, id);
        assert.equal(view.claimableNet, 1500);
        assert.equal(view.blockedGroups[0].reason, "order_cancelled");
        const t = service.partnerMoneyTables(kind);
        const projected = await db.select({ id: t.earning.id }).from(t.earning).leftJoin(orders, eq(orders.id, t.earning.orderId)).where(sql`${t.earningOwner} = ${id} and ${claimableEarningWhere(t.earning)}`);
        assert.equal(projected.length, 0);
        const batch = await create(id); assert.ok(batch.ok);
        assert.equal(batch.totalKurus, 1500);
        assert.deepEqual((await service.readPartnerPayables(kind, id, { payoutId: batch.payoutId })).heldMembers.map(m => m.id), [credit]);
      });
      await test(`${kind}: refunded reason stays distinct from cancellation`, async () => {
        const id = await partner(), e = await earning(id);
        await admin.query("UPDATE orders SET payment_status='refunded' WHERE id=$1", [e.orderId]);
        assert.equal(await accrue(id, e.orderId), "skipped_refunded");
        assert.equal((await service.readPartnerPayables(kind, id)).blockedGroups[0].reason, "source_ineligible");
      });
      await test(`${kind}: tx reversal releases exact source offset, recomputes batch, retains other earning and credits`, async () => {
        const id = await partner(), e = await earning(id), other = await earning(id, 3000);
        const debit = await adjustment(id, e.orderId, -2000, e.id), credit = await adjustment(id, e.orderId, 1000);
        const otherDebit = await adjustment(id, other.orderId, -500, other.id);
        const batch = await create(id); assert.ok(batch.ok); assert.equal(batch.totalKurus, 7500);
        const result = await reverse(id, e.orderId);
        assert.deepEqual(result, { outcome: 'reversed', earningId: e.id, netKurus: 6000, affectedPayoutIds: [batch.payoutId] });
        const view = await service.readPartnerPayables(kind, id, { payoutId: batch.payoutId });
        assert.equal(view.heldNet, 3500); assert.equal(view.heldEarningCount, 1); assert.equal(view.heldAdjustmentCount, 2);
        assert.deepEqual(view.heldMembers.map(m => m.id).sort(), [other.id, credit, otherDebit].sort());
        const stored = (await admin.query(`SELECT total_kurus,earning_count,adjustment_count FROM ${batches} WHERE id=$1`, [batch.payoutId])).rows[0];
        assert.deepEqual(stored, { total_kurus: 3500, earning_count: 1, adjustment_count: 2 });
        const offset = (await admin.query(`SELECT status,${membership} AS payout FROM partner_adjustments WHERE id=$1`, [debit])).rows[0];
        assert.deepEqual(offset, { status: 'pending', payout: null });
        const after = await snapshot(id);
        assert.deepEqual(await reverse(id, e.orderId), { outcome: 'already_reversed', earningId: e.id, netKurus: 6000, affectedPayoutIds: [] });
        assert.deepEqual(await snapshot(id), after);
      });
      await test(`${kind}: caller rollback restores original, offset and batch atomically`, async () => {
        const id = await partner(), e = await earning(id);
        await adjustment(id, e.orderId, -1000, e.id); assert.ok((await create(id)).ok);
        const before = await snapshot(id);
        await assert.rejects(() => reverse(id, e.orderId, true), /Injected outer/);
        assert.deepEqual(await snapshot(id), before);
      });
      for (const netting of [false, true]) await test(`${kind}: ${netting ? 'netted' : 'paid'} original and batch retained byte-for-byte`, async () => {
        const id = await partner(), e = await earning(id);
        if (netting) await adjustment(id, e.orderId, -6000, e.id);
        const batch = await create(id); assert.ok(batch.ok);
        const view = await service.readPartnerPayables(kind, id, { payoutId: batch.payoutId });
        assert.ok((await service.settlePartnerPayout(kind, batch.payoutId, netting ? null : 'QA-TRANSFER', { expectedFingerprint: view.fingerprint, adminEmail: 'qa@example.invalid', settlementKind: netting ? 'netting' : 'transfer' })).ok);
        await adjustment(id, e.orderId, 1000);
        const before = await snapshot(id);
        assert.deepEqual(await reverse(id, e.orderId), { outcome: 'paid_retained', earningId: e.id, netKurus: 6000, affectedPayoutIds: [] });
        assert.deepEqual(await snapshot(id), before);
      });
      await test(`${kind}: owner mismatch throws even for a closed earning; absent is explicit`, async () => {
        const id = await partner(), foreign = await partner(), e = await earning(id);
        const before = await snapshot(id);
        await assert.rejects(() => reverse(foreign, e.orderId), /owner/i);
        assert.deepEqual(await snapshot(id), before);
        await reverse(id, e.orderId);
        await assert.rejects(() => reverse(foreign, e.orderId), /owner/i);
        assert.deepEqual(await reverse(id, await order(id)), { outcome: 'absent', affectedPayoutIds: [] });
      });
      await test(`${kind}: public wrapper remains repeatable and live Phase4 reconciliation remains active`, async () => {
        const id = await partner(), e = await earning(id, 1000);
        assert.equal(await accrue(id, e.orderId), 'corrected');
        assert.equal((await admin.query(`SELECT gross_kurus FROM ${earnings} WHERE id=$1`, [e.id])).rows[0].gross_kurus, kind === 'manufacturer' ? 6000 : 4000);
        await service.reversePartnerEarning(kind, e.orderId);
        const before = await snapshot(id);
        await service.reversePartnerEarning(kind, e.orderId);
        assert.deepEqual(await snapshot(id), before);
      });
      await test(`${kind}: cancellation under caller locks wins over waiting late accrual`, async () => {
        const id = await partner(), e = await earning(id);
        let release!: () => void, ready!: () => void;
        const barrier = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { ready = r; });
        const closing = db.transaction(async tx => {
          await lockPartnerMoney(tx, kind, id);
          await tx.update(orders).set({ status: 'rejected' }).where(eq(orders.id, e.orderId));
          await service.reversePartnerEarningTx(tx, { kind, orderId: e.orderId, expectedPartnerId: id });
          ready(); await barrier;
        });
        await locked;
        let finished = false;
        const late = accrue(id, e.orderId).then(result => { finished = true; return result; });
        try { await new Promise(r => setTimeout(r, 75)); assert.equal(finished, false); }
        finally { release(); }
        await closing; assert.equal(await late, 'skipped_cancelled');
        assert.equal((await admin.query(`SELECT status FROM ${earnings} WHERE id=$1`, [e.id])).rows[0].status, 'reversed');
      });
      await test(`${kind}: cancellation wins the gate before settlement; changed batch refuses stale payment`, async () => {
        const id = await partner(), e = await earning(id), batch = await create(id); assert.ok(batch.ok);
        const view = await service.readPartnerPayables(kind, id, { payoutId: batch.payoutId });
        let release!: () => void, ready!: () => void;
        const barrier = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { ready = r; });
        const closing = db.transaction(async tx => {
          await lockPartnerMoney(tx, kind, id);
          await tx.update(orders).set({ status: 'rejected' }).where(eq(orders.id, e.orderId));
          const result = await service.reversePartnerEarningTx(tx, { kind, orderId: e.orderId, expectedPartnerId: id });
          ready(); await barrier; return result;
        });
        await locked;
        let finished = false;
        const paying = service.settlePartnerPayout(kind, batch.payoutId, 'NOT-PAID', {
          expectedFingerprint: view.fingerprint, adminEmail: 'qa@example.invalid', settlementKind: 'transfer',
        }).then(result => { finished = true; return result; });
        try { await new Promise(r => setTimeout(r, 75)); assert.equal(finished, false); }
        finally { release(); }
        assert.equal((await closing).outcome, 'reversed');
        assert.deepEqual(await paying, { ok: false, reason: 'stale_confirmation' });
        const stored = (await admin.query(`SELECT status,total_kurus,paid_at FROM ${batches} WHERE id=$1`, [batch.payoutId])).rows[0];
        assert.deepEqual(stored, { status: 'pending', total_kurus: 0, paid_at: null });
      });
      await test(`${kind}: settlement wins the gate; waiting cancellation retains the paid original`, async () => {
        const id = await partner(), e = await earning(id), batch = await create(id); assert.ok(batch.ok);
        const view = await service.readPartnerPayables(kind, id, { payoutId: batch.payoutId });
        // Hold the order so real settlement acquires its partner gate and waits.
        await admin.query('BEGIN');
        await admin.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [e.orderId]);
        const paying = service.settlePartnerPayout(kind, batch.payoutId, 'PAID-FIRST', {
          expectedFingerprint: view.fingerprint, adminEmail: 'qa@example.invalid', settlementKind: 'transfer',
        });
        // Observe the actual gate owner (not a timing guess) before starting cancellation.
        const gateKey = `partner-money:${kind}:${id.toLowerCase()}`;
        let gateHeld = false;
        try {
          for (let attempt = 0; attempt < 100; attempt++) {
            await admin.query('SAVEPOINT gate_probe');
            const probe = (await admin.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [gateKey])).rows[0].acquired;
            await admin.query('ROLLBACK TO SAVEPOINT gate_probe');
            await admin.query('RELEASE SAVEPOINT gate_probe');
            if (!probe) { gateHeld = true; break; }
            await new Promise(r => setTimeout(r, 10));
          }
          assert.ok(gateHeld);
        } catch (error) { await admin.query('ROLLBACK'); await paying; throw error; }
        const closing = db.transaction(async tx => {
          await lockPartnerMoney(tx, kind, id);
          await tx.update(orders).set({ status: 'rejected' }).where(eq(orders.id, e.orderId));
          return service.reversePartnerEarningTx(tx, { kind, orderId: e.orderId, expectedPartnerId: id });
        });
        await admin.query('COMMIT');
        assert.ok((await paying).ok);
        assert.equal((await closing).outcome, 'paid_retained');
        const stored = (await admin.query(`SELECT status,total_kurus,reference FROM ${batches} WHERE id=$1`, [batch.payoutId])).rows[0];
        assert.deepEqual(stored, { status: 'paid', total_kurus: 6000, reference: 'PAID-FIRST' });
      });
      await test(`${kind}: existing batch on cancelled order cannot settle`, async () => {
        const id = await partner(), e = await earning(id), batch = await create(id); assert.ok(batch.ok);
        const view = await service.readPartnerPayables(kind, id, { payoutId: batch.payoutId });
        await admin.query("UPDATE orders SET status='rejected' WHERE id=$1", [e.orderId]);
        const before = await snapshot(id);
        assert.deepEqual(await service.settlePartnerPayout(kind, batch.payoutId, 'NO-TRANSFER', { expectedFingerprint: view.fingerprint, adminEmail: 'qa@example.invalid', settlementKind: 'transfer' }), { ok: false, reason: 'blocked_groups' });
        assert.deepEqual(await snapshot(id), before);
      });
    }
    const { loadOrderMoneySnapshot } = await import("../src/lib/services/order-money");
    const { deriveOrderMoneyBreakdown } = await import("../src/lib/config/order-money");
    const { CASH_COLLECTED_KURUS, NET_REVENUE_CASH_KURUS, COUNTS_AS_REVENUE } = await import("../src/lib/services/admin-order-sql");
    const moneyOrder = async (status = 'approved', payment = 'succeeded') => (await admin.query("INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,payment_status,status,amount_kurus,production_base_kurus,painting_price_kurus,gift_card_amount_kurus,havale_discount_kurus) VALUES($1,$2,'qa@example.invalid','QA','{}','bank_transfer',$3,$4,10000,10000,0,2000,500) RETURNING id", [`READ-${++seq}`, user, payment, status])).rows[0].id as string;
    const record = async (orderId: string, kind: 'refund' | 'cancellation' | 'legacy_evidence', cash: number, gift: number) => {
      const id = randomUUID();
      await admin.query(`INSERT INTO order_refund_records(id,operation_key,request_hash,kind,payment_scope_key,standalone_order_id,cash_amount_kurus,gift_amount_kurus,method,external_reference,external_reference_key,occurred_at,confirmed_at,admin_email,reason,source_snapshot,result_snapshot)
        VALUES($1,$2,'hash',$3,$4,$5,$6,$7,$8,$9,$9,now(),now(),'qa@example.invalid','Actual read fixture','{}','{}')`, [id, randomUUID(), kind, `order:${orderId}`, orderId, cash, gift, cash ? 'bank_transfer' : gift ? 'gift_credit' : 'none', cash ? id : null]);
      await admin.query("INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,$2,$3,$4,$5,'{}')", [id, kind, orderId, cash, gift]);
    };
    const rows: { id: string; expected: number }[] = [];
    for (const mode of ['partial', 'gift', 'cancelled', 'full', 'legacy'] as const) {
      await test(`money reads: ${mode} actual allocations and SQL revenue agree`, async () => {
        const id = await moneyOrder(mode === 'cancelled' ? 'rejected' : 'approved', mode === 'full' || mode === 'legacy' ? 'refunded' : 'succeeded');
        if (mode === 'partial') { await record(id, 'refund', 2000, 0); await record(id, 'refund', 1000, 500); }
        if (mode === 'gift') await record(id, 'refund', 0, 500);
        if (mode === 'cancelled') await record(id, 'cancellation', 0, 2000);
        if (mode === 'full') await record(id, 'refund', 7500, 2000);
        if (mode === 'legacy') await record(id, 'legacy_evidence', 7500, 2000);
        const snapshot = await loadOrderMoneySnapshot(id); assert.ok(snapshot);
        const money = deriveOrderMoneyBreakdown(snapshot);
        const expected = mode === 'partial' ? 4500 : mode === 'gift' ? 7500 : 0;
        const [row] = await db.select({ original: CASH_COLLECTED_KURUS, revenue: NET_REVENUE_CASH_KURUS }).from(orders).where(eq(orders.id, id));
        assert.equal(Number(row.original), 7500);
        assert.equal(Number(row.revenue), expected);
        assert.equal(money.collection.revenueKurus, expected);
        assert.equal(money.collection.cashCollectedKurus, 7500);
        if (mode === 'partial') { assert.equal(money.collection.cashReturnedKurus, 3000); assert.equal(money.platform.netKurus, 4500); }
        if (mode === 'cancelled') { assert.equal(money.collection.cashRefundDueKurus, 7500); assert.equal(money.platform.netKurus, 0); }
        if (mode === 'legacy') { assert.equal(money.collection.cashRemainingKurus, null); assert.equal(money.collection.cashReturnedKurus, 0); }
        rows.push({ id, expected });
      });
    }
    await test('cancelled child of draft10000/children11000 preserves each persisted unknown cash signal', async () => {
      const draftId = (await admin.query("INSERT INTO order_drafts(reference,user_id,email,customer_name,shipping_address,payment_method,amount_kurus,order_type) VALUES($1,$2,'qa@example.invalid','QA','{}','bank_transfer',10000,'marketplace') RETURNING id", [randomUUID(), user])).rows[0].id;
      const child = await moneyOrder('rejected'), sibling = await moneyOrder();
      for (const [id, amount] of [[child, 6000], [sibling, 5000]]) {
        await admin.query('UPDATE orders SET draft_id=$1::uuid,parent_reference=$1::uuid::text,amount_kurus=$2,production_base_kurus=$2,gift_card_amount_kurus=0,havale_discount_kurus=0 WHERE id=$3', [draftId, amount, id]);
      }
      // Reproduce immutable cancellation snapshots from the coordinator's
      // invalid-lineage branch, without invoking notices or changing core code.
      await record(child, 'cancellation', 0, 0);
      await admin.query("UPDATE order_refund_records SET standalone_order_id=NULL,draft_id=$1,payment_scope_key=$2 WHERE standalone_order_id=$3", [draftId, `draft:${draftId}`, child]);
      for (const [source, result, unknown] of [
        [{ payment: { cashBasisKurus: null } }, { cashRefundRequiredKurus: null }, true],
        [{}, { cashRefundRequiredKurus: null }, true],
        [{ payment: { cashBasisKurus: null } }, {}, true],
        [{ payment: { cashBasisKurus: 10000 } }, { cashRefundRequiredKurus: 6000 }, false],
        [{}, {}, false],
      ] as const) {
        await admin.query('UPDATE order_refund_records SET source_snapshot=$1,result_snapshot=$2 WHERE draft_id=$3', [JSON.stringify(source), JSON.stringify(result), draftId]);
        const snapshot = await loadOrderMoneySnapshot(child); assert.ok(snapshot);
        const money = deriveOrderMoneyBreakdown(snapshot);
        assert.equal(money.collection.cashRefundDueKurus, unknown ? null : 6000);
        assert.equal(money.collection.cashRemainingKurus, unknown ? null : 6000);
        assert.equal(snapshot.refunds?.[0].cancellationCashUnknown, unknown);
        assert.equal(money.collection.cashCollectedKurus, 6000);
        assert.equal(money.collection.cashReturnedKurus, 0);
        assert.equal(money.collection.giftReturnedKurus, 0);
        assert.equal(money.collection.revenueKurus, 0);
        assert.equal(money.collection.legacyRefundUnknown, false);
      }
    });
    await test('revenue aggregate subtracts child actual cash returns once, excluding legacy and cancellation liabilities', async () => {
      const [row] = await db.select({ total: sql`SUM(${NET_REVENUE_CASH_KURUS})` }).from(orders)
        .where(sql`${orders.id} IN (${sql.join(rows.map(r => sql`${r.id}`), sql`, `)}) AND ${COUNTS_AS_REVENUE}`);
      assert.equal(Number(row.total), rows.reduce((total, r) => total + r.expected, 0));
    });
    await test('refund read failure propagates instead of producing zero returns', async () => {
      await admin.query('ALTER TABLE order_refund_allocations RENAME TO refund_allocations_unavailable');
      try { await assert.rejects(() => loadOrderMoneySnapshot(rows[0].id)); }
      finally { await admin.query('ALTER TABLE refund_allocations_unavailable RENAME TO order_refund_allocations'); }
    });
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end(); fs.rmSync(out, { recursive: true, force: true });
  }
  console.log(`${checks} refund financial-effects DB checks passed; disposable schema removed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
