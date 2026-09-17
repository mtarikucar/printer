/** Real service SQL, isolated QA schema. Up creates fixtures; down drops only it. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const raw = process.env.QA_ADJUSTMENT_DB_URL;
if (!raw) throw new Error("QA_ADJUSTMENT_DB_URL must explicitly name printer_qa on 55433");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa") throw new Error("Only isolated QA printer_qa:55433 is allowed");
const namespace = `adjustment_crud_${Date.now()}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "adjustment-crud-ddl-"));
const admin = new pg.Client({ connectionString: raw });
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); };

async function main() {
  await admin.connect();
  let pool: pg.Pool | undefined;
  try {
    execFileSync("npx", ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"], { env: { ...process.env, SCRATCH_OUT: out }, stdio: "ignore" });
    const ddl = fs.readFileSync(path.join(out, fs.readdirSync(out).find(f => f.endsWith(".sql"))!), "utf8").replace(/"public"\./g, "");
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await admin.query(`SET search_path TO ${namespace}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter(s => s.trim())) await admin.query(statement);
    url.searchParams.set("options", `-c search_path=${namespace}`);
    url.searchParams.set("application_name", namespace);
    process.env.DATABASE_URL = url.toString();
    const service = await import("../src/lib/services/partner-adjustments");
    const { db } = await import("../src/lib/db");
    pool = (db as unknown as { $client: pg.Pool }).$client;
    const { lockPartnerMoney } = await import("../src/lib/services/money-partner-lock");
    const user = (await admin.query("INSERT INTO users(email,full_name) VALUES('adjust-user@example.invalid','Test') RETURNING id")).rows[0].id;
    const maker = (await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone) VALUES('adjust-maker@example.invalid','x','Maker','Test','05000000000') RETURNING id")).rows[0].id;
    const other = (await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone) VALUES('adjust-other@example.invalid','x','Other','Test','05000000001') RETURNING id")).rows[0].id;
    const painter = (await admin.query("INSERT INTO painters(email,password_hash,company_name,contact_person,phone) VALUES('adjust-painter@example.invalid','x','Painter','Test','05000000002') RETURNING id")).rows[0].id;
    const reason = "Üretim maliyeti için yönetici düzeltmesi";
    const actor = "admin@example.invalid";
    let seq = 0;
    async function seed() {
      const orderId = (await admin.query("INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,production_base_kurus,manufacturer_id,painter_id) VALUES($1,$2,'adjust@example.invalid','Test','{}','bank_transfer','approved',10000,10000,$3,$4) RETURNING id", [`ADJUST-${++seq}`, user, maker, painter])).rows[0].id;
      const earningId = (await admin.query("INSERT INTO manufacturer_earnings(order_id,manufacturer_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps) VALUES($1,$2,10000,4000,6000,4000) RETURNING id", [orderId, maker])).rows[0].id;
      return { orderId, earningId };
    }
    const form = (orderId: string) => service.loadOrderAdjustments(orderId);
    async function credit(orderId: string, kind: "manufacturer" | "painter" = "manufacturer") {
      const recipient = (await form(orderId)).recipients.find(r => r.kind === kind)!;
      return { partnerKind: kind, partnerId: recipient.id, kind: "reprint" as const, netKurus: 1000, reason, idempotencyKey: randomUUID(), expectedFingerprint: recipient.expectedFingerprint };
    }
    async function offset(orderId: string, netKurus = -1000) {
      const source = (await form(orderId)).recipients.find(r => r.id === maker)!.sources.find(s => s.kind === "manufacturer_earning")!;
      return { partnerKind: "manufacturer" as const, partnerId: maker, kind: "unpaid_offset" as const, netKurus, reason, idempotencyKey: randomUUID(), expectedFingerprint: source.expectedFingerprint, source: { kind: source.kind, id: source.id } };
    }
    const create = (orderId: string, input: Awaited<ReturnType<typeof credit>> | Awaited<ReturnType<typeof offset>>) => service.createPartnerAdjustment({ orderId, input, adminEmail: actor });
    async function refuses(run: () => Promise<unknown>, code: string) {
      await assert.rejects(run, (e: unknown) => e instanceof service.PartnerAdjustmentError && e.code === code); checks++;
    }
    let fixture = await seed();
    const original = (await admin.query("SELECT * FROM manufacturer_earnings WHERE id=$1", [fixture.earningId])).rows[0];
    const positive = await credit(fixture.orderId);
    const first = await create(fixture.orderId, positive);
    const replay = await create(fixture.orderId, positive);
    check("same create operation returns original ID", replay.adjustmentId, first.adjustmentId);
    check("same create operation replays", replay.replayed, true);
    await refuses(() => create(fixture.orderId, { ...positive, netKurus: 2000 }), "idempotency_conflict");
    await refuses(() => create(fixture.orderId, { ...positive, partnerId: other, idempotencyKey: randomUUID() }), "foreign_recipient");
    const row = (await admin.query("SELECT * FROM partner_adjustments WHERE id=$1", [first.adjustmentId])).rows[0];
    check("creator, reason and signed net are durable", [row.admin_email, row.reason, row.net_kurus], [actor, reason, 1000]);
    const debit = await create(fixture.orderId, await offset(fixture.orderId));
    check("offset snapshot names original source", (await admin.query("SELECT source_snapshot->>'id' AS id FROM partner_adjustments WHERE id=$1", [debit.adjustmentId])).rows[0].id, fixture.earningId);
    await refuses(async () => create(fixture.orderId, await offset(fixture.orderId, -5001)), "offset_exceeds_source");
    check("original earning fields unchanged", (await admin.query("SELECT * FROM manufacturer_earnings WHERE id=$1", [fixture.earningId])).rows[0], original);
    const staleDebit = await offset(fixture.orderId);
    await create(fixture.orderId, staleDebit);
    await refuses(() => create(fixture.orderId, { ...staleDebit, idempotencyKey: randomUUID() }), "stale_adjustment");

    const history = (await form(fixture.orderId)).adjustments.find(a => a.id === first.adjustmentId)!;
    const cancelInput = { reason: "Yanlış ek ödeme kaydı iptal ediliyor", idempotencyKey: randomUUID(), expectedFingerprint: history.expectedFingerprint };
    const cancel = () => service.voidPartnerAdjustment({ orderId: fixture.orderId, adjustmentId: first.adjustmentId, input: cancelInput, adminEmail: actor });
    await cancel();
    check("cancel replay returns original operation", (await cancel()).replayed, true);
    await refuses(() => service.voidPartnerAdjustment({ orderId: fixture.orderId, adjustmentId: first.adjustmentId, input: { ...cancelInput, reason: "Farklı gerekçeyle aynı işlem anahtarı" }, adminEmail: actor }), "idempotency_conflict");
    const cancelled = (await admin.query("SELECT * FROM partner_adjustments WHERE id=$1", [first.adjustmentId])).rows[0];
    for (const key of ["net_kurus", "reason", "admin_email", "request_hash", "idempotency_key", "order_id", "manufacturer_id", "created_at"]) check(`cancel preserves ${key}`, cancelled[key], row[key]);
    check("cancel audit is durable", [cancelled.status, cancelled.voided_by, cancelled.void_reason], ["voided", actor, cancelInput.reason]);

    async function cancelCurrent(orderId: string, adjustmentId: string) {
      const h = (await form(orderId)).adjustments.find(a => a.id === adjustmentId)!;
      return service.voidPartnerAdjustment({ orderId, adjustmentId, adminEmail: actor, input: { reason: cancelInput.reason, idempotencyKey: randomUUID(), expectedFingerprint: h.expectedFingerprint } });
    }
    fixture = await seed();
    const parent = await create(fixture.orderId, await credit(fixture.orderId));
    const parentSource = (await form(fixture.orderId)).recipients.find(r => r.id === maker)!.sources.find(s => s.id === parent.adjustmentId)!;
    const child = await create(fixture.orderId, { ...await offset(fixture.orderId, -500), source: { kind: parentSource.kind, id: parentSource.id }, expectedFingerprint: parentSource.expectedFingerprint });
    await refuses(() => cancelCurrent(fixture.orderId, parent.adjustmentId), "adjustment_not_voidable");
    check("dependent offset can be cancelled before its positive source", (await cancelCurrent(fixture.orderId, child.adjustmentId)).ok, true);
    check("positive source can then be cancelled", (await cancelCurrent(fixture.orderId, parent.adjustmentId)).ok, true);

    fixture = await seed();
    const batchedCredit = await create(fixture.orderId, await credit(fixture.orderId));
    const batchedOffset = await create(fixture.orderId, await offset(fixture.orderId));
    const heldBatch = (await admin.query("INSERT INTO payouts(manufacturer_id,total_kurus,earning_count,admin_email) VALUES($1,6000,1,'test') RETURNING id", [maker])).rows[0].id;
    await admin.query("UPDATE partner_adjustments SET manufacturer_payout_id=$2 WHERE id=$1", [batchedCredit.adjustmentId, heldBatch]);
    await refuses(() => cancelCurrent(fixture.orderId, batchedCredit.adjustmentId), "adjustment_not_voidable");
    await admin.query("UPDATE manufacturer_earnings SET payout_id=$2 WHERE id=$1", [fixture.earningId, heldBatch]);
    await refuses(() => cancelCurrent(fixture.orderId, batchedOffset.adjustmentId), "adjustment_not_voidable");
    await admin.query("UPDATE partner_adjustments SET status='settled',settled_at=now() WHERE id=$1", [batchedCredit.adjustmentId]);
    await refuses(() => cancelCurrent(fixture.orderId, batchedCredit.adjustmentId), "adjustment_not_voidable");
    const foreignOrder = await seed();
    const foreignSource = await offset(foreignOrder.orderId);
    await refuses(() => create(fixture.orderId, foreignSource), "invalid_source");

    fixture = await seed();
    const concurrent = await offset(fixture.orderId, -4000);
    // Both calls observe the same remaining amount; the partner gate admits
    // only one, and the other rereads the now-stale source fingerprint.
    const results = await Promise.allSettled([create(fixture.orderId, concurrent), create(fixture.orderId, { ...concurrent, idempotencyKey: randomUUID() })]);
    check("competing offsets cannot overspend source", results.map(r => r.status).sort(), ["fulfilled", "rejected"]);
    check("competing offset sum", Number((await admin.query("SELECT sum(net_kurus) AS n FROM partner_adjustments WHERE order_id=$1", [fixture.orderId])).rows[0].n), -4000);
    const duplicate = await credit(fixture.orderId);
    const duplicates = await Promise.all([create(fixture.orderId, duplicate), create(fixture.orderId, duplicate)]);
    check("concurrent idempotent creation writes once", duplicates[0].adjustmentId, duplicates[1].adjustmentId);

    fixture = await seed();
    const pending = await offset(fixture.orderId);
    const payout = (await admin.query("INSERT INTO payouts(manufacturer_id,total_kurus,earning_count,admin_email) VALUES($1,6000,1,'test') RETURNING id", [maker])).rows[0].id;
    await admin.query("UPDATE manufacturer_earnings SET payout_id=$2 WHERE id=$1", [fixture.earningId, payout]);
    await refuses(() => create(fixture.orderId, pending), "source_batched");
    await admin.query("UPDATE manufacturer_earnings SET status='paid' WHERE id=$1", [fixture.earningId]);
    await refuses(() => create(fixture.orderId, pending), "source_batched");

    fixture = await seed();
    const beforeRefund = await offset(fixture.orderId);
    await admin.query("UPDATE orders SET payment_status='refunded' WHERE id=$1", [fixture.orderId]);
    await refuses(() => create(fixture.orderId, beforeRefund), "source_unavailable");
    check("independent reprint survives refund", (await create(fixture.orderId, await credit(fixture.orderId))).ok, true);
    check("painter compensation works", (await create(fixture.orderId, await credit(fixture.orderId, "painter"))).ok, true);

    fixture = await seed();
    const missing = await offset(fixture.orderId);
    const recorded = await create(fixture.orderId, missing);
    await admin.query("DELETE FROM manufacturer_earnings WHERE id=$1", [fixture.earningId]);
    check("logical source deletion preserves adjustment history", (await form(fixture.orderId)).adjustments.some(a => a.id === recorded.adjustmentId), true);
    await refuses(() => create(fixture.orderId, { ...missing, idempotencyKey: randomUUID() }), "invalid_source");

    fixture = await seed();
    const raced = await offset(fixture.orderId);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(r => { entered = r; });
    const finish = new Promise<void>(r => { release = r; });
    const reversal = db.transaction(async tx => {
      await lockPartnerMoney(tx, "manufacturer", maker);
      const { sql } = await import("drizzle-orm");
      await tx.execute(sql`UPDATE manufacturer_earnings SET status='reversed' WHERE id=${fixture.earningId}`);
      entered(); await finish;
    });
    await ready;
    const rejected = refuses(() => create(fixture.orderId, raced), "source_unavailable");
    try {
      let blocked = false;
      for (let i = 0; i < 200; i++) {
        blocked = (await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [namespace])).rowCount! > 0;
        if (blocked) break;
        await new Promise(r => setTimeout(r, 10));
      }
      check("adjustment really waits behind partner gate", blocked, true);
    } finally { release(); await reversal; await rejected; }
    check("reversal winner leaves no new offset", (await admin.query("SELECT count(*)::int AS n FROM partner_adjustments WHERE order_id=$1", [fixture.orderId])).rows[0].n, 0);
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end();
    fs.rmSync(out, { recursive: true, force: true });
  }
  console.log(`${checks} adjustment CRUD DB checks passed; exact scratch removed; no external sends`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
