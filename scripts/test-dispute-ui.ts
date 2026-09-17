import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildRefundEntryInput, emptyRefundEntry, RefundEntryFields } from "../src/components/admin/refund-entry-fields";
import type { OrderRefundView, RecordRefundInput, RefundResult } from "../src/lib/config/order-refund";

const orderId = "00000000-0000-4000-8000-000000000001";
const siblingId = "00000000-0000-4000-8000-000000000002";
const operationKey = "00000000-0000-4000-8000-000000000003";
const view: OrderRefundView = {
  expectedFingerprint: "a".repeat(64), canRecord: true,
  payment: { scopeKey: "draft:test", method: "card", collectionReference: null, evidenceLevel: "recorded", invoiceBasisKurus: 20000, cashBasisKurus: 16000, giftBasisKurus: 4000 },
  siblings: [orderId, siblingId].map((id, i) => ({ orderId: id, orderNumber: `ORDER-${i}`, cashBasisKurus: 8000, giftBasisKurus: 2000, confirmedCashKurus: 0, confirmedGiftKurus: 0, remainingCashKurus: 8000, remainingGiftKurus: 2000, legacyUnverified: false, cancelled: false })), history: [],
};
const giftValues = () => ({ ...emptyRefundEntry(), amounts: { [orderId]: { cash: "", gift: "12,34" } }, reason: "Müşteri talebi üzerine" });

test("shared builder keeps the supplied operation UUID, precise amounts and no cash evidence for gift only", () => {
  const input = buildRefundEntryInput(orderId, view, giftValues(), operationKey, "actual");
  assert.equal(input.operationKey, operationKey);
  assert.equal(input.expectedFingerprint, view.expectedFingerprint);
  assert.deepEqual(input.allocations, [{ orderId, cashKurus: 0, giftKurus: 1234 }]);
  assert.equal(input.cashEvidence, undefined);
});
test("cash requires explicit confirmation and recorded channel evidence", () => {
  const values = { ...giftValues(), amounts: { [orderId]: { cash: "10,01", gift: "0" } }, reference: "PAYTR-123", occurredAt: "2026-01-01T12:00:00" };
  assert.throws(() => buildRefundEntryInput(orderId, view, values, operationKey, "actual"), /doğrulayın/);
  const input = buildRefundEntryInput(orderId, view, { ...values, confirmed: true }, operationKey, "actual");
  assert.equal(input.allocations[0].cashKurus, 1001);
  assert.equal(input.cashEvidence?.method, "card");
  assert.equal(input.cashEvidence?.paytrRefundCompleted, true);
  assert.equal(input.cashEvidence?.occurredAt, new Date(values.occurredAt).toISOString());
});
test("malformed amounts and missing anchor never silently become zero or another order's refund", () => {
  assert.throws(() => buildRefundEntryInput(orderId, view, { ...giftValues(), amounts: { [orderId]: { cash: "oops", gift: "10" } } }, operationKey, "actual"));
  assert.throws(() => buildRefundEntryInput(orderId, view, { ...giftValues(), amounts: { [siblingId]: { cash: "0", gift: "10" } } }, operationKey, "actual"), /Açık sipariş/);
});
test("single-order fields hide sibling entry; existing card still offers all payment siblings", () => {
  const props = { orderId, view, values: giftValues(), onChange: () => {}, mode: "actual" as const };
  const single = renderToStaticMarkup(createElement(RefundEntryFields, { ...props, singleOrderOnly: true }));
  assert.match(single, /ORDER-0 nakit iade/);
  assert.doesNotMatch(single, /ORDER-1 nakit iade/);
  assert.match(renderToStaticMarkup(createElement(RefundEntryFields, props)), /ORDER-1 nakit iade/);
});
test("legacy mode remains evidence-only and independent blank form instances do not share amounts", () => {
  const a = emptyRefundEntry(), b = emptyRefundEntry();
  a.amounts[orderId] = { cash: "1", gift: "0" };
  assert.deepEqual(b.amounts, {});
  const html = renderToStaticMarkup(createElement(RefundEntryFields, { orderId, view, values: giftValues(), onChange: () => {}, mode: "legacy_evidence" }));
  assert.match(html, /bakiye|bakiyesi/);
  assert.doesNotMatch(html, /Kalan tutarı doldur/);
});

