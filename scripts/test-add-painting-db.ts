/**
 * QA-only adapter + real shared transaction regression. Production function
 * bodies run with a real PostgreSQL client; auth/notifications are controlled.
 * Up: connection-local TEMP tables/fixtures. Down: disconnect drops them all.
 * No migrations, persistent data, queues or server processes are touched.
 * Run: QA_MONEY_PG_URL=... npx tsx scripts/test-add-painting-db.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as orm from "drizzle-orm";
import * as tables from "../src/lib/db/schema";
import * as policy from "../src/lib/config/order-status-policy";
import * as splitPolicy from "../src/lib/config/order-money-edit";
import * as bases from "../src/lib/services/earning-base";
import { parseTryToKurus } from "../src/lib/config/cost-lines";
import { finishNeedsPainter } from "../src/lib/config/prices";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const raw = process.env.QA_MONEY_PG_URL;
if (!raw) throw new Error("QA_MONEY_PG_URL is required (localhost:55433 only)");
const url = new URL(raw);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55433") throw new Error("Refusing non-QA database");
const client = new pg.Client({ connectionString: raw });
const db = drizzle(client, { schema: tables });
const maker = randomUUID(), painter = randomUUID();
let effects: string[] = [];
let failNotice = false, failLookup = false, failEmit = false;
const routeDb = new Proxy(db, {
  get(target, key) {
    if (key !== "query") return Reflect.get(target, key);
    return { ...db.query, manufacturers: {
      findFirst: async (...args: Parameters<typeof db.query.manufacturers.findFirst>) => {
        if (failLookup) throw new Error("test: notice lookup unavailable");
        return db.query.manufacturers.findFirst(...args);
      },
    } };
  },
});
const scope = {
  ...orm, ...tables, ...policy, ...splitPolicy, ...bases, db, z, NextResponse,
  parseTryToKurus, finishNeedsPainter,
  notRefundedGuard: () => orm.ne(tables.orders.paymentStatus, policy.REFUNDED_PAYMENT_STATUS),
  requireAdmin: async () => ({ session: { user: { email: "admin@test.invalid", role: "admin" } } }),
  notifyManufacturer: async () => { effects.push("notice"); if (failNotice) throw new Error("test: notice unavailable"); },
  emitOrderChanged: async () => { effects.push("realtime"); if (failEmit) throw new Error("test: realtime unavailable"); },
  handleRouteFailure: () => NextResponse.json({ error: "unexpected failure" }, { status: 500 }),
  ADMIN_ACTION_FAILED_ERROR: "unexpected failure",
};

function loadSource(file: string, dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const code = ts.transpileModule(source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function("exports", ...Object.keys(dependencies), code)(exports, ...Object.values(dependencies));
  return exports;
}

async function main() {
  await client.connect();
  try {
    await client.query("SET search_path TO pg_temp");
    for (const table of ["orders", "manufacturers", "painters", "manufacturer_earnings", "painter_earnings", "admin_actions"]) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    }
    await client.query("INSERT INTO manufacturers(id,email,password_hash,company_name,contact_person,phone) VALUES($1,'maker@test.invalid','x','Maker','Test','0')", [maker]);
    await client.query("INSERT INTO painters(id,email,password_hash,company_name,contact_person,phone) VALUES($1,'painter@test.invalid','x','Painter','Test','0')", [painter]);
    const shared = loadSource("src/lib/services/order-money-edit.ts", scope);
    const route = loadSource("src/app/api/admin/orders/[id]/add-painting/route.ts", { ...scope, ...shared, db: routeDb });
    const post = route.POST as (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
    const seed = async () => {
      const id = randomUUID(); effects = []; failNotice = false; failLookup = false; failEmit = false;
      await client.query(`INSERT INTO orders(id,order_number,user_id,email,customer_name,shipping_address,payment_method,status,manufacturer_id,manufacturer_status,amount_kurus,production_base_kurus,painting_price_kurus)
        VALUES($1::uuid,$1::uuid::text,$1::uuid,'test@test.invalid','Test','{}','bank_transfer','quality_check',$2,'qc_approved',10000,10000,0)`, [id, maker]);
      return id;
    };
    const reason = "Müşteri talebi doğrultusunda";
    const request = (id: string, body: object = { amount: "40", reason }) => post(new NextRequest("http://localhost/test", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ id }) });
    const snapshot = async (id: string) => (await client.query("SELECT production_base_kurus,painting_price_kurus,needs_painting,finish FROM orders WHERE id=$1", [id])).rows[0];
    let checks = 0;
    for (const kind of ["manufacturer", "painter"] as const) {
      const id = await seed(), before = await snapshot(id);
      await client.query(`INSERT INTO ${kind}_earnings(order_id,${kind}_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps,status) VALUES($1,$2,10000,4000,6000,4000,'reversed')`, [id, kind === "manufacturer" ? maker : painter]);
      const response = await request(id);
      assert.equal(response.status, 409, `reversed ${kind} earning blocks the old add-painting endpoint`);
      assert.deepEqual(await snapshot(id), before, "refusal leaves split and finish unchanged");
      assert.deepEqual(effects, []);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM admin_actions WHERE order_id=$1", [id])).rows[0].n, 0);
      checks++; console.log(`ok reversed ${kind}: refused, unchanged, no side effects`);
    }
    for (const badReason of [undefined, "short", "          "]) {
      const id = await seed(), before = await snapshot(id);
      assert.equal((await request(id, { amount: "40", reason: badReason })).status, 400);
      assert.deepEqual(await snapshot(id), before);
      checks++;
    }
    for (const failure of ["none", "notice", "lookup", "realtime"] as const) {
      const id = await seed(); failNotice = failure === "notice"; failLookup = failure === "lookup"; failEmit = failure === "realtime";
      const response = await request(id);
      assert.equal(response.status, 200, `${failure}: no 500 after commit`);
      assert.equal((await response.json()).success, true);
      assert.deepEqual(await snapshot(id), { production_base_kurus: 6000, painting_price_kurus: 4000, needs_painting: true, finish: "hand_painted" });
      const audit = (await client.query("SELECT notes FROM admin_actions WHERE order_id=$1", [id])).rows;
      assert.equal(audit.length, 1, "shared service owns the sole audit");
      assert.ok(audit[0].notes.includes(reason));
      checks++;
    }
    console.log(`add-painting adapter: ${checks} DB cases passed`);
  } finally { await client.end(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
