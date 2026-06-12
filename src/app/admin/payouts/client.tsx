"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Owed {
  manufacturerId: string;
  companyName: string;
  owed: number;
  count: number;
}
interface Payout {
  id: string;
  companyName: string;
  totalKurus: number;
  earningCount: number;
  status: string;
  reference: string | null;
  createdAt: string;
  paidAt: string | null;
}

const fmt = (k: number) =>
  `₺${(k / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function PayoutsClient({ owed, payouts }: { owed: Owed[]; payouts: Payout[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const createPayout = async (manufacturerId: string) => {
    setBusy(`create-${manufacturerId}`);
    try {
      const res = await fetch(`/api/admin/manufacturers/${manufacturerId}/payout`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Ödeme oluşturulamadı");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const markPaid = async (payoutId: string) => {
    const reference = prompt("Banka referansı (opsiyonel):") ?? "";
    setBusy(`paid-${payoutId}`);
    try {
      const res = await fetch(`/api/admin/payouts/${payoutId}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "İşaretlenemedi");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Ödemeler (Payout)</h1>

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Ödeme bekleyen hak edişler
      </h2>
      {owed.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 mb-8">
          Bekleyen hak ediş yok.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-8">
          {owed.map((o) => (
            <div key={o.manufacturerId} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{o.companyName}</p>
                <p className="text-xs text-gray-500">{o.count} sipariş</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-semibold text-gray-900">{fmt(o.owed)}</span>
                <button
                  onClick={() => createPayout(o.manufacturerId)}
                  disabled={busy === `create-${o.manufacturerId}`}
                  className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:bg-gray-400"
                >
                  {busy === `create-${o.manufacturerId}` ? "…" : "Ödeme oluştur"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Ödeme geçmişi
      </h2>
      {payouts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          Henüz ödeme yok.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {payouts.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-gray-900">{p.companyName}</p>
                <p className="text-xs text-gray-500">
                  {new Date(p.createdAt).toLocaleDateString("tr-TR")} · {p.earningCount} sipariş
                  {p.reference ? ` · ${p.reference}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-gray-900">{fmt(p.totalKurus)}</span>
                {p.status === "paid" ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                    Ödendi
                  </span>
                ) : (
                  <button
                    onClick={() => markPaid(p.id)}
                    disabled={busy === `paid-${p.id}`}
                    className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:bg-gray-400"
                  >
                    {busy === `paid-${p.id}` ? "…" : "Ödendi işaretle"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
