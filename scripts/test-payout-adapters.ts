/** Execute real route handlers with service/auth boundaries stubbed. No DB or sends. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { PayoutPaidResult } from "../src/lib/services/payouts";
import type { PainterPayoutPaidResult } from "../src/lib/services/painter-payouts";
const require = createRequire(import.meta.url);
const originals = new Map<string, NodeJS.Module | undefined>();
function stub(path: string, exports: unknown) {
  const id = require.resolve(path);
  originals.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeJS.Module;
}
let checks = 0;
const check = (name: string, actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`); };
let authenticated = true;
const calls: unknown[][] = [];
let notices = 0;
let notificationFails = false;
const noticeBodies: string[] = [];
const partnerId = randomUUID();
let outcome: PayoutPaidResult = { ok: true, manufacturerId: partnerId, totalKurus: 0, settlementKind: "netting", replayed: false };
async function notify(input: { body: string }) { notices++; noticeBodies.push(input.body); if (notificationFails) throw new Error("test notification unavailable"); return "notice"; }
async function main() {
  try {
    stub("../src/lib/auth/require-admin", { requireAdmin: async () => authenticated ? { session: { user: { email: "admin@example.invalid" } } } : { response: NextResponse.json({ error: "Oturum gerekli." }, { status: 401 }) } });
    stub("../src/lib/services/payouts", {
      createPayoutForManufacturer: async () => ({ ok: true, payoutId: randomUUID(), totalKurus: 0, count: 1, adjustmentCount: 1, settlementKind: "netting" }),
      markPayoutPaid: async (...args: unknown[]) => { calls.push(["manufacturer", ...args]); return outcome; },
      voidPayout: async (...args: unknown[]) => { calls.push(["void-manufacturer", ...args]); return outcome; },
    });
    stub("../src/lib/services/painter-payouts", {
      createPayoutForPainter: async () => ({ ok: true, payoutId: randomUUID(), totalKurus: 0, count: 1, adjustmentCount: 1, settlementKind: "netting" }),
      markPainterPayoutPaid: async (...args: unknown[]): Promise<PainterPayoutPaidResult> => { calls.push(["painter", ...args]); return outcome.ok ? { ...outcome, painterId: partnerId } : outcome; },
      voidPainterPayout: async (...args: unknown[]) => { calls.push(["void-painter", ...args]); return outcome; },
    });
    stub("../src/lib/services/manufacturer-notifications", { notifyManufacturer: notify });
    stub("../src/lib/services/painter-notifications", { notifyPainter: notify });
    const paid = await import("../src/app/api/admin/payouts/[id]/mark-paid/route");
    const cancelled = await import("../src/app/api/admin/payouts/[id]/void/route");
    const legacy = await import("../src/app/api/admin/payouts/[id]/route");
    const id = randomUUID();
    const context = { params: Promise.resolve({ id }) };
    const body = { kind: "manufacturer", reference: "", expectedFingerprint: "a".repeat(64), settlementKind: "netting" };
    const request = (data: unknown) => new NextRequest("http://localhost/api/admin/payouts/fixture/mark-paid", { method: "POST", body: JSON.stringify(data) });
    authenticated = false;
    check("unauthorized confirmation writes nothing", (await paid.POST(request(body), context)).status, 401);
    check("unauthorized bypasses service", calls.length, 0);
    authenticated = true;
    for (const change of [{ expectedFingerprint: undefined }, { settlementKind: undefined }, { reference: "BANK" }]) check("invalid confirmation refused before service", (await paid.POST(request({ ...body, ...change }), context)).status, 400);
    check("invalid confirmations do not settle", calls.length, 0);
    let response = await paid.POST(request(body), context);
    check("netting confirmation succeeds", response.status, 200);
    check("UI empty bank reference becomes NULL", calls[0][2], null);
    check("locked service gets exact fingerprint kind and session actor", calls[0][3], { expectedFingerprint: body.expectedFingerprint, settlementKind: "netting", adminEmail: "admin@example.invalid" });
    check("netting sends no bank-payment message", notices, 0);
    check("netting answer explicitly says no transfer", (await response.json()).message, "Mahsup tamamlandı; banka transferi yapılmadı.");
    outcome = { ok: false, reason: "stale_confirmation" };
    response = await paid.POST(request(body), context);
    check("stale service result remains a 409", response.status, 409);
    check("stale result carries cause", (await response.json()).code, "stale_confirmation");
    check("failed confirmation sends nothing", notices, 0);
    outcome = { ok: true, manufacturerId: partnerId, totalKurus: 1000, settlementKind: "transfer", replayed: false };
    response = await paid.POST(request({ ...body, settlementKind: "transfer", reference: "BANK" }), context);
    check("new transfer sends one notice", notices, 1);
    outcome = { ...outcome, replayed: true };
    await paid.POST(request({ ...body, settlementKind: "transfer", reference: "BANK" }), context);
    check("transfer replay never duplicates notice", notices, 1);
    outcome = { ...outcome, replayed: false };
    notificationFails = true;
    response = await paid.POST(request({ ...body, settlementKind: "transfer", reference: "BANK" }), context);
    check("notification failure never claims settlement failed", response.status, 200);
    check("notification failure is disclosed", typeof (await response.json()).warning, "string");
    notificationFails = false;
    outcome = { ok: true, manufacturerId: partnerId, totalKurus: 0, settlementKind: "netting", replayed: false };
    const cancelBody = { kind: "painter", expectedFingerprint: body.expectedFingerprint, idempotencyKey: randomUUID(), reason: "Yanlış parti seçimi nedeniyle iptal" };
    response = await cancelled.POST(request(cancelBody), context);
    check("void delegates to explicit painter kind", calls.at(-1)?.[0], "void-painter");
    check("void carries reason key fingerprint and session actor", calls.at(-1)?.[2], { expectedFingerprint: body.expectedFingerprint, idempotencyKey: cancelBody.idempotencyKey, reason: cancelBody.reason, adminEmail: "admin@example.invalid" });
    check("void succeeds", response.status, 200);
    const beforeDelete = calls.length;
    check("legacy DELETE refuses erasing financial history", (await legacy.DELETE()).status, 409);
    check("legacy DELETE reaches no mutation service", calls.length, beforeDelete);
    const createManufacturer = await import("../src/app/api/admin/manufacturers/[id]/payout/route");
    const createPainter = await import("../src/app/api/admin/painters/[id]/payout/route");
    for (const route of [createManufacturer, createPainter]) {
      response = await route.POST(request({}), context);
      const created = await response.json();
      check("created zero-net batch identifies netting", created.settlementKind, "netting");
      check("created batch counts adjustments", created.adjustmentCount, 1);
      check("netting creation notice promises no bank transfer", noticeBodies.at(-1)?.includes("banka transferi yapılmayacak"), true);
    }
  } finally {
    for (const [id, original] of originals) { if (original) require.cache[id] = original; else delete require.cache[id]; }
  }
  console.log(`${checks} payout route checks passed; no database or external sends`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
