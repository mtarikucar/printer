/** Isolated QA schema only. Current-schema fixtures are removed in finally. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { PayoutListScope, PayoutListRow, PayoutStatusFilter } from "../src/lib/config/payout-list";

const connectionString = process.env.QA_MONEY_PG_URL;
if (!connectionString) throw new Error("QA_MONEY_PG_URL required");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55433") throw new Error("Refusing non-QA database");
const namespace = `payout_list_${Date.now()}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "payout-list-ddl-"));
const admin = new pg.Client({ connectionString });
let checks = 0;
const test = async (name: string, run: () => Promise<void>) => { await run(); checks++; console.log(`PASS ${name}`); };
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
    const { readPayoutPage, loadPayoutPage } = await import("../src/lib/services/payout-list");
    const { readPartnerPayables } = await import("../src/lib/services/partner-payables");
    const { db } = await import("../src/lib/db");
    const user = (await admin.query("INSERT INTO users(email,full_name) VALUES('list@test.invalid','Secret Customer') RETURNING id")).rows[0].id;
    const walk = async (scope: PayoutListScope, status: PayoutStatusFilter = "all", limit = 17) => {
      const rows: PayoutListRow[] = []; let cursor: string | undefined;
      do {
        const page = await readPayoutPage(scope, { status, limit, ...(cursor ? { cursor } : {}) });
        assert.ok(page.rows.length <= limit); rows.push(...page.rows);
        if (!page.hasMore) { assert.equal(page.nextCursor, null); break; }
        assert.ok(page.nextCursor && page.nextCursor !== cursor && page.rows.length === limit);
        cursor = page.nextCursor;
        assert.ok(rows.length < 1000, "traversal must progress");
      } while (true);
      assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
      return rows;
    };
    for (const kind of ["manufacturer", "painter"] as const) {
      const partnerTable = kind === "manufacturer" ? "manufacturers" : "painters";
      const batchTable = kind === "manufacturer" ? "payouts" : "painter_payouts";
      const ownerColumn = `${kind}_id`;
      const owner = async () => (await admin.query(`INSERT INTO ${partnerTable}(email,password_hash,company_name,contact_person,phone,iban,bank_account_holder,bank_name,pending_iban) VALUES($1,'x','Partner','Contact','0','BANK_SECRET','HOLDER_SECRET','BANK_NAME_SECRET','PENDING_SECRET') RETURNING id`, [`${randomUUID()}@test.invalid`])).rows[0].id as string;
      const a = await owner(), b = await owner();
      // 133 records per kind: beyond both old caps, equal timestamp UUID ties,
      // and differences within one JS millisecond exactly at page boundaries.
      for (let i = 0; i < 133; i++) {
        const state = i % 5, paid = state === 1 || state === 2, netting = state === 2;
        await admin.query(`INSERT INTO ${batchTable}(${ownerColumn},total_kurus,earning_count,admin_email,status,settlement_kind,created_at,paid_at,paid_by,reference,voided_at,voided_by,void_reason,void_snapshot,void_operation_key,void_request_hash)
          VALUES($1,$2,0,'OPERATOR_SECRET',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [i < 117 ? a : b, netting ? 0 : 100, paid ? 'paid' : 'pending', netting ? 'netting' : 'transfer', `2026-09-17 12:00:00.${String(Math.floor(i / 3)).padStart(6, '0')}`, paid ? '2026-09-18' : null, paid ? 'PAID_OPERATOR_SECRET' : null, paid && !netting ? 'BANK-REF' : null, state === 3 ? '2026-09-19' : null, state === 3 ? 'VOID_OPERATOR_SECRET' : null, state === 3 ? 'Wrong batch cancelled' : null, state === 3 ? '{"operator":"SNAPSHOT_SECRET"}' : null, state === 3 ? randomUUID() : null, state === 3 ? 'void-hash' : null]);
      }
      const scope = { audience: "partner" as const, kind, partnerId: a };
      await test(`${kind}: exact keyset traverses admin >100 and owner >50 without gaps/ties`, async () => {
        const all = await walk({ audience: "admin", kind });
        assert.deepEqual(all.map(r => r.id), (await admin.query(`SELECT id FROM ${batchTable} ORDER BY created_at DESC,id DESC`)).rows.map(r => r.id));
        const own = await walk(scope);
        assert.equal(own.length, 117); assert.ok(own.every(r => r.partnerId === a));
        assert.deepEqual(own.map(r => r.id), (await walk({ audience: "admin", kind, partnerId: a }, "all", 100)).map(r => r.id));
        assert.ok(new Set(own.map(r => r.createdAtExact)).size > 1);
        assert.equal(new Set(own.map(r => r.createdAt)).size, 1, "fixtures exercise sub-millisecond loss");
      });
      await test(`${kind}: semantic statuses partition all history and admin audit stays private`, async () => {
        const all = await walk(scope); const filtered: string[] = [];
        for (const status of ["pending", "paid", "netted", "voided"] as const) {
          const rows = await walk(scope, status); assert.ok(rows.length); assert.ok(rows.every(r => r.displayStatus === status));
          assert.deepEqual(rows.map(r => r.id), all.filter(r => r.displayStatus === status).map(r => r.id)); filtered.push(...rows.map(r => r.id));
        }
        assert.equal(new Set(filtered).size, all.length); assert.equal(filtered.length, all.length);
        const forbidden = ["bank", "adminEmail", "paidBy", "voidedBy", "voidSnapshot", "customerName", "shippingAddress", "email"];
        for (const row of all) for (const key of forbidden) assert.equal(Object.hasOwn(row, key), false);
        assert.doesNotMatch(JSON.stringify(all), /SECRET|Secret Customer/);
        const audit = await readPayoutPage({ audience: "admin", kind, partnerId: a }, { status: "voided", limit: 1 });
        assert.equal(audit.rows[0].voidedBy, 'VOID_OPERATOR_SECRET'); assert.ok(audit.rows[0].voidSnapshot); assert.equal(audit.rows[0].bank.iban, 'BANK_SECRET');
      });
      await test(`${kind}: shared membership/offset fingerprint and full balances survive pagination`, async () => {
        const orderId = (await admin.query("INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,production_base_kurus,painting_price_kurus) VALUES($1,$2,'customer@test.invalid','Secret Customer','{}','bank_transfer','approved',10000,6000,4000) RETURNING id", [`LIST-${kind}`, user])).rows[0].id;
        const batch = (await admin.query(`INSERT INTO ${batchTable}(${ownerColumn},total_kurus,earning_count,adjustment_count,admin_email) VALUES($1,4000,1,1,'admin@test.invalid') RETURNING id`, [a])).rows[0].id;
        const source = (await admin.query(`INSERT INTO ${kind}_earnings(order_id,${ownerColumn},gross_kurus,commission_kurus,net_kurus,commission_rate_bps,payout_id) VALUES($1,$2,6000,0,6000,0,$3) RETURNING id`, [orderId, a, batch])).rows[0].id;
        await admin.query(`INSERT INTO partner_adjustments(order_id,${ownerColumn},kind,net_kurus,source_kind,source_id,source_snapshot,idempotency_key,request_hash,admin_email,reason,${kind}_payout_id) VALUES($1,$2,'unpaid_offset',-2000,$3,$4,'{}',$5,'hash','ADJUSTMENT_OPERATOR_SECRET','Documented net correction',$6)`, [orderId, a, `${kind}_earning`, source, randomUUID(), batch]);
        const before = await readPartnerPayables(kind, a);
        const row = (await walk(scope)).find(r => r.id === batch)!;
        const shared = before.payouts.find(p => p.id === batch)!;
        assert.equal(row.heldNet, 4000); assert.equal(row.heldEarningCount, 1); assert.equal(row.heldAdjustmentCount, 1);
        assert.equal(row.expectedFingerprint, shared.fingerprint); assert.equal(row.blockedReason, null);
        assert.equal(row.earnings[0].netKurus, 6000); assert.equal(row.adjustments[0].sourceId, source); assert.equal(row.adjustments[0].netKurus, -2000);
        await readPayoutPage(scope, { status: "paid", limit: 1 });
        assert.deepEqual(await readPartnerPayables(kind, a), before);
        await admin.query("UPDATE orders SET payment_status='refunded' WHERE id=$1", [orderId]);
        const refunded = (await walk(scope)).find(r => r.id === batch)!;
        assert.equal(refunded.earnings[0].refunded, true);
        assert.ok(refunded.blockedReason, "current refund gate is retained by the shared reader");
      });
      await test(`${kind}: same-transaction traversal retains snapshot during concurrent insert`, async () => {
        await db.transaction(async tx => {
          const first = await loadPayoutPage(tx, scope, { status: "all", limit: 100 });
          const expected = (await admin.query(`SELECT id FROM ${batchTable} WHERE ${ownerColumn}=$1 ORDER BY created_at DESC,id DESC`, [a])).rows.map(r => r.id);
          await admin.query(`INSERT INTO ${batchTable}(${ownerColumn},total_kurus,earning_count,admin_email,created_at) VALUES($1,100,0,'new@test.invalid','2027-01-01')`, [a]);
          const second = await loadPayoutPage(tx, scope, { status: "all", limit: 100, cursor: first.nextCursor! });
          assert.deepEqual([...first.rows, ...second.rows].map(r => r.id), expected);
          assert.equal(second.hasMore, false);
        }, { isolationLevel: "repeatable read", accessMode: "read only" });
      });
      await test(`${kind}: unavailable shared membership refuses whole page`, async () => {
        await admin.query('ALTER TABLE partner_adjustments RENAME TO unavailable_adjustments');
        try { await assert.rejects(readPayoutPage(scope, { status: "all", limit: 1 })); }
        finally { await admin.query('ALTER TABLE unavailable_adjustments RENAME TO partner_adjustments'); }
      });
    }
    console.log(`${checks} payout list DB checks passed`);
  } finally {
    const { db } = await import("../src/lib/db");
    await (db as typeof db & { $client: pg.Pool }).$client.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`); await admin.end();
    fs.rmSync(out, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
