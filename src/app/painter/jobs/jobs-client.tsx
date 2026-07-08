"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/types";

interface Job {
  id: string;
  orderNumber: string;
  orderType: string;
  productTitleSnapshot: string | null;
  customerName: string | null;
  figurineSize: string | null;
  style: string | null;
  finish: string | null;
  modifiers: string[] | null;
  painterStatus: string | null;
  paintingPriceKurus: number;
  assignedAt: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  assigned: "bg-amber-100 text-amber-700",
  accepted: "bg-blue-100 text-blue-700",
  painting: "bg-indigo-100 text-indigo-700",
  painted: "bg-green-100 text-green-700",
  shipped: "bg-emerald-100 text-emerald-700",
};
const STATUS_LABEL: Record<string, string> = {
  assigned: "Atandı",
  accepted: "Kabul edildi",
  painting: "Boyanıyor",
  painted: "Boyandı",
  shipped: "Kargolandı",
};

const TABS: { value: string | null; label: string }[] = [
  { value: null, label: "Tümü" },
  { value: "assigned", label: "Atandı" },
  { value: "accepted", label: "Kabul edildi" },
  { value: "painting", label: "Boyanıyor" },
  { value: "painted", label: "Boyandı" },
  { value: "shipped", label: "Kargolandı" },
];

const CARRIERS: { value: string; label: string }[] = [
  { value: "yurtici", label: "Yurtiçi Kargo" },
  { value: "aras", label: "Aras Kargo" },
  { value: "mng", label: "MNG Kargo" },
  { value: "ptt", label: "PTT Kargo" },
  { value: "surat", label: "Sürat Kargo" },
  { value: "other", label: "Diğer" },
];

export function PainterJobsClient({
  jobs,
  total,
  page,
  pageSize,
  filterStatus,
}: {
  jobs: Job[];
  total: number;
  page: number;
  pageSize: number;
  filterStatus: string | null;
  locale: Locale;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState<Record<string, string>>({});

  const call = async (id: string, action: string, payload?: Record<string, unknown>) => {
    setBusy(`${action}-${id}`);
    try {
      const res = await fetch(`/api/painter/orders/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
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

  const decline = (id: string) => {
    const reason = prompt("Reddetme sebebi (opsiyonel):") ?? undefined;
    call(id, "decline", { reason });
  };

  const ship = (id: string) => {
    const t = (tracking[id] ?? "").trim();
    if (!t) {
      alert("Takip numarası girin");
      return;
    }
    call(id, "ship", { trackingNumber: t, carrier: carrier[id] || undefined });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Boyama İşleri</h1>
        <p className="text-sm text-gray-500 mt-1">
          Size atanan profesyonel boyama işleri.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map((t) => {
          const active = (t.value ?? null) === (filterStatus ?? null);
          const href = t.value ? `/painter/jobs?status=${t.value}` : "/painter/jobs";
          return (
            <Link
              key={t.label}
              href={href}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 text-white"
                  : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          Bu durumda iş yok.
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-indigo-600">{j.orderNumber}</span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      STATUS_BADGE[j.painterStatus ?? ""] || "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {STATUS_LABEL[j.painterStatus ?? ""] || j.painterStatus}
                  </span>
                </div>
                <span className="text-sm font-semibold text-gray-800">
                  ₺{(j.paintingPriceKurus / 100).toLocaleString("tr-TR")}
                </span>
              </div>
              <div className="text-sm text-gray-700 mb-1">
                {j.productTitleSnapshot || j.style || "Özel figür"}
                {j.figurineSize && ` · ${j.figurineSize}`}
                {j.finish && ` · ${j.finish}`}
              </div>
              {j.customerName && (
                <div className="text-xs text-gray-500 mb-3">Müşteri: {j.customerName}</div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {j.painterStatus === "assigned" && (
                  <>
                    <button
                      onClick={() => call(j.id, "accept")}
                      disabled={busy !== null}
                      className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      Kabul et
                    </button>
                    <button
                      onClick={() => decline(j.id)}
                      disabled={busy !== null}
                      className="px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                      Reddet
                    </button>
                  </>
                )}
                {(j.painterStatus === "accepted" || j.painterStatus === "painting") && (
                  <button
                    onClick={() => call(j.id, "painted")}
                    disabled={busy !== null}
                    className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    Boyandı olarak işaretle
                  </button>
                )}
                {j.painterStatus === "painted" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={tracking[j.id] ?? ""}
                      onChange={(e) => setTracking((s) => ({ ...s, [j.id]: e.target.value }))}
                      placeholder="Takip no"
                      className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                    />
                    <select
                      value={carrier[j.id] ?? ""}
                      onChange={(e) => setCarrier((s) => ({ ...s, [j.id]: e.target.value }))}
                      className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                    >
                      <option value="">Kargo firması</option>
                      {CARRIERS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => ship(j.id)}
                      disabled={busy !== null}
                      className="px-4 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Kargola
                    </button>
                  </div>
                )}
                {j.painterStatus === "shipped" && (
                  <span className="text-sm text-gray-400">Tamamlandı</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <Link
              href={`/painter/jobs?${filterStatus ? `status=${filterStatus}&` : ""}page=${page - 1}`}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
            >
              Önceki
            </Link>
          )}
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/painter/jobs?${filterStatus ? `status=${filterStatus}&` : ""}page=${page + 1}`}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
            >
              Sonraki
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
