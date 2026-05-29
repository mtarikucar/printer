"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Dispute {
  id: string;
  orderNumber: string;
  category: string;
  description: string;
  createdAt: string;
}

export function DisputesClient({ disputes }: { disputes: Dispute[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [clawback, setClawback] = useState<Record<string, boolean>>({});

  const resolve = async (id: string, action: "resolve" | "reject") => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/disputes/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          resolution: resolution[id] ?? "",
          clawback: !!clawback[id],
        }),
      });
      if (!res.ok) alert("İşlem başarısız");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Anlaşmazlıklar</h1>
      {disputes.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          Açık anlaşmazlık yok.
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map((dp) => (
            <div key={dp.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-sm text-indigo-600">{dp.orderNumber}</span>
                <span className="text-xs text-gray-400">
                  {new Date(dp.createdAt).toLocaleDateString("tr-TR")}
                </span>
              </div>
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">{dp.category}</p>
              <p className="text-sm text-gray-800 mb-3">{dp.description}</p>
              <textarea
                value={resolution[dp.id] ?? ""}
                onChange={(e) =>
                  setResolution((s) => ({ ...s, [dp.id]: e.target.value }))
                }
                rows={2}
                placeholder="Çözüm notu (opsiyonel)"
                className="w-full text-sm border border-gray-200 rounded-lg p-2 mb-2"
              />
              <label className="flex items-center gap-2 text-sm text-gray-700 mb-3">
                <input
                  type="checkbox"
                  checked={!!clawback[dp.id]}
                  onChange={(e) =>
                    setClawback((s) => ({ ...s, [dp.id]: e.target.checked }))
                  }
                  className="h-4 w-4 rounded"
                />
                Üretici hak edişini geri al + strike uygula (clawback)
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => resolve(dp.id, "resolve")}
                  disabled={busy === dp.id}
                  className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                >
                  Çöz (müşteri lehine)
                </button>
                <button
                  onClick={() => resolve(dp.id, "reject")}
                  disabled={busy === dp.id}
                  className="px-4 py-1.5 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 disabled:opacity-50"
                >
                  Reddet
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
