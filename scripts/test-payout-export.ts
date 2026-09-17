/** Real export/file lifecycle, stubbed page/query boundary; no DB or sends. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PayoutListAdminRow, PayoutListScope, PayoutListQuery } from "../src/lib/config/payout-list";
const require = createRequire(import.meta.url);
const original = new Map<string, NodeJS.Module | undefined>();
function stub(file: string, exports: unknown) {
  const id = require.resolve(file); original.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports } as NodeJS.Module;
}
const partnerId = randomUUID();
const row: PayoutListAdminRow = {
  id: randomUUID(), kind: "manufacturer", partnerId, name: "=DANGEROUS()",
  totalKurus: 6000, earningCount: 1, adjustmentCount: 0, status: "pending", displayStatus: "pending", settlementKind: "transfer",
  createdAt: "2026-09-17T00:00:00.000Z", createdAtExact: "2026-09-17 00:00:00.000001", paidAt: null, voidedAt: null,
  reference: "\t=FORMULA()", voidReason: null, requestedByPartner: false, expectedFingerprint: "a".repeat(64),
  heldNet: 6000, heldEarningCount: 1, heldAdjustmentCount: 0, blockedReason: null, earnings: [], adjustments: [],
  bank: { iban: "SECRET-BANK", accountHolder: "SECRET-HOLDER", bankName: "SECRET-NAME", pendingIban: null, ibanReviewPending: false },
  adminEmail: "PRIVATE-OPERATOR", paidBy: "PRIVATE-PAYER", voidedBy: null, voidSnapshot: { originalAmount: 6000, reason: "audit, retained" },
};
const tx = { execute: async () => undefined };
let transactionOpen = false;
let pages = 0;
let failurePage = 0;
let totalPages = 3;
let abortOnPage: AbortController | undefined;
let wrongOwner = false;
let invalidAmount = false;
const scopes: PayoutListScope[] = [];
const files = async () => (await readdir(tmpdir())).filter(n => n.startsWith("payout-export-"));
let checks = 0;
function check(name: string, actual: unknown, expected: unknown) { assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`); }
async function main() {
  const before = await files();
  try {
    stub("../src/lib/db", { db: { transaction: async (run: (t: typeof tx) => Promise<unknown>, options: unknown) => {
      check("one readonly repeatable snapshot", options, { isolationLevel: "repeatable read", accessMode: "read only" });
      transactionOpen = true; try { return await run(tx); } finally { transactionOpen = false; }
    } } });
    stub("../src/lib/services/payout-list", { loadPayoutPage: async (t: typeof tx, scope: PayoutListScope, query: PayoutListQuery) => {
      assert.equal(t, tx); assert.equal(transactionOpen, true); scopes.push(scope); pages++;
      if (pages === failurePage) throw new Error("later page unavailable");
      if (abortOnPage) abortOnPage.abort();
      const index = query.cursor ? Number(query.cursor) : 0;
      return { rows: Array.from({ length: 100 }, (_, i) => ({ ...row, id: `${index}-${i}`, ...(wrongOwner ? { partnerId: randomUUID() } : {}), ...(invalidAmount && i === 50 ? { totalKurus: Infinity } : {}) })), hasMore: index + 1 < totalPages, nextCursor: index + 1 < totalPages ? String(index + 1) : null };
    } });
    const { exportPayoutCsv } = await import("../src/lib/services/payout-export");
    const scope = { audience: "admin", kind: "manufacturer", partnerId } as const;
    let response = await exportPayoutCsv(scope, { status: "all" });
    check("all pages finished before success headers", pages, 3);
    check("snapshot released before download", transactionOpen, false);
    const staged = (await files()).filter(n => !before.includes(n));
    check("one completed private export exists", staged.length, 1);
    const name = (await readdir(join(tmpdir(), staged[0])))[0];
    check("file permission is 0600", (await stat(join(tmpdir(), staged[0], name))).mode & 0o777, 0o600);
    const raw = await readFile(join(tmpdir(), staged[0], name));
    check("finished file starts UTF8 BOM", [...raw.subarray(0, 3)], [239, 187, 191]);
    check("correct content length", response.headers.get("Content-Length"), String(raw.length));
    check("private uncached download", response.headers.get("Cache-Control"), "private, no-store");
    const csv = await response.text();
    check("export contains all 300 rows beyond old caps", csv.split("\r\n").length - 2, 300);
    assert.ok(csv.includes("PRIVATE-OPERATOR")); assert.ok(csv.includes('""originalAmount"":6000')); assert.ok(csv.includes("'=DANGEROUS()")); assert.ok(!csv.includes("SECRET-BANK"));
    check("temp file removed at EOF", (await files()).filter(n => !before.includes(n)), []);
    pages = 0; scopes.length = 0;
    response = await exportPayoutCsv({ audience: "partner", kind: "manufacturer", partnerId }, { status: "voided" });
    const partnerCsv = await response.text();
    for (const secret of ["PRIVATE-OPERATOR", "PRIVATE-PAYER", "SECRET-BANK", "originalAmount"]) assert.ok(!partnerCsv.includes(secret), secret);
    check("all partner pages retain session-derived owner", scopes.every(s => s.audience === "partner" && s.partnerId === partnerId), true);
    pages = 0; failurePage = 2;
    await assert.rejects(() => exportPayoutCsv(scope, { status: "pending" }), /later page unavailable/);
    check("later page error removes incomplete file", (await files()).filter(n => !before.includes(n)), []);
    failurePage = 0; pages = 0; abortOnPage = new AbortController();
    await assert.rejects(() => exportPayoutCsv(scope, { status: "all" }, abortOnPage!.signal));
    check("abort during query removes incomplete file", (await files()).filter(n => !before.includes(n)), []);
    abortOnPage = undefined; pages = 0; totalPages = 1;
    response = await exportPayoutCsv(scope, { status: "all" });
    await response.body!.cancel();
    check("download cancellation unlinks completed file", (await files()).filter(n => !before.includes(n)), []);
    const downloadAbort = new AbortController();
    response = await exportPayoutCsv(scope, { status: "all" }, downloadAbort.signal);
    downloadAbort.abort();
    await assert.rejects(() => response.text());
    for (let i = 0; i < 100 && (await files()).some(n => !before.includes(n)); i++) await new Promise(r => setTimeout(r, 10));
    check("request abort after headers unlinks completed file", (await files()).filter(n => !before.includes(n)), []);
    invalidAmount = true;
    await assert.rejects(() => exportPayoutCsv(scope, { status: "all" }), /tam sayı/);
    invalidAmount = false;
    check("encoding failure removes file and never returns success", (await files()).filter(n => !before.includes(n)), []);
    pages = 0; wrongOwner = true;
    await assert.rejects(() => exportPayoutCsv({ audience: "partner", kind: "manufacturer", partnerId }, { status: "all" }));
    check("foreign-owner page never becomes downloadable", (await files()).filter(n => !before.includes(n)), []);
    wrongOwner = false;
    await assert.rejects(() => exportPayoutCsv(scope, { status: "all", cursor: "page-2" } as never));
  } finally { for (const [id, value] of original) { if (value) require.cache[id] = value; else delete require.cache[id]; } }
  console.log(`${checks} export checks passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
