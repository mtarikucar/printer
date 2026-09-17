"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { COST_LINE_OPTIONS, parseTryToKurus, type CostLineKind } from "@/lib/config/cost-lines";
import type { DraftAction, DraftLine } from "@/app/api/admin/drafts/[id]/_policy";

export interface DraftManagementProps {
  id: string; updatedAt: string; payUrl: string; deadline: string | null;
  permissions: Record<"edit" | "extend" | "cancel" | "resend", string | null>;
  lines: { name: string; priceKurus: number; kind?: string }[];
}
const money = (value: number) => (value / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const field = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const button = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40";

export function DraftManagement({ id, updatedAt, payUrl, permissions, lines: initialLines, onSuccess }: DraftManagementProps & { onSuccess: (message: string) => void }) {
  const router = useRouter();
  const [lines, setLines] = useState<DraftLine[]>(initialLines.map((line) => ({ description: line.name, quantity: 1,
    unitPrice: (line.priceKurus / 100).toFixed(2), kind: line.kind === "painting" ? "painting" : "production" })));
  const [reason, setReason] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = lines.reduce((sum, line) => sum + parseTryToKurus(line.unitPrice) * line.quantity, 0);
  const updateLine = (index: number, change: Partial<DraftLine>) => setLines((old) => old.map((line, i) => i === index ? { ...line, ...change } : line));
  const act = async (action: DraftAction["action"]) => {
    setNotice(null); setError(null);
    if (reason.trim().length < 3) { setError("En az 3 karakter gerekçe yazın."); return; }
    if (action === "extend" && !Number.isFinite(new Date(deadline).getTime())) { setError("Geçerli bir son tarih seçin."); return; }
    if (action === "cancel" && !confirm("Bu ödenmemiş taslak iptal edilecek. Devam edilsin mi?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/drafts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedUpdatedAt: updatedAt, reason,
          ...(action === "edit" ? { lines } : {}), ...(action === "extend" ? { deadline: new Date(deadline).toISOString() } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "İşlem tamamlanamadı."); return; }
      onSuccess(data.message);
      router.refresh();
    } catch { setError("Sunucuya ulaşılamadı. İşlemi tekrarlamadan önce sayfayı yenileyip sonucu kontrol edin."); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
    <h2 className="font-semibold text-gray-900">Ödeme öncesi düzenleme</h2>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <label className="block text-sm text-gray-700">İşlem gerekçesi
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={field} rows={2} />
    </label>
    <div className="space-y-2">
      <label className="block text-sm text-gray-700">Ödeme bağlantısı<input readOnly value={payUrl} className={field} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={async () => {
          try { await navigator.clipboard.writeText(payUrl); setError(null); setNotice("Ödeme bağlantısı kopyalandı."); }
          catch { setError("Bağlantı kopyalanamadı; yukarıdaki alandan seçip kopyalayabilirsiniz."); }
        }}>Bağlantıyı kopyala</button>
        <button type="button" className={button} disabled={busy || !!permissions.resend} onClick={() => act("resend")}>E-posta ile tekrar gönder</button>
      </div>
      {permissions.resend && <p className="text-sm text-amber-800">{permissions.resend}</p>}
    </div>
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Kalemler ve fiyat</h3>
      {permissions.edit ? <>
        {initialLines.length > 0 && <ul className="space-y-1 text-sm">{initialLines.map((line, index) => <li key={index} className="flex justify-between gap-3"><span>{line.name}</span><span>₺{money(line.priceKurus)}</span></li>)}</ul>}
        <p className="text-sm text-amber-800">{permissions.edit}</p>
      </> : <>
        <p className="text-xs text-gray-500">Mevcut satırlar toplam bedelle açılır. Miktarı değiştirirken birim fiyatı da kontrol edin. Fiyat değişince müşteriye güncel bağlantıyı yeniden gönderin.</p>
        {lines.map((line, index) => <div key={index} className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 sm:grid-cols-5">
          <label className="col-span-2 text-xs text-gray-600">Açıklama<input aria-label={`Kalem ${index + 1} açıklaması`} className={field} value={line.description} maxLength={120} onChange={(e) => updateLine(index, { description: e.target.value })} /></label>
          <label className="text-xs text-gray-600">Tür<select className={field} value={line.kind} onChange={(e) => updateLine(index, { kind: e.target.value as CostLineKind })}>{COST_LINE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="text-xs text-gray-600">Birim fiyat (₺)<input className={field} inputMode="decimal" value={line.unitPrice} onChange={(e) => updateLine(index, { unitPrice: e.target.value })} /></label>
          <label className="text-xs text-gray-600">Miktar<input className={field} type="number" min={1} max={999} value={line.quantity} onChange={(e) => updateLine(index, { quantity: Number(e.target.value) })} /></label>
          <button type="button" className="text-left text-sm text-red-700" disabled={busy || lines.length === 1} onClick={() => setLines((old) => old.filter((_, i) => i !== index))}>Kalemi kaldır</button>
        </div>)}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="text-sm text-indigo-700" disabled={busy || lines.length >= 20} onClick={() => setLines((old) => [...old, { description: "", quantity: 1, unitPrice: "", kind: "production" }])}>+ Kalem ekle</button>
          <span className="text-sm font-semibold">Yeni toplam: {Number.isFinite(total) ? `₺${money(total)}` : "Fiyatları kontrol edin"}</span>
          <button type="button" className={button} disabled={busy} onClick={() => act("edit")}>Kalemleri kaydet</button>
        </div>
      </>}
    </div>
    <div className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-semibold">Ödeme süresini uzat</h3>
      <p className="text-xs text-gray-500">Yeni son tarihte ödeme hâlâ bekliyorsa taslak otomatik sona erer.</p>
      {permissions.extend ? <p className="text-sm text-amber-800">{permissions.extend}</p> : <div className="flex flex-wrap gap-2">
        <input aria-label="Yeni ödeme son tarihi" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <button type="button" className={button} disabled={busy} onClick={() => act("extend")}>Son tarihi uzat</button>
      </div>}
    </div>
    <div className="space-y-2 border-t pt-4">
      <button type="button" className="rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-800 disabled:opacity-40" disabled={busy || !!permissions.cancel} onClick={() => act("cancel")}>Taslağı iptal et</button>
      {permissions.cancel && <p className="text-sm text-amber-800">{permissions.cancel}</p>}
    </div>
  </section>;
}
