"use client";

import { parseTryToKurus } from "@/lib/config/cost-lines";
import { MAX_REFUND_KURUS, normalizeRecordRefundInput, type OrderRefundView, type RecordRefundInput, type RefundResult } from "@/lib/config/order-refund";

const RECEIPT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function receiptUuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && RECEIPT_UUID.test(value);
}
function receiptObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function receiptAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_REFUND_KURUS;
}

/** A 2xx response is not proof of this refund. Validate the complete receipt
 * against the persisted intent before either form releases its retry UUID.
 * Remaining balances belong to that receipt, not a later refreshed preview.
 */
export function refundReceiptMatchesInput(value: unknown, input: RecordRefundInput): value is RefundResult {
  if (!receiptObject(value) || value.ok !== true || !receiptUuid(value.refundId)
    || typeof value.replayed !== "boolean" || !receiptAmount(value.cashKurus) || !receiptAmount(value.giftKurus)
    || value.cashKurus !== input.allocations.reduce((sum, row) => sum + row.cashKurus, 0)
    || value.giftKurus !== input.allocations.reduce((sum, row) => sum + row.giftKurus, 0)
    || typeof value.notificationState !== "string" || !["pending", "delivered", "not_required"].includes(value.notificationState)
    || (value.warning !== undefined && typeof value.warning !== "string")
    || !Array.isArray(value.orders) || value.orders.length !== input.allocations.length) return false;
  const expectedOrders = new Set(input.allocations.map(row => row.orderId));
  for (const row of value.orders) {
    if (!receiptObject(row) || !receiptUuid(row.orderId) || !expectedOrders.delete(row.orderId)
      || typeof row.fullyReturned !== "boolean" || !Array.isArray(row.originalReversal)) return false;
    if (input.mode === "actual") {
      if (!receiptAmount(row.remainingCashKurus) || !receiptAmount(row.remainingGiftKurus)
        || row.fullyReturned !== (row.remainingCashKurus === 0 && row.remainingGiftKurus === 0)) return false;
    } else if ((row.remainingCashKurus !== null && !receiptAmount(row.remainingCashKurus))
      || (row.remainingGiftKurus !== null && !receiptAmount(row.remainingGiftKurus)) || row.fullyReturned) return false;
    for (const reversal of row.originalReversal) {
      if (!receiptObject(reversal) || typeof reversal.kind !== "string" || !["manufacturer", "painter"].includes(reversal.kind)
        || typeof reversal.outcome !== "string" || !["reversed", "paid_retained", "already_reversed", "absent"].includes(reversal.outcome)
        || (reversal.earningId !== undefined && !receiptUuid(reversal.earningId))) return false;
    }
  }
  return expectedOrders.size === 0;
}

export interface RefundEntryValues {
  amounts: Record<string, { cash: string; gift: string }>;
  reason: string;
  reference: string;
  occurredAt: string;
  confirmed: boolean;
}
export function emptyRefundEntry(): RefundEntryValues {
  return { amounts: {}, reason: "", reference: "", occurredAt: "", confirmed: false };
}

/** Builds evidence only. The owning form persists the operation before sending. */
export function buildRefundEntryInput(
  orderId: string, view: OrderRefundView, values: RefundEntryValues,
  operationKey: string, mode: RecordRefundInput["mode"],
): RecordRefundInput {
  const allocations = Object.entries(values.amounts).map(([id, row]) => ({
    orderId: id, cashKurus: parseTryToKurus(row.cash || "0"), giftKurus: parseTryToKurus(row.gift || "0"),
  })).filter(row => row.cashKurus !== 0 || row.giftKurus !== 0);
  if (!allocations.some(row => row.orderId === orderId)) throw new Error("Açık sipariş için en az bir iade tutarı girin.");
  const cash = allocations.reduce((sum, row) => sum + row.cashKurus, 0);
  if (cash > 0 && !values.confirmed) throw new Error("Paranın ilgili ödeme kanalından geri gönderildiğini doğrulayın.");
  const method = view.payment.method;
  return normalizeRecordRefundInput({ operationKey, expectedFingerprint: view.expectedFingerprint,
    mode, allocations, reason: values.reason, ...(cash > 0 ? { cashEvidence: {
      method, externalReference: values.reference,
      occurredAt: values.occurredAt ? new Date(values.occurredAt).toISOString() : "",
      ...(method === "card" ? { paytrRefundCompleted: true } : { bankTransferCompleted: true }),
    } } : {}),
  });
}

