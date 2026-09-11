"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import {
  PartnerApplicationDetails,
  BoolChip,
} from "@/components/admin/partner-application-details";

interface TurkishAddress {
  adres: string;
  mahalle?: string;
  ilce: string;
  il: string;
  postaKodu: string;
  telefon: string;
}

interface Painter {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  taxId: string | null;
  taxIdType: "vkn" | "tckn" | null;
  requiresManualTaxReview: boolean;
  status: string;
  activeOrders: number;
  createdAt: string;
  rejectionReason: string | null;
  workSamplePhotoUploadedAt: string | null;
  workSamplePhotoUrl: string | null;
  whatsappPhone: string | null;
  address: TurkishAddress | null;
  iban: string | null;
  bankAccountHolder: string | null;
  bankName: string | null;
  maxConcurrentOrders: number;
  acceptingOrders: boolean;
  capabilities: string[];
  mapVisible: boolean;
  onboardingAcceptedAt: string | null;
  strikeCount: number;
  notes: string | null;
}

// Painting-technique capability tags chosen at registration → readable labels
// (keys mirror the painter register form).
const TECHNIQUE_LABELS: Record<string, string> = {
  hand: "El fırçası",
  airbrush: "Havalı fırça (Airbrush)",
  detail: "İnce detay",
  priming: "Astarlama",
  sealing: "Vernik / Koruma",
};

const STATUS_BADGE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-700",
  active: "bg-green-100 text-green-700",
  suspended: "bg-red-100 text-red-700",
  conditionally_approved: "bg-blue-100 text-blue-700",
  rejected: "bg-gray-200 text-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Beklemede",
  active: "Aktif",
  suspended: "Askıya Alınmış",
  conditionally_approved: "Koşullu onaylı",
  rejected: "Reddedildi",
};

type FilterTab =
  | "all"
  | "pending_approval"
  | "conditionally_approved"
  | "rejected"
  | "manual_review"
  | "active"
  | "suspended";

function matchesFilter(p: Painter, filter: FilterTab): boolean {
  if (filter === "all") return true;
  if (filter === "manual_review") {
    return p.requiresManualTaxReview && p.status !== "suspended";
  }
  return p.status === filter;
}

