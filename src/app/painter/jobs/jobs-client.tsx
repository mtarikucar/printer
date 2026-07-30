"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/types";
import { sizeDisplayTr } from "@/lib/config/sizes";
import { QC_MIN_PHOTOS } from "@/lib/config/qc";
import { ModelViewer } from "@/components/model-viewer";

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
  /** Colour and other spec the customer/admin agreed on. */
  specRows: { label: string; value: string }[];
  material: string | null;
  commissionRateBps: number;
  /** QC photos already uploaded for the current round (server truth). */
  qcPhotoCount: number;
  qcPhotoUrls: string[];
  glbUrl: string | null;
  customerNote: string | null;
  quantity: number;
  /** The styled image the customer signed off on — the painting reference. */
  approvedImageUrl: string | null;
  photoUrls: string[];
  shippingAddress: {
    adres: string;
    mahalle?: string;
    ilce: string;
    il: string;
    postaKodu: string;
    telefon: string;
  } | null;
}

const STATUS_BADGE: Record<string, string> = {
  assigned: "bg-amber-100 text-amber-700",
  accepted: "bg-blue-100 text-blue-700",
  painting: "bg-indigo-100 text-indigo-700",
  painted: "bg-green-100 text-green-700",
  qc_pending: "bg-purple-100 text-purple-700",
  qc_rejected: "bg-red-100 text-red-700",
  qc_approved: "bg-emerald-100 text-emerald-700",
  shipped: "bg-emerald-100 text-emerald-700",
};
const STATUS_LABEL: Record<string, string> = {
  assigned: "Atandı",
  accepted: "Kabul edildi",
  painting: "Boyanıyor",
  painted: "Boyandı",
  qc_pending: "QC onayında",
  qc_rejected: "QC reddedildi",
  qc_approved: "QC onaylandı",
  shipped: "Kargolandı",
};

