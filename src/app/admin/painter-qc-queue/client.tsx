"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface QcPhoto {
  id: string;
  url: string;
  fullUrl: string;
}
interface QcJob {
  id: string;
  orderNumber: string;
  painterName: string;
  customerName: string | null;
  style: string | null;
  figurineSize: string | null;
  finish: string | null;
  paintingPriceKurus: number;
  photos: QcPhoto[];
}

export function PainterQcQueueClient({ jobs }: { jobs: QcJob[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  const act = async (id: string, action: "approve" | "reject") => {
    if (action === "reject" && !(reason[id] ?? "").trim()) {
      alert("Red gerekçesi girin");
      return;
    }
    setBusy(`${action}-${id}`);
    try {
      const res = await fetch(`/api/admin/painter-qc/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason: reason[id] } : {}),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "İşlem başarısız");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Boyacı QC Kuyruğu</h1>
        <p className="text-sm text-gray-500 mt-1">
          Boyacıların gönderdiği boyama işlerini inceleyin; onaylamadan kargolanamazlar.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          QC onayı bekleyen boyama işi yok.
        </div>
      ) : (
        <div className="space-y-5">
          {jobs.map((j) => (
            <div key={j.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <span className="font-mono text-sm text-indigo-600">{j.orderNumber}</span>
                  <span className="text-sm text-gray-700 ml-3">
                    {j.style || "Özel figür"}
                    {j.figurineSize && ` · ${j.figurineSize}`}
                    {j.finish && ` · ${j.finish}`}
                  </span>
                </div>
                <span className="text-xs text-gray-500">Boyacı: {j.painterName}</span>
              </div>

              {j.photos.length === 0 ? (
                <p className="text-sm text-amber-600 mb-3">Fotoğraf bulunamadı.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mb-4">
                  {j.photos.map((p) => (
                    <a key={p.id} href={p.fullUrl} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.url}
                        alt="QC"
                        className="w-28 h-28 object-cover rounded-lg border border-gray-200"
                      />
                    </a>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => act(j.id, "approve")}
                  disabled={busy !== null}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  Onayla
                </button>
                <input
                  value={reason[j.id] ?? ""}
                  onChange={(e) => setReason((s) => ({ ...s, [j.id]: e.target.value }))}
                  placeholder="Red gerekçesi"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1 min-w-[180px]"
                />
                <button
                  onClick={() => act(j.id, "reject")}
                  disabled={busy !== null}
                  className="px-4 py-2 bg-red-50 text-red-700 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50"
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
