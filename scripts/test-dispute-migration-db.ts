/** Real 0062 DDL, only a disposable schema in explicitly selected QA55433. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");
const tag = "0062_dispute_decisions";
const upPath = path.join(root, "drizzle", `${tag}.sql`);
const downPath = path.join(root, "drizzle", `${tag}.down.sql`);
assert.ok(fs.existsSync(upPath) && fs.existsSync(downPath), "0062 requires executable up/down artifacts");
const raw = process.env.QA_DISPUTE_MIGRATION_DB_URL;
if (!raw) throw new Error("Explicit QA_DISPUTE_MIGRATION_DB_URL is required");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa" || url.search) {
  throw new Error("Only 127.0.0.1:55433/printer_qa without connection options is allowed");
}
const ns = `dispute_migration_${randomUUID().replaceAll("-", "")}`;
const client = new pg.Client({ connectionString: raw });
const entry = JSON.parse(fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8"))
  .entries.find((e: { tag: string }) => e.tag === tag);
assert.ok(entry, "0062 journal entry exists");
const qualify = (sql: string) => sql.replaceAll('"public".', `"${ns}".`)
  .replaceAll("public.", `${ns}.`).replaceAll("drizzle.__drizzle_migrations", `${ns}.__drizzle_migrations`);
const up = qualify(fs.readFileSync(upPath, "utf8"));
const down = qualify(fs.readFileSync(downPath, "utf8"));
const fields = ["decision_operation_key", "decision_request_hash", "refund_record_id", "decision_snapshot",
  "decision_email_payload", "decision_email_progress", "decision_email_state", "decision_email_next_attempt_at", "decision_email_lease_until",
  "opening_email_payload", "opening_email_progress", "opening_email_state", "opening_email_next_attempt_at", "opening_email_lease_until"];
let checks = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`);
}
const ids = { order: randomUUID(), user: randomUUID(), refund: randomUUID(), legacy: randomUUID() };
const json = new Set(["decision_snapshot", "decision_email_payload", "decision_email_progress", "opening_email_payload", "opening_email_progress"]);
async function insert(overrides: Record<string, unknown> = {}) {
  const data = { id: randomUUID(), order_id: ids.order, user_id: ids.user, category: "other", description: "Fixture complaint", ...overrides };
  const keys = Object.keys(data);
  return client.query(`INSERT INTO disputes (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.entries(data).map(([key, value]) => json.has(key) && value !== null ? JSON.stringify(value) : value));
}
function decision(overrides: Record<string, unknown> = {}) {
  return { status: "resolved", resolution: "İncelendi ve karara bağlandı", admin_email: "admin@example.invalid", resolved_at: new Date(),
    decision_operation_key: randomUUID(), decision_request_hash: "canonical-hash", decision_snapshot: { version: 1 }, ...overrides };
}
async function rejected(name: string, overrides: Record<string, unknown>, code = "23514") {
  await assert.rejects(insert(overrides), (e: unknown) => (e as { code?: string }).code === code, name);
  checks++; console.log(`PASS ${name}`);
}
async function refusesDown(name: string) {
  await client.query("SAVEPOINT before_down");
  await assert.rejects(client.query(down), /0062 rollback refused/, name);
  await client.query("ROLLBACK TO SAVEPOINT before_down");
  checks++; console.log(`PASS ${name}`);
  check("refused down keeps journal", (await client.query("SELECT count(*)::int AS n FROM __drizzle_migrations")).rows[0].n, 3);
}
async function main() {
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${ns}`);
    await client.query(`SET search_path TO ${ns}, pg_catalog`);
    await client.query("CREATE TYPE dispute_status AS ENUM ('open','resolved','rejected')");
    for (const table of ["orders", "users", "order_refund_records"]) await client.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY, sentinel text NOT NULL DEFAULT 'preserve')`);
    for (const [table, id] of [["orders", ids.order], ["users", ids.user], ["order_refund_records", ids.refund]]) await client.query(`INSERT INTO ${table}(id) VALUES($1)`, [id]);
    await client.query(`CREATE TABLE disputes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id), user_id uuid NOT NULL REFERENCES users(id),
      category text NOT NULL, description text NOT NULL, status dispute_status NOT NULL DEFAULT 'open', resolution text, admin_email text,
      created_at timestamp NOT NULL DEFAULT now(), resolved_at timestamp)`);
    await insert({ id: ids.legacy, status: "resolved" }); // Incomplete historical decision stays untouched.
    await insert(); await insert(); // Historical duplicate open rows must not break the additive migration.
    const old = (await client.query("SELECT * FROM disputes ORDER BY id")).rows;
    await client.query("CREATE TABLE __drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)");
    await client.query("INSERT INTO __drizzle_migrations(hash,created_at) VALUES('prior',$1),('own',$2),('later',$3)", [entry.when - 1, entry.when, entry.when + 1]);
    await client.query(up); await client.query(up);
    const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='disputes'", [ns])).rows.map(r => r.column_name);
    check("exactly fourteen added columns", columns.filter(c => !Object.keys(old[0]).includes(c)).sort(), [...fields].sort());
    check("legacy closed and duplicate open rows survive", (await client.query("SELECT id,order_id,user_id,category,description,status,resolution,admin_email,created_at,resolved_at FROM disputes ORDER BY id")).rows, old);
    const legacy = (await client.query("SELECT * FROM disputes WHERE id=$1", [ids.legacy])).rows[0];
    for (const phase of ["opening", "decision"]) {
      check(`${phase} starts without notification intent`, [legacy[`${phase}_email_payload`], legacy[`${phase}_email_progress`], legacy[`${phase}_email_state`], legacy[`${phase}_email_next_attempt_at`], legacy[`${phase}_email_lease_until`]], [{}, {}, "not_required", null, null]);
    }
    await client.query("BEGIN");
    const resolved = (await insert(decision({ refund_record_id: ids.refund }))).rows[0];
    await rejected("operation key cannot identify two decisions", decision({ decision_operation_key: resolved.decision_operation_key }), "23505").catch(async e => { await client.query("ROLLBACK"); throw e; });
    // Constraint failures abort transactions; remaining cases run separately below.
    await client.query("ROLLBACK");
    const closed = (await insert(decision({ refund_record_id: ids.refund }))).rows[0];
    await rejected("refund cannot be adopted by two disputes", decision({ refund_record_id: ids.refund }), "23505");
    await rejected("refund association enforces actual FK", decision({ refund_record_id: randomUUID() }), "23503");
    for (const [name, change] of [
      ["key alone", { decision_operation_key: randomUUID() }], ["hash alone", { decision_request_hash: "hash" }],
      ["snapshot alone", { decision_snapshot: {} }], ["refund without decision", { refund_record_id: ids.refund }],
      ["open decision", decision({ status: "open" })], ["blank hash", decision({ decision_request_hash: " " })],
      ["missing hash", decision({ decision_request_hash: null })], ["missing snapshot", decision({ decision_snapshot: null })],
      ["array snapshot", decision({ decision_snapshot: [] })], ["missing resolution", decision({ resolution: null })],
      ["blank resolution", decision({ resolution: " " })], ["missing actor", decision({ admin_email: null })],
      ["blank actor", decision({ admin_email: " " })], ["missing decision date", decision({ resolved_at: null })],
      ["rejected decision with refund", decision({ status: "rejected", refund_record_id: ids.refund })],
    ] as const) await rejected(name, change);
    const rejectedRow = (await insert(decision({ status: "rejected" }))).rows[0];
    check("rejection needs no refund", rejectedRow.refund_record_id, null);
    for (const phase of ["opening", "decision"]) {
      const base = phase === "decision" ? decision() : {};
      for (const [name, change] of [
        ["unknown state", { [`${phase}_email_state`]: "sent" }],
        ["array payload", { [`${phase}_email_payload`]: [] }],
        ["array progress", { [`${phase}_email_progress`]: [] }],
        ["empty pending", { [`${phase}_email_state`]: "pending" }],
        ["empty with progress", { [`${phase}_email_progress`]: { sent: true } }],
        ["empty with retry", { [`${phase}_email_next_attempt_at`]: new Date() }],
        ["empty with lease", { [`${phase}_email_lease_until`]: new Date() }],
      ] as const) await rejected(`${phase}: ${name}`, { ...base, ...change });
    }
    await rejected("keyless decision cannot send", { decision_email_payload: { version: 1 }, decision_email_state: "pending" });
    const opened = (await insert({ opening_email_payload: { version: 1 }, opening_email_state: "pending" })).rows[0];
    check("opening intent allowed without decision", opened.decision_operation_key, null);
    await client.query("UPDATE disputes SET status='rejected',resolution='Reddedildi',admin_email='admin',resolved_at=now(),decision_operation_key=$2,decision_request_hash='hash',decision_snapshot='{}',decision_email_payload='{\"version\":1}',decision_email_state='pending' WHERE id=$1", [opened.id, randomUUID()]);
    await client.query("UPDATE disputes SET decision_email_state='delivered',decision_email_progress='{\"accepted\":true}' WHERE id=$1", [opened.id]);
    check("opening remains independent after decision delivery", (await client.query("SELECT opening_email_state,decision_email_state FROM disputes WHERE id=$1", [opened.id])).rows[0], { opening_email_state: "pending", decision_email_state: "delivered" });
    await assert.rejects(client.query("DELETE FROM order_refund_records WHERE id=$1", [ids.refund]), (e: unknown) => (e as { code?: string }).code === "23503"); checks++;
    await client.query("BEGIN"); await refusesDown("populated decision and opening refuse down atomically"); await client.query("ROLLBACK");
    await client.query("DELETE FROM disputes WHERE id=ANY($1::uuid[])", [[closed.id, rejectedRow.id, opened.id]]);
    // Probe each field even in a partially applied/otherwise inconsistent schema.
    // The down must preserve metadata independently of constraints enforcing valid writes.
    const constraints = (await client.query("SELECT conname FROM pg_constraint WHERE conrelid='disputes'::regclass AND contype='c'")).rows;
    for (const field of fields) {
      await client.query("BEGIN");
      for (const { conname } of constraints) await client.query(`ALTER TABLE disputes DROP CONSTRAINT "${conname}"`);
      const value = field.endsWith("_key") || field === "refund_record_id" ? (field === "refund_record_id" ? ids.refund : randomUUID())
        : field.endsWith("_at") || field.endsWith("_until") ? new Date()
        : json.has(field) ? JSON.stringify({ evidence: true }) : field.endsWith("_state") ? "pending" : "evidence";
      await client.query(`UPDATE disputes SET ${field}=$1 WHERE id=$2`, [value, ids.legacy]);
      await refusesDown(`used ${field} independently blocks down`);
      check("refusal retains fourteen columns", (await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='disputes' AND column_name=ANY($2)", [ns, fields])).rows[0].n, 14);
      await client.query("ROLLBACK");
    }
    await client.query(down); await client.query(down);
    check("down preserves every historical dispute", (await client.query("SELECT * FROM disputes ORDER BY id")).rows, old);
    check("down removes only its journal record", (await client.query("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).rows.map(r => r.hash), ["prior", "later"]);
    // Partial schema: populated opening column is enough to refuse; an unused one can be dropped.
    await client.query("ALTER TABLE disputes ADD COLUMN opening_email_payload jsonb DEFAULT '{}' NOT NULL");
    await client.query("UPDATE disputes SET opening_email_payload='{\"version\":1}' WHERE id=$1", [ids.legacy]);
    await assert.rejects(client.query(down), /0062 rollback refused/); checks++;
    await client.query("UPDATE disputes SET opening_email_payload='{}'"); await client.query(down);
    await client.query(up); await client.query(up);
    check("up/down/up ends with all fourteen columns", (await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='disputes' AND column_name=ANY($2)", [ns, fields])).rows[0].n, 14);
    check("parents remain untouched", (await client.query("SELECT sentinel FROM order_refund_records WHERE id=$1", [ids.refund])).rows[0].sentinel, "preserve");
    console.log(`${checks} dispute migration checks passed; disposable schema only`);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`);
    await client.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
