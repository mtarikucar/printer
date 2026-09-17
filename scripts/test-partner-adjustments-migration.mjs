/** Isolated 0060 QA. Never reads DATABASE_URL or connects outside loopback:55433. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const container = JSON.parse(execFileSync("docker", ["inspect", "printer-qa-pg"], { encoding: "utf8" }))[0];
assert.ok(container.NetworkSettings.Ports["5432/tcp"].some(
  (p) => p.HostIp === "127.0.0.1" && p.HostPort === "55433"
));
const env = Object.fromEntries(container.Config.Env.map((e) => {
  const i = e.indexOf("=");
  return [e.slice(0, i), e.slice(i + 1)];
}));
const config = {
  host: "127.0.0.1", port: 55433,
  user: env.POSTGRES_USER || "postgres", password: env.POSTGRES_PASSWORD,
};
const name = `partner_adjustments_0060_${randomUUID().replaceAll("-", "")}`;
assert.match(name, /^partner_adjustments_0060_[a-f0-9]{32}$/);
const up = fs.readFileSync(path.join(root, "drizzle/0060_partner_adjustments.sql"), "utf8");
const down = fs.readFileSync(path.join(root, "drizzle/0060_partner_adjustments.down.sql"), "utf8");
const journal = JSON.parse(fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8"));
const entry = journal.entries.find((e) => e.idx === 60);
assert.equal(entry.tag, "0060_partner_adjustments");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "printer-0060-migration-"));
fs.mkdirSync(path.join(folder, "meta"));
fs.writeFileSync(path.join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: [entry] }));
fs.writeFileSync(path.join(folder, `${entry.tag}.sql`), up);
let admin, db, contender, created = false, checks = 0;
const ok = (label) => { checks++; console.log(`PASS ${label}`); };
const isRefusal = (e) => e.code === "P0001" && e.message.includes("0060 rollback refused");

async function main() {
  admin = new Client({ ...config, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = new Client({ ...config, database: name });
  await db.connect();
  console.log(`Disposable database ${name} on 127.0.0.1:55433`);
  // Baseline has precisely the pre-0060 payout columns and referenced keys.
  await db.query(`
    CREATE TYPE payout_status AS ENUM ('pending', 'paid');
    CREATE TABLE orders (id uuid PRIMARY KEY);
    CREATE TABLE manufacturers (id uuid PRIMARY KEY);
    CREATE TABLE painters (id uuid PRIMARY KEY);
    CREATE TABLE manufacturer_earnings (id uuid PRIMARY KEY);
    CREATE TABLE painter_earnings (id uuid PRIMARY KEY);
    CREATE TABLE payouts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), manufacturer_id uuid NOT NULL REFERENCES manufacturers(id),
      total_kurus integer NOT NULL, earning_count integer NOT NULL,
      status payout_status NOT NULL DEFAULT 'pending', reference text, admin_email text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(), paid_at timestamp
    );
    CREATE TABLE painter_payouts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), painter_id uuid NOT NULL REFERENCES painters(id),
      total_kurus integer NOT NULL, earning_count integer NOT NULL,
      status payout_status NOT NULL DEFAULT 'pending', reference text, admin_email text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(), paid_at timestamp
    );
  `);
  const order = randomUUID(), manufacturer = randomUUID(), painter = randomUUID();
  await db.query("INSERT INTO orders VALUES ($1)", [order]);
  await db.query("INSERT INTO manufacturers VALUES ($1)", [manufacturer]);
  await db.query("INSERT INTO painters VALUES ($1)", [painter]);
  const batch = {};
  const legacy = {};
  for (const [table, partnerColumn, partner] of [
    ["payouts", "manufacturer_id", manufacturer], ["painter_payouts", "painter_id", painter],
  ]) {
    legacy[table] = (await db.query(`INSERT INTO ${table} (${partnerColumn}, total_kurus, earning_count, status, reference, admin_email, paid_at)
      VALUES ($1, 10000, 1, 'paid', 'historical-transfer', 'requester@example.test', '2026-01-01') RETURNING *`, [partner])).rows[0];
    batch[table] = (await db.query(`INSERT INTO ${table} (${partnerColumn}, total_kurus, earning_count, admin_email)
      VALUES ($1, 0, 0, 'requester@example.test') RETURNING id`, [partner])).rows[0].id;
  }
  const runUp = () => migrate(drizzle(db), { migrationsFolder: folder });
  const exists = async () => (await db.query("SELECT to_regclass('public.partner_adjustments') AS name")).rows[0].name !== null;
  const ownCount = async () => Number((await db.query("SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at=$1", [entry.when])).rows[0].count);
  const oldRowsUnchanged = async () => {
    for (const table of Object.keys(legacy)) {
      const columns = Object.keys(legacy[table]).join(", ");
      assert.deepEqual((await db.query(`SELECT ${columns} FROM ${table} WHERE id=$1`, [legacy[table].id])).rows[0], legacy[table]);
    }
  };
  await runUp();
  assert.ok(await exists()); assert.equal(await ownCount(), 1);
  await oldRowsUnchanged();
  ok("Drizzle up; historical paid rows unchanged");
  await db.query(up); await runUp();
  assert.equal(await ownCount(), 1);
  ok("raw up and Drizzle up are repeatable");

  const base = () => ({ order_id: order, manufacturer_id: manufacturer, kind: "topup", net_kurus: 1000,
    idempotency_key: randomUUID(), request_hash: "fixture-hash", admin_email: "admin@example.test", reason: "Fixture compensation" });
  async function insert(fields = {}, client = db) {
    const values = { ...base(), ...fields };
    const keys = Object.keys(values);
    return (await client.query(`INSERT INTO partner_adjustments (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, Object.values(values))).rows[0];
  }
  const credit = await insert();
  assert.equal(credit.status, "pending"); assert.ok(credit.id); assert.ok(credit.created_at);
  assert.equal(credit.source_id, null);
  await insert({ manufacturer_id: null, painter_id: painter, kind: "reprint" });
  await insert({ kind: "unpaid_offset", net_kurus: -500, source_kind: "adjustment", source_id: credit.id, source_snapshot: { netKurus: 1000 } });
  ok("manufacturer/painter credits and bounded signed source-linked offsets");

  for (const fields of [
    { manufacturer_id: null }, { painter_id: painter }, { kind: "other" }, { net_kurus: 0 }, { net_kurus: -1 },
    { kind: "unpaid_offset", net_kurus: -1 }, { kind: "unpaid_offset", net_kurus: -2147483648, source_kind: "adjustment", source_id: credit.id, source_snapshot: {} },
    { source_kind: "adjustment", source_id: credit.id, source_snapshot: {} },
    { kind: "unpaid_offset", net_kurus: -1, source_kind: "painter_earning", source_id: randomUUID(), source_snapshot: {} },
    { kind: "unpaid_offset", net_kurus: -1, source_kind: "other", source_id: randomUUID(), source_snapshot: {} },
    { kind: "unpaid_offset", net_kurus: -1, source_kind: "adjustment", source_id: credit.id, source_snapshot: "[]" },
    { status: "other" }, { admin_email: " " }, { reason: " " }, { request_hash: " " },
    { painter_payout_id: batch.painter_payouts }, { status: "settled" },
    { settled_at: new Date() }, { status: "voided" }, { voided_by: "admin@example.test" },
  ]) await assert.rejects(insert(fields), { code: "23514" });
  const self = randomUUID();
  await assert.rejects(insert({ id: self, kind: "unpaid_offset", net_kurus: -1, source_kind: "adjustment", source_id: self, source_snapshot: {} }), { code: "23514" });
  ok("invalid partner/sign/source/status/audit combinations rejected");

  await assert.rejects(insert({ idempotency_key: credit.idempotency_key }), { code: "23505" });
  await assert.rejects(insert({ order_id: randomUUID() }), { code: "23503" });
  await assert.rejects(db.query("DELETE FROM orders WHERE id=$1", [order]), { code: "23503" });
  await assert.rejects(insert({ manufacturer_payout_id: randomUUID() }), { code: "23503" });
  const settled = await insert({ status: "settled", manufacturer_payout_id: batch.payouts, settled_at: new Date() });
  assert.ok(settled.settled_at);
  await assert.rejects(db.query("DELETE FROM payouts WHERE id=$1", [batch.payouts]), { code: "23503" });
  const cancellation = { status: "voided", voided_at: new Date(), voided_by: "admin@example.test", void_reason: "Fixture cancellation" };
  await assert.rejects(insert(cancellation), { code: "23514" });
  const voided = await insert({ ...cancellation, void_operation_key: randomUUID(), void_request_hash: "cancel-hash" });
  assert.equal(voided.net_kurus, 1000);
  assert.equal(voided.void_request_hash, "cancel-hash");
  await assert.rejects(insert({ ...cancellation, void_operation_key: voided.void_operation_key, void_request_hash: "other-hash" }), { code: "23505" });
  for (const fields of [
    { ...cancellation, void_operation_key: randomUUID() },
    { ...cancellation, void_request_hash: "cancel-hash" },
    { ...cancellation, void_operation_key: randomUUID(), void_request_hash: " " },
    { void_operation_key: randomUUID() },
    { void_request_hash: "cancel-hash" },
  ]) await assert.rejects(insert(fields), { code: "23514" });
  ok("idempotency uniqueness, restrictive parent/payout FKs and terminal metadata");

  const source = randomUUID();
  await db.query("INSERT INTO manufacturer_earnings VALUES($1)", [source]);
  const offset = await insert({ kind: "unpaid_offset", net_kurus: -100, source_kind: "manufacturer_earning", source_id: source, source_snapshot: { id: source, netKurus: 500 } });
  await db.query("DELETE FROM manufacturer_earnings WHERE id=$1", [source]);
  assert.deepEqual((await db.query("SELECT source_id, source_snapshot FROM partner_adjustments WHERE id=$1", [offset.id])).rows[0], { source_id: source, source_snapshot: { id: source, netKurus: 500 } });
  ok("legacy earning deletion preserves logical source identity and snapshot");

  const history = (await db.query("SELECT * FROM partner_adjustments ORDER BY id")).rows;
  await assert.rejects(db.query(down), isRefusal);
  assert.deepEqual((await db.query("SELECT * FROM partner_adjustments ORDER BY id")).rows, history);
  assert.equal(await ownCount(), 1);
  ok("populated rollback refuses atomically, preserving history and journal");
  await db.query("DELETE FROM partner_adjustments WHERE order_id=$1", [order]);

  for (const table of ["payouts", "painter_payouts"]) {
    await assert.rejects(db.query(`UPDATE ${table} SET adjustment_count=-1 WHERE id=$1`, [batch[table]]), { code: "23514" });
    await assert.rejects(db.query(`UPDATE ${table} SET settlement_kind='other' WHERE id=$1`, [batch[table]]), { code: "23514" });
    await assert.rejects(db.query(`UPDATE ${table} SET settlement_kind='netting', total_kurus=1 WHERE id=$1`, [batch[table]]), { code: "23514" });
    await assert.rejects(db.query(`UPDATE ${table} SET settlement_kind='netting', reference='bank' WHERE id=$1`, [batch[table]]), { code: "23514" });
    await assert.rejects(db.query(`UPDATE ${table} SET voided_at=now() WHERE id=$1`, [batch[table]]), { code: "23514" });
    const key = randomUUID();
    const voidSql = `UPDATE ${table} SET voided_at=now(), voided_by='admin@example.test', void_reason='Fixture void',
      void_snapshot='{"sources":[]}', void_operation_key=$1, void_request_hash='void-hash' WHERE id=$2`;
    await db.query(voidSql, [key, batch[table]]);
    await assert.rejects(db.query(`UPDATE ${table} SET status='paid' WHERE id=$1`, [batch[table]]), { code: "23514" });
    await assert.rejects(db.query(down), isRefusal);
    assert.equal(await ownCount(), 1);
    await db.query("BEGIN");
    await db.query(`UPDATE ${table} SET status='pending' WHERE id=$1`, [legacy[table].id]);
    await db.query("SAVEPOINT duplicate_void");
    await assert.rejects(db.query(voidSql, [key, legacy[table].id]), { code: "23505" });
    await db.query("ROLLBACK");
    await db.query(`UPDATE ${table} SET voided_at=NULL, voided_by=NULL, void_reason=NULL, void_snapshot=NULL,
      void_operation_key=NULL, void_request_hash=NULL WHERE id=$1`, [batch[table]]);
  }
  ok("both payout tables enforce netting, complete void audit and unique operation keys");

  // Exercise EVERY refusal field, including partially applied/older constraints.
  const metadata = {
    adjustment_count: 1, settlement_kind: "netting", paid_by: "admin@example.test", voided_at: new Date(),
    voided_by: "admin@example.test", void_reason: "preserve", void_snapshot: {},
    void_operation_key: randomUUID(), void_request_hash: "preserve-hash",
  };
  for (const table of ["payouts", "painter_payouts"]) {
    for (const [column, value] of Object.entries(metadata)) {
      await db.query("BEGIN");
      await db.query(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_void_audit_check`);
      await db.query(`UPDATE ${table} SET ${column}=$1 WHERE id=$2`, [value, batch[table]]);
      await db.query("SAVEPOINT before_down");
      await assert.rejects(db.query(down), isRefusal);
      await db.query("ROLLBACK TO SAVEPOINT before_down");
      assert.equal(await exists(), true); assert.equal(await ownCount(), 1);
      assert.notEqual((await db.query(`SELECT ${column} AS value FROM ${table} WHERE id=$1`, [batch[table]])).rows[0].value, null);
      await db.query("ROLLBACK");
    }
  }
  ok("all nine metadata fields on both payout tables independently prevent rollback");

  // A writer already holding the table lock must commit before down can inspect.
  contender = new Client({ ...config, database: name });
  await contender.connect();
  const pid = (await contender.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  await db.query("BEGIN");
  const concurrent = await insert();
  const attemptedDown = contender.query(down).then(() => null, (error) => error);
  let waiting = false;
  for (let i = 0; i < 50; i++) {
    waiting = (await db.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting", [pid])).rows[0].waiting;
    if (waiting) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(waiting, "down must wait for the uncommitted writer");
  await db.query("COMMIT");
  assert.ok(isRefusal(await attemptedDown));
  assert.equal((await db.query("SELECT count(*) FROM partner_adjustments WHERE id=$1", [concurrent.id])).rows[0].count, "1");
  await db.query("DELETE FROM partner_adjustments WHERE id=$1", [concurrent.id]);
  await contender.end(); contender = null;
  ok("down locks before inspecting and preserves a concurrent committed adjustment");

  await db.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)", ["older-sentinel", entry.when - 1]);
  await db.query(down);
  assert.equal(await exists(), false); assert.equal(await ownCount(), 0);
  await oldRowsUnchanged();
  ok("empty down removes only its schema and own journal; historical payouts survive");
  await db.query(down);
  ok("repeat down is idempotent");
  await runUp();
  assert.ok(await exists()); assert.equal(await ownCount(), 1);
  await oldRowsUnchanged();
  ok("Drizzle up after down completes the up/down/up roundtrip");
  await db.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)", ["later-sentinel", entry.when + 1]);
  await db.query(down); await db.query(down);
  assert.deepEqual((await db.query("SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows.map((r) => r.hash), ["older-sentinel", "later-sentinel"]);
  ok("rollback retains both older and newer journal entries");
  await db.query("DROP SCHEMA drizzle CASCADE");
  await db.query(up); await db.query(down); await db.query(down);
  await oldRowsUnchanged();
  ok("raw up/down/repeat-down works without a Drizzle journal");
  console.log(`${checks} migration checks passed`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // Only this script's UUID-named database can be removed, even after failure.
  if (db) await db.end();
  if (contender) await contender.end();
  if (created) {
    await admin.query(`DROP DATABASE "${name}"`);
    console.log("Disposable database removed");
  }
  if (admin) await admin.end();
  fs.rmSync(folder, { recursive: true, force: true });
}
