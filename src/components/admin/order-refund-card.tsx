"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildRefundEntryInput, emptyRefundEntry, RefundEntryFields, refundReceiptMatchesInput } from "@/components/admin/refund-entry-fields";
import { normalizeRecordRefundInput, refundResponseAllowsNewIntent, type OrderRefundView, type RecordRefundInput } from "@/lib/config/order-refund";

const money = (value: number | null) => value === null ? "Uzlaştırma gerekiyor" : (value / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
const dateText = (value: string) => new Date(value).toLocaleString("tr-TR");

/** The pending intent survives reloads; an uncertain response retries the SAME operation. */
export function OrderRefundCard({ orderId }: { orderId: string }) {
  const router = useRouter();
  const endpoint = `/api/admin/orders/${orderId}/refund`;
  const storageKey = `order-refund-intent:${orderId}`;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<OrderRefundView | null>(null);
  const [values, setValues] = useState(emptyRefundEntry);
  const [mode, setMode] = useState<RecordRefundInput["mode"]>("actual");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<RecordRefundInput | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const legacy = view?.siblings.some(row => row.legacyUnverified) ?? false;
  const canEnter = !!view && (mode === "legacy_evidence" ? legacy : view.canRecord);

  async function read() {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "İade kayıtları okunamadı.");
    setView(data);
  }
  async function load() {
    setOpen(true); setBusy(true); setError(null); setView(null);
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        pending.current = normalizeRecordRefundInput(JSON.parse(saved));
        setUncertain(true);
      }
      await read();
    } catch (e) { setError(e instanceof Error ? e.message : "İade kayıtları okunamadı."); }
    finally { setBusy(false); }
  }
  async function submit(retry = false) {
    if (busy || (!retry && (!view || !canEnter || uncertain))) return;
    setError(null); setNotice(null);
    try {
      if (!retry) {
        const input = buildRefundEntryInput(orderId, view!, values, crypto.randomUUID(), mode);
        const cash = input.allocations.reduce((sum, row) => sum + row.cashKurus, 0);
        const gift = input.allocations.reduce((sum, row) => sum + row.giftKurus, 0);
        if (!window.confirm(mode === "legacy_evidence"
          ? `Eski iadenin kanıtı kaydedilecek. Nakit ${money(cash)}, hediye kartı ${money(gift)}. Yeni para veya kart bakiyesi hareketi yapılmaz.`
          : `Gerçekleşen nakit iade ${money(cash)} olarak kaydedilecek; hediye kartına ${money(gift)} geri yüklenecek. Bu panel banka veya PayTR transferi yapmaz. Devam edilsin mi?`)) return;
        // If storage is unavailable, refuse before sending rather than lose retry identity.
        sessionStorage.setItem(storageKey, JSON.stringify(input));
        pending.current = input; setUncertain(true);
      }
      if (!pending.current) return;
      setBusy(true);
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      const data = await response.json();
      if (!response.ok) {
        if (refundResponseAllowsNewIntent(response.status, data.code)) {
          sessionStorage.removeItem(storageKey); pending.current = null; setUncertain(false);
          // Busy cannot prove whether an earlier request committed: keep its key.
          // A definitive conflict requires a fresh snapshot before a new intent.
          if (response.status === 409) setView(null);
        }
        throw new Error(data.error || "İade kaydı tamamlanamadı. Aynı kaydı tekrar deneyin.");
      }
      if (!refundReceiptMatchesInput(data, pending.current)) throw new Error("İşlem sonucu doğrulanamadı. İşlem numarası korundu; aynı kaydın sonucunu tekrar kontrol edin.");
      const result = data;
      sessionStorage.removeItem(storageKey); pending.current = null; setUncertain(false);
      setValues(emptyRefundEntry());
      setNotice(`${result.replayed ? "Önceki kayıt bulundu; ikinci işlem yapılmadı." : "İade kaydedildi."} Nakit: ${money(result.cashKurus)} · Hediye kartı: ${money(result.giftKurus)}.${result.notificationState === "pending" ? " E-posta bildirimi sırada; para kaydını yeniden girmeyin." : ""}${result.warning ? ` ${result.warning}` : ""}`);
      await read().catch(() => { setView(null); setError("İade kaydedildi; güncel geçmiş okunamadı. Listeyi yeniden yükleyin."); });
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "İşlem sonucu doğrulanamadı. Aynı kaydı tekrar deneyin."); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-gray-200 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-sm font-semibold text-gray-900">İadeler ve kalan tutarlar</h3><p className="text-xs text-gray-500">Gerçekleşen para iadesi, hediye kartı dönüşü ve iptal kayıtları</p></div>
      <button type="button" onClick={load} disabled={busy} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy ? "Yükleniyor…" : open ? "Kayıtları yenile" : "İade kayıtlarını aç"}</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {open && uncertain && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p>Önceki gönderimin sonucu henüz doğrulanmadı. Aynı işlem numarasıyla sonucu kontrol edin; yeni bir iade girmeyin.</p>
      {pending.current && <p className="mt-1 text-xs">İşlem: {pending.current.operationKey}</p>}
      <button type="button" disabled={busy} onClick={() => submit(true)} className="mt-2 rounded-lg border border-amber-400 px-3 py-2 font-semibold">Aynı kaydın sonucunu kontrol et</button>
    </div>}
    {open && view && <div className="mt-4 space-y-4">
      <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
        <p>Kayıtlı tahsilat: {money(view.payment.cashBasisKurus)} nakit · {money(view.payment.giftBasisKurus)} hediye kartı.</p>
        <p>Bu tutarlar siparişin ödeme kayıtlarından gelir. Banka veya PayTR hesabını bu ekran sorgulamaz.</p>
      </div>
      {view.blockedReason && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{view.blockedReason}</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-xs">
        <thead><tr className="border-b"><th className="py-2">Sipariş</th><th>Nakit iade kaydı</th><th>Karta dönüş kaydı</th><th>Kalan nakit</th><th>Kalan kart tutarı</th></tr></thead>
        <tbody>{view.siblings.map(row => <tr key={row.orderId} className="border-b border-gray-100">
          <td className="py-3">{row.orderNumber}{row.cancelled && <span className="ml-1 text-red-700">İptal</span>}</td>
          <td>{money(row.confirmedCashKurus)}</td><td>{money(row.confirmedGiftKurus)}</td><td>{money(row.remainingCashKurus)}</td><td>{money(row.remainingGiftKurus)}</td>
        </tr>)}</tbody>
      </table></div>
      {legacy && <p className="text-xs text-amber-800">Eski “iade edildi” işareti, gerçekleşen tutar veya işlem kanıtı değildir. Bilinmeyen kalan tutar yeni bir iade yetkisi vermez.</p>}
      {legacy && <label className="block text-sm"><input type="checkbox" checked={mode === "legacy_evidence"} disabled={busy || uncertain} onChange={e => { setMode(e.target.checked ? "legacy_evidence" : "actual"); setValues(value => ({ ...value, amounts: {}, confirmed: false })); }} className="mr-2" />Yalnız eski iadenin kanıtını kaydet; bakiye ve sipariş durumunu değiştirme</label>}
      {canEnter && <fieldset disabled={busy || uncertain} className="space-y-3 disabled:opacity-60">
        <legend className="mb-2 text-sm font-semibold">{mode === "legacy_evidence" ? "Eski iade kanıtı" : "Gerçekleşen iadeyi kaydet"}</legend>
        <RefundEntryFields orderId={orderId} view={view} values={values} onChange={setValues} mode={mode} disabled={busy || uncertain} />
        <button type="button" onClick={() => submit()} disabled={busy || values.reason.trim().length < 10} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">{mode === "legacy_evidence" ? "Eski iade kanıtını kaydet" : "Gerçekleşen iadeyi kaydet"}</button>
      </fieldset>}
      <div><h4 className="mb-2 text-sm font-semibold">Kayıt geçmişi</h4>
        {view.history.length === 0 ? <p className="text-xs text-gray-500">Tutarı ve kanıtı kaydedilmiş iade yok.</p> : <ol className="space-y-2">{view.history.map(record => <li key={record.refundId} className="rounded-lg border border-gray-100 p-3 text-xs">
          <p className="font-semibold">{record.kind === "cancellation" ? "Sipariş iptali" : record.kind === "legacy_evidence" ? "Eski iade kanıtı" : "Gerçekleşen iade"} · Nakit {money(record.cashKurus)} · Hediye kartı {money(record.giftKurus)}</p>
          <p className="mt-1">{dateText(record.occurredAt)} · {record.adminEmail}{record.externalReference ? ` · Ref: ${record.externalReference}` : ""}</p>
          <p className="mt-1">{record.reason}</p>
          {record.allocations.length > 1 && <ul className="mt-2 space-y-1 text-gray-600">{record.allocations.map(allocation => <li key={allocation.orderId}>
            {view.siblings.find(row => row.orderId === allocation.orderId)?.orderNumber ?? allocation.orderId}: nakit {money(allocation.cashKurus)} · hediye kartı {money(allocation.giftKurus)}
          </li>)}</ul>}
          <p className="mt-1 text-gray-500">Kayıt: {dateText(record.recordedAt)} · {record.notificationState === "pending" ? "E-posta bildirimi bekliyor" : record.notificationState === "delivered" ? "E-posta gönderimi kabul edildi" : "Yeni bildirim gerekmiyor"}</p>
        </li>)}</ol>}
      </div>
    </div>}
  </section>;
}
