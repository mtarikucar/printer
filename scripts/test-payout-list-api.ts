/** Production GET handlers with auth/reader boundaries stubbed; no DB/server. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { PayoutListScope, PayoutListQuery } from "../src/lib/config/payout-list";
const require = createRequire(import.meta.url);
const original = new Map<string, NodeJS.Module | undefined>();
function stub(path: string, exports: unknown) {
  const id = require.resolve(path); original.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeJS.Module;
}
let authenticated = true, adminRole = true, fail = false;
const owner = randomUUID(), foreign = randomUUID();
const reads: {scope: PayoutListScope; query: PayoutListQuery}[] = [];
let checks = 0;
function check(label: string, actual: unknown, expected: unknown) { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); }
async function main() {
  try {
    stub("../src/lib/auth/require-admin", { requireAdmin: async () => authenticated && adminRole ? { session: { user: { email: "operator@example.invalid" } } } : { response: NextResponse.json({ error: "Admin oturumu gerekiyor." }, { status: 401 }) } });
    stub("../src/lib/services/manufacturer-auth", { getManufacturerSession: async () => authenticated ? { manufacturerId: owner } : null });
    stub("../src/lib/services/painter-auth", { getPainterSession: async () => authenticated ? { painterId: owner } : null });
    stub("../src/lib/services/payout-list", { readPayoutPage: async (scope: PayoutListScope, query: PayoutListQuery) => {
      reads.push({scope, query}); if (fail) throw new Error("query unavailable");
      return { rows: [], nextCursor: null, hasMore: false };
    } });
    const admin = await import("../src/app/api/admin/payouts/route");
    const manufacturer = await import("../src/app/api/manufacturer/payouts/route");
    const painter = await import("../src/app/api/painter/payouts/route");
    const req = (query = "") => new NextRequest(`http://localhost/api/payouts?${query}`);
    authenticated = false;
    for (const route of [admin, manufacturer, painter]) check("anonymous read refused", (await route.GET(req())).status, 401);
    check("anonymous requests never reach reader", reads.length, 0);
    authenticated = true; adminRole = false;
    check("non-admin cannot read admin history", (await admin.GET(req())).status, 401); adminRole = true;
    let response = await admin.GET(req());
    check("admin default status and page size", reads.at(-1), {scope: {audience:"admin",kind:"manufacturer"},query:{status:"pending",limit:50}});
    check("successful financial response prevents caching", response.headers.get("cache-control"), "private, no-store");
    response = await admin.GET(req(`kind=painter&partnerId=${foreign}&status=voided&limit=100`));
    check("admin filter adapter preserves exact scope and query", reads.at(-1), {scope:{audience:"admin",kind:"painter",partnerId:foreign},query:{status:"voided",limit:100}});
    check("successful response uses page DTO", await response.json(), {rows:[],nextCursor:null,hasMore:false});
    for (const [kind, route] of [["manufacturer", manufacturer], ["painter", painter]] as const) {
      response = await route.GET(req()); check("partner read succeeds", response.status, 200);
      check("partner owner from session and default all", reads.at(-1), {scope:{audience:"partner",kind,partnerId:owner},query:{status:"all",limit:50}});
      for (const query of [`partnerId=${foreign}`, `partnerId=${owner}`, `kind=${kind === "manufacturer" ? "painter" : "manufacturer"}`, "cursor=", "limit=101", "status=bogus", "status=all&status=paid", "unknown=1"]) {
        const before = reads.length;
        check("foreign or malformed request refused", (await route.GET(req(query))).status, 400);
        assert.equal(reads.length, before);
      }
    }
    fail = true;
    for (const route of [admin, manufacturer, painter]) {
      response = await route.GET(req()); check("unavailable membership is failure, never empty success", response.status, 500);
      check("failure carries Turkish message", /[çğıöşü]/.test((await response.json()).error), true);
    }
  } finally { for (const [id, value] of original) { if (value) require.cache[id] = value; else delete require.cache[id]; } }
  console.log(`${checks} payout list API checks passed; no database or sends`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