const amountText = (value: number | null) => value === null ? "" : (value / 100).toFixed(2).replace(".", ",");
export function RefundEntryFields({ orderId, view, values, onChange, mode, disabled = false, singleOrderOnly = false }: {
  orderId: string;
  view: OrderRefundView;
  values: RefundEntryValues;
  onChange: (values: RefundEntryValues) => void;
  mode: RecordRefundInput["mode"];
  disabled?: boolean;
  singleOrderOnly?: boolean;
}) {
  const cashTotal = Object.values(values.amounts).reduce((sum, row) => sum + (parseTryToKurus(row.cash || "0") || 0), 0);
  function changeAmount(id: string, key: "cash" | "gift", value: string) {
    onChange({ ...values, amounts: { ...values.amounts, [id]: { cash: values.amounts[id]?.cash ?? "", gift: values.amounts[id]?.gift ?? "", [key]: value } } });
  }
  return <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
        <p className="text-xs text-gray-600">{mode === "legacy_evidence" ? "Bu kayıt yalnız geçmişte gerçekleşen iadenin kanıtını saklar. Kart bakiyesi, sipariş durumu ve partner hak edişi değişmez; yeni iade bildirimi gönderilmez." : "Nakit tutarı yalnız para müşteriye geri gönderildikten sonra girin. Hediye kartı tutarı burada kaydedildiğinde aynı karta geri yüklenir. Kısmi iade üretimi durdurmaz; tüm tutar döndüğünde ileri işlemler kapanır. Ödenmiş veya mahsupla kapanmış partner hak edişleri ve bağımsız ek hak edişler korunur."}</p>
        {(singleOrderOnly ? view.siblings.filter(row => row.orderId === orderId) : view.siblings).map(row => <div key={row.orderId} className="grid gap-2 rounded-lg border border-gray-100 p-3 sm:grid-cols-3">
          <div className="text-xs font-medium">{row.orderNumber}{row.orderId === orderId ? " · Açık sipariş" : " · Aynı ödeme"}
            {mode === "actual" && <button type="button" className="mt-1 block text-blue-700 underline" onClick={() => onChange({ ...values, amounts: { ...values.amounts, [row.orderId]: { cash: amountText(row.remainingCashKurus), gift: amountText(row.remainingGiftKurus) } } })}>Kalan tutarı doldur</button>}</div>
          <label className="text-xs">Nakit iade (₺)<input aria-label={`${row.orderNumber} nakit iade`} inputMode="decimal" value={values.amounts[row.orderId]?.cash ?? ""} onChange={e => changeAmount(row.orderId,"cash",e.target.value)} placeholder="0,00" className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="text-xs">Hediye kartı (₺)<input aria-label={`${row.orderNumber} hediye kartı iadesi`} inputMode="decimal" value={values.amounts[row.orderId]?.gift ?? ""} onChange={e => changeAmount(row.orderId,"gift",e.target.value)} placeholder="0,00" className="mt-1 w-full rounded-lg border p-2" /></label>
        </div>)}
        {cashTotal > 0 && <div className="space-y-3 rounded-lg border border-amber-200 p-3">
          <label className="block text-xs">İade işlem referansı<input value={values.reference} onChange={e => onChange({ ...values, reference: e.target.value })} maxLength={200} className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="block text-xs">Gerçekleşme tarihi ve saati<input type="datetime-local" step="1" value={values.occurredAt} onChange={e => onChange({ ...values, occurredAt: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /><span className="mt-1 block text-gray-500">Tarayıcınızın yerel saat dilimi kullanılır.</span></label>
          <label className="block text-sm"><input type="checkbox" checked={values.confirmed} onChange={e => onChange({ ...values, confirmed: e.target.checked })} className="mr-2" />{view.payment.method === "card" ? "Bu tutarın PayTR panelinden müşteriye iadesini tamamladım." : "Bu tutarı bankadan müşteriye geri gönderdim."}</label>
        </div>}
        <label className="block text-xs">Gerekçe<textarea value={values.reason} onChange={e => onChange({ ...values, reason: e.target.value })} minLength={10} maxLength={1000} rows={2} className="mt-1 w-full rounded-lg border p-2" /><span className="text-gray-500">En az 10 karakter; tutar ve gerekçe denetim kaydında saklanır.</span></label>
  </fieldset>;
}