// Render the actual history component with only Next navigation supplied.
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { DisputesClient, type DisputeRow } from "../src/app/admin/disputes/client";
const noop = () => {};
const router = { back: noop, forward: noop, push: noop, replace: noop, refresh: noop, prefetch: noop, hmrRefresh: noop };
const closedRow: DisputeRow = { id: operationKey, orderId, orderNumber: "ORDER-0", category: "damaged", description: "Paket hasarlı geldi.", createdAt: "2026-01-01T10:00:00Z", status: "resolved", resolution: "Talep incelendi ve çözüldü.", resolvedAt: "2026-01-02T10:00:00Z", decisionOperationKey: operationKey, refundRecordId: siblingId, refund: { cashKurus: 1200, giftKurus: 350 } };
function renderHistory(row: DisputeRow, readError?: string) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(DisputesClient, { disputes: readError ? [] : [row], status: row.status, readError })));
}
test("history links real order IDs, exposes URL tabs and displays linked actual cash/gift", () => {
  const html = renderHistory(closedRow);
  assert.match(html, new RegExp(`/admin/orders/${orderId}`));
  for (const tab of ["open", "resolved", "rejected"]) assert.ok(html.includes(`/admin/disputes?status=${tab}`));
  assert.match(html, /Hasarlı geldi/);
  assert.match(html, /Karar tarihi/);
  assert.match(html, /nakit ₺12,00/);
  assert.match(html, /hediye kartı ₺3,50/);
  assert.doesNotMatch(html, /clawback|strike/);
});
test("legacy and unreadable history do not invent a zero refund or an empty list", () => {
  const legacy = renderHistory({ ...closedRow, decisionOperationKey: null, refundRecordId: null, refund: null });
  assert.match(legacy, /iade tutarı bu kayıttan doğrulanamıyor/);
  assert.doesNotMatch(legacy, /nakit 0,00|yeni iade kaydı oluşturulmadı/);
  assert.match(renderHistory({ ...closedRow, refundRecordId: null, refund: null }), /yeni iade kaydı oluşturulmadı/);
  const broken = renderHistory(closedRow, "Liste okunamadı.");
  assert.match(broken, /role="alert"/);
  assert.doesNotMatch(broken, /anlaşmazlık kaydı yok/);
});

