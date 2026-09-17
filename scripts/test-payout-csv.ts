import assert from "node:assert/strict";
import { csvText, csvInteger, csvRecord, CSV_BOM, payoutCsvHeader, payoutCsvRecord } from "../src/lib/config/payout-csv";
import type { PayoutListAdminRow } from "../src/lib/config/payout-list";
let checks = 0;
const test = (name: string, run: () => void) => { run(); checks++; console.log(`PASS ${name}`); };
test("UTF-8 BOM and RFC4180 Turkish quoting", () => {
  assert.equal(CSV_BOM, "\uFEFF");
  assert.equal(csvText('İstanbul, "hak ediş"\r\nikinci satır'), '"İstanbul, ""hak ediş""\r\nikinci satır"');
  assert.equal(csvRecord([csvText("Tür"), csvInteger(10)]), '"Tür","10"\r\n');
});
test("formula prefixes are neutralized before quoting", () => {
  for (const prefix of ["", " ", "\u00a0", "\u200b", "\uFEFF", "\u0000", "\u202e", "\u0085"]) {
    for (const payload of ["=1+1", "+SUM(1)", "-1+2", "@SUM(1)"]) {
      assert.equal(csvText(prefix + payload), `"'${prefix + payload}"`);
    }
  }
});
test("leading tabs and line breaks are neutralized even without a formula", () => {
  for (const payload of ["\ttext", "\rtext", "\ntext", " \ttext", "\u200b\rtext"]) assert.equal(csvText(payload), `"'${payload}"`);
});
test("plain identifiers, timestamps and JSON retain their text", () => {
  for (const text of ["00123", "2026-09-17 12:00:00.123456", "normal", "", "İptal edildi"]) assert.equal(csvText(text), `"${text}"`);
  assert.equal(csvText('{"reference":"=DANGEROUS()"}'), '"{""reference"":""=DANGEROUS()""}"');
});
test("numeric branch permits legitimate negative integers only", () => {
  for (const n of [0, -100, 12500, Number.MAX_SAFE_INTEGER]) assert.equal(csvInteger(n), `"${n}"`);
  for (const n of [NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1, "=SUM(1)", "123", null, undefined]) assert.throws(() => csvInteger(n as number));
});
test("text branch rejects silently stringifying objects and numbers", () => {
  for (const value of [123, {}, [], undefined, null]) assert.throws(() => csvText(value as string));
});
const payout: PayoutListAdminRow = {
  id: "id", kind: "manufacturer", partnerId: "owner", name: "Partner",
  totalKurus: 100, earningCount: 1, adjustmentCount: 0, status: "pending", displayStatus: "voided", settlementKind: "transfer",
  createdAt: "date", createdAtExact: "2026-09-17 00:00:00.000001", paidAt: null, voidedAt: "void-date", reference: null,
  voidReason: "=formula-reason", requestedByPartner: false, expectedFingerprint: "a".repeat(64), heldNet: 0,
  heldEarningCount: 0, heldAdjustmentCount: 0, blockedReason: null, earnings: [], adjustments: [],
  adminEmail: "SECRET-OPERATOR", paidBy: "SECRET-PAYER", voidedBy: "SECRET-VOIDER", voidSnapshot: { original: 100 },
  bank: { iban: "SECRET-BANK", accountHolder: "SECRET-HOLDER", bankName: "SECRET-BANK-NAME", pendingIban: null, ibanReviewPending: false },
};
test("explicit partner columns never serialize admin or bank fields", () => {
  const csv = payoutCsvHeader("partner") + payoutCsvRecord(payout, "partner");
  for (const forbidden of ["SECRET", "original", "formula-reason"]) assert.ok(!csv.includes(forbidden));
  assert.ok(csv.includes("2026-09-17 00:00:00.000001"));
});
test("admin CSV preserves void audit and distinguishes released membership", () => {
  const csv = payoutCsvRecord(payout, "admin");
  for (const expected of ["SECRET-OPERATOR", "SECRET-PAYER", "SECRET-VOIDER", "'=", '""original"":100', '"100"', '"0"', "İptal"]) assert.ok(csv.includes(expected), expected);
  assert.ok(!csv.includes("SECRET-BANK"));
});
test("unreadable held values are blank and unknown, never a fabricated zero", () => {
  const csv = payoutCsvRecord({ ...payout, expectedFingerprint: "", heldNet: 999 }, "partner");
  assert.ok(csv.includes('"","","","Okunamadı"'));
  assert.ok(!csv.includes('"999"'));
});
test("a mismatched or empty pending batch never claims to be payable", () => {
  const mismatch = payoutCsvRecord({ ...payout, displayStatus: "pending", voidedAt: null }, "partner");
  assert.ok(mismatch.includes("uyuşmuyor"));
  const empty = payoutCsvRecord({ ...payout, displayStatus: "pending", voidedAt: null, totalKurus: 0, earningCount: 0 }, "partner");
  assert.ok(empty.includes("Bağlı kayıt yok"));
});
test("completed ghost payouts retain the mismatch warning, voids remain historical", () => {
  for (const displayStatus of ["paid", "netted"] as const) {
    const ghost = payoutCsvRecord({ ...payout, status: "paid", displayStatus, voidedAt: null }, "admin");
    assert.ok(ghost.includes("Tamamlandı; kayıtlı toplam veya sayılar bağlı kayıtlarla uyuşmuyor"));
  }
  assert.ok(payoutCsvRecord(payout, "admin").includes("İptal edildi; kayıtlı toplam güncel borç değildir"));
});
console.log(`${checks} CSV encoder checks passed`);
