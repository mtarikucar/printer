/** Real route + pure validation; auth and transactional service are external boundaries. */
import assert from "node:assert/strict";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { DisputePolicyError, type ResolveDisputeInput } from "../src/lib/config/dispute-resolution";

const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const disputeId = randomUUID(), orderId = randomUUID(), operationKey = randomUUID();
const adminEmail = "operator@test.invalid";
let authorized = true, authThrows = false, serviceError: Error | null = null;
let readResult: unknown = { dispute: { id: disputeId, orderId }, expectedDecisionFingerprint: "a".repeat(64), refundView: null };
let decisionResult: Record<string, unknown> = { ok: true, disputeId, operationKey, replayed: false, refund: null };
const reads: string[] = [], writes: Array<{ input: ResolveDisputeInput; actor: unknown }> = [];
const input = () => ({ disputeId, operationKey, expectedDecisionFingerprint: "a".repeat(64),
  action: "resolve", resolution: "  Talep değerlendirildi ve uygun bulundu.  " });
const context = (id: string = disputeId) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown = input()) => new NextRequest("http://localhost/api/admin/disputes/test/resolve", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, name); passed++; console.log(`PASS ${name}`);
}
async function main() {
  loader._load = function(name, ...args) {
    if (name === "@/lib/auth/require-admin") return { requireAdmin: async () => {
      if (authThrows) throw new Error("session unavailable");
      return authorized ? { session: { user: { email: adminEmail, role: "admin" } } }
        : { response: NextResponse.json({ error: "Admin oturumu gerekiyor." }, { status: 401 }) };
    } };
    if (name === "@/lib/services/dispute-resolution") return {
      readDisputeDecisionView: async (id: string) => { reads.push(id); if (serviceError) throw serviceError; return readResult; },
      resolveDispute: async (command: ResolveDisputeInput, actor: unknown) => {
        writes.push({ input: command, actor }); if (serviceError) throw serviceError; return decisionResult;
      },
    };
    // Old direct money/database dependencies may be imported by the pre-fix route,
    // but any use is a forbidden side effect for this adapter.
    if (name === "@/lib/db" || /^@\/lib\/services\/(payouts|painter-payouts|strikes|manufacturer-notifications)$/.test(name)) {
      return new Proxy({}, { get: () => () => { throw new Error("route-owned side effect"); } });
    }
    return originalLoad.call(this, name, ...args);
  };
  try {
    const route = await import("../src/app/api/admin/disputes/[id]/resolve/route");
    check("preview method exists for fingerprint and optional money", typeof route.GET, "function");
    authorized = false;
    for (const method of ["GET", "POST"] as const) check(`anonymous ${method} refuses`, (await route[method](request(), context())).status, 401);
    check("anonymous never reads money or writes", [reads.length, writes.length], [0,0]); authorized = true;
    for (const method of ["GET", "POST"] as const) {
      for (const id of ["broken", disputeId + "\n"]) check(`invalid ${method} id refuses before service`, (await route[method](request(), context(id))).status, 404);
    }
    check("invalid IDs never reach service", [reads.length, writes.length], [0,0]);
    let response = await route.GET(request(), context(disputeId.toUpperCase()));
    check("preview normalizes UUID", reads[0], disputeId);
    check("preview is never cached", response.headers.get("cache-control"), "no-store");
    check("unknown refund preview still renders decision", await response.json(), readResult);
    readResult = { ok: false, code: "not_found", status: 404, error: "Anlaşmazlık bulunamadı." };
    response = await route.GET(request(), context());
    check("missing preview preserves typed status", response.status, 404);
    check("missing preview preserves error code", (await response.json()).code, "not_found");
    for (const invalid of [null, {}, { ...input(), clawback: true }, { ...input(), adminEmail: "spoof@test.invalid" },
      { ...input(), disputeId: randomUUID() }, { ...input(), resolution: "kısa" },
      { ...input(), action: "reject", refund: {} }, { ...input(), operationKey: "not-a-uuid" }]) {
      response = await route.POST(request(invalid), context());
      check("invalid command never accepted", response.status, 400);
      check("invalid command has error code", (await response.json()).code, "invalid_evidence");
    }
    const malformed = new NextRequest("http://localhost/test", { method: "POST", body: "{" });
    check("malformed JSON is a 400", (await route.POST(malformed, context())).status, 400);
    check("rejected commands never delegate", writes.length, 0);
    response = await route.POST(request(input()), context());
    check("valid command returns transaction receipt", await response.json(), decisionResult);
    check("normalized command uses authenticated actor", writes[0], {
      input: { ...input(), resolution: "Talep değerlendirildi ve uygun bulundu." }, actor: { adminEmail },
    });
    decisionResult = { ...decisionResult, replayed: true };
    check("same-key receipt stays a successful replay", (await (await route.POST(request(), context())).json()).replayed, true);
    for (const code of ["busy", "stale", "already_closed", "key_conflict", "over_refund"]) {
      decisionResult = { ok: false, code, status: 409, error: "İşlem tamamlanamadı." };
      response = await route.POST(request(), context());
      check(`${code} status retained`, response.status, 409);
      check(`${code} body retained`, (await response.json()).code, code);
    }
    serviceError = new DisputePolicyError("lineage_unknown", "Ödeme bilgileri doğrulanamadı.", 409);
    for (const method of ["GET", "POST"] as const) {
      response = await route[method](request(), context());
      check(`${method} typed thrown error status retained`, response.status, 409);
      check(`${method} typed thrown error renderable`, (await response.json()).code, "lineage_unknown");
    }
    serviceError = new Error("SECRET DB DETAIL");
    for (const method of ["GET", "POST"] as const) {
      response = await route[method](request(), context()); const body = await response.json();
      check(`${method} unexpected failure has body`, [response.status, typeof body.error], [500,"string"]);
      check(`${method} error does not leak infrastructure`, JSON.stringify(body).includes("SECRET"), false);
    }
    serviceError = null; authThrows = true;
    for (const method of ["GET", "POST"] as const) check(`${method} auth outage also has error body`, typeof (await (await route[method](request(), context())).json()).error, "string");
    console.log(`Admin dispute API: ${passed} passed`);
  } finally { loader._load = originalLoad; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