// Execute real component handlers in a bounded hook harness. No browser/server,
// databases or provider calls; only storage, navigation and HTTP are fake I/O.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { createRequire } from "node:module";
import * as React from "react";
import type { DisputeDecisionView, ResolveDisputeInput } from "../src/lib/config/dispute-resolution";
const clientPath = path.resolve("src/app/admin/disputes/client.tsx");
const requireClient = createRequire(clientPath);
function hookHarness(sourcePath: string, exportName: string, globals: Record<string, unknown> = {}, append = "") {
  const slots: unknown[] = [];
  let cursor = 0;
  const effects: Array<() => unknown> = [];
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (next: unknown) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
    },
    useRef(initial: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(effect: () => unknown) {
      const i = cursor++;
      if (!(i in slots)) { slots[i] = true; effects.push(effect); }
    },
    useCallback(fn: unknown) { cursor++; return fn; },
  };
  const exports: Record<string, (props: object) => React.ReactNode> = {};
  const js = ts.transpileModule(fs.readFileSync(sourcePath, "utf8") + append, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const bindings = { exports, console, ...globals, require: (name: string) => {
    const overrides = (globals.modules ?? {}) as Record<string, unknown>;
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === "react") return hooks;
    if (name === "next/navigation") return { useRouter: () => router };
    if (name === "@/lib/i18n/locale-context") return { useDictionary: () => ({}) };
    return requireClient(name);
  } };
  new Function(...Object.keys(bindings), js)(...Object.values(bindings));
  return {
    render: (props: object) => { cursor = 0; return exports[exportName](props); },
    mount: async () => { effects.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)); },
  };
}
function elements(tree: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children as React.ReactNode)];
}
function textOf(tree: React.ReactNode): string {
  if (Array.isArray(tree)) return tree.map(textOf).join("");
  if (React.isValidElement<Record<string, unknown>>(tree)) return textOf(tree.props.children as React.ReactNode);
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : "";
}
async function click(tree: React.ReactNode, label: string) {
  const button = elements(tree).find(node => node.type === "button" && textOf(node) === label);
  assert.ok(button, `button missing: ${label}`);
  assert.ok(!button.props.disabled, `button disabled: ${label}`);
  await (button.props.onClick as () => Promise<void>)();
}
const command: ResolveDisputeInput = { disputeId: operationKey, operationKey: siblingId, expectedDecisionFingerprint: "b".repeat(64), action: "resolve", resolution: "Müşteri talebi incelendi." };
function storage(initial?: ResolveDisputeInput) {
  const map = new Map<string, string>(initial ? [["dispute-decision-intent", JSON.stringify(initial)]] : []);
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
test("closed-tab reload retains the root command; lost response/auth/busy/conflict replay the identical UUID", async () => {
  const store = storage(command);
  const sent: string[] = [];
  const responses: Array<Error | { ok: boolean; status: number; body: object }> = [new Error("lost response"),
    { ok: false, status: 401, body: { error: "Oturum gerekli" } },
    { ok: false, status: 503, body: { code: "busy", error: "Meşgul" } },
    { ok: false, status: 409, body: { code: "operation_conflict", error: "İşlem uyuşmuyor" } },
    { ok: true, status: 200, body: validDecisionReceipt(command) }];
  const h = hookHarness(clientPath, "DisputesClient", { sessionStorage: store, fetch: async (url: string, init: RequestInit) => {
    assert.equal(url, `/api/admin/disputes/${command.disputeId}/resolve`);
    if (init.method !== "POST") return { ok: true, json: async () => ({ dispute: { ...closedRow, decisionOperationKey: command.operationKey, resolution: command.resolution } }) };
    assert.equal(init.method, "POST");
    assert.equal(store.getItem("dispute-decision-intent"), init.body);
    sent.push(String(init.body));
    const response = responses.shift()!;
    if (response instanceof Error) throw response;
    return { ...response, json: async () => response.body };
  } });
  const props = { disputes: [], status: "resolved" };
  h.render(props); await h.mount();
  for (let i = 0; i < 5; i++) {
    const tree = h.render(props);
    assert.match(textOf(tree), /Önceki kararın sonucu henüz doğrulanmadı/);
    await click(tree, "Aynı kararın sonucunu kontrol et");
    if (i < 4) assert.ok(store.getItem("dispute-decision-intent"));
  }
  assert.equal(new Set(sent).size, 1);
  assert.deepEqual(JSON.parse(sent[0]), command);
  assert.equal(store.getItem("dispute-decision-intent"), null);
  assert.match(textOf(h.render(props)), /Önceki karar bulundu; ikinci işlem yapılmadı/);
});
test("decision-only remains enabled with unknown money; shared evidence produces one combined command", async () => {
  const preview: DisputeDecisionView = { dispute: { ...closedRow, status: "open", decisionOperationKey: null, refundRecordId: null }, expectedDecisionFingerprint: "b".repeat(64), refundView: null, refundReadUnavailable: "Ödeme kaydı okunamadı." };
  const sent: ResolveDisputeInput[] = [];
  const h = hookHarness(clientPath, "TestEditor", { crypto: { randomUUID: () => operationKey }, window: { confirm: () => true } }, "\nexport { DecisionEditor as TestEditor };\n");
  const props = { view: preview, disabled: false, onSubmit: async (input: ResolveDisputeInput) => { sent.push(input); } };
  let tree = h.render(props);
  const reason = elements(tree).find(node => node.type === "textarea")!;
  (reason.props.onChange as (event: object) => void)({ target: { value: "İtiraz ayrıntıları incelendi." } });
  tree = h.render(props);
  const refundToggle = elements(tree).find(node => node.type === "input" && node.props.type === "checkbox")!;
  assert.equal(refundToggle.props.disabled, true);
  await click(tree, "Kararı kaydet");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].refund, undefined);

  const fundedProps = { ...props, view: { ...preview, refundView: view, refundReadUnavailable: undefined } };
  tree = h.render(fundedProps);
  const toggle = elements(tree).find(node => node.type === "input" && node.props.type === "checkbox")!;
  (toggle.props.onChange as (event: object) => void)({ target: { checked: true } });
  tree = h.render(fundedProps);
  const fields = elements(tree).find(node => node.type === RefundEntryFields)!;
  assert.equal(fields.props.singleOrderOnly, true);
  (fields.props.onChange as (values: object) => void)(giftValues());
  await click(h.render(fundedProps), "Kararı ve iadeyi birlikte kaydet");
  assert.equal(sent.length, 2);
  assert.equal(sent[1].operationKey, operationKey);
  assert.deepEqual(sent[1].refund?.allocations, [{ orderId, cashKurus: 0, giftKurus: 1234 }]);
  assert.equal(sent[1].refund && "operationKey" in sent[1].refund, false);
  assert.equal(sent[1].refund && "mode" in sent[1].refund, false);
});
test("customer read failures are visible and closed decision exposes only returned date/amounts", async () => {
  const file = path.resolve("src/components/order-dispute.tsx");
  let fail = true;
  const h = hookHarness(file, "OrderDispute", { fetch: async () => fail
    ? { ok: false, status: 503, json: async () => ({ error: "Kaydı okuyamadık." }) }
    : { ok: true, status: 200, json: async () => ({ canOpen: false, dispute: { status: "resolved", resolution: "Çözüm kaydedildi.", resolvedAt: "2026-01-02T10:00:00Z", refund: { cashKurus: 1200, giftKurus: 350 } } }) } });
  h.render({ orderNumber: "ORDER-0" }); await h.mount(); await Promise.resolve();
  assert.match(textOf(h.render({ orderNumber: "ORDER-0" })), /Kaydı okuyamadık/);
  fail = false;
  await click(h.render({ orderNumber: "ORDER-0" }), "Kaydı yeniden yükle");
  const text = textOf(h.render({ orderNumber: "ORDER-0" }));
  assert.match(text, /Karar tarihi/); assert.match(text, /nakit ₺12,00/); assert.match(text, /hediye kartı ₺3,50/);
});

