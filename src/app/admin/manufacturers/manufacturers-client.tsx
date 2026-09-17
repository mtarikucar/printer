"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import Link from "next/link";
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

interface Manufacturer {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  taxId: string | null;
  taxIdType: "vkn" | "tckn" | null;
  requiresManualTaxReview: boolean;
  status: string;
  /**
   * GÖSTERİM: tezgâhtaki ayrı kutu sayısı. KAPI DEĞİLDİR — bir toplu iş tek
   * "iş"tir ama tezgâhın tamamını doldurabilir.
   */
  activeOrders: number;
  /**
   * Ağırlıklı yük: sipariş başına 1, her 20 adet için 1 daha.
   * Yalnız weightedLoadLive açıkken atama kapısıdır.
   */
  loadUnits: number;
  weightedLoadLive: boolean;
  /** Ağırlıklı eşiğin boolean cevabı: bu atölyeye bir iş daha yazılabilir mi. */
  hasRoom: boolean;
  /** Kapının ölçüsüyle yazılmış tek yük etiketi: "6/5 birim · 1 iş". */
  loadLabel: string;
  createdAt: string;
  rejectionReason: string | null;
  printerPhotoUploadedAt: string | null;
  printerPhotoUrls: string[];
  whatsappPhone: string | null;
  address: TurkishAddress | null;
  iban: string | null;
  bankAccountHolder: string | null;
  bankName: string | null;
  maxConcurrentOrders: number;
  acceptingOrders: boolean;
  capabilities: string[];
  paintsInHouse: boolean;
  coverageProvinces: string[];
  mapVisible: boolean;
  onboardingAcceptedAt: string | null;
  notes: string | null;
}

// material_* capability tags chosen at registration → admin-readable labels.
const MATERIAL_LABELS: Record<string, string> = {
  material_resin: "Reçine (SLA/DLP)",
  material_filament: "Filament (FDM)",
};

const STATUS_BADGE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-700",
  active: "bg-green-100 text-green-700",
  suspended: "bg-red-100 text-red-700",
  conditionally_approved: "bg-blue-100 text-blue-700",
  rejected: "bg-gray-200 text-gray-600",
};

const STATUS_LABEL_KEY: Record<string, string> = {
  pending_approval: "admin.manufacturers.statusPending",
  active: "admin.manufacturers.statusActive",
  suspended: "admin.manufacturers.statusSuspended",
  conditionally_approved: "admin.manufacturers.statusConditional",
  rejected: "admin.manufacturers.statusRejected",
};

type FilterTab =
  | "all"
  | "pending_approval"
  | "conditionally_approved"
  | "rejected"
  | "manual_review"
  | "active"
  | "suspended";

function matchesFilter(m: Manufacturer, filter: FilterTab): boolean {
  if (filter === "all") return true;
  if (filter === "manual_review") {
    return m.requiresManualTaxReview && m.status !== "suspended";
  }
  return m.status === filter;
}

