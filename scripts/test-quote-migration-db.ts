/** Real 0064 DDL + seed, only a disposable schema in explicitly selected QA55433. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");
const tag = "0064_instant_quotes";
const upPath = path.join(root, "drizzle", `${tag}.sql`);
const downPath = path.join(root, "drizzle", `${tag}.down.sql`);
assert.ok(fs.existsSync(upPath) && fs.existsSync(downPath), "0064 requires executable up/down artifacts");
const raw = process.env.QA_QUOTE_DB_URL;
if (!raw) throw new Error("Explicit QA_QUOTE_DB_URL is required");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa" || url.search) {
  throw new Error("Only 127.0.0.1:55433/printer_qa without connection options is allowed");
}
const ns = `quote_migration_${randomUUID().replaceAll("-", "")}`;
const client = new pg.Client({ connectionString: raw });
const entry = JSON.parse(fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8"))
  .entries.find((e: { tag: string }) => e.tag === tag);
assert.ok(entry, "0064 journal entry exists");
const qualify = (sql: string) => sql.replaceAll('"public".', `"${ns}".`)
  .replaceAll("public.", `${ns}.`).replaceAll("drizzle.__drizzle_migrations", `${ns}.__drizzle_migrations`);
const up = qualify(fs.readFileSync(upPath, "utf8"));
const down = qualify(fs.readFileSync(downPath, "utf8"));
// Dependency order: children first, so the list doubles as a delete order.
const ownedTables = ["quote_admin_actions", "quote_messages", "quote_checkouts", "quote_parts", "quotes",
  "print_catalog_changes", "quote_pricing_settings", "print_addons", "print_finishes", "print_materials", "print_technologies"];
const seedCounts = { print_technologies: 2, print_materials: 7, print_finishes: 5, print_addons: 4, quote_pricing_settings: 1 };
const fdmId = "00000000-0000-4000-8000-000000000f01";
const slaId = "00000000-0000-4000-8000-000000000f02";
const ids = { user: randomUUID(), order: randomUUID(), otherOrder: randomUUID(), draft: randomUUID(), otherDraft: randomUUID() };

let checks = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`);
}
async function rows(sql: string, params: unknown[] = []) {
  return (await client.query(sql, params)).rows;
}
async function count(table: string) {
  return (await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
}
async function listTables() {
  return (await rows("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", [ns]))
    .map((r) => r.table_name as string);
}
async function allSeedCounts() {
  const out: Record<string, number> = {};
  for (const table of Object.keys(seedCounts)) out[table] = await count(table);
  return out;
}
/** A quote needs only its frozen catalog and validity window; the rest defaults. */
async function insertQuote(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    anonymous_id: "anon-fixture",
    pricing_snapshot: JSON.stringify({ version: 1 }),
    expires_at: new Date(Date.now() + 30 * 86400000),
    ...overrides,
  };
  const keys = Object.keys(data);
  const overriding = keys.includes("seq") ? "OVERRIDING SYSTEM VALUE" : "";
  return (await client.query(
    `INSERT INTO quotes (${keys.join(",")}) ${overriding} VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.values(data),
  )).rows[0];
}
async function insertPart(quoteId: string, overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    quote_id: quoteId, name: "Parça", file_name: "parca.stl", source_key: `quote-parts/${randomUUID()}/source.stl`,
    source_format: "stl", source_bytes: 2048, source_sha256: "a".repeat(64),
    technology_key: "fdm", material_key: "pla", color_key: "beyaz", finish_key: "ham", ...overrides,
  };
  const keys = Object.keys(data);
  return (await client.query(
    `INSERT INTO quote_parts (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.values(data),
  )).rows[0];
}
async function rejects(name: string, sql: string, params: unknown[] = [], code = "23514") {
  await client.query("SAVEPOINT reject_probe");
  await assert.rejects(client.query(sql, params), (e: unknown) => (e as { code?: string }).code === code, name);
  await client.query("ROLLBACK TO SAVEPOINT reject_probe");
  checks++; console.log(`PASS ${name}`);
}
async function refusesDown(name: string) {
  await client.query("SAVEPOINT before_down");
  await assert.rejects(client.query(down), /0064 rollback refused/, name);
  await client.query("ROLLBACK TO SAVEPOINT before_down");
  checks++; console.log(`PASS ${name}`);
  check("refused down keeps the journal", (await count("__drizzle_migrations")), 3);
}