test("already_closed releases only after independently verifying another or legacy closed decision", async () => {
  for (const variant of ["other", "legacy", "same", "unavailable"] as const) {
    const store = storage(command);
    const h = hookHarness(clientPath, "DisputesClient", { sessionStorage: store, fetch: async (_url: string, init: RequestInit) => {
      if (init.method === "POST") return { ok: false, status: 409, json: async () => ({ code: "already_closed", error: "Önceden kapandı." }) };
      if (variant === "unavailable") throw new Error("GET failed");
      return { ok: true, json: async () => ({ dispute: { ...closedRow,
        decisionOperationKey: variant === "same" ? command.operationKey : variant === "legacy" ? null : operationKey,
      }, expectedDecisionFingerprint: "c".repeat(64), refundView: null }) };
    } });
    const props = { disputes: [], status: "rejected" };
    h.render(props); await h.mount();
    await click(h.render(props), "Aynı kararın sonucunu kontrol et");
    assert.equal(store.getItem("dispute-decision-intent") === null, variant === "other" || variant === "legacy", variant);
    if (variant === "other" || variant === "legacy") assert.match(textOf(h.render(props)), /Bu gönderim uygulanmadı/);
    else assert.match(textOf(h.render(props)), /Önceki kararın sonucu henüz doğrulanmadı/);
  }
});
test("history server pages beyond 200 records with bounded offset and truthful next/previous links", async () => {
  const all = Array.from({ length: 255 }, (_, i) => ({ ...closedRow, id: `row-${i}`, decisionOperationKey: null, refundRecordId: null, createdAt: new Date(closedRow.createdAt), resolvedAt: new Date(closedRow.resolvedAt!) }));
  const queries: Array<{ limit: number; offset: number; orderBy: unknown[] }> = [];
  const db = {
    query: { disputes: { findMany: async (query: typeof queries[number]) => { queries.push(query); return all.slice(query.offset, query.offset + query.limit); } } },
    select: () => ({ from: () => ({ where: async () => [{ id: orderId, orderNumber: "ORDER-0" }] }) }),
  };
  const h = hookHarness(path.resolve("src/app/admin/disputes/page.tsx"), "default", { modules: { "@/lib/db": { db } } });
  for (const page of [5, 6]) {
    const tree = await h.render({ searchParams: Promise.resolve({ status: "resolved", page: String(page) }) });
    assert.ok(React.isValidElement<{ disputes: DisputeRow[]; hasNext: boolean; page: number }>(tree));
    assert.equal(tree.props.disputes.length, page === 5 ? 50 : 5);
    assert.equal(tree.props.disputes[0].id, `row-${(page - 1) * 50}`);
    assert.equal(tree.props.hasNext, page === 5);
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, tree));
    assert.ok(html.includes(`status=resolved&amp;page=${page - 1}`));
    assert.equal(html.includes("Sonraki sayfa"), page === 5);
  }
  assert.deepEqual(queries.map(q => ({ limit: q.limit, offset: q.offset, sorts: q.orderBy.length })), [{ limit: 51, offset: 200, sorts: 2 }, { limit: 51, offset: 250, sorts: 2 }]);
  for (const page of ["0", "-1", "1.2", "9007199254740991", ["1", "2"]]) {
    const tree = await h.render({ searchParams: Promise.resolve({ status: "resolved", page }) });
    assert.ok(React.isValidElement<{ readError: string }>(tree)); assert.match(tree.props.readError, /geçersiz/);
  }
  assert.equal(queries.length, 2, "invalid page must never reach database");
});

