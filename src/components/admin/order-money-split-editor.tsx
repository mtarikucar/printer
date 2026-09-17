"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseTryToKurus } from "@/lib/config/cost-lines";
import { validateMoneySplit, type MoneySplitEditView } from "@/lib/config/order-money-edit";

const amountText = (value: number) => (value / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OrderMoneySplitEditor({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MoneySplitEditView | null>(null);
  const [production, setProduction] = useState("");
  const [painting, setPainting] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setOpen(true); setBusy(true); setError(null); setMessage(null); setView(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/money-split`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kalemler okunamadı.");
      setView(data); setProduction(amountText(data.productionKurus)); setPainting(amountText(data.paintingKurus));
    } catch (e) { setError(e instanceof Error ? e.message : "Kalemler okunamadı."); }
    finally { setBusy(false); }
  }

  const productionKurus = parseTryToKurus(production);
  const paintingKurus = parseTryToKurus(painting);
  const splitError = view ? validateMoneySplit(view.amountKurus, productionKurus, paintingKurus) : null;

  async function save() {
    if (!view || view.blockedReason || splitError || busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/money-split`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productionKurus, paintingKurus, expectedProductionKurus: view.productionKurus, expectedPaintingKurus: view.paintingKurus, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kalemler kaydedilemedi.");
      setMessage(data.warning || (data.changed ? "Kalemler ve değişiklik gerekçesi kaydedildi." : "Kalemler zaten bu tutarlarda; değişiklik yapılmadı."));
      setOpen(false); setView(null); setReason(""); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Kalemler kaydedilemedi."); }
    finally { setBusy(false); }
  }

  return <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-gray-900">Kalemleri düzenle</h3>
      <button type="button" disabled={busy} onClick={() => open ? setOpen(false) : void load()} className="text-sm font-medium text-blue-600 disabled:opacity-50">{open ? "Kapat" : "Düzenle"}</button>
    </div>
    <p className="mt-2 text-xs text-gray-600">Hak ediş oluşmadan üretim ve boyama payını değiştirin. Müşterinin toplamı aynı kalır; boyamayı kaldırmak için boyama tutarını sıfır yapın.</p>
    {message && <p role="status" className="mt-3 text-sm text-amber-800">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {open && busy && !view && <p className="mt-3 text-sm text-gray-500">Güncel kalemler okunuyor…</p>}
    {open && view && (view.blockedReason ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{view.blockedReason}</p> : <div className="mt-4 space-y-3">
      <p className="text-sm font-medium">Sipariş toplamı: {amountText(view.amountKurus)} TL</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-600">Üretim / baskı (TL)<input value={production} onChange={e => setProduction(e.target.value)} inputMode="decimal" disabled={busy} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" /></label>
        <label className="text-xs text-gray-600">Boyama (TL)<input value={painting} onChange={e => setPainting(e.target.value)} inputMode="decimal" disabled={busy} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" /></label>
      </div>
      <p className="text-xs text-gray-500">Tutarlar komisyon öncesi hak ediş tabanlarıdır. Boyama kaldırılırsa boyalı yüzey seçimi de boyamasız olarak güncellenir.</p>
      {splitError && <p className="text-xs text-red-700">{splitError}</p>}
      <label className="block text-xs text-gray-600">Değişiklik gerekçesi<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={10} maxLength={1000} disabled={busy} className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm" placeholder="En az 10 karakter" /></label>
      <button type="button" onClick={() => void save()} disabled={busy || !!splitError || reason.trim().length < 10} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? "Kaydediliyor…" : "Bölüşümü kaydet"}</button>
      <button type="button" onClick={() => void load()} disabled={busy} className="ml-3 text-xs text-blue-600">Güncel tutarları yükle</button>
    </div>)}
  </div>;
}
