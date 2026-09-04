"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  workshopStatusMeta,
  venueTypeLabel,
  ageGroupLabel,
  workshopTypeLabel,
} from "@/lib/workshop/constants";

interface DetailData {
  id: string;
  venueId: string | null;
  reference: string;
  status: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  organizationName: string | null;
  venueType: string;
  city: string;
  district: string;
  addressLine: string;
  participantCount: number;
  ageGroup: string;
  workshopType: string;
  preferredDate: string | null;
  alternativeDate: string | null;
  budgetRange: string | null;
  message: string | null;
  howHeard: string | null;
  adminNotes: string | null;
  rejectionReason: string | null;
  quotedPriceKurus: number | null;
  scheduledAt: string | null;
  adminEmail: string | null;
  accountEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-3 py-1.5 border-b border-gray-50 last:border-0">
      <div className="w-40 shrink-0 text-xs text-gray-500">{label}</div>
      <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">
        {value}
      </div>
    </div>
  );
}

export function WorkshopRequestDetailClient({ data }: { data: DetailData }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState(data.adminNotes ?? "");
  const [rejectionReason, setRejectionReason] = useState(
    data.rejectionReason ?? ""
  );
  const [priceTl, setPriceTl] = useState(
    data.quotedPriceKurus != null ? String(data.quotedPriceKurus / 100) : ""
  );
  const [scheduledDate, setScheduledDate] = useState(
    data.scheduledAt ? data.scheduledAt.slice(0, 10) : ""
  );

  // Talep → mekan dönüşümü. Başvuru formu mahalle ve posta kodu toplamıyor;
  // sipariş adresi /^\d{5}$/ şartı koyduğundan admin bu iki alanı burada
  // tamamlar (bkz. IMPLEMENTER-CONTEXT: "posta kodu gap'i").
  const [convertOpen, setConvertOpen] = useState(false);
  const [venueName, setVenueName] = useState(
    data.organizationName || data.contactName
  );
  const [mahalle, setMahalle] = useState("");
  const [postaKodu, setPostaKodu] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  const meta = workshopStatusMeta(data.status);

  const priceKurus = () => {
    if (priceTl.trim() === "") return null;
    const n = Number(priceTl.replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };

  const call = async (
    action: string,
    payload: Record<string, unknown>
  ): Promise<void> => {
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/workshop-requests/${data.id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  const commonFields = () => ({
    adminNotes,
    quotedPriceKurus: priceKurus(),
    scheduledAt: scheduledDate || null,
  });

  const scheduleReq = () => {
    if (!scheduledDate) {
      if (!confirm("Tarih girmeden planlamak istediğinize emin misiniz?")) return;
    }
    call("scheduled", { status: "scheduled", ...commonFields() });
  };

  const reject = () => {
    call("rejected", {
      status: "rejected",
      rejectionReason,
      ...commonFields(),
    });
  };

  const convert = async () => {
    setConvertError(null);
    setConverting(true);
    try {
      const res = await fetch(
        `/api/admin/workshop-requests/${data.id}/convert-to-venue`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: venueName,
            contactName: data.contactName,
            contactEmail: data.contactEmail,
            contactPhone: data.contactPhone,
            address: {
              adres: data.addressLine,
              mahalle,
              ilce: data.district,
              il: data.city,
              postaKodu,
              telefon: data.contactPhone,
            },
          }),
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConvertError(payload.error || "Mekana dönüştürülemedi.");
        return;
      }
      // Panel kabuğunda dönüşüm sonrası bir mekan gösterge sayfasına geçiliyor;
      // TAM navigasyon gerekir, router.push değil (panel-shell responsive notu).
      window.location.href = `/admin/workshops/${payload.venueId}`;
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <Link
        href="/admin/workshop-requests"
        className="text-sm text-gray-500 hover:text-gray-800"
      >
        ← Atölye talepleri
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{data.contactName}</h1>
        <span className="font-mono text-sm text-indigo-600">
          {data.reference}
        </span>
        <span
          className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}
        >
          {meta.label}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Details */}
        <div className="space-y-6">
          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              İletişim
            </h2>
            <Row label="Ad soyad" value={data.contactName} />
            <Row label="E-posta" value={data.contactEmail} />
            <Row label="Telefon" value={data.contactPhone} />
            <Row label="Kurum / İşletme" value={data.organizationName} />
            <Row
              label="Üyelik e-postası"
              value={data.accountEmail ?? "— (misafir)"}
            />
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Mekân</h2>
            <Row label="Mekân türü" value={venueTypeLabel(data.venueType)} />
            <Row label="İl / İlçe" value={`${data.city} / ${data.district}`} />
            <Row label="Açık adres" value={data.addressLine} />
          </section>

          <section className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Etkinlik</h2>
            <Row label="Katılımcı sayısı" value={data.participantCount} />
            <Row label="Yaş grubu" value={ageGroupLabel(data.ageGroup)} />
            <Row label="Etkinlik türü" value={workshopTypeLabel(data.workshopType)} />
            <Row label="Tercih edilen tarih" value={data.preferredDate} />
            <Row label="Alternatif tarih" value={data.alternativeDate} />
            <Row label="Bütçe" value={data.budgetRange} />
            <Row label="Mesaj" value={data.message} />
            <Row label="Nereden duydu" value={data.howHeard} />
          </section>

          <p className="text-xs text-gray-400">
            Oluşturuldu: {new Date(data.createdAt).toLocaleString("tr-TR")}
            {data.adminEmail && ` · Son işlem: ${data.adminEmail}`}
          </p>
        </div>

        {/* Action panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 lg:sticky lg:top-6">
            <h2 className="text-sm font-semibold text-gray-700">Yönetim</h2>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Planlanan tarih
              </label>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Teklif tutarı (₺)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={priceTl}
                onChange={(e) => setPriceTl(e.target.value)}
                placeholder="örn. 7500"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                İç not (müşteriye gitmez)
              </label>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            <button
              onClick={() => call("save", commonFields())}
              disabled={busy !== null}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              {busy === "save" ? "Kaydediliyor…" : "Not / teklifi kaydet"}
            </button>

            <div className="border-t border-gray-100 pt-4 space-y-2">
              <p className="text-xs font-medium text-gray-500">Durum</p>
              {data.status !== "reviewing" && (
                <button
                  onClick={() => call("reviewing", { status: "reviewing", ...commonFields() })}
                  disabled={busy !== null}
                  className="w-full px-4 py-2 bg-blue-50 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-100 disabled:opacity-50"
                >
                  İncelemeye al
                </button>
              )}
              <button
                onClick={scheduleReq}
                disabled={busy !== null}
                className="w-full px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                Planla (müşteriye e-posta)
              </button>
              <button
                onClick={() => call("completed", { status: "completed", ...commonFields() })}
                disabled={busy !== null}
                className="w-full px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                Tamamlandı olarak işaretle
              </button>
              {!data.venueId && (
                <button
                  type="button"
                  onClick={() => setConvertOpen(true)}
                  disabled={busy !== null}
                  className="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  Mekana dönüştür
                </button>
              )}
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Red gerekçesi (müşteriye gider)
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={2}
                placeholder="Opsiyonel"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
              <button
                onClick={reject}
                disabled={busy !== null}
                className="w-full px-4 py-2 bg-red-50 text-red-700 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                Reddet (müşteriye e-posta)
              </button>
              <button
                onClick={() => call("cancelled", { status: "cancelled", ...commonFields() })}
                disabled={busy !== null}
                className="w-full px-4 py-2 bg-gray-50 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-100 disabled:opacity-50"
              >
                İptal et
              </button>
            </div>
          </div>
        </div>
      </div>

      {convertOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-900">
              Mekana dönüştür
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Seans siparişleri bu adrese gönderilir. İl / ilçe / açık adres
              başvurudan gelir; mahalle ve posta kodu başvuruda toplanmadığı
              için burada tamamlanmalı.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Mekan adı
                </label>
                <input
                  type="text"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Mahalle
                </label>
                <input
                  type="text"
                  value={mahalle}
                  onChange={(e) => setMahalle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Posta kodu
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  value={postaKodu}
                  onChange={(e) => setPostaKodu(e.target.value)}
                  placeholder="örn. 34000"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <Row label="İl / İlçe" value={`${data.city} / ${data.district}`} />
              <Row label="Açık adres" value={data.addressLine} />
            </div>

            {convertError && (
              <p className="mt-3 text-sm text-red-600">{convertError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConvertOpen(false)}
                disabled={converting}
                className="px-4 py-2 bg-gray-50 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-100 disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={convert}
                disabled={converting}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {converting ? "Dönüştürülüyor…" : "Mekana dönüştür"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