test("6c refund card still restores and retries its persisted operation after field extraction", async () => {
  const input = buildRefundEntryInput(orderId, view, giftValues(), operationKey, "actual");
  const store = storage();
  const key = `order-refund-intent:${orderId}`;
  store.setItem(key, JSON.stringify(input));
  const sent: string[] = [];
  const h = hookHarness(path.resolve("src/components/admin/order-refund-card.tsx"), "OrderRefundCard", { sessionStorage: store, fetch: async (url: string, init: RequestInit) => {
    assert.equal(url, `/api/admin/orders/${orderId}/refund`);
    if (init.method !== "POST") return { ok: true, json: async () => view };
    sent.push(String(init.body));
    if (sent.length === 1) throw new Error("lost response");
    return { ok: true, json: async () => validRefundReceipt(input) };
  } });
  const props = { orderId };
  await click(h.render(props), "İade kayıtlarını aç");
  await click(h.render(props), "Aynı kaydın sonucunu kontrol et");
  assert.equal(store.getItem(key), JSON.stringify(input));
  await click(h.render(props), "Aynı kaydın sonucunu kontrol et");
  assert.equal(new Set(sent).size, 1);
  assert.equal(store.getItem(key), null);
  assert.match(textOf(h.render(props)), /Önceki kayıt bulundu/);
});
test("new combined command refuses HTTP when durable browser storage fails", async () => {
  const store = storage();
  const preview = { dispute: { ...closedRow, status: "open", decisionOperationKey: null, refundRecordId: null }, expectedDecisionFingerprint: "b".repeat(64), refundView: null };
  let posts = 0;
  const h = hookHarness(clientPath, "DisputesClient", { sessionStorage: { ...store, setItem: () => { throw new Error("Depolama kullanılamıyor"); } }, fetch: async (_url: string, init: RequestInit) => {
    if (init.method === "POST") posts++;
    return { ok: true, json: async () => preview };
  } });
  const props = { disputes: [{ ...closedRow, status: "open" }], status: "open" };
  h.render(props); await h.mount();
  await click(h.render(props), "Karar formunu aç");
  const editor = elements(h.render(props)).find(node => typeof node.type === "function" && node.type.name === "DecisionEditor")!;
  assert.ok(editor);
  await (editor.props.onSubmit as (input: ResolveDisputeInput) => Promise<void>)(command);
  assert.equal(posts, 0);
  assert.match(textOf(h.render(props)), /Depolama kullanılamıyor/);
});