export function PaintersClient({
  painters,
  locale,
}: {
  painters: Painter[];
  locale: string;
}) {
  const loc = locale as Locale;
  const router = useRouter();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [loading, setLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = painters.filter((p) => matchesFilter(p, filter));

  const performAction = async (
    id: string,
    action:
      | "activate"
      | "suspend"
      | "conditionally-approve"
      | "approve"
      | "reject"
  ) => {
    let body: string | undefined;
    if (action === "reject") {
      const input = window.prompt(
        "Reddetme sebebi (opsiyonel, boyacıya e-posta ile iletilir):"
      );
      const reason = input && input.trim() ? input.trim() : undefined;
      body = JSON.stringify({ reason });
    }
    setLoading(`${action}-${id}`);
    try {
      const res = await fetch(`/api/admin/painters/${id}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `${action} başarısız`);
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  // Closing a tax review must say what was checked: the server refuses it
  // without a note and appends who/when/what to the painter's admin notes.
  // Same flow as the manufacturer list.
  const closeTaxReview = async (p: Painter) => {
    const input = window.prompt(
      `${p.companyName}: vergi incelemesini kapat.\nNeyi kontrol ettiniz? (ör. "Vergi levhası görüldü, VKN doğrulandı")`
    );
    if (input === null) return;
    const note = input.trim();
    if (note.length < 3) {
      alert("Neyi kontrol ettiğinizi kısaca yazın (en az 3 karakter).");
      return;
    }
    setLoading(`tax-review-${p.id}`);
    try {
      const res = await fetch(`/api/admin/painters/${p.id}/tax-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Vergi incelemesi kapatılamadı");
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "Tümü" },
    { key: "pending_approval", label: "Onay Bekleyen" },
    { key: "conditionally_approved", label: "Koşullu" },
    { key: "rejected", label: "Reddedildi" },
    { key: "manual_review", label: "Manuel İnceleme" },
    { key: "active", label: "Aktif" },
    { key: "suspended", label: "Askıya Alınmış" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Boyacılar</h1>
      <p className="text-gray-500 mt-1">Boyama ortaklarını yönetin</p>

      {/* Filter tabs */}
      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const count = painters.filter((p) =>
            matchesFilter(p, tab.key)
          ).length;
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === tab.key
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="mt-8 text-center py-12 text-gray-500">
          <p className="text-lg">Boyacı bulunamadı</p>
        </div>
      ) : (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  Şirket Adı
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  İletişim
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  E-posta
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  Durum
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  Vergi No
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  Aktif İşler
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  Kayıt Tarihi
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <Fragment key={p.id}>
                <tr className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {p.companyName}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {p.contactPerson}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[p.status] || "bg-gray-100 text-gray-700"}`}
                    >
                      {STATUS_LABEL[p.status] || p.status}
                    </span>
                    {p.status === "rejected" && p.rejectionReason ? (
                      <p
                        className="mt-1 text-xs text-gray-500 max-w-[200px] truncate"
                        title={p.rejectionReason}
                      >
                        {p.rejectionReason}
                      </p>
                    ) : null}
                    {p.status === "conditionally_approved" ? (
                      p.workSamplePhotoUploadedAt ? (
                        <p className="mt-1 text-xs text-green-600">
                          Örnek çalışma yüklendi ·{" "}
                          {formatDate(p.workSamplePhotoUploadedAt, loc)}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-amber-600">
                          Örnek çalışma bekleniyor
                        </p>
                      )
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {p.taxId && p.taxIdType ? (
                      <span className="font-mono text-gray-700">
                        {p.taxIdType.toUpperCase()}: {p.taxId}
                      </span>
                    ) : !p.requiresManualTaxReview ? (
                      <span className="text-xs text-gray-400">Beyan edilmedi</span>
                    ) : null}
                    {/* The badge follows the flag, not the missing tax id: the
                        flag is what the "Manuel İnceleme" tab filters on, and
                        an admin can now close it. */}
                    {p.requiresManualTaxReview && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          Vergi levhası yok
                        </span>
                        {p.status !== "rejected" && (
                          <button
                            onClick={() => void closeTaxReview(p)}
                            disabled={loading === `tax-review-${p.id}`}
                            className="text-xs font-medium text-indigo-600 hover:underline disabled:text-gray-400"
                          >
                            {loading === `tax-review-${p.id}` ? "Kapatılıyor…" : "İncelemeyi kapat"}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-center">
                    {p.activeOrders}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(p.createdAt, loc)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end items-center">
                      <button
                        onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          expandedId === p.id
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {expandedId === p.id ? "Kapat" : "Detay"}
                      </button>
                      {p.status === "pending_approval" && (
                        <>
                          <button
                            onClick={() =>
                              performAction(p.id, "conditionally-approve")
                            }
                            disabled={
                              loading === `conditionally-approve-${p.id}`
                            }
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                          >
                            Koşullu onayla
                          </button>
                          <button
                            onClick={() => performAction(p.id, "reject")}
                            disabled={loading === `reject-${p.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors"
                          >
                            Reddet
                          </button>
                        </>
                      )}
                      {p.status === "conditionally_approved" && (
                        <>
                          {p.workSamplePhotoUrl ? (
                            <a
                              href={p.workSamplePhotoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
                            >
                              Örneği gör
                            </a>
                          ) : p.workSamplePhotoUploadedAt ? (
                            <span className="text-xs text-green-600">
                              Örnek yüklendi
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">
                              Örnek bekleniyor
                            </span>
                          )}
                          <button
                            onClick={() => performAction(p.id, "approve")}
                            disabled={
                              !p.workSamplePhotoUploadedAt ||
                              loading === `approve-${p.id}`
                            }
                            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                          >
                            Onayla
                          </button>
                          <button
                            onClick={() => performAction(p.id, "reject")}
                            disabled={loading === `reject-${p.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors"
                          >
                            Reddet
                          </button>
                        </>
                      )}
                      {p.status === "suspended" && (
                        <button
                          onClick={() => performAction(p.id, "activate")}
                          disabled={loading === `activate-${p.id}`}
                          className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `activate-${p.id}`
                            ? "Aktifleştiriliyor..."
                            : "Aktifleştir"}
                        </button>
                      )}
                      {p.status === "active" && (
                        <button
                          onClick={() => performAction(p.id, "suspend")}
                          disabled={loading === `suspend-${p.id}`}
                          className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `suspend-${p.id}`
                            ? "Askıya alınıyor..."
                            : "Askıya Al"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedId === p.id && (
                  <tr className="bg-gray-50/60">
                    <td colSpan={8} className="px-4 py-4">
                      <PartnerApplicationDetails
                        sections={[
                          {
                            title: "İletişim",
                            items: [
                              { k: "Telefon", v: p.phone },
                              { k: "WhatsApp", v: p.whatsappPhone },
                              { k: "E-posta", v: p.email },
                            ],
                          },
                          {
                            title: "Adres",
                            items: p.address
                              ? [
                                  { k: "İl / İlçe", v: `${p.address.il} / ${p.address.ilce}` },
                                  { k: "Mahalle", v: p.address.mahalle || null },
                                  { k: "Açık adres", v: p.address.adres },
                                  { k: "Posta kodu", v: p.address.postaKodu },
                                ]
                              : [{ k: "Adres", v: null }],
                          },
                          {
                            title: "Banka / Ödeme",
                            items: [
                              { k: "IBAN", v: p.iban ? <span className="font-mono text-xs">{p.iban}</span> : null },
                              { k: "Hesap sahibi", v: p.bankAccountHolder },
                              { k: "Banka", v: p.bankName },
                              {
                                k: "Vergi",
                                v: p.taxId && p.taxIdType ? `${p.taxIdType.toUpperCase()}: ${p.taxId}` : "Beyan edilmedi",
                              },
                            ],
                          },
                          {
                            title: "Boyama Seçimleri",
                            items: [
                              {
                                k: "Teknikler",
                                v:
                                  p.capabilities.length > 0
                                    ? p.capabilities.map((c) => TECHNIQUE_LABELS[c] ?? c).join(", ")
                                    : null,
                              },
                              { k: "Eş zamanlı iş limiti", v: p.maxConcurrentOrders },
                              { k: "İş alıyor", v: <BoolChip value={p.acceptingOrders} /> },
                              { k: "Uyarı (strike)", v: p.strikeCount },
                              {
                                k: "Haritada",
                                v:
                                  p.status === "active" ? (
                                    <BoolChip value={p.mapVisible} yes="Yayında (adsız)" no="Gizli" />
                                  ) : (
                                    <span className="text-gray-500">
                                      Yayında değil ({p.mapVisible ? "izinli" : "gizli"})
                                    </span>
                                  ),
                              },
                            ],
                          },
                          {
                            title: "Belgeler & Sözleşme",
                            items: [
                              {
                                k: "İş örneği",
                                v: p.workSamplePhotoUrl ? (
                                  <a
                                    href={p.workSamplePhotoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 hover:underline"
                                  >
                                    Görüntüle
                                  </a>
                                ) : p.workSamplePhotoUploadedAt ? (
                                  "Yüklendi (dosya eski kayıt — görüntülenemiyor)"
                                ) : (
                                  "Yüklenmedi"
                                ),
                              },
                              {
                                k: "Sözleşme kabulü",
                                v: p.onboardingAcceptedAt ? formatDate(p.onboardingAcceptedAt, loc) : null,
                              },
                              { k: "Başvuru tarihi", v: formatDate(p.createdAt, loc) },
                            ],
                          },
                          {
                            // Partner-level admin decisions (e.g. a closed tax
                            // review: who, when, what was checked).
                            // painter_actions rows need an order, so they live
                            // in painters.notes.
                            title: "Admin notları",
                            items: [
                              {
                                k: "Kayıtlar",
                                v: p.notes ? (
                                  <span className="block whitespace-pre-line text-left text-xs text-gray-700">
                                    {p.notes}
                                  </span>
                                ) : null,
                              },
                            ],
                          },
                        ]}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
