"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Doc {
  id: string;
  type: string;
  company: string;
  url: string;
  createdAt: string;
}
interface IbanChange {
  id: string;
  company: string;
  current: string | null;
  pending: string | null;
}

export function KycQueueClient({
  docs,
  ibanChanges,
}: {
  docs: Doc[];
  ibanChanges: IbanChange[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const reviewDoc = async (docId: string, action: "approve" | "reject") => {
    const note = action === "reject" ? prompt("Ret gerekçesi (opsiyonel):") ?? "" : "";
    setBusy(`doc-${docId}`);
    try {
      const res = await fetch(`/api/admin/documents/${docId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) alert("İşlem başarısız");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const reviewIban = async (id: string, action: "approve" | "reject") => {
    setBusy(`iban-${id}`);
    try {
      const res = await fetch(`/api/admin/manufacturers/${id}/iban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) alert("İşlem başarısız");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">KYC & Belge Kuyruğu</h1>

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Bekleyen belgeler
      </h2>
      {docs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 mb-8">
          Bekleyen belge yok.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-8">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-gray-900">{doc.company}</p>
                <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">
                  {doc.type} — belgeyi aç
                </a>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => reviewDoc(doc.id, "approve")}
                  disabled={busy === `doc-${doc.id}`}
                  className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                >
                  Onayla
                </button>
                <button
                  onClick={() => reviewDoc(doc.id, "reject")}
                  disabled={busy === `doc-${doc.id}`}
                  className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400"
                >
                  Reddet
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Bekleyen IBAN değişiklikleri
      </h2>
      {ibanChanges.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          Bekleyen IBAN değişikliği yok.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {ibanChanges.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-gray-900">{c.company}</p>
                <p className="text-xs text-gray-500 font-mono">
                  {c.current ?? "—"} → <span className="text-gray-900">{c.pending}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => reviewIban(c.id, "approve")}
                  disabled={busy === `iban-${c.id}`}
                  className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                >
                  Onayla
                </button>
                <button
                  onClick={() => reviewIban(c.id, "reject")}
                  disabled={busy === `iban-${c.id}`}
                  className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400"
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