function validRefundReceipt(input: RecordRefundInput): RefundResult {
  return { ok: true, refundId: siblingId, replayed: true,
    cashKurus: input.allocations.reduce((sum, row) => sum + row.cashKurus, 0),
    giftKurus: input.allocations.reduce((sum, row) => sum + row.giftKurus, 0),
    orders: input.allocations.map(row => ({ orderId: row.orderId,
      remainingCashKurus: input.mode === "legacy_evidence" ? null : 1000,
      remainingGiftKurus: input.mode === "legacy_evidence" ? null : 0,
      fullyReturned: false, originalReversal: [] })), notificationState: "pending" };
}
function validDecisionReceipt(input: ResolveDisputeInput) {
  return { ok: true, disputeId: input.disputeId, orderId, operationKey: input.operationKey,
    status: input.action === "resolve" ? "resolved" : "rejected", resolution: input.resolution,
    resolvedAt: "2026-01-02T10:00:00.000Z", refund: input.refund ? validRefundReceipt({ ...input.refund, operationKey: input.operationKey, mode: "actual" }) : null,
    replayed: true, decisionNotificationState: "pending" };
}
const refundCommand = buildRefundEntryInput(orderId, view, { ...giftValues(), amounts: { [orderId]: { cash: "10", gift: "12,34" }, [siblingId]: { cash: "0", gift: "1" } }, reference: "ACTUAL-REF-123", occurredAt: "2026-01-01T12:00:00", confirmed: true }, operationKey, "actual");
const refundReceipt = validRefundReceipt(refundCommand);
const malformedRefunds: Record<string, unknown> = {
  "bare ok/refund ID": { ok: true, refundId: siblingId },
  "non UUID receipt ID": { ...refundReceipt, refundId: "anything" },
  "missing cash": { ...refundReceipt, cashKurus: undefined },
  "wrong cash total": { ...refundReceipt, cashKurus: refundReceipt.cashKurus + 1 },
  "wrong gift total": { ...refundReceipt, giftKurus: refundReceipt.giftKurus - 1 },
  "string amount": { ...refundReceipt, cashKurus: String(refundReceipt.cashKurus) },
  "missing orders": { ...refundReceipt, orders: undefined },
  "missing allocation": { ...refundReceipt, orders: refundReceipt.orders.slice(0, 1) },
  "duplicate allocation": { ...refundReceipt, orders: [refundReceipt.orders[0], refundReceipt.orders[0]] },
  "foreign allocation": { ...refundReceipt, orders: [{ ...refundReceipt.orders[0], orderId: operationKey }, refundReceipt.orders[1]] },
  "negative remainder": { ...refundReceipt, orders: [{ ...refundReceipt.orders[0], remainingCashKurus: -1 }, refundReceipt.orders[1]] },
  "unknown actual remainder": { ...refundReceipt, orders: [{ ...refundReceipt.orders[0], remainingCashKurus: null }, refundReceipt.orders[1]] },
  "missing completion flag": { ...refundReceipt, orders: [{ ...refundReceipt.orders[0], fullyReturned: undefined }, refundReceipt.orders[1]] },
  "inconsistent fully returned": { ...refundReceipt, orders: [{ ...refundReceipt.orders[0], fullyReturned: true }, refundReceipt.orders[1]] },
  "missing reversal evidence": { ...refundReceipt, orders: [{ ...refundReceipt.orders[0], originalReversal: undefined }, refundReceipt.orders[1]] },
  "invalid reversal ID": { ...refundReceipt, orders: [{ ...refundReceipt.orders[0], originalReversal: [{ kind: "manufacturer", outcome: "paid_retained", earningId: "bad" }] }, refundReceipt.orders[1]] },
  "unknown notification state": { ...refundReceipt, notificationState: "maybe" },
  "missing replay flag": { ...refundReceipt, replayed: undefined },
  "invalid warning": { ...refundReceipt, warning: { text: "wrong" } },
};
for (const [name, malformed] of Object.entries(malformedRefunds)) test(`refund handler preserves UUID on ${name}, then accepts complete same-command replay`, async () => {
  const store = storage(), key = `order-refund-intent:${orderId}`;
  store.setItem(key, JSON.stringify(refundCommand));
  const sent: string[] = [];
  const h = hookHarness(path.resolve("src/components/admin/order-refund-card.tsx"), "OrderRefundCard", { sessionStorage: store, fetch: async (_url: string, init: RequestInit) => {
    if (init.method !== "POST") return { ok: true, json: async () => view };
    sent.push(String(init.body));
    return { ok: true, json: async () => sent.length === 1 ? malformed : refundReceipt };
  } });
  const props = { orderId };
  await click(h.render(props), "İade kayıtlarını aç");
  await click(h.render(props), "Aynı kaydın sonucunu kontrol et");
  assert.equal(store.getItem(key), JSON.stringify(refundCommand), "malformed success must retain financial retry intent");
  const tree = h.render(props);
  assert.match(textOf(tree), /doğrulanamadı/);
  assert.equal(elements(tree).some(node => node.props.role === "status"), false, "no success notice");
  await click(tree, "Aynı kaydın sonucunu kontrol et");
  assert.equal(store.getItem(key), null);
  assert.equal(new Set(sent).size, 1);
});
const singleRefund = buildRefundEntryInput(orderId, view, giftValues(), command.operationKey, "actual");
const combinedCommand: ResolveDisputeInput = { ...command, refund: { expectedFingerprint: singleRefund.expectedFingerprint, allocations: singleRefund.allocations, reason: singleRefund.reason } };
const decisionReceipt = validDecisionReceipt(combinedCommand);
const malformedDecisions: Record<string, unknown> = {
  "refund omitted": { ...decisionReceipt, refund: null },
  "opposite decision": { ...decisionReceipt, status: "rejected" },
  "foreign root order": { ...decisionReceipt, orderId: siblingId },
  "foreign operation": { ...decisionReceipt, operationKey },
  "foreign dispute": { ...decisionReceipt, disputeId: orderId },
  "missing resolution": { ...decisionReceipt, resolution: undefined },
  "different resolution": { ...decisionReceipt, resolution: "Başka bir kararın gerekçesi." },
  "missing decision date": { ...decisionReceipt, resolvedAt: undefined },
  "invalid decision date": { ...decisionReceipt, resolvedAt: "not-a-date" },
  "unknown notification": { ...decisionReceipt, decisionNotificationState: "maybe" },
  "missing replay flag": { ...decisionReceipt, replayed: undefined },
  "bare nested refund": { ...decisionReceipt, refund: { ok: true, refundId: siblingId } },
  "wrong nested amount": { ...decisionReceipt, refund: { ...decisionReceipt.refund!, giftKurus: 0 } },
  "foreign nested allocation": { ...decisionReceipt, refund: { ...decisionReceipt.refund!, orders: [{ ...decisionReceipt.refund!.orders[0], orderId: siblingId }] } },
};
for (const [name, malformed] of Object.entries(malformedDecisions)) test(`combined decision handler preserves UUID on ${name}, then accepts complete replay`, async () => {
  const store = storage(combinedCommand), sent: string[] = [];
  const h = hookHarness(clientPath, "DisputesClient", { sessionStorage: store, fetch: async (_url: string, init: RequestInit) => {
    assert.equal(init.method, "POST", "combined command must not call standalone refund endpoint");
    sent.push(String(init.body));
    return { ok: true, json: async () => sent.length === 1 ? malformed : decisionReceipt };
  } });
  const props = { disputes: [], status: "resolved" };
  h.render(props); await h.mount();
  await click(h.render(props), "Aynı kararın sonucunu kontrol et");
  assert.equal(store.getItem("dispute-decision-intent"), JSON.stringify(combinedCommand), "malformed success must retain root intent");
  const tree = h.render(props);
  assert.match(textOf(tree), /doğrulanamadı/);
  assert.equal(elements(tree).some(node => node.props.role === "status"), false);
  await click(tree, "Aynı kararın sonucunu kontrol et");
  assert.equal(store.getItem("dispute-decision-intent"), null);
  assert.equal(new Set(sent).size, 1);
});

