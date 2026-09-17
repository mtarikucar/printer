/** Real CSV over real loadPayoutPage; exact disposable 55433 schema up/down. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { MoneyTx } from "../src/lib/services/money-partner-lock";
import type { PayoutListScope, PayoutListQuery } from "../src/lib/config/payout-list";
const require = createRequire(import.meta.url);
const raw = process.env.QA_PAYOUT_EXPORT_DB_URL;
if (!raw) throw new Error("QA_PAYOUT_EXPORT_DB_URL must explicitly select printer_qa:55433");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa") throw new Error("Only isolated QA55433 is allowed");
const ns = `payout_export_${Date.now()}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "payout-export-ddl-"));
const admin = new pg.Client({ connectionString: raw });
let checks = 0;
function check(label: string, actual: unknown, expected: unknown) { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); }
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(cell); cell = ""; }
    else if (!quoted && c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  assert.equal(quoted, false); assert.equal(row.length, 0); assert.equal(cell, ""); return rows;
}
async function main() {
  await admin.connect(); let pool: pg.Pool | undefined; let moduleId: string | undefined; let original: NodeJS.Module | undefined;
  try {
    execFileSync("npx", ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"], { env: { ...process.env, SCRATCH_OUT: out }, stdio: "ignore" });
    const ddl = fs.readFileSync(path.join(out, fs.readdirSync(out).find(f => f.endsWith(".sql"))!), "utf8").replace(/"public"\./g, "");
    await admin.query(`CREATE SCHEMA ${ns}`); await admin.query(`SET search_path TO ${ns}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter(s => s.trim())) await admin.query(statement);
    url.searchParams.set("options", `-c search_path=${ns}`); process.env.DATABASE_URL = url.toString();
    const real = await import("../src/lib/services/payout-list");
    let afterFirst: (() => Promise<void>) | undefined;
    let failOnSecond = false; let calls = 0;
    moduleId = require.resolve("../src/lib/services/payout-list"); original = require.cache[moduleId];
    require.cache[moduleId] = { id: moduleId, filename: moduleId, loaded: true, exports: { ...real, loadPayoutPage: async (tx: MoneyTx, scope: PayoutListScope, query: PayoutListQuery) => {
      calls++; if (failOnSecond && query.cursor) throw new Error("Injected later-page database failure");
      const page = await real.loadPayoutPage(tx, scope, query);
      if (afterFirst && !query.cursor) { const mutate = afterFirst; afterFirst = undefined; await mutate(); }
      return page;
    } } } as NodeJS.Module;
    const { exportPayoutCsv } = await import("../src/lib/services/payout-export");
    const { db } = await import("../src/lib/db"); pool = (db as unknown as { $client: pg.Pool }).$client;
    const user = (await admin.query("INSERT INTO users(email,full_name) VALUES('csv@example.invalid','PRIVATE-CUSTOMER') RETURNING id")).rows[0].id;
    let orderNumber = 0;
    for (const kind of ["manufacturer", "painter"] as const) {
      const partners = kind === "manufacturer" ? "manufacturers" : "painters", batches = kind === "manufacturer" ? "payouts" : "painter_payouts";
      const earnings = `${kind}_earnings`, owner = `${kind}_id`, membership = `${kind}_payout_id`;
      const partner = (await admin.query(`INSERT INTO ${partners}(email,password_hash,company_name,contact_person,phone) VALUES($1,'x',$2,'QA','0') RETURNING id`, [`${kind}@example.invalid`, '\u200b=SUM(1,2)'])).rows[0].id;
      const foreign = (await admin.query(`INSERT INTO ${partners}(email,password_hash,company_name,contact_person,phone) VALUES($1,'x','FOREIGN-PARTNER','QA','0') RETURNING id`, [`foreign-${kind}@example.invalid`])).rows[0].id;
      const ids: string[] = [];
      async function order() { return (await admin.query("INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,production_base_kurus) VALUES($1,$2,'PRIVATE-CUSTOMER@example.invalid','PRIVATE-CUSTOMER','{}','bank_transfer','approved',10000,10000) RETURNING id", [`CSV-${++orderNumber}`, user])).rows[0].id as string; }
      for (let i = 0; i < 125; i++) {
        const type = i % 4, netted = type === 2, voided = type === 3, paid = type === 1 || netted;
        const id = randomUUID(); ids.push(id);
        await admin.query(`INSERT INTO ${batches}(id,${owner},total_kurus,earning_count,adjustment_count,admin_email,status,settlement_kind,paid_at,paid_by,reference,created_at,voided_at,voided_by,void_reason,void_snapshot,void_operation_key,void_request_hash)
          VALUES($1,$2,$3,1,$4,'PRIVATE-OPERATOR',$5,$6,$7,$8,$9,timestamp '2026-09-17 00:00:00.123456' + $10::int * interval '1 microsecond',$11,$12,$13,$14,$15,$16)`,
          [id, partner, netted ? 0 : 6000, netted ? 1 : 0, paid ? 'paid' : 'pending', netted ? 'netting' : 'transfer', paid ? new Date() : null, paid ? 'PRIVATE-PAYER' : null,
            netted ? null : '\t=REFERENCE()', Math.floor(i / 2), voided ? new Date() : null, voided ? 'PRIVATE-VOIDER' : null, voided ? 'İptal gerekçesi, "satır"\nkorundu' : null,
            voided ? JSON.stringify({ originalTotal: 6000, source: 'retained-audit' }) : null, voided ? randomUUID() : null, voided ? 'void-hash' : null]);
        const orderId = await order();
        const earning = (await admin.query(`INSERT INTO ${earnings}(order_id,${owner},gross_kurus,commission_kurus,net_kurus,commission_rate_bps,status,payout_id) VALUES($1,$2,10000,4000,6000,4000,$3,$4) RETURNING id`, [orderId, partner, paid ? 'paid' : 'pending', voided ? null : id])).rows[0].id;
        if (netted) await admin.query(`INSERT INTO partner_adjustments(order_id,${owner},kind,net_kurus,source_kind,source_id,source_snapshot,idempotency_key,request_hash,admin_email,reason,status,settled_at,${membership}) VALUES($1,$2,'unpaid_offset',-6000,$3,$4,'{}',$5,'hash','PRIVATE-OPERATOR','Same source fully offset','settled',now(),$6)`, [orderId, partner, `${kind}_earning`, earning, randomUUID(), id]);
      }
      const adjustmentOnly = (await admin.query(`INSERT INTO ${batches}(${owner},total_kurus,earning_count,adjustment_count,admin_email) VALUES($1,1000,0,1,'PRIVATE-OPERATOR') RETURNING id`, [partner])).rows[0].id;
      await admin.query(`INSERT INTO partner_adjustments(order_id,${owner},kind,net_kurus,idempotency_key,request_hash,admin_email,reason,${membership}) VALUES($1,$2,'topup',1000,$3,'hash','PRIVATE-OPERATOR','Independent extra credit',$4)`, [await order(), partner, randomUUID(), adjustmentOnly]);
      await admin.query(`INSERT INTO ${batches}(${owner},total_kurus,earning_count,admin_email) VALUES($1,555,0,'FOREIGN-OPERATOR')`, [foreign]);
      const scope = { audience: "admin", kind, partnerId: partner } as const;
      const predicates = { all: 'true', pending: "status='pending' AND voided_at IS NULL", paid: "status='paid' AND settlement_kind='transfer' AND voided_at IS NULL", netted: "status='paid' AND settlement_kind='netting' AND voided_at IS NULL", voided: 'voided_at IS NOT NULL' };
      for (const status of ["all", "pending", "paid", "netted", "voided"] as const) {
        const expected = (await admin.query(`SELECT id,total_kurus FROM ${batches} WHERE ${owner}=$1 AND ${predicates[status]} ORDER BY created_at DESC,id DESC`, [partner])).rows;
        calls = 0; const response = await exportPayoutCsv(scope, { status }); const csv = await response.text(); const rows = parseCsv(csv).slice(1);
        check(`${kind}/${status}: complete ordered CSV matches SQL IDs`, rows.map(r => r[1]), expected.map(r => r.id));
        check(`${kind}/${status}: stated kuruş preserved`, rows.map(r => Number(r[9])), expected.map(r => r.total_kurus));
        if (status === 'all') { check(`${kind}: export exceeds admin100 and partner50 caps`, rows.length, 126); check(`${kind}: multiple real loadPayoutPage calls`, calls, 2); assert.ok(csv.includes(adjustmentOnly)); }
        if (status === 'voided') { assert.ok(csv.includes('retained-audit')); assert.ok(csv.includes('PRIVATE-VOIDER')); }
      }
      const partnerResponse = await exportPayoutCsv({ audience: "partner", kind, partnerId: partner }, { status: "all" });
      const partnerCsv = await partnerResponse.text(); check(`${kind}: partner gets complete own history`, parseCsv(partnerCsv).length - 1, 126);
      for (const forbidden of ['PRIVATE-OPERATOR', 'PRIVATE-PAYER', 'PRIVATE-VOIDER', 'PRIVATE-CUSTOMER', 'FOREIGN-PARTNER', 'FOREIGN-OPERATOR', 'retained-audit']) assert.ok(!partnerCsv.includes(forbidden), forbidden);
      check(`${kind}: partner formula names neutralized`, partnerCsv.includes("'\u200b=SUM(1,2)"), true);
      // Two rows on the second page change after page one has actually queried.
      // The export must preserve their pre-change status in its single snapshot.
      afterFirst = async () => {
        await admin.query('BEGIN'); try {
          await admin.query(`UPDATE ${batches} SET status='paid',paid_at=now(),paid_by='PRIVATE-PAYER' WHERE id=$1`, [ids[0]]);
          await admin.query(`UPDATE ${earnings} SET status='paid' WHERE payout_id=$1`, [ids[0]]);
          await admin.query(`UPDATE ${batches} SET voided_at=now(),voided_by='PRIVATE-VOIDER',void_reason='Concurrent snapshot test',void_snapshot='{}',void_operation_key=$2,void_request_hash='hash' WHERE id=$1`, [ids[4], randomUUID()]);
          await admin.query(`UPDATE ${earnings} SET payout_id=NULL WHERE payout_id=$1`, [ids[4]]);
          await admin.query('COMMIT');
        } catch (error) { await admin.query('ROLLBACK'); throw error; }
      };
      const snapshot = parseCsv(await (await exportPayoutCsv(scope, { status: 'all' })).text());
      check(`${kind}: concurrent settlement invisible in same export snapshot`, snapshot.find(r => r[1] === ids[0])?.[4], 'Bekliyor');
      check(`${kind}: concurrent void invisible in same export snapshot`, snapshot.find(r => r[1] === ids[4])?.[4], 'Bekliyor');
      const refreshed = parseCsv(await (await exportPayoutCsv(scope, { status: 'all' })).text());
      check(`${kind}: new export sees committed settlement`, refreshed.find(r => r[1] === ids[0])?.[4], 'Banka ödemesi kaydedildi');
      check(`${kind}: new export sees committed void`, refreshed.find(r => r[1] === ids[4])?.[4], 'İptal edildi');
      const before = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('payout-export-')).sort();
      failOnSecond = true;
      await assert.rejects(() => exportPayoutCsv(scope, { status: 'all' }), /Injected later-page/);
      failOnSecond = false;
      check(`${kind}: later page failure leaves no partial file`, fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('payout-export-')).sort(), before);
    }
  } finally {
    if (moduleId) { if (original) require.cache[moduleId] = original; else delete require.cache[moduleId]; }
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`); await admin.end(); fs.rmSync(out, { recursive: true, force: true });
  }
  console.log(`${checks} actual CSV/database checks passed; exact QA schema removed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