async function main() {
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${ns}`);
    await client.query(`SET search_path TO ${ns}, pg_catalog`);
    // Minimal predecessors: 0064 only references their ids.
    for (const table of ["users", "orders", "order_drafts"]) {
      await client.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY, sentinel text NOT NULL DEFAULT 'preserve')`);
    }
    await client.query("INSERT INTO users(id) VALUES($1)", [ids.user]);
    await client.query("INSERT INTO orders(id) VALUES($1),($2)", [ids.order, ids.otherOrder]);
    await client.query("INSERT INTO order_drafts(id) VALUES($1),($2)", [ids.draft, ids.otherDraft]);
    await client.query("CREATE TABLE __drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)");
    await client.query("INSERT INTO __drizzle_migrations(hash,created_at) VALUES('prior',$1),('own',$2),('later',$3)",
      [entry.when - 1, entry.when, entry.when + 1]);

    await client.query(up); await client.query(up);
    check("up is idempotent and creates every table", (await listTables()).filter((t) => ownedTables.includes(t)), [...ownedTables].sort());
    check("seed is applied exactly once", await allSeedCounts(), seedCounts);
    check("technologies carry their fixed ids", await rows("SELECT key,id::text,sort_order,order_material FROM print_technologies ORDER BY sort_order"), [
      { key: "fdm", id: fdmId, sort_order: 0, order_material: "filament" },
      { key: "sla", id: slaId, sort_order: 1, order_material: "resin" },
    ]);
    check("materials hang off both technologies with colours", await rows(
      `SELECT t.key AS tech, count(*)::int AS n, min(jsonb_array_length(m.colors))::int AS min_colors
       FROM print_materials m JOIN print_technologies t ON t.id = m.technology_id GROUP BY t.key ORDER BY t.key`),
      [{ tech: "fdm", n: 4, min_colors: 2 }, { tech: "sla", n: 3, min_colors: 1 }]);
    check("settings are a single configured row", (await rows(
      `SELECT id, min_order_kurus, max_parts_per_quote, max_file_bytes, quote_valid_days, cutoff_hour, havale_discount_applies,
              jsonb_array_length(qty_breaks) AS breaks, jsonb_array_length(lead_tiers) AS tiers, jsonb_array_length(holidays) AS holidays
       FROM quote_pricing_settings`))[0],
      { id: 1, min_order_kurus: 20000, max_parts_per_quote: 20, max_file_bytes: 33554432, quote_valid_days: 30, cutoff_hour: 14,
        havale_discount_applies: true, breaks: 7, tiers: 3, holidays: 27 });
    check("seeded rows are all active", await rows(
      `SELECT count(*)::int AS inactive FROM (
         SELECT active FROM print_technologies UNION ALL SELECT active FROM print_materials
         UNION ALL SELECT active FROM print_finishes UNION ALL SELECT active FROM print_addons) s WHERE active = false`),
      [{ inactive: 0 }]);

    const first = await insertQuote({ user_id: ids.user, anonymous_id: null });
    const second = await insertQuote();
    check("quote numbers are generated in sequence", [first.number, second.number, first.status, first.lead_tier, first.version, first.addon_keys],
      ["T-000001", "T-000002", "draft", "standard", 1, []]);
    const big = await insertQuote({ seq: 1234567 });
    const near = await insertQuote({ seq: 123456 });
    check("seven-digit sequences keep a distinct number", [big.number, near.number], ["T-1234567", "T-123456"]);

    const part = await insertPart(first.id, { upload_id: "upload-1", manual_price_key: "fiyat-anahtari", dfm_ack_key: "uyari-anahtari" });
    // Ruling R7: these columns hold partPricingKey()/dfmWarningKey() output, so they are keys, not hashes.
    check("part key columns carry the contract vocabulary",
      [part.manual_price_key, part.dfm_ack_key], ["fiyat-anahtari", "uyari-anahtari"]);
    await client.query("INSERT INTO quote_checkouts (quote_id,draft_id,quote_version,amount_kurus,parts_snapshot,lead_days) VALUES ($1,$2,1,25000,'[]'::jsonb,5)", [first.id, ids.draft]);
    await client.query("INSERT INTO quote_messages (quote_id,sender,body) VALUES ($1,'customer','Merhaba')", [first.id]);
    await client.query("INSERT INTO quote_admin_actions (quote_id,quote_part_id,action,admin_email,reason) VALUES ($1,$2,'manual_price','admin@example.invalid','Elle fiyat')", [first.id, part.id]);
    await client.query("UPDATE quotes SET order_id = $2 WHERE id = $1", [first.id, ids.order]);

    // Constraint probes write; one transaction keeps the stored fixtures intact.
    await client.query("BEGIN");
    await rejects("unknown quote status is rejected", "UPDATE quotes SET status='unknown' WHERE id=$1", [first.id]);
    await rejects("unknown review kind is rejected", "UPDATE quotes SET review_kind='haggle' WHERE id=$1", [first.id]);
    await rejects("unknown lead tier is rejected", "UPDATE quotes SET lead_tier='instant' WHERE id=$1", [first.id]);
    await rejects("unknown invoice type is rejected", "UPDATE quotes SET invoice_type='public' WHERE id=$1", [first.id]);
    await rejects("unknown tax id type is rejected", "UPDATE quotes SET tax_id_type='ssn' WHERE id=$1", [first.id]);
    await rejects("zero quantity is rejected", "UPDATE quote_parts SET quantity=0 WHERE id=$1", [part.id]);
    await rejects("quantity above the cap is rejected", "UPDATE quote_parts SET quantity=100001 WHERE id=$1", [part.id]);
    await rejects("scale below the range is rejected", "UPDATE quote_parts SET scale=0.009 WHERE id=$1", [part.id]);
    await rejects("scale above the range is rejected", "UPDATE quote_parts SET scale=100.02 WHERE id=$1", [part.id]);
    await rejects("unknown unit is rejected", "UPDATE quote_parts SET units='ft' WHERE id=$1", [part.id]);
    await rejects("unknown source format is rejected", "UPDATE quote_parts SET source_format='step' WHERE id=$1", [part.id]);
    await rejects("unknown analysis status is rejected", "UPDATE quote_parts SET analysis_status='done' WHERE id=$1", [part.id]);
    await rejects("unknown message sender is rejected", "UPDATE quote_messages SET sender='system' WHERE quote_id=$1", [first.id]);
    await rejects("unknown admin action is rejected", "UPDATE quote_admin_actions SET action='discount' WHERE quote_id=$1", [first.id]);
    await rejects("a second settings row is rejected",
      "INSERT INTO quote_pricing_settings (id,qty_breaks,lead_tiers,min_order_kurus,max_auto_total_kurus,max_auto_qty_per_part,max_parts_per_quote,max_file_bytes,quote_valid_days,retention_days_after_expiry,price_break_quantities,holidays,cutoff_hour,havale_discount_applies) VALUES (2,'[]','[]',1,1,1,1,1,1,1,'[]','[]',14,true)");
    await rejects("a malformed technology key is rejected", "UPDATE print_technologies SET key='FDM Pro' WHERE id=$1", [fdmId]);
    await rejects("an unknown order material is rejected", "UPDATE print_technologies SET order_material='powder' WHERE id=$1", [fdmId]);
    await rejects("an unknown finish cost line is rejected", "UPDATE print_finishes SET cost_line_kind='shipping' WHERE key='ham'");
    await rejects("an unknown addon price type is rejected", "UPDATE print_addons SET price_type='hourly' WHERE key='rohs_beyani'");
    await rejects("an unknown catalog entity is rejected",
      "INSERT INTO print_catalog_changes (entity,action,admin_email) VALUES ('printer','update','admin@example.invalid')");
    await rejects("an unknown catalog action is rejected",
      "INSERT INTO print_catalog_changes (entity,action,admin_email) VALUES ('material','delete','admin@example.invalid')");
    await rejects("a duplicate upload claim is rejected", "UPDATE quote_parts SET upload_id='upload-1' WHERE id=$1",
      [(await insertPart(first.id)).id], "23505");
    await rejects("two quotes cannot share one order", "UPDATE quotes SET order_id=$2 WHERE id=$1", [second.id, ids.order], "23505");
    await rejects("two checkouts cannot share one draft",
      "INSERT INTO quote_checkouts (quote_id,draft_id,quote_version,amount_kurus,parts_snapshot,lead_days) VALUES ($1,$2,1,1,'[]'::jsonb,1)",
      [second.id, ids.draft], "23505");
    await rejects("a part needs a real quote",
      "UPDATE quote_parts SET quote_id=$2 WHERE id=$1", [part.id, randomUUID()], "23503");
    await rejects("a used technology cannot be deleted", "DELETE FROM print_technologies WHERE id=$1", [fdmId], "23503");
    await rejects("a quote with parts cannot be deleted", "DELETE FROM quotes WHERE id=$1", [first.id], "23503");
    await client.query("ROLLBACK");

    await client.query("BEGIN");
    await refusesDown("a stored quote refuses the rollback");
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await client.query(`DELETE FROM quote_admin_actions; DELETE FROM quote_messages; DELETE FROM quote_parts;
      ALTER TABLE quote_checkouts DROP CONSTRAINT quote_checkouts_quote_id_quotes_id_fk; DELETE FROM quotes;`);
    await refusesDown("an orphaned checkout alone refuses the rollback");
    await client.query("ROLLBACK");
    await client.query("BEGIN");
    await client.query(`DELETE FROM quote_admin_actions; DELETE FROM quote_messages; DELETE FROM quote_checkouts;
      DELETE FROM quote_parts; DELETE FROM quotes;
      INSERT INTO print_catalog_changes (entity,action,admin_email) VALUES ('settings','update','admin@example.invalid');`);
    await refusesDown("an edited catalog refuses the rollback");
    await client.query("ROLLBACK");

    for (const table of ownedTables) {
      if (table.startsWith("print_") || table === "quote_pricing_settings") continue;
      await client.query(`DELETE FROM ${table}`);
    }
    await client.query(down); await client.query(down);
    check("down removes every owned table", (await listTables()).filter((t) => ownedTables.includes(t)), []);
    check("down removes only its journal record", (await rows("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).map((r) => r.hash), ["prior", "later"]);
    check("predecessor tables are untouched", (await rows(
      "SELECT sentinel FROM users UNION ALL SELECT sentinel FROM orders UNION ALL SELECT sentinel FROM order_drafts")).map((r) => r.sentinel),
      ["preserve", "preserve", "preserve", "preserve", "preserve"]);

    await client.query(up);
    check("up after down restores the tables", (await listTables()).filter((t) => ownedTables.includes(t)), [...ownedTables].sort());
    check("up after down restores the seed", await allSeedCounts(), seedCounts);
    check("numbering restarts on a fresh table", (await insertQuote()).number, "T-000001");
    console.log(`${checks} quote migration checks passed; disposable schema only`);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`);
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