test("decision-only rejects an unexpected refund/opposite action and only clears after a matching complete receipt", async () => {
  const input: ResolveDisputeInput = { ...command, action: "reject" };
  const store = storage(input), valid = validDecisionReceipt(input);
  const replies = [{ ...valid, refund: validRefundReceipt(singleRefund) }, { ...valid, status: "resolved" }, valid];
  const sent: string[] = [];
  const h = hookHarness(clientPath, "DisputesClient", { sessionStorage: store, fetch: async (_url: string, init: RequestInit) => {
    assert.equal(init.method, "POST"); sent.push(String(init.body));
    return { ok: true, json: async () => replies.shift() };
  } });
  const props = { disputes: [closedRow], status: "rejected" };
  h.render(props); await h.mount();
  for (let i = 0; i < 3; i++) {
    await click(h.render(props), "Aynı kararın sonucunu kontrol et");
    assert.equal(store.getItem("dispute-decision-intent") === null, i === 2);
  }
  assert.equal(new Set(sent).size, 1);
});
test("restored decision-only receipt keeps UUID until its unknown order link is verified", async () => {
  const store = storage(command), valid = validDecisionReceipt(command);
  let verified = false;
  const h = hookHarness(clientPath, "DisputesClient", { sessionStorage: store, fetch: async (_url: string, init: RequestInit) => {
    if (init.method === "POST") return { ok: true, json: async () => valid };
    return { ok: true, json: async () => ({ dispute: { ...closedRow, orderId: verified ? orderId : siblingId, decisionOperationKey: command.operationKey, resolution: command.resolution } }) };
  } });
  const props = { disputes: [], status: "resolved" };
  h.render(props); await h.mount();
  await click(h.render(props), "Aynı kararın sonucunu kontrol et");
  assert.ok(store.getItem("dispute-decision-intent"));
  assert.match(textOf(h.render(props)), /sipariş bağlantısı doğrulanamadı/);
  verified = true;
  await click(h.render(props), "Aynı kararın sonucunu kontrol et");
  assert.equal(store.getItem("dispute-decision-intent"), null);
});
test("legacy evidence receipt accepts unknown balances without implying a completed actual refund", async () => {
  const input = { ...singleRefund, mode: "legacy_evidence" as const };
  const store = storage(), key = `order-refund-intent:${orderId}`;
  store.setItem(key, JSON.stringify(input));
  const receipt = { ...validRefundReceipt(input), notificationState: "not_required" };
  const h = hookHarness(path.resolve("src/components/admin/order-refund-card.tsx"), "OrderRefundCard", { sessionStorage: store, fetch: async (_url: string, init: RequestInit) => ({ ok: true, json: async () => init.method === "POST" ? receipt : view }) });
  const props = { orderId };
  await click(h.render(props), "İade kayıtlarını aç");
  await click(h.render(props), "Aynı kaydın sonucunu kontrol et");
  assert.equal(store.getItem(key), null);
});

