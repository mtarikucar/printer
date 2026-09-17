/** Actual export routes and encoder/file service; stub only auth and DB pages. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { encodePayoutCursor, type PayoutListScope } from "../src/lib/config/payout-list";
const require = createRequire(import.meta.url);
const original = new Map<string, NodeJS.Module | undefined>();
function stub(path: string, exports: unknown) {
  const id = require.resolve(path); original.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeJS.Module;
}
let authenticated = true;
let adminRole = true;
let fail = false;
const owner = randomUUID(), foreign = randomUUID();
const scopes: PayoutListScope[] = [];
let checks = 0;
function check(label: string, actual: unknown, expected: unknown) { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); }
async function main() {
  try {
    stub("../src/lib/auth/require-admin", { requireAdmin: async () => authenticated && adminRole ? { session: { user: { email: "operator@example.invalid" } } } : { response: NextResponse.json({ error: "Admin oturumu gerekiyor." }, { status: 401 }) } });
    stub("../src/lib/services/manufacturer-auth", { getManufacturerSession: async () => authenticated ? { manufacturerId: owner, email: "partner@example.invalid" } : null });
    stub("../src/lib/services/painter-auth", { getPainterSession: async () => authenticated ? { painterId: owner, email: "partner@example.invalid" } : null });
    stub("../src/lib/db", { db: { transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ execute: async () => undefined }) } });
    stub("../src/lib/services/payout-list", { loadPayoutPage: async (_tx: unknown, scope: PayoutListScope) => {
      scopes.push(scope); if (fail) throw new Error("query unavailable");
      return { rows: [], nextCursor: null, hasMore: false };
    } });
    const admin = await import("../src/app/api/admin/payouts/export/route");
    const manufacturer = await import("../src/app/api/manufacturer/payouts/export/route");
    const painter = await import("../src/app/api/painter/payouts/export/route");
    const req = (query = "") => new NextRequest(`http://localhost/api/payouts/export?${query}`);
    authenticated = false;
    for (const route of [admin, manufacturer, painter]) check("anonymous export is refused", (await route.GET(req())).status, 401);
    check("anonymous requests never reach rows", scopes.length, 0);
    authenticated = true; adminRole = false;
    check("non-admin cannot export admin history", (await admin.GET(req())).status, 401);
    adminRole = true;
    let response = await admin.GET(req(`kind=painter&partnerId=${foreign}&status=voided`));
    check("admin filters delegate exact authorized scope", scopes.at(-1), { audience: "admin", kind: "painter", partnerId: foreign });
    check("admin complete export status", response.status, 200); await response.text();
    for (const [kind, route] of [["manufacturer", manufacturer], ["painter", painter]] as const) {
      response = await route.GET(req("status=all")); check("partner export succeeds", response.status, 200);
      check("partner owner always derives from session", scopes.at(-1), { audience: "partner", kind, partnerId: owner });
      check("partner header excludes operator columns", (await response.text()).includes("Talebi açan"), false);
      for (const query of [`partnerId=${foreign}`, `partnerId=${owner}`, `kind=${kind === "manufacturer" ? "painter" : "manufacturer"}`, "cursor=", "limit=50", "status=bogus", "status=all&status=paid", "unknown=1"]) {
        check("foreign scope, page subset and malformed filters refused", (await route.GET(req(query))).status, 400);
      }
      const cursor = encodePayoutCursor({ audience: "partner", kind, partnerId: foreign }, "all", { lastId: randomUUID(), lastTimestamp: "2026-09-17 00:00:00.000001" });
      check("foreign cursor does not authorize export", (await route.GET(req(`cursor=${cursor}`))).status, 400);
    }
    fail = true;
    const before = (await readdir(tmpdir())).filter(n => n.startsWith("payout-export-"));
    response = await admin.GET(req("status=all"));
    check("read failure returns JSON instead of partial successful CSV", response.status, 500);
    check("read failure has a Turkish message", /[çğıöşü]/.test((await response.json()).error), true);
    check("failed route removes temporary file", (await readdir(tmpdir())).filter(n => n.startsWith("payout-export-")).sort(), before.sort());
  } finally { for (const [id, value] of original) { if (value) require.cache[id] = value; else delete require.cache[id]; } }
  console.log(`${checks} export API checks passed; no database or sends`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
