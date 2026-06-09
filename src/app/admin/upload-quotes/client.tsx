"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModelViewer } from "@/components/model-viewer";

interface QuoteModel {
  id: string;
  fileName: string;
  material: string;
  targetHeightMm: number;
  volumeMm3: number | null;
  isVolume: boolean | null;
  boundingBoxMm: { x: number; y: number; z: number } | null;
  printRisk: string[] | null;
  contactEmail: string | null;
  quoteStatus: string;
  quotedPriceKurus: number | null;
  glbPreviewUrl: string | null;
  createdAt: string;
}

function QuoteCard({ m }: { m: QuoteModel }) {
  const router = useRouter();
  const [price, setPrice] = useState(
    m.quotedPriceKurus ? String(Math.round(m.quotedPriceKurus / 100)) : ""
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(m.quoteStatus === "quoted");

  async function send() {
    const tl = Math.round(Number(price));
    if (!Number.isFinite(tl) || tl < 1) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/upload-quotes/${m.id}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceKurus: tl * 100 }),
      });
      if (res.ok) {
        setDone(true);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-bg-subtle bg-bg-base p-4">
      {m.glbPreviewUrl ? (
        <div className="overflow-hidden rounded-xl">
          <ModelViewer url={m.glbPreviewUrl} previewMode />
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-xl bg-bg-elevated text-sm text-text-muted">
          önizleme yok
        </div>
      )}
      <p className="mt-3 truncate font-medium text-text-primary">{m.fileName}</p>
      <p className="text-xs text-text-muted">{m.contactEmail}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-text-secondary">
        <dt>Malzeme</dt>
        <dd className="text-right">{m.material}</dd>
        <dt>Yükseklik</dt>
        <dd className="text-right">{m.targetHeightMm}mm</dd>
        <dt>Hacim</dt>
        <dd className="text-right">
          {m.volumeMm3 != null ? `${(m.volumeMm3 / 1000).toFixed(1)} cm³` : "—"}
        </dd>
        <dt>Kapalı hacim</dt>
        <dd className="text-right">{m.isVolume ? "evet" : "hayır"}</dd>
        {m.boundingBoxMm && (
          <>
            <dt>Boyut (mm)</dt>
            <dd className="text-right">
              {Math.round(m.boundingBoxMm.x)}×{Math.round(m.boundingBoxMm.y)}×
              {Math.round(m.boundingBoxMm.z)}
            </dd>
          </>
        )}
      </dl>
      {m.printRisk && m.printRisk.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.printRisk.map((r) => (
            <span key={r} className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              {r}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-text-muted">₺</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="Fiyat"
            className="w-full rounded-lg border border-bg-subtle bg-bg-base py-2 pl-6 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>
        <button
          onClick={send}
          disabled={saving || !price}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? "…" : done ? "Güncelle" : "Teklif gönder"}
        </button>
      </div>
      {done && (
        <p className="mt-2 text-xs font-medium text-green-600">
          Teklif gönderildi{m.quotedPriceKurus ? ` · ₺${(m.quotedPriceKurus / 100).toLocaleString("tr-TR")}` : ""}
        </p>
      )}
    </div>
  );
}

export function UploadQuotesClient({ models }: { models: QuoteModel[] }) {
  return (
    <div className="p-4 md:p-6">
      <h1 className="font-serif text-2xl text-text-primary">Yükleme teklifleri</h1>
      <p className="mt-1 text-sm text-text-muted">
        Otomatik fiyatlanamayan yüklenen modeller. Fiyat belirle → müşteriye ödeme bağlantısı gider.
      </p>
      {models.length === 0 ? (
        <p className="mt-10 text-center text-text-muted">Bekleyen teklif yok.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {models.map((m) => (
            <QuoteCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}