test("verified already-closed refund refusal explains how to record cash already returned; decision-only stays short", async () => {
  const recovery = "Bu gönderimin iadesi kaydedilmedi. Bankadan/PayTR’den gerçekten dönen tutar varsa siparişin İadeler bölümünden kaydedin.";
  for (const input of [command, combinedCommand]) {
    const store = storage(input);
    const latest: DisputeDecisionView = { dispute: { ...closedRow, decisionOperationKey: operationKey }, expectedDecisionFingerprint: "c".repeat(64), refundView: null };
    const h = hookHarness(clientPath, "DisputesClient", { sessionStorage: store, fetch: async (_url: string, init: RequestInit) => init.method === "POST"
      ? { ok: false, status: 409, json: async () => ({ code: "already_closed", error: "Önceden kapandı." }) }
      : { ok: true, json: async () => latest } });
    const props = { disputes: [], status: "resolved" };
    h.render(props); await h.mount();
    await click(h.render(props), "Aynı kararın sonucunu kontrol et");
    const tree = h.render(props);
    assert.equal(textOf(tree).includes(recovery), !!input.refund);
    assert.equal(store.getItem("dispute-decision-intent"), null);
    const editor = elements(tree).find(node => typeof node.type === "function" && node.type.name === "DecisionEditor")!;
    const detail = hookHarness(clientPath, "TestEditor", {}, "\nexport { DecisionEditor as TestEditor };\n").render(editor.props);
    assert.ok(elements(detail).some(node => node.props.href === `/admin/orders/${orderId}`));
  }
});

test("already_closed keeps the pending intent when the latest decision key is blank or malformed", async () => {
  for (const key of ["", "not-a-uuid", " ", `${operationKey}\n`, operationKey.slice(0, -1), 123, undefined]) {
    const store = storage(combinedCommand);
    const h = hookHarness(clientPath, "DisputesClient", { sessionStorage: store, fetch: async (_url: string, init: RequestInit) => init.method === "POST"
      ? { ok: false, status: 409, json: async () => ({ code: "already_closed", error: "Önceden kapandı." }) }
      : { ok: true, json: async () => ({ dispute: { ...closedRow, decisionOperationKey: key }, expectedDecisionFingerprint: "c".repeat(64), refundView: null }) } });
    const props = { disputes: [], status: "resolved" };
    h.render(props); await h.mount();
    await click(h.render(props), "Aynı kararın sonucunu kontrol et");
    assert.equal(store.getItem("dispute-decision-intent"), JSON.stringify(combinedCommand), `invalid key ${JSON.stringify(key)} cannot prove another decision`);
    const tree = h.render(props);
    assert.match(textOf(tree), /doğrulanamadı/);
    assert.match(textOf(tree), /Önceki kararın sonucu henüz doğrulanmadı/);
    assert.equal(elements(tree).some(node => node.props.role === "status"), false);
  }
});
