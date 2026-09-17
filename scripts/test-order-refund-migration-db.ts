/** 0061 real DDL contract. Only a disposable schema in explicit QA55433. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");
const tag = "0061_order_refunds";
const upFile = path.join(root, "drizzle", `${tag}.sql`);
const downFile = path.join(root, "drizzle", `${tag}.down.sql`);
assert.ok(fs.existsSync(upFile) && fs.existsSync(downFile), "0061 must ship both executable up and down");
const raw = process.env.QA_REFUND_MIGRATION_DB_URL;
if (!raw) throw new Error("QA_REFUND_MIGRATION_DB_URL must explicitly select QA55433");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa") throw new Error("Only 127.0.0.1:55433/printer_qa is allowed");
// No connection options may redirect search_path/roles away from this schema.
if (url.search) throw new Error("QA connection URL must not contain options");
const ns = `refund_migration_${randomUUID().replaceAll("-", "")}`;
const client = new pg.Client({ connectionString: raw });
const journal = JSON.parse(fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8"));
const entry = journal.entries.find((e: { tag: string }) => e.tag === tag);
assert.ok(entry, "0061 journal entry exists");
const qualify = (sql: string) => sql.replaceAll('"public".', `"${ns}".`).replaceAll("public.", `${ns}.`).replaceAll("drizzle.__drizzle_migrations", `${ns}.__drizzle_migrations`);
const up = qualify(fs.readFileSync(upFile, "utf8"));
const down = qualify(fs.readFileSync(downFile, "utf8"));
let checks = 0;
function check(label: string, actual: unknown, expected: unknown) { assert.deepEqual(actual, expected, label); console.log(`PASS ${label}`); checks++; }
async function reject(label: string, query: string, code: string, args: unknown[] = []) {
  await assert.rejects(client.query(query, args), (e: unknown) => (e as { code?: string }).code === code, label);
  console.log(`PASS ${label}`); checks++;
}
async function applyUp() { await client.query(up); }
const ids = { draft: randomUUID(), order: randomUUID(), card: randomUUID(), redemption: randomUUID() };
async function operation(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    id: randomUUID(), operation_key: randomUUID(), request_hash: "fixture-hash", kind: "refund",
    payment_scope_key: `draft:${ids.draft}`, draft_id: ids.draft,
    cash_amount_kurus: 8000, gift_amount_kurus: 2000, method: "card",
    external_reference: randomUUID(), external_reference_key: randomUUID(),
    occurred_at: new Date("2026-09-17T08:00:00Z"), confirmed_at: new Date("2026-09-17T08:01:00Z"),
    admin_email: "refund@example.invalid", reason: "Doğrulanmış iade kaydı", source_snapshot: {}, result_snapshot: {}, ...overrides,
  };
  const keys = Object.keys(data);
  return client.query(`INSERT INTO order_refund_records (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`, keys.map(k => ["source_snapshot", "result_snapshot", "email_payload", "email_progress", "analytics_progress"].includes(k) ? JSON.stringify(data[k]) : data[k]));
}
async function rejectOperation(label: string, overrides: Record<string, unknown>, code = "23514") {
  await assert.rejects(operation(overrides), (e: unknown) => (e as { code?: string }).code === code, label); checks++; console.log(`PASS ${label}`);
}
async function assertDownRefuses(label: string) {
  const before = (await client.query("SELECT * FROM __drizzle_migrations ORDER BY created_at")).rows;
  await assert.rejects(client.query(down), /0061 rollback refused/); checks++; console.log(`PASS ${label}`);
  check("refusal retains own and later journal rows", (await client.query("SELECT * FROM __drizzle_migrations ORDER BY created_at")).rows, before);
}
async function main() {
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${ns}`);
    await client.query(`SET search_path TO ${ns}, pg_catalog`);
    // Minimal real parent relations: no application import, seeds or public data.
    for (const table of ["orders", "order_drafts", "gift_cards", "gift_card_redemptions"]) {
      await client.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY, sentinel text NOT NULL DEFAULT 'preserve')`);
    }
    for (const [table, id] of [["orders", ids.order], ["order_drafts", ids.draft], ["gift_cards", ids.card], ["gift_card_redemptions", ids.redemption]]) await client.query(`INSERT INTO ${table}(id) VALUES($1)`, [id]);
    await client.query("CREATE TABLE __drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)");
    await client.query("INSERT INTO __drizzle_migrations(hash,created_at) VALUES('prior',$1),('own',$2),('later',$3)", [entry.when - 1, entry.when, entry.when + 1]);
    await applyUp(); await applyUp();
    check("up repeat creates exactly three refund tables", (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('order_refund_records','order_refund_allocations','gift_credit_returns') ORDER BY table_name", [ns])).rows.map(r => r.table_name), ["gift_credit_returns", "order_refund_allocations", "order_refund_records"]);
    const base = (await operation()).rows[0];
    check("email defaults to not_required", base.email_state, "not_required");
    check("analytics defaults to not_required", base.analytics_state, "not_required");
    check("analytics progress retains structured data", base.analytics_progress, {});
    await rejectOperation("duplicate operation key cannot create second refund", { operation_key: base.operation_key }, "23505");
    await rejectOperation("same actual transfer cannot be allocated a second time", { external_reference_key: base.external_reference_key }, "23505");
    for (const [label, change] of [
      ["unknown kind", { kind: "cancel" }], ["zero refund", { cash_amount_kurus: 0, gift_amount_kurus: 0 }],
      ["negative cash", { cash_amount_kurus: -1 }], ["negative gift", { gift_amount_kurus: -1 }],
      ["cash without reference", { external_reference: null }], ["cash without reference key", { external_reference_key: null }],
      ["blank reference", { external_reference: " " }], ["empty request hash", { request_hash: " " }],
      ["missing scope anchor", { draft_id: null }], ["two scope anchors", { standalone_order_id: ids.order }],
      ["scope anchor mismatch", { payment_scope_key: `order:${ids.order}` }], ["short reason", { reason: "short" }],
      ["blank actor", { admin_email: " " }], ["snapshot must be object", { source_snapshot: [] }],
      ["invalid email state", { email_state: "sent-maybe" }], ["invalid analytics state", { analytics_state: "sent-maybe" }],
      ["legacy evidence cannot queue email", { kind: "legacy_evidence", email_state: "pending", email_payload: { messages: [] } }],
      ["legacy evidence cannot queue analytics", { kind: "legacy_evidence", analytics_state: "pending" }],
    ] as const) await rejectOperation(label, change);
    await rejectOperation("missing real draft FK", { draft_id: randomUUID(), payment_scope_key: "draft:00000000-0000-0000-0000-000000000000" }, "23514");
    const missing = randomUUID();
    await rejectOperation("foreign draft is refused by actual FK", { draft_id: missing, payment_scope_key: `draft:${missing}` }, "23503");
    const giftOnly = (await operation({ cash_amount_kurus: 0, method: "gift_credit", external_reference: null, external_reference_key: null })).rows[0];
    check("gift-only does not invent bank reference", giftOnly.external_reference, null);
    const standalone = (await operation({ draft_id: null, standalone_order_id: ids.order, payment_scope_key: `order:${ids.order}` })).rows[0];
    check("standalone recorded source allowed", standalone.standalone_order_id, ids.order);
    const legacy = (await operation({ kind: "legacy_evidence" })).rows[0];
    const legacyAllocation = (await client.query("INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,'legacy_evidence',$2,0,1,'{}') RETURNING id", [legacy.id, ids.order])).rows[0].id;
    const legacyReturn = (await client.query("INSERT INTO gift_credit_returns(refund_allocation_id,redemption_id,gift_card_id,amount_kurus,balance_effect) VALUES($1,$2,$3,1,'none') RETURNING balance_before_kurus,balance_after_kurus", [legacyAllocation, ids.redemption, ids.card])).rows[0];
    check("legacy gift evidence can retain no balance write", legacyReturn, { balance_before_kurus: null, balance_after_kurus: null });
    check("legacy evidence has no delivery work", legacy.email_state, "not_required");
    const allocation = (await client.query("INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,'refund',$2,8000,2000,'{}') RETURNING id", [base.id, ids.order])).rows[0].id;
    await reject("duplicate child allocation rejected", "INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,'refund',$2,1,0,'{}')", "23505", [base.id, ids.order]);
    await reject("zero allocation rejected", "INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,'refund',$2,0,0,'{}')", "23514", [giftOnly.id, ids.order]);
    await reject("allocation evidence must be object", "INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,'refund',$2,1,0,'[]')", "23514", [giftOnly.id, ids.order]);
    const returned = (await client.query("INSERT INTO gift_credit_returns(refund_allocation_id,redemption_id,gift_card_id,amount_kurus,balance_effect,balance_before_kurus,balance_after_kurus) VALUES($1,$2,$3,2000,'restore',50,2050) RETURNING id", [allocation, ids.redemption, ids.card])).rows[0].id;
    for (const [label, set] of [
      ["return amount cannot be negative", "amount_kurus=-1"], ["return balance must conserve amount", "balance_after_kurus=2051"],
      ["restore must have balances", "balance_before_kurus=NULL"], ["none cannot modify balance", "balance_effect='none'"],
      ["invalid balance effect", "balance_effect='maybe'"],
    ]) await reject(label, `UPDATE gift_credit_returns SET ${set} WHERE id=$1`, "23514", [returned]);
    await reject("same redemption cannot be claimed twice per refund", "INSERT INTO gift_credit_returns(refund_allocation_id,redemption_id,gift_card_id,amount_kurus,balance_effect,balance_before_kurus,balance_after_kurus) VALUES($1,$2,$3,1,'restore',0,1)", "23505", [allocation, ids.redemption, ids.card]);
    for (const [table, id] of [["order_refund_records", base.id], ["order_refund_allocations", allocation], ["orders", ids.order], ["order_drafts", ids.draft], ["gift_cards", ids.card], ["gift_card_redemptions", ids.redemption]]) await reject(`${table} history FK restricts deletion`, `DELETE FROM ${table} WHERE id=$1`, "23503", [id]);
    const cancellation = (await operation({ kind: "cancellation", cash_amount_kurus: 0, gift_amount_kurus: 0, method: "none", external_reference: null, external_reference_key: null })).rows[0];
    check("zero cancellation is operational evidence without cash refund", cancellation.cash_amount_kurus, 0);
    const cancelAllocation = (await client.query("INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,'cancellation',$2,0,0,'{}') RETURNING id", [cancellation.id, ids.order])).rows[0].id;
    check("zero cancellation allocation allowed", typeof cancelAllocation, "string");
    await rejectOperation("cancellation cannot claim cash returned", { kind: "cancellation" });
    await rejectOperation("none method cannot disguise positive tender", { method: "none" });
    const giftCancellation = (await operation({ kind: "cancellation", cash_amount_kurus: 0, gift_amount_kurus: 2000, method: "gift_credit", external_reference: null, external_reference_key: null })).rows[0];
    check("cancellation may record actual gift return without claiming cash", { cash: giftCancellation.cash_amount_kurus, gift: giftCancellation.gift_amount_kurus, method: giftCancellation.method }, { cash: 0, gift: 2000, method: "gift_credit" });
    const cancelAgain = (await operation({ kind: "cancellation", cash_amount_kurus: 0, gift_amount_kurus: 0, method: "none", external_reference: null, external_reference_key: null })).rows[0];
    await reject("one cancellation per order even with a new operation", "INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,'cancellation',$2,0,0,'{}')", "23505", [cancelAgain.id, ids.order]);
    await reject("allocation kind cannot disagree with header", "INSERT INTO order_refund_allocations(refund_id,kind,order_id,cash_kurus,gift_kurus,basis_snapshot) VALUES($1,'refund',$2,1,0,'{}')", "23503", [cancelAgain.id, ids.order]);
    const draftReturn = (await client.query("INSERT INTO gift_credit_returns(expired_draft_id,redemption_id,gift_card_id,amount_kurus,balance_effect,balance_before_kurus,balance_after_kurus) VALUES($1,$2,$3,10,'restore',0,10) RETURNING id", [ids.draft, ids.redemption, ids.card])).rows[0].id;
    check("draft-only reservation return has no fake order allocation", typeof draftReturn, "string");
    await reject("draft return must change actual balance", "UPDATE gift_credit_returns SET balance_effect='none',balance_before_kurus=NULL,balance_after_kurus=NULL WHERE id=$1", "23514", [draftReturn]);
    await reject("gift return cannot have both parent kinds", "UPDATE gift_credit_returns SET refund_allocation_id=$1 WHERE id=$2", "23514", [allocation, draftReturn]);
    await reject("gift return must have one parent", "UPDATE gift_credit_returns SET expired_draft_id=NULL WHERE id=$1", "23514", [draftReturn]);
    await reject("same draft reservation release cannot repeat", "INSERT INTO gift_credit_returns(expired_draft_id,redemption_id,gift_card_id,amount_kurus,balance_effect,balance_before_kurus,balance_after_kurus) VALUES($1,$2,$3,10,'restore',0,10)", "23505", [ids.draft, ids.redemption, ids.card]);
    await assertDownRefuses("populated financial history refuses rollback");
    check("refusal retains exact gift balance evidence", (await client.query("SELECT amount_kurus,balance_before_kurus,balance_after_kurus FROM gift_credit_returns WHERE id=$1", [returned])).rows[0], { amount_kurus: 2000, balance_before_kurus: 50, balance_after_kurus: 2050 });
    await client.query("DELETE FROM gift_credit_returns; DELETE FROM order_refund_allocations; DELETE FROM order_refund_records");
    // A live writer must prevent down from observing an empty table and
    // dropping history. The migration's own 5s timeout is part of this proof.
    const writer = new pg.Client({ connectionString: raw });
    await writer.connect();
    try {
      await writer.query(`SET search_path TO ${ns}, pg_catalog`);
      await writer.query("BEGIN");
      await writer.query("UPDATE order_refund_records SET reason=reason");
      await reject("rollback waits for concurrent writer and times out safely", down, "55P03");
      check("lock timeout preserves own migration journal", (await client.query("SELECT count(*)::int AS n FROM __drizzle_migrations WHERE created_at=$1", [entry.when])).rows[0].n, 1);
      check("lock timeout preserves all three tables", (await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name IN ('order_refund_records','order_refund_allocations','gift_credit_returns')", [ns])).rows[0].n, 3);
    } finally { await writer.query("ROLLBACK"); await writer.end(); }
    await client.query(down); await client.query(down);
    check("down deletes only its own journal entry, not newer one", (await client.query("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).rows.map(r => r.hash), ["prior", "later"]);
    for (const table of ["orders", "order_drafts", "gift_cards", "gift_card_redemptions"]) check(`${table} parent data preserved`, (await client.query(`SELECT sentinel FROM ${table}`)).rows, [{ sentinel: "preserve" }]);
    await applyUp();
    check("up -> down -> down -> up succeeds", (await client.query("SELECT count(*)::int AS n FROM order_refund_records")).rows[0].n, 0);
    await client.query(down);
    // Down must detect data even in a partially present leaf table, not only header.
    for (const table of ["order_refund_allocations", "gift_credit_returns"]) {
      await client.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY); INSERT INTO ${table} VALUES(gen_random_uuid())`);
      await assertDownRefuses(`${table} alone with runtime data refuses partial rollback`);
      await client.query(`DELETE FROM ${table}`); await client.query(down);
    }
    console.log(`${checks} migration database checks passed`);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`);
    await client.end(); console.log("Exact QA schema removed");
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