const TABS: { value: string | null; label: string }[] = [
  { value: null, label: "Tümü" },
  { value: "assigned", label: "Atandı" },
  { value: "accepted", label: "Kabul edildi" },
  { value: "qc_pending", label: "QC onayında" },
  { value: "qc_rejected", label: "QC reddedildi" },
  { value: "qc_approved", label: "QC onaylandı" },
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
  const [qcUploaded, setQcUploaded] = useState<Record<string, number>>(() =>
    Object.fromEntries(jobs.map((j) => [j.id, j.qcPhotoCount]))
  );

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

  const uploadQcPhoto = async (id: string, file: File) => {
    setBusy(`qc-upload-${id}`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/painter/orders/${id}/qc-photos`, { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Fotoğraf yüklenemedi");
        return;
      }
      setQcUploaded((s) => ({ ...s, [id]: (s[id] ?? 0) + 1 }));
    } finally {
      setBusy(null);
    }
  };

  const submitQc = (id: string) => {
    if ((qcUploaded[id] ?? 0) < QC_MIN_PHOTOS) {
      alert(
        `Önce en az ${QC_MIN_PHOTOS} QC fotoğrafı yükleyin: genel ön, arka/yan, ` +
          `yüz veya en detaylı bölgenin yakın çekimi ve kaide/taban.`
      );
      return;
    }
    call(id, "submit-qc");
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
                <span className="text-right text-sm font-semibold text-gray-800">
                  {(() => {
                    // Gross was shown as if it were the payout; commission is
                    // deducted at accrual.
                    const commission = Math.round(
                      (j.paintingPriceKurus * j.commissionRateBps) / 10000
                    );
                    const net = j.paintingPriceKurus - commission;
                    return (
                      <>
                        ₺{(net / 100).toLocaleString("tr-TR")}
                        <span className="block text-[11px] font-normal text-gray-400">
                          brüt ₺{(j.paintingPriceKurus / 100).toLocaleString("tr-TR")} ·
                          komisyon %{j.commissionRateBps / 100}
                        </span>
                      </>
                    );
                  })()}
                </span>
              </div>
              <div className="text-sm text-gray-700 mb-1">
                {j.productTitleSnapshot || j.style || "Özel figür"}
                {j.figurineSize &&
                  ` · ${sizeDisplayTr(j.figurineSize, { short: true })}`}
                {j.material && ` · ${j.material === "filament" ? "Filament" : "Reçine"}`}
              </div>
              {/* Finish decides what actually has to be in the box. */}
              <div className="mb-1 text-xs text-gray-600">
                {j.finish === "luxe_display"
                  ? "Lüks Vitrin — tam el boyaması + premium kaide, isim plakası ve sert kutu"
                  : j.finish === "hand_painted"
                    ? "El Boyaması — tam el boyaması + QC fotoğrafı + hediye kutusu"
                    : j.finish || ""}
              </div>
              {j.modifiers && j.modifiers.length > 0 && (
                <div className="mb-1 text-xs text-gray-600">
                  Stil düzenleyici:{" "}
                  {j.modifiers
                    .map((m) => (m === "pixel_art" ? "Piksel Art — düz bloklu renkler, sınırlı palet" : m))
                    .join(", ")}
                </div>
              )}
              {j.customerName && (
                <div className="text-xs text-gray-500 mb-3">Müşteri: {j.customerName}</div>
              )}

              {/* The brief. Without these the painter was guessing the colours
                  and could not post the parcel. */}
              {(j.approvedImageUrl || j.photoUrls.length > 0) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {j.approvedImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={j.approvedImageUrl}
                      alt="Onaylı görsel"
                      className="h-28 w-28 rounded-lg border-2 border-green-300 object-cover"
                      title="Müşterinin onayladığı görsel"
                    />
                  )}
                  {j.photoUrls.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={u}
                      alt="Müşteri fotoğrafı"
                      className="h-28 w-28 rounded-lg border border-gray-200 object-cover"
                      title="Müşteri fotoğrafı"
                    />
                  ))}
                </div>
              )}

              {j.glbUrl && (
                <details className="mb-3 rounded-lg border border-gray-200 p-2">
                  <summary className="cursor-pointer text-xs font-medium text-gray-600">
                    3D modeli aç (tüm açılar)
                  </summary>
                  <div className="mt-2">
                    <ModelViewer url={j.glbUrl} className="h-64 w-full rounded-lg" />
                  </div>
                </details>
              )}

              {(j.specRows.length > 0 || j.quantity > 1) && (
                <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-gray-50 p-3 sm:grid-cols-3">
                  {j.specRows.map((row, i) => (
                    <div key={i}>
                      <dt className="text-[11px] text-gray-400">{row.label}</dt>
                      <dd className="text-xs font-medium text-gray-900">{row.value}</dd>
                    </div>
                  ))}
                  {j.quantity > 1 && (
                    <div>
                      <dt className="text-[11px] text-gray-400">Adet</dt>
                      <dd className="text-xs font-medium text-gray-900">{j.quantity}</dd>
                    </div>
                  )}
                </dl>
              )}

              {j.customerNote && (
                <p className="mb-3 whitespace-pre-line rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <span className="font-semibold">Müşteri notu: </span>
                  {j.customerNote}
                </p>
              )}

              {/* The painter ships to the customer directly, so they need the
                  address — it was never sent to this panel. */}
              {j.shippingAddress &&
                ["accepted", "painting", "painted", "qc_approved"].includes(
                  j.painterStatus ?? ""
                ) && (
                  <div className="mb-3 rounded-lg border border-gray-200 p-3 text-xs text-gray-700">
                    <p className="mb-1 font-semibold text-gray-500">Teslimat adresi</p>
                    <p>{j.shippingAddress.adres}</p>
                    {j.shippingAddress.mahalle && <p>{j.shippingAddress.mahalle}</p>}
                    <p>
                      {j.shippingAddress.ilce} / {j.shippingAddress.il}{" "}
                      {j.shippingAddress.postaKodu}
                    </p>
                    <p className="mt-1">Tel: {j.shippingAddress.telefon}</p>
                  </div>
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
                {/* Paint done → submit QC photos for admin review. Also the
                    re-submit path after a QC rejection. */}
                {["accepted", "painting", "painted", "qc_rejected"].includes(
                  j.painterStatus ?? ""
                ) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {j.painterStatus === "qc_rejected" && (
                      <span className="w-full text-xs text-red-600">
                        QC reddedildi — düzeltip yeni fotoğraflarla tekrar gönderin.
                      </span>
                    )}
                    <label className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg cursor-pointer hover:bg-gray-200">
                      QC fotoğrafı ekle
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={busy !== null}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadQcPhoto(j.id, f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {j.qcPhotoUrls.length > 0 && (
                      <span className="flex gap-1">
                        {j.qcPhotoUrls.slice(0, 4).map((u) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={u}
                            src={u}
                            alt="QC"
                            className="h-10 w-10 rounded border border-gray-200 object-cover"
                          />
                        ))}
                      </span>
                    )}
                    {(qcUploaded[j.id] ?? 0) > 0 && (
                      <span className="text-xs text-green-600">
                        {qcUploaded[j.id]} fotoğraf eklendi
                      </span>
                    )}
                    <button
                      onClick={() => submitQc(j.id)}
                      disabled={
                        busy !== null || (qcUploaded[j.id] ?? 0) < QC_MIN_PHOTOS
                      }
                      className="px-4 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50"
                    >
                      QC&apos;ye gönder
                    </button>
                  </div>
                )}
                {j.painterStatus === "qc_pending" && (
                  <span className="text-sm text-purple-700">
                    QC onayında — admin incelemesi bekleniyor.
                  </span>
                )}
                {j.painterStatus === "qc_approved" && (
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
