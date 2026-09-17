"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseTryToKurus } from "@/lib/config/cost-lines";
import type { OrderAdjustmentsView } from "@/lib/services/partner-adjustments";

const money = (value: number) => (value / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
const labels: Record<string, string> = { topup: "Ek hak ediş", reprint: "Yeniden üretim desteği", unpaid_offset: "Ödenmemiş hak ediş düzeltmesi", pending: "Bekliyor", settled: "Kapatıldı", voided: "İptal edildi" };

export function OrderPartnerAdjustments({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<OrderAdjustmentsView | null>(null);
  const [recipientKey, setRecipientKey] = useState("");
  const [kind, setKind] = useState("topup");
  const [sourceKey, setSourceKey] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const attempt = useRef<{ intent: string; key: string } | null>(null);
  const endpoint = `/api/admin/orders/${orderId}/adjustments`;
  const recipient = view?.recipients.find(r => `${r.kind}:${r.id}` === recipientKey);
  const source = recipient?.sources.find(s => `${s.kind}:${s.id}` === sourceKey);
  const magnitude = parseTryToKurus(amount);
  const debit = kind === "unpaid_offset";
  const valid = recipient && Number.isSafeInteger(magnitude) && magnitude > 0
    && magnitude <= 2147483647 && reason.trim().length >= 10
    && (!debit || (source && magnitude <= source.remainingNetKurus));

  async function read() {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Hak ediş düzeltmeleri okunamadı.");
    setView(data);
  }
  async function load() {
    setOpen(true); setBusy(true); setError(null); setNotice(null); setView(null);
    try { await read(); }
    catch (e) { setError(e instanceof Error ? e.message : "Hak ediş bilgileri okunamadı."); }
    finally { setBusy(false); }
  }
  async function mutate(url: string, payload: Record<string, unknown>) {
    const intent = JSON.stringify({ url, payload });
    if (attempt.current?.intent !== intent) attempt.current = { intent, key: crypto.randomUUID() };
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, idempotencyKey: attempt.current.key }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "İşlem kaydedilemedi.");
    attempt.current = null;
    setNotice(data.warning || "İşlem ve gerekçesi kaydedildi.");
    await read().catch(() => {
      setView(null);
      setError("İşlem kaydedildi; güncel liste okunamadı. Yeni işlem yapmadan kayıtları yeniden yükleyin.");
    });
    router.refresh();
  }
  async function save() {
    if (!valid || !recipient || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await mutate(endpoint, {
        partnerKind: recipient.kind, partnerId: recipient.id, kind,
        netKurus: debit ? -magnitude : magnitude, reason: reason.trim(),
        expectedFingerprint: debit ? source!.expectedFingerprint : recipient.expectedFingerprint,
        ...(debit ? { source: { kind: source!.kind, id: source!.id } } : {}),
      });
      setAmount(""); setReason(""); setSourceKey("");
    } catch (e) { setError(e instanceof Error ? e.message : "İşlem kaydedilemedi."); }
    finally { setBusy(false); }
  }
  async function voidAdjustment(row: OrderAdjustmentsView["adjustments"][number]) {
    const why = window.prompt("Bu ödenmemiş düzeltme kaydını neden iptal ediyorsunuz? En az 10 karakter gerekçe yazın.");
    if (why === null) return;
    if (why.trim().length < 10) { setError("İptal gerekçesi en az 10 karakter olmalıdır."); return; }
    setBusy(true); setError(null); setNotice(null);
    try { await mutate(`${endpoint}/${row.id}/void`, { reason: why.trim(), expectedFingerprint: row.expectedFingerprint }); }
    catch (e) { setError(e instanceof Error ? e.message : "İptal kaydedilemedi."); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-gray-900">Hak ediş düzeltmeleri</h3>
      <button type="button" disabled={busy} className="text-sm font-medium text-blue-600 disabled:opacity-50" onClick={() => open ? setOpen(false) : void load()}>{open ? "Kapat" : "Kayıtları aç"}</button>
    </div>
    <p className="mt-2 text-xs text-gray-600">Ek ödeme ve düzeltmeler ayrı kaydedilir. Geçmiş hak ediş ve müşterinin ödediği tutar değişmez.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error} <button type="button" disabled={busy} onClick={() => void load()} className="underline">Güncel kayıtları yükle</button></p>}
    {notice && <p role="status" className="mt-3 text-sm text-amber-800">{notice}</p>}
    {open && busy && !view && <p className="mt-3 text-sm text-gray-500">Hak ediş kayıtları okunuyor…</p>}
    {open && view && <div className="mt-4 space-y-4">
      {view.recipients.length === 0 ? <p className="text-sm text-gray-600">Bu siparişle bağlantılı üretici veya boyacı bulunamadı.</p> : <div className="space-y-3">
        <label className="block text-xs text-gray-600">Üretici / boyacı<select value={recipientKey} disabled={busy} onChange={e => { setRecipientKey(e.target.value); setSourceKey(""); }} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm">
          <option value="">Partner seçin</option>{view.recipients.map(r => <option key={`${r.kind}:${r.id}`} value={`${r.kind}:${r.id}`}>{r.name} · {r.kind === "manufacturer" ? "Üretici" : "Boyacı"}</option>)}
        </select></label>
        <label className="block text-xs text-gray-600">İşlem<select value={kind} disabled={busy} onChange={e => { setKind(e.target.value); setSourceKey(""); }} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm">
          <option value="topup">Platformdan ek hak ediş</option><option value="reprint">Platformdan yeniden üretim desteği</option><option value="unpaid_offset">Ödenmemiş hak edişten düzeltme</option>
        </select></label>
        {debit ? <>
          <label className="block text-xs text-gray-600">Düzeltilecek kayıt<select value={sourceKey} disabled={busy || !recipient} onChange={e => setSourceKey(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm">
            <option value="">Ödenmemiş kayıt seçin</option>{recipient?.sources.map(s => <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>{s.label} · kalan {money(s.remainingNetKurus)}</option>)}
          </select></label>
          <p className="text-xs text-amber-800">Kesinti yalnız seçtiğiniz ödenmemiş kaydı azaltır. Ödenmiş tutardan veya başka siparişin kazancından kesinti yapılamaz. Partiye alınmış kayıt için önce ödeme partisini iptal edin.</p>
        </> : <p className="text-xs text-gray-600">Tutar partnerin alacağı net ek ödemedir; platform tarafından karşılanır. Müşteriden ek tahsilat yapılmaz ve bu tutardan yeniden komisyon kesilmez.</p>}
        <label className="block text-xs text-gray-600">Net tutar (TL)<input value={amount} disabled={busy} inputMode="decimal" onChange={e => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" /></label>
        {source && debit && magnitude > source.remainingNetKurus && <p className="text-xs text-red-700">Kesinti, seçilen kaydın kalan {money(source.remainingNetKurus)} tutarını aşamaz.</p>}
        <label className="block text-xs text-gray-600">Gerekçe<textarea value={reason} disabled={busy} maxLength={1000} onChange={e => setReason(e.target.value)} placeholder="En az 10 karakter" className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" /></label>
        <button type="button" disabled={busy || !valid} onClick={() => void save()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "Kaydediliyor…" : debit ? "Kesintiyi kaydet" : "Ek hak edişi kaydet"}</button>
      </div>}
      <div className="border-t border-gray-100 pt-4">
        <h4 className="text-sm font-medium">Düzeltme geçmişi</h4>
        {view.adjustments.length === 0 ? <p className="mt-2 text-xs text-gray-500">Henüz düzeltme kaydı yok.</p> : <ul className="mt-2 divide-y divide-gray-100">{view.adjustments.map(row => <li key={row.id} className="py-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span>{row.partnerName} · {labels[row.kind]}</span><strong className={row.netKurus < 0 ? "text-red-700" : "text-emerald-700"}>{money(row.netKurus)}</strong></div>
          <p className="mt-1 text-xs text-gray-500">{labels[row.status]}{row.payoutId ? " · Ödeme partisine alındı" : ""} · {new Date(row.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</p>
          <p className="mt-1 text-xs text-gray-700">{row.reason}</p>
          <p className="mt-1 text-xs text-gray-500">Kaydeden: {row.adminEmail}</p>
          {row.voidReason && <p className="mt-1 text-xs text-gray-600">İptal gerekçesi: {row.voidReason} · {row.voidedBy}{row.voidedAt ? ` · ${new Date(row.voidedAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}` : ""}</p>}
          {row.canVoid ? <button type="button" disabled={busy} onClick={() => void voidAdjustment(row)} className="mt-2 text-xs text-red-700 underline disabled:opacity-40">Düzeltmeyi iptal et</button> : row.voidBlockedReason && <p className="mt-1 text-xs text-gray-500">{row.voidBlockedReason}</p>}
        </li>)}</ul>}
      </div>
    </div>}
  </section>;
}
