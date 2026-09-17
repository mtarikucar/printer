import assert from "node:assert/strict";
import { invoiceBasisKurus } from "../src/lib/config/invoice";
import { computeKdv } from "../src/lib/services/finance";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Literal expectations catch subtracting gift tender or forgetting havale.
const cases = [
  { amountKurus: 100000, havaleDiscountKurus: 3000, giftCardAmountKurus: 20000, expected: 97000 },
  { amountKurus: 100000, havaleDiscountKurus: 0, giftCardAmountKurus: 0, expected: 100000 },
  { amountKurus: 100000, havaleDiscountKurus: 0, giftCardAmountKurus: 100000, expected: 100000 },
  { amountKurus: 100000, havaleDiscountKurus: 0, giftCardAmountKurus: 20000, expected: 100000 },
  { amountKurus: 100001, havaleDiscountKurus: 3000, giftCardAmountKurus: 20000, expected: 97001 },
  { amountKurus: 0, havaleDiscountKurus: 0, giftCardAmountKurus: 0, expected: 0 },
];

for (const order of cases) {
  assert.equal(invoiceBasisKurus(order), order.expected);
}

assert.deepEqual(computeKdv(invoiceBasisKurus(cases[0]), 2000), {
  subtotalKurus: 80833,
  kdvKurus: 16167,
  totalKurus: 97000,
  kdvRateBps: 2000,
});

console.log(`Invoice basis: ${cases.length + 1} checks passed`);

// Execute the actual invoice function with only DB/provider boundaries faked.
// Importing payouts.ts itself initializes unrelated DB/queue services.
const source = readFileSync(new URL("../src/lib/services/payouts.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("payouts.ts", source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(
  (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "getOrCreateInvoice"
);
assert.ok(declaration);
const compiled = ts.transpileModule(declaration.getText(ast).replace(/^export /, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

type InvoiceRow = Record<string, unknown>;
const fixture = (existing?: InvoiceRow, providerRef = "ISSUED-1") => {
  let saved = existing;
  const issuedInputs: InvoiceRow[] = [];
  const db = {
    query: { invoices: { findFirst: async () => saved } },
    insert: () => ({ values: (values: InvoiceRow) => ({
      onConflictDoNothing: () => ({ returning: async () => {
        if (saved) return [];
        saved = { id: "invoice-1", ...values };
        return [saved];
      } }),
    }) }),
    update: () => ({ set: (values: InvoiceRow) => ({ where: () => ({
      returning: async () => {
        assert.ok(saved);
        saved = { ...saved, ...values };
        return [saved];
      },
    }) }) }),
  };
  const provider = { issue: async (input: InvoiceRow) => {
    issuedInputs.push(input);
    return { providerRef };
  } };
  const create = new Function(
    "db", "eq", "invoices", "computeKdv", "KDV_RATE_BPS", "eInvoiceProvider", "invoiceBasisKurus",
    `${compiled}\nreturn getOrCreateInvoice;`
  )(db, () => true, { orderId: "orderId", id: "id" }, computeKdv, 2000, provider, invoiceBasisKurus) as
    (order: typeof input) => Promise<InvoiceRow>;
  return { create, issuedInputs, saved: () => saved };
};
const input = {
  id: "order-1", orderNumber: "FIG-TEST", customerName: "Test", email: "test@example.com",
  amountKurus: 100000, havaleDiscountKurus: 3000, giftCardAmountKurus: 20000,
};

async function testInvoiceService() {
  const fresh = fixture();
  const row = await fresh.create(input);
  assert.equal(row.totalKurus, 97000);
  assert.equal(fresh.issuedInputs[0].totalKurus, 97000);
  assert.equal(fresh.issuedInputs[0].subtotalKurus, 80833);
  assert.equal(row.providerRef, "ISSUED-1");

  const original = { id: "old", status: "issued", totalKurus: 100000, providerRef: "OLD-1" };
  const historic = fixture(original);
  assert.equal(await historic.create(input), original);
  assert.equal(historic.issuedInputs.length, 0);
  assert.equal(historic.saved(), original);

  const concurrent = fixture();
  const results = await Promise.all([concurrent.create(input), concurrent.create(input)]);
  assert.equal(concurrent.issuedInputs.length, 1, "only the successful unique insert may issue");
  assert.ok(results.every((r) => r.id === "invoice-1" && r.totalKurus === 97000));

  const stub = fixture(undefined, "STUB-FAT-FIG-TEST");
  const pending = await stub.create(input);
  assert.equal(pending.status, "pending");
  assert.equal(pending.providerRef, null);
  assert.equal(pending.totalKurus, 97000);
  assert.equal(await stub.create(input), pending);
  assert.equal(stub.issuedInputs.length, 1, "pending records must not trigger blind issuance retries");
  console.log("Invoice service: basis, issued-history preservation, concurrent claim and pending stub passed");
}

testInvoiceService().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