export function ManufacturersClient({
  manufacturers,
  locale,
}: {
  manufacturers: Manufacturer[];
  locale: string;
}) {
  const d = useDictionary();
  const loc = locale as Locale;
  const router = useRouter();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [loading, setLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Kaydedilen satır ANINDA güncel görünsün diye yerel üst-yazım. Sayfa sunucu
  // bileşeninden besleniyor; router.refresh() dönene kadar panel eski değeri
  // gösterirse admin "kaydedilmedi mi?" diye ikinci kez kaydeder.
  const [overrides, setOverrides] = useState<Record<string, Partial<Manufacturer>>>({});

  // Üst-yazım YALNIZCA refresh dönene kadar yaşar. Sunucudan yeni satırlar
  // geldiğinde sıfırlanır; yoksa üreticinin kendi panelinden yaptığı sonraki
  // değişiklik, admin'in bayatlamış değerinin altında sayfa kapanana kadar
  // görünmez kalırdı. (Render sırasında ayarlamak, React'in "prop değişince
  // state'i düzelt" kalıbı: fazladan bir render turu ve bayat değerin bir kare
  // boyunca görünmesi olmaz.)
  const [serverRows, setServerRows] = useState(manufacturers);
  if (serverRows !== manufacturers) {
    setServerRows(manufacturers);
    setOverrides({});
  }

  const rows = manufacturers.map((m) => ({ ...m, ...(overrides[m.id] ?? {}) }));
  const filtered = rows.filter((m) => matchesFilter(m, filter));

  const performAction = async (
    id: string,
    action: "activate" | "suspend" | "conditionally-approve" | "approve" | "reject"
  ) => {
    let body: string | undefined;
    if (action === "reject") {
      const input = window.prompt(d["admin.manufacturers.rejectPrompt"]);
      const reason = input && input.trim() ? input.trim() : undefined;
      body = JSON.stringify({ reason });
    }
    setLoading(`${action}-${id}`);
    try {
      const res = await fetch(`/api/admin/manufacturers/${id}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `${action} failed`);
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  // Closing a tax review lifts the ranker's −40 compliance penalty, so it must
  // say what was checked: the server refuses it without a note and appends
  // who/when/what to the manufacturer's admin notes.
  const closeTaxReview = async (m: Manufacturer) => {
    const input = window.prompt(
      `${m.companyName}: vergi incelemesini kapat.\nNeyi kontrol ettiniz? (ör. "Vergi levhası görüldü, VKN doğrulandı")`
    );
    if (input === null) return;
    const note = input.trim();
    if (note.length < 3) {
      alert("Neyi kontrol ettiğinizi kısaca yazın (en az 3 karakter).");
      return;
    }
    setLoading(`tax-review-${m.id}`);
    try {
      const res = await fetch(`/api/admin/manufacturers/${m.id}/tax-review`, {
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
    { key: "all", label: d["admin.manufacturers.filterAll"] },
    { key: "pending_approval", label: d["admin.manufacturers.filterPending"] },
    { key: "conditionally_approved", label: d["admin.manufacturers.filterConditional"] },
    { key: "rejected", label: d["admin.manufacturers.filterRejected"] },
    {
      key: "manual_review",
      label: d["admin.manufacturers.filterManualReview"],
    },
    { key: "active", label: d["admin.manufacturers.filterActive"] },
    { key: "suspended", label: d["admin.manufacturers.filterSuspended"] },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">
        {d["admin.manufacturers.title"]}
      </h1>
      <p className="text-gray-500 mt-1">
        {d["admin.manufacturers.subtitle"]}
      </p>

      {/* Filter tabs */}
      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const count = manufacturers.filter((m) =>
            matchesFilter(m, tab.key)
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
          <p className="text-lg">{d["admin.manufacturers.empty"]}</p>
        </div>
      ) : (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.companyName"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.contactPerson"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.email"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.status"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.colTaxId"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  Ağırlıklı yük
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.registeredAt"]}
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((m) => (
                <MfrRow
                  key={m.id}
                  m={m}
                  d={d}
                  loc={loc}
                  loading={loading}
                  expanded={expandedId === m.id}
                  onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
                  performAction={performAction}
                  onCloseTaxReview={() => void closeTaxReview(m)}
                  onSaved={(patch) =>
                    setOverrides((prev) => ({
                      ...prev,
                      [m.id]: { ...(prev[m.id] ?? {}), ...patch },
                    }))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MfrRow({
  m,
  d,
  loc,
  loading,
  expanded,
  onToggle,
  performAction,
  onCloseTaxReview,
  onSaved,
}: {
  m: Manufacturer;
  d: ReturnType<typeof useDictionary>;
  loc: Locale;
  loading: string | null;
  expanded: boolean;
  onToggle: () => void;
  onCloseTaxReview: () => void;
  onSaved: (patch: Partial<Manufacturer>) => void;
  performAction: (
    id: string,
    action: "activate" | "suspend" | "conditionally-approve" | "approve" | "reject"
  ) => void;
}) {
  return (
    <>
                <tr className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {m.companyName}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {m.contactPerson}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {m.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[m.status] || "bg-gray-100 text-gray-700"}`}
                    >
                      {d[STATUS_LABEL_KEY[m.status] as keyof typeof d] || m.status}
                    </span>
                    {m.status === "rejected" && m.rejectionReason ? (
                      <p className="mt-1 text-xs text-gray-500 max-w-[200px] truncate" title={m.rejectionReason}>
                        {m.rejectionReason}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {m.taxId && m.taxIdType ? (
                      <span className="font-mono text-gray-700">
                        {m.taxIdType.toUpperCase()}: {m.taxId}
                      </span>
                    ) : !m.requiresManualTaxReview ? (
                      <span className="text-xs text-gray-400">Beyan edilmedi</span>
                    ) : null}
                    {/* The badge follows the flag, not the missing tax id: the
                        flag is what the ranker penalises and what the "Manuel
                        inceleme" tab filters on, and an admin can now close it. */}
                    {m.requiresManualTaxReview && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          {d["admin.manufacturers.badgeManualReview"]}
                        </span>
                        {m.status !== "rejected" && (
                          <button
                            onClick={onCloseTaxReview}
                            disabled={loading === `tax-review-${m.id}`}
                            className="text-xs font-medium text-indigo-600 hover:underline disabled:text-gray-400"
                          >
                            {loading === `tax-review-${m.id}` ? "Kapatılıyor…" : "İncelemeyi kapat"}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-center">
                    {/* Ölçüm her profilde görünür; dolu rozeti yalnız canlı kapıyı anlatır. */}
                    <span className="whitespace-nowrap">{m.loadLabel}</span>
                    {m.weightedLoadLive && !m.hasRoom && (
                      <span className="ml-1.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 align-middle">
                        Dolu
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(m.createdAt, loc)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end items-center">
                      <button
                        onClick={onToggle}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          expanded
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {expanded ? "Kapat" : "Detay"}
                      </button>
                      {m.status === "pending_approval" && (
                        <>
                          <button
                            onClick={() => performAction(m.id, "conditionally-approve")}
                            disabled={loading === `conditionally-approve-${m.id}`}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                          >
                            {d["admin.manufacturers.conditionallyApprove"]}
                          </button>
                          <button
                            onClick={() => performAction(m.id, "reject")}
                            disabled={loading === `reject-${m.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors"
                          >
                            {d["admin.manufacturers.reject"]}
                          </button>
                        </>
                      )}
                      {m.status === "conditionally_approved" && (
                        <>
                          {m.printerPhotoUrls.length > 0 ? (
                            <a
                              href={m.printerPhotoUrls[0]}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
                            >
                              {d["admin.manufacturers.viewPrinterPhoto"]}
                              {m.printerPhotoUrls.length > 1 ? ` (${m.printerPhotoUrls.length})` : ""}
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">{d["admin.manufacturers.awaitingPhoto"]}</span>
                          )}
                          <button
                            onClick={() => performAction(m.id, "approve")}
                            disabled={!m.printerPhotoUploadedAt || loading === `approve-${m.id}`}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                          >
                            {d["admin.manufacturers.approve"]}
                          </button>
                          <button
                            onClick={() => performAction(m.id, "reject")}
                            disabled={loading === `reject-${m.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors"
                          >
                            {d["admin.manufacturers.reject"]}
                          </button>
                        </>
                      )}
                      {m.status === "suspended" && (
                        <button
                          onClick={() => performAction(m.id, "activate")}
                          disabled={loading === `activate-${m.id}`}
                          className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `activate-${m.id}` ? d["admin.manufacturers.activating"] : d["admin.manufacturers.activate"]}
                        </button>
                      )}
                      {m.status === "active" && (
                        <button
                          onClick={() => performAction(m.id, "suspend")}
                          disabled={loading === `suspend-${m.id}`}
                          className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `suspend-${m.id}` ? d["admin.manufacturers.suspending"] : d["admin.manufacturers.suspend"]}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-gray-50/60">
                    <td colSpan={8} className="px-4 py-4">
                      <PartnerApplicationDetails
                        sections={[
                          {
                            title: "İletişim",
                            items: [
                              { k: "Telefon", v: m.phone },
                              { k: "WhatsApp", v: m.whatsappPhone },
                              { k: "E-posta", v: m.email },
                            ],
                          },
                          {
                            title: "Adres",
                            items: m.address
                              ? [
                                  { k: "İl / İlçe", v: `${m.address.il} / ${m.address.ilce}` },
                                  { k: "Mahalle", v: m.address.mahalle || null },
                                  { k: "Açık adres", v: m.address.adres },
                                  { k: "Posta kodu", v: m.address.postaKodu },
                                ]
                              : [{ k: "Adres", v: null }],
                          },
                          {
                            title: "Banka / Ödeme",
                            items: [
                              { k: "IBAN", v: m.iban ? <span className="font-mono text-xs">{m.iban}</span> : null },
                              { k: "Hesap sahibi", v: m.bankAccountHolder },
                              { k: "Banka", v: m.bankName },
                              {
                                k: "Vergi",
                                v: m.taxId && m.taxIdType ? `${m.taxIdType.toUpperCase()}: ${m.taxId}` : "Beyan edilmedi",
                              },
                            ],
                          },
                          {
                            title: "Üretim Seçimleri",
                            items: [
                              {
                                k: "Malzemeler",
                                v:
                                  m.capabilities.filter((c) => c.startsWith("material_")).length > 0
                                    ? m.capabilities
                                        .filter((c) => c.startsWith("material_"))
                                        .map((c) => MATERIAL_LABELS[c] ?? c.replace("material_", ""))
                                        .join(", ")
                                    : null,
                              },
                              { k: "Eş zamanlı iş limiti", v: m.maxConcurrentOrders },
                              { k: "Sipariş alıyor", v: <BoolChip value={m.acceptingOrders} /> },
                              {
                                k: "Kendi boyama",
                                v: <BoolChip value={m.paintsInHouse} yes="Evet (boyayıp kargolar)" no="Hayır (boyacıya gönderir)" />,
                              },
                            ],
                          },
                          {
                            title: "Etki Alanı",
                            items: [
                              {
                                k: "Sorumlu iller",
                                v:
                                  m.coverageProvinces.length > 0
                                    ? `${m.coverageProvinces.length} il: ${m.coverageProvinces.join(", ")}`
                                    : null,
                              },
                              {
                                // Ham map_visible "public haritada mı?" sorusunun
                                // yanıtı DEĞİL: public sorgu ayrıca status='active'
                                // istiyor. Askıdaki bir partner için "Görünür"
                                // yazmak, gizlilik denetimi yapan admin'e yanlış
                                // cevap vermek olurdu.
                                k: "Haritada",
                                v:
                                  m.status === "active" ? (
                                    <BoolChip value={m.mapVisible} yes="Yayında" no="Gizli" />
                                  ) : (
                                    <span className="text-gray-500">
                                      Yayında değil ({m.mapVisible ? "izinli" : "gizli"})
                                    </span>
                                  ),
                              },
                              {
                                k: "Düzenle",
                                v:
                                  m.status === "rejected" ? null : (
                                    <Link
                                      href={`/admin/network-map?partner=${m.id}`}
                                      className="text-cyan-700 underline"
                                    >
                                      Haritada düzenle
                                    </Link>
                                  ),
                              },
                            ],
                          },
                          {
                            title: "Belgeler & Sözleşme",
                            items: [
                              {
                                k: `Yazıcı fotoğrafları${m.printerPhotoUrls.length > 0 ? ` (${m.printerPhotoUrls.length})` : ""}`,
                                v:
                                  m.printerPhotoUrls.length > 0 ? (
                                    <span className="inline-flex flex-wrap gap-x-2 justify-end">
                                      {m.printerPhotoUrls.map((url, i) => (
                                        <a
                                          key={url}
                                          href={url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-indigo-600 hover:underline"
                                        >
                                          {i + 1}. fotoğraf
                                        </a>
                                      ))}
                                    </span>
                                  ) : (
                                    "Yüklenmedi"
                                  ),
                              },
                              {
                                k: "Sözleşme kabulü",
                                v: m.onboardingAcceptedAt ? formatDate(m.onboardingAcceptedAt, loc) : null,
                              },
                              { k: "Başvuru tarihi", v: formatDate(m.createdAt, loc) },
                            ],
                          },
                          {
                            // Partner-level admin decisions (e.g. a closed tax
                            // review: who, when, what was checked). admin_actions
                            // rows need an order, so they live in
                            // manufacturers.notes.
                            title: "Admin notları",
                            items: [
                              {
                                k: "Kayıtlar",
                                v: m.notes ? (
                                  <span className="block whitespace-pre-line text-left text-xs text-gray-700">
                                    {m.notes}
                                  </span>
                                ) : null,
                              },
                            ],
                          },
                        ]}
                      />
                      <RankerInputsEditor m={m} onSaved={onSaved} />
                    </td>
                  </tr>
                )}
    </>
  );
}

/**
 * Atama girdilerinin admin düzenlemesi.
 *
 * Bu alanlar siparişin hangi atölyeye düşeceğini belirler: kapasite ve
 * "sipariş alıyor" sert filtre, malzeme etiketleri malzeme eşleşmesi (hiç
 * etiket yoksa atölye HER malzemeyi basabilir sayılır). Otomatik atama yalnız
 * bu veriye güvendiği için yanlış girilmiş bir değeri düzeltecek bir yer
 * gerekti; bugüne kadar yalnız partnerin kendisi değiştirebiliyordu.
 *
 * İKİ ALAN BURADA ÖZEL:
 *  • "Kendi boyar" bir yönlendirme kutusu DEĞİL, bir PARA girdisidir: kargo ucu
 *    bayrağı canlı okur, yani çevirmek atölyenin ELİNDEKİ boyalı siparişlerde
 *    hakediş tabanını değiştirir. Form bu yüzden önce etkilenen siparişleri
 *    sunucudan sorar, lira cinsinden gösterir ve ayrı bir onay ister.
 *  • Malzemeler yalnız admin GERÇEKTEN dokunduysa gönderilir. Hiç etiketi
 *    olmayan eski bir atölye bugün her malzemeye adaydır; kapasiteyi düzeltmek
 *    için açılan bir form onu sessizce tek malzemeye daraltmamalı.
 */

/** Sunucunun "kendi boyama" etki dökümü (/api/admin/manufacturers/[id] GET). */
interface PaintingImpactOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  currentBaseKurus: number;
  nextBaseKurus: number;
  /** Negatif = üreticinin payı azalır. */
  deltaKurus: number;
}

interface PaintingImpact {
  count: number;
  totalDeltaKurus: number;
  orders: PaintingImpactOrder[];
  truncated: boolean;
}

const formatLira = (kurus: number) =>
  `₺${(kurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function RankerInputsEditor({
  m,
  onSaved,
}: {
  m: Manufacturer;
  onSaved: (patch: Partial<Manufacturer>) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(String(m.maxConcurrentOrders));
  const [accepting, setAccepting] = useState(m.acceptingOrders);
  const [materials, setMaterials] = useState<string[]>([]);
  // Admin malzeme kutularına DOKUNDU mu. Dokunmadıysa `materials` hiç
  // gönderilmez; bkz. yukarıdaki not (eski atölyeyi sessizce daraltmama).
  const [materialsTouched, setMaterialsTouched] = useState(false);
  const [paints, setPaints] = useState(m.paintsInHouse);
  const [impact, setImpact] = useState<PaintingImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactAck, setImpactAck] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const currentMaterialTags = m.capabilities.filter((c) => c.startsWith("material_"));
  const hasNoMaterialTags = currentMaterialTags.length === 0;
  const paintsChanged = paints !== m.paintsInHouse;
  const ackRequired = paintsChanged && !!impact && impact.count > 0;

  // Form AÇILIRKEN doldurulur. useEffect ile senkronlamak, satır sunucudan
  // yenilendiğinde admin'in yazdığı değeri altından çekerdi.
  const openEditor = () => {
    setLimit(String(m.maxConcurrentOrders));
    setAccepting(m.acceptingOrders);
    setMaterials(currentMaterialTags.map((c) => c.slice("material_".length)));
    setMaterialsTouched(false);
    setPaints(m.paintsInHouse);
    setImpact(null);
    setImpactAck(false);
    setImpactLoading(false);
    setReason("");
    setError(null);
    setSavedMsg(null);
    setOpen(true);
  };

  const toggleMaterial = (key: string) => {
    setMaterialsTouched(true);
    setMaterials((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  /**
   * "Kendi boyar" kutusu çevrildiğinde: bu değişiklik ELDEKİ hangi siparişlerde
   * kime ne kadar ödeneceğini değiştirir? Rakamı sunucu hesaplar (kargo ucunun
   * kullandığı aynı fonksiyonla), istemci yalnız gösterir.
   */
  const loadImpact = async (next: boolean) => {
    if (next === m.paintsInHouse) {
      setImpact(null);
      setImpactAck(false);
      return;
    }
    setImpactLoading(true);
    try {
      const res = await fetch(`/api/admin/manufacturers/${m.id}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      setImpact(res.ok && data?.impact ? (data.impact as PaintingImpact) : null);
    } catch {
      // Etki listesi alınamadıysa kayıt yine engellenmez: sunucu kendi
      // kontrolünü yapar ve onay gerekiyorsa 409 ile geri çevirir.
      setImpact(null);
    } finally {
      setImpactLoading(false);
    }
  };

  const save = async () => {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
      setError("Eş zamanlı iş limiti 1 ile 999 arasında olmalı.");
      return;
    }
    if (materialsTouched && materials.length === 0) {
      setError(
        "En az bir malzeme seçili olmalı. Malzemeleri değiştirmek istemiyorsanız kutuları eski hâline getirin."
      );
      return;
    }
    if (reason.trim().length < 3) {
      setError("Neden değiştirdiğinizi kısaca yazın (en az 3 karakter).");
      return;
    }
    if (ackRequired && !impactAck) {
      setError(
        "Kendi boyama değişikliğinin devam eden siparişlerdeki ödeme etkisini onaylayın."
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/manufacturers/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxConcurrentOrders: n,
          acceptingOrders: accepting,
          // Dokunulmadıysa hiç gönderilmez: sunucu da alanı yoksa malzemelere
          // dokunmaz.
          ...(materialsTouched ? { materials } : {}),
          paintsInHouse: paints,
          paintsInHouseAck: impactAck,
          reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.needsPaintingAck && data?.impact) {
          // Sunucu etkiyi bizden daha taze biliyor (ekranda yokken yeni bir
          // sipariş düşmüş olabilir): dökümü göster, onayı yeniden iste.
          setImpact(data.impact as PaintingImpact);
          setImpactAck(false);
        }
        setError(data.error || "Kaydedilemedi");
        return;
      }
      if (data.manufacturer) {
        onSaved({
          maxConcurrentOrders: data.manufacturer.maxConcurrentOrders,
          acceptingOrders: data.manufacturer.acceptingOrders,
          paintsInHouse: data.manufacturer.paintsInHouse,
          capabilities: data.manufacturer.capabilities ?? [],
          notes: data.manufacturer.notes ?? null,
        });
      }
      const changedCount = Array.isArray(data.changed) ? data.changed.length : 0;
      setReason("");
      setMaterialsTouched(false);
      setImpact(null);
      setImpactAck(false);
      setSavedMsg(
        changedCount === 0
          ? "Değişen alan yok; kayıt aynı kaldı."
          : m.status === "rejected"
            ? `Kaydedildi ✓ ${changedCount} alan güncellendi (reddedilmiş başvuru, bildirim gönderilmedi).`
            : `Kaydedildi ✓ ${changedCount} alan güncellendi, üreticiye bildirildi.`
      );
      setOpen(false);
      // Sunucu verisiyle uzlaş: üst-yazım yalnız refresh dönene kadar geçerli.
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Atama girdileri (admin)
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            Kapasite, sipariş kabulü, malzemeler ve kendi boyama; siparişin hangi
            atölyeye düşeceğini belirler. &quot;Kendi boyama&quot; ayrıca
            üreticiye ne ödeneceğini etkiler. Değişiklik üreticinin admin
            notlarına iz olarak yazılır ve kendisine bildirilir.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={openEditor}
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Düzenle
          </button>
        )}
      </div>

      {savedMsg && !open && <p className="mt-2 text-xs text-green-700">{savedMsg}</p>}

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Eş zamanlı iş limiti
              </label>
              <input
                type="number"
                min={1}
                max={999}
                step={1}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <p className="mt-1 text-xs text-gray-400">
                {m.weightedLoadLive
                  ? "Ağırlıklı yük bu limite ulaşınca yeni atama engellenir."
                  : "Ağırlıklı yük (gölge): bu ölçüm atamayı engellemez."}{" "}
                Ağırlık: sipariş başına 1 birim, toplu ve atölye partilerinde her
                20 adet için 1 birim daha. Şu an {m.loadLabel}
                {m.weightedLoadLive && !m.hasRoom ? " — tezgâh dolu, yeni atama engellenir" : ""}.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Durum
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={accepting}
                  onChange={(e) => setAccepting(e.target.checked)}
                  className="h-4 w-4"
                />
                Sipariş alıyor
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={paints}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setPaints(next);
                    setImpactAck(false);
                    void loadImpact(next);
                  }}
                  className="h-4 w-4"
                />
                Kendi boyar (boyacıya göndermez)
              </label>
              <p className="mt-1 text-xs text-gray-400">
                Bu kutu ödeme girdisidir: kendi boyayan atölye, boyama payını da
                kendi hakedişine yazar. Değiştirmek elde duran boyalı siparişleri
                etkiler.
              </p>
            </div>
          </div>

          {paintsChanged && (
            <div
              className={`rounded-lg border p-3 ${
                ackRequired
                  ? "border-amber-300 bg-amber-50"
                  : "border-gray-200 bg-gray-50"
              }`}
            >
              {impactLoading ? (
                <p className="text-xs text-gray-600">
                  Etkilenen siparişler hesaplanıyor…
                </p>
              ) : impact && impact.count > 0 ? (
                <>
                  <p className="text-xs font-semibold text-amber-900">
                    Bu değişiklik devam eden {impact.count} boyalı siparişi
                    etkiler: üreticinin hakediş tabanı toplam{" "}
                    {formatLira(Math.abs(impact.totalDeltaKurus))}{" "}
                    {impact.totalDeltaKurus < 0 ? "azalır" : "artar"}.
                  </p>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-amber-900">
                    {impact.orders.map((o) => (
                      <li key={o.orderId}>
                        <span className="font-mono">{o.orderNumber}</span>:{" "}
                        {formatLira(o.currentBaseKurus)} →{" "}
                        {formatLira(o.nextBaseKurus)} (
                        {o.deltaKurus < 0 ? "−" : "+"}
                        {formatLira(Math.abs(o.deltaKurus))})
                      </li>
                    ))}
                    {impact.truncated && <li>… ve diğerleri</li>}
                  </ul>
                  <p className="mt-1 text-[11px] text-amber-800">
                    Kargolanmış ya da hakedişi yazılmış siparişler etkilenmez;
                    boyacıya devredilmiş siparişlerde de taban değişmez.
                  </p>
                  <label className="mt-2 flex items-start gap-2 text-xs font-medium text-amber-900">
                    <input
                      type="checkbox"
                      checked={impactAck}
                      onChange={(e) => setImpactAck(e.target.checked)}
                      className="mt-0.5 h-4 w-4"
                    />
                    Bu {impact.count} siparişte üreticiye ödenecek tutarın
                    değişeceğini biliyorum ve onaylıyorum.
                  </label>
                </>
              ) : (
                <p className="text-xs text-gray-600">
                  Devam eden boyalı siparişi yok: bu değişiklik mevcut ödemeleri
                  etkilemiyor, yalnızca bundan sonrası için geçerli.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Malzemeler
            </label>
            <div className="flex flex-wrap gap-3">
              {Object.entries(MATERIAL_LABELS).map(([tag, label]) => {
                const key = tag.slice("material_".length);
                return (
                  <label key={tag} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={materials.includes(key)}
                      onChange={() => toggleMaterial(key)}
                      className="h-4 w-4"
                    />
                    {label}
                  </label>
                );
              })}
            </div>
            {hasNoMaterialTags ? (
              <p className="mt-1 text-xs text-amber-700">
                Bu atölyede malzeme etiketi YOK. Bugünkü kural: etiketi olmayan
                atölye her malzemede aday sayılır. Kutulara dokunmazsanız bu
                böyle kalır; bir malzeme işaretlerseniz atölye yalnızca
                işaretlediklerinize aday olur.
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                Dokunmazsanız malzemeler değişmez. Düzenlerseniz en az biri
                zorunlu: hiç etiketi olmayan atölye her malzemeyi basabilir
                sayılır.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Gerekçe (üreticiye iletilir)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder='örn. "Telefonda kapasitesini 8 olarak bildirdi"'
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || (ackRequired && !impactAck)}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {busy ? "Kaydediliyor…" : "Kaydet ve üreticiye bildir"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-60"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
