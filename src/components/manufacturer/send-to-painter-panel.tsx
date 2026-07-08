"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface PainterOption {
  id: string;
  companyName: string;
  il: string | null;
  capabilities: string[];
}

// Shown on a manufacturer's order detail when the order carries the
// professional-painting add-on and has passed QC: instead of shipping, the
// manufacturer hands the figurine to a painter, who paints and ships.
export function SendToPainterPanel({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [painters, setPainters] = useState<PainterOption[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/manufacturer/painters")
      .then((r) => (r.ok ? r.json() : { painters: [] }))
      .then((d) => setPainters(d.painters ?? []))
      .catch(() => setPainters([]));
  }, []);

  const send = async () => {
    if (!selected) {
      setError("Bir boyacı seçin");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/manufacturer/orders/${orderId}/send-to-painter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ painterId: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gönderilemedi");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-5">
      <h3 className="text-sm font-semibold text-purple-900 mb-1">
        Profesyonel boyama gerekiyor
      </h3>
      <p className="text-xs text-purple-700/80 mb-3">
        Bu sipariş için müşteri profesyonel boyama seçti. Kargolamak yerine bir
        boyacıya gönderin; boyacı boyayıp müşteriye kargolayacak.
      </p>
      {painters === null ? (
        <p className="text-sm text-gray-400">Boyacılar yükleniyor…</p>
      ) : painters.length === 0 ? (
        <p className="text-sm text-amber-700">
          Şu an uygun (aktif, kabul açık) boyacı yok. Lütfen daha sonra tekrar deneyin.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            <option value="">Boyacı seçin</option>
            {painters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.companyName}
                {p.il ? ` — ${p.il}` : ""}
              </option>
            ))}
          </select>
          <button
            onClick={send}
            disabled={busy || !selected}
            className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {busy ? "Gönderiliyor…" : "Boyacıya gönder"}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
