/**
 * Execute the actual handoff function bodies against isolated QA PostgreSQL.
 * Auth, capacity and external side effects are controlled; placement SQL and
 * transaction/early-return behavior are real. The capacity boundary commits a
 * split change after the route/automatic assignment has read the old order.
 * Up: connection-local TEMP tables/fixtures. Down: ROLLBACK + disconnect;
 * no persistent schema, runtime rows, queues, or production imports are used.
 * Run: QA_MONEY_PG_URL=... npx tsx scripts/test-painter-handoff-money-race.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as orm from "drizzle-orm";
import * as tables from "../src/lib/db/schema";
import * as flags from "../src/lib/config/flags";
import * as policy from "../src/lib/config/order-status-policy";
import { manufacturerBaseKurus } from "../src/lib/services/earning-base";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const raw = process.env.QA_MONEY_PG_URL;
if (!raw) throw new Error("QA_MONEY_PG_URL is required (isolated localhost:55433 only)");
const url = new URL(raw);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "55433") throw new Error("Refusing non-QA database");
const client = new pg.Client({ connectionString: raw });
const db = drizzle(client, { schema: tables });
const makerId = randomUUID();
const painterId = randomUUID();
let orderId = "";
let mutation: (() => Promise<void>) | undefined;
let effects: string[] = [];
let checks = 0;
const effect = (name: string) => async () => { effects.push(name); };
const context: Record<string, unknown> = {
  ...orm, ...tables, ...flags, ...policy, db, z, NextResponse, manufacturerBaseKurus,
  notRefundedGuard: () => orm.ne(tables.orders.paymentStatus, "refunded"),
  getManufacturerSession: async () => ({ manufacturerId: makerId }),
  requireAdmin: async () => ({ session: { user: { email: "test@example.invalid", role: "admin" } } }),
  readPartnerModelAck: async () => ({}), modelAckRefusal: () => null,
  isPartnerOrderRefunded: async () => false,
  painterCapacityGate: async () => { await mutation?.(); return { ok: true }; },
  isFlagEnabled: async () => true,
  rankPaintersForOrder: async () => [{ painterId, eligible: true, score: 100 }],
  accrueEarning: effect("accrual"), accrueHandoffPrintEarning: effect("accrual"),
  notifyPainter: effect("painter notice"), notifyPainterOfNewJob: effect("painter notice"),
  notifyManufacturerOfPainterHandoff: effect("manufacturer notice"),
  emitOrderChanged: effect("realtime"), announceUnplacedPainter: effect("admin notice"),
  recordPainterPlacementDecision: async () => { effects.push("decision"); return {}; },
  recordPainterEvaluation: async () => { effects.push("decision"); return true; },
  notePainterDecisionUnrecorded: async () => null,
  painterWeightsVersion: () => "test",
  handleRouteFailure: (...args: unknown[]) => { throw args.find(a => a instanceof Error) ?? new Error("route failure"); },
  PARTNER_ACTION_FAILED_ERROR: "failed", ADMIN_ACTION_FAILED_ERROR: "failed",
};

// Compile named declarations from the production source, not a copied query.
// Keeping imports out prevents loading live DB/Redis/auth/provider clients.
function loadDeclarations(file: string, names: string[], dependencies: Record<string, unknown> = {}) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const declarations = source.statements.filter(node =>
    ts.isFunctionDeclaration(node) ? !!node.name && names.includes(node.name.text)
      : ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && names.includes(d.name.text)));
  assert.equal(declarations.length, names.length, `production declarations: ${file}`);
  const code = ts.transpileModule(declarations.map(n => n.getText(source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {} as {
    POST: (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
    assignPainterAutomatically: (orderId: string, opts?: { painterDetached: boolean }) => Promise<{ reason: string }>;
  };
  const scope = { ...context, ...dependencies };
  new Function("exports", ...Object.keys(scope), code)(exports, ...Object.values(scope));
  return exports;
}

function shipPredicate(file: string, before: { needsPainting: boolean }, paintsInHouse: boolean) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const predicates: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "where"
      && /\.update\(orders\)/.test(node.expression.expression.getText(source))
      && /manufacturerStatus:\s*"shipped"/.test(node.expression.expression.getText(source))) {
      predicates.push(node.arguments[0].getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(predicates.length, 1, `manufacturer shipping UPDATE in ${file}`);
  const scope = { ...context, id: orderId, current: before, order: { id: orderId, ...before }, session: { manufacturerId: makerId }, manufacturerId: makerId, manufacturer: { paintsInHouse } };
  return new Function(...Object.keys(scope), `return (${predicates[0]});`)(...Object.values(scope));
}

async function main() {
  await client.connect();
  try {
    // Fail closed if a temp table disappears; never fall back to public rows.
    await client.query("SET search_path TO pg_temp");
    for (const table of ["orders", "manufacturers", "painters", "painter_actions", "manufacturer_actions"]) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    }
    await client.query("INSERT INTO manufacturers(id,email,password_hash,company_name,contact_person,phone,status) VALUES($1,'maker@test.invalid','x','Maker','Test','0','active')", [makerId]);
    await client.query("INSERT INTO painters(id,email,password_hash,company_name,contact_person,phone,status) VALUES($1,'painter@test.invalid','x','Painter','Test','0','active')", [painterId]);
    const manufacturer = loadDeclarations("src/app/api/manufacturer/orders/[id]/send-to-painter/route.ts", ["schema", "POST"]);
    const admin = loadDeclarations("src/app/api/admin/orders/[id]/assign-painter/route.ts", ["schema", "POST"]);
    const automatic = loadDeclarations("src/lib/services/painter-auto-assign.ts", ["PAINTER_AUTO_ASSIGNED_ACTION", "unplacedResult", "painterHandoffConditions", "placePainterOnOrder", "assignPainterAutomatically"]);
    for (const [name, route] of [["manufacturer", manufacturer], ["admin", admin], ["automatic", automatic]] as const) {
      for (const state of ["removed", "flag_only", "zero_share", "positive"] as const) {
        orderId = randomUUID(); effects = [];
        await client.query(`INSERT INTO orders(id,order_number,user_id,email,customer_name,shipping_address,payment_method,status,manufacturer_id,manufacturer_status,needs_painting,amount_kurus,production_base_kurus,painting_price_kurus)
          VALUES($1,$2,$1,'test@test.invalid','Test','{}','bank_transfer','quality_check',$3,'qc_approved',true,10000,6000,4000)`, [orderId, orderId, makerId]);
        mutation = async () => {
          await client.query("UPDATE orders SET needs_painting=$2,painting_price_kurus=$3,production_base_kurus=10000-$3 WHERE id=$1", [orderId, state === "zero_share" || state === "positive", state === "flag_only" || state === "positive" ? 4000 : 0]);
        };
        const result = name === "automatic"
          ? await route.assignPainterAutomatically(orderId)
          : await route.POST(new NextRequest("http://localhost/test", { method: "POST", body: JSON.stringify({ painterId }), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ id: orderId }) });
        const row = (await client.query("SELECT painter_id,status FROM orders WHERE id=$1", [orderId])).rows[0];
        if (state === "positive") {
          assert.equal(row.painter_id, painterId, `${name}: positive share still places before shipment`);
          assert.ok(effects.includes("accrual") && effects.includes("painter notice"));
        } else {
          assert.equal(row.painter_id, null, `${name}/${state}: late handoff must not place`);
          assert.equal(row.status, "quality_check");
          assert.deepEqual(effects, [], `${name}/${state}: no accrual, notice, realtime or decision on lost write`);
          const actions = await client.query("SELECT 1 FROM painter_actions WHERE order_id=$1 UNION ALL SELECT 1 FROM manufacturer_actions WHERE order_id=$1", [orderId]);
          assert.equal(actions.rowCount, 0);
          if (name === "automatic") assert.equal((result as { reason: string }).reason, "not_needed");
          else { const response = result as Response; assert.equal(response.status, 409); assert.ok((await response.json()).error); }
        }
        checks++;
        console.log(`ok ${name}/${state}`);
      }
    }
    // Force a lost placement at the helper boundary; the caller must reread
    // real current state and notify only if unplaced work still needs action.
    // The actual placement SQL/early returns are exercised above.
    const lostWrite = loadDeclarations("src/lib/services/painter-auto-assign.ts", ["unplacedResult", "assignPainterAutomatically"], {
      placePainterOnOrder: async () => { await mutation?.(); return { code: "lost_race" }; },
    });
    for (const reason of ["no_candidate", "refunded", "not_needed", "already_assigned"] as const) {
      orderId = randomUUID(); effects = [];
      await client.query(`INSERT INTO orders(id,order_number,user_id,email,customer_name,shipping_address,payment_method,status,manufacturer_id,manufacturer_status,needs_painting,amount_kurus,production_base_kurus,painting_price_kurus)
        VALUES($1,$2,$1,'test@test.invalid','Test','{}','bank_transfer','quality_check',$3,'qc_approved',true,10000,6000,4000)`, [orderId, orderId, makerId]);
      mutation = async () => {
        if (reason === "refunded") await client.query("UPDATE orders SET payment_status='refunded' WHERE id=$1", [orderId]);
        if (reason === "not_needed") await client.query("UPDATE orders SET needs_painting=false,painting_price_kurus=0,production_base_kurus=10000 WHERE id=$1", [orderId]);
        if (reason === "already_assigned") await client.query("UPDATE orders SET painter_id=$2,painter_status='assigned' WHERE id=$1", [orderId, painterId]);
      };
      const result = await lostWrite.assignPainterAutomatically(orderId, { painterDetached: true });
      assert.equal(result.reason, reason);
      assert.deepEqual(effects, reason === "no_candidate" ? ["admin notice"] : [], `lost write/${reason}: only actionable unplaced work notifies admin`);
      checks++;
      console.log(`ok lost write/${reason}`);
    }
    for (const file of ["src/app/api/manufacturer/orders/[id]/ship/route.ts", "src/lib/services/on-behalf.ts"]) {
      for (const [before, after, paintsInHouse, allowed] of [
        [false, true, false, false], [false, true, true, false],
        [false, false, false, true], [true, true, true, true], [true, true, false, false],
      ]) {
        orderId = randomUUID();
        await client.query(`INSERT INTO orders(id,order_number,user_id,email,customer_name,shipping_address,payment_method,status,manufacturer_id,manufacturer_status,needs_painting,amount_kurus,production_base_kurus,painting_price_kurus)
          VALUES($1::uuid,$1::uuid::text,$1::uuid,'test@test.invalid','Test','{}','bank_transfer','quality_check',$2,'qc_approved',$3,10000,$4,$5)`, [orderId, makerId, before, before ? 6000 : 10000, before ? 4000 : 0]);
        // Hold the request's old snapshot, then commit the split edit first.
        const predicate = shipPredicate(file, { needsPainting: before }, paintsInHouse);
        await client.query("UPDATE orders SET needs_painting=$2,production_base_kurus=$3,painting_price_kurus=$4 WHERE id=$1", [orderId, after, after ? 6000 : 10000, after ? 4000 : 0]);
        const updated = await db.update(tables.orders).set({ manufacturerStatus: "shipped", status: "shipped", shippedAt: new Date() }).where(predicate).returning({ id: tables.orders.id });
        assert.equal(updated.length, allowed ? 1 : 0, `${file}: ${before}→${after}, self-paint=${paintsInHouse}`);
        checks++;
        console.log(`ok ship ${file}: ${before}→${after}, self-paint=${paintsInHouse}`);
      }
    }
    console.log(`painter handoff money race: ${checks} cases passed`);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
