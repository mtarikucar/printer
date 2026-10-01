"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminQuoteListItem, QuoteStatus } from "@/lib/config/quote-types";
import { formatCurrency, formatDateTime } from "@/lib/i18n/format";
import type { AdminQuoteTab } from "@/lib/services/quote-admin";

/**
 * Teklif kuyruğunun ekranı.
 *
 * Sekmeler BAĞLANTIDIR (istemci state'i değil): bir teklifi açıp geri dönen
 * admin aynı sekmede kalır ve kuyruğun bir sayfası paylaşılabilir bir adrestir.
 *
 * Sekme listesi SUNUCUDAN PROP olarak gelir (kenar çubuğu deseni): etiketler
 * `quote-admin.ts`tedir ve o modül `db`yi import eder — değer olarak import
 * etmek veritabanı zincirini istemci paketine taşırdı.
 */

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Taslak",
  needs_review: "İncelemede",
  quoted: "Fiyatlandı",
  ordered: "Siparişe dönüştü",
  expired: "Süresi doldu",
  cancelled: "İptal",
};

const STATUS_TONES: Record<QuoteStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  needs_review: "bg-amber-100 text-amber-800",
  quoted: "bg-green-100 text-green-800",
  ordered: "bg-indigo-100 text-indigo-800",
  expired: "bg-gray-200 text-gray-600",
  cancelled: "bg-red-100 text-red-700",
};

const REVIEW_KIND_LABELS: Record<string, string> = {
  manual: "Manuel fiyat",
  rfq: "RFQ",
  target_price: "Hedef fiyat",
};

function href(tab: AdminQuoteTab, page: number, q: string): string {
  const params = new URLSearchParams({ tab });
  if (page > 1) params.set("page", String(page));
  if (q) params.set("q", q);
  return `/admin/teklifler?${params.toString()}`;
}

export interface QuoteQueueTab {
  key: AdminQuoteTab;
  label: string;
}

export function QuoteQueueClient({
  tab,
  tabs,
  page,
  q = "",
  items,
  hasNext = false,
  pageSize = 25,
  readError,
}: {
  tab: AdminQuoteTab;
  tabs: QuoteQueueTab[];
  page: number;
  q?: string;
  items: AdminQuoteListItem[];
  hasNext?: boolean;
  pageSize?: number;
  readError?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);

  // Ölçü "herhangi bir satır"dır, "ilk satır" değil: tek bir takım teklifi
  // olan sayfada da kolon görünmeli.
  const showTeam = items.some((row) => row.teamName !== null);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(href(tab, 1, search.trim()));
  };

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Anlık teklifler</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Motorun kendi fiyatlayamadığı ya da müşterinin pazarlık ettiği teklifler burada
        karara bağlanır. Sekmeler teklifin <strong>durumuna</strong> bakar; bir teklif
        cevaplandıktan sonra kuyruktan düşer.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2">
        {tabs.map((entry) => (
          <Link
            key={entry.key}
            href={href(entry.key, 1, q)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              entry.key === tab
                ? "bg-green-600 text-white font-medium"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      <form onSubmit={submitSearch} className="mt-4 flex max-w-md gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Teklif no, başlık, müşteri adı ya da e-posta"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">
          Ara
        </button>
        {q && (
          <Link
            href={href(tab, 1, "")}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600"
          >
            Temizle
          </Link>
        )}
      </form>

      {readError && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {readError}
        </div>
      )}

      {!readError && items.length === 0 && (
        <p className="mt-8 text-sm text-gray-500">
          Bu sekmede teklif yok{q ? ` (“${q}” aramasıyla)` : ""}.
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Teklif</th>
                <th className="px-4 py-3">Müşteri</th>
                {/* TAKIM KOLONU YALNIZ VERİ VARSA (0072): aynı firmanın üç
                    mühendisinden gelen üç teklifi "üç ayrı müşteri" diye
                    okumak, manuel fiyatlamada yanlış kararın en kısa yolu.
                    Takım teklifi OLMAYAN bir kuyruk sayfasında tablo
                    bugünküyle birebir aynı kalır (müşteri tarafıyla aynı
                    kural). */}
                {showTeam && <th className="px-4 py-3">Takım</th>}
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3 text-right">Parça / Adet</th>
                <th className="px-4 py-3 text-right">Tutar</th>
                <th className="px-4 py-3">Talep</th>
                <th className="px-4 py-3">Geçerlilik</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/teklifler/${row.id}`}
                      className="font-medium text-green-700 hover:underline"
                    >
                      {row.number}
                    </Link>
                    {row.title && <div className="text-xs text-gray-500">{row.title}</div>}
                    {row.orderNumber && (
                      <div className="text-xs text-indigo-600">Sipariş: {row.orderNumber}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.anonymous ? (
                      <span className="text-xs text-gray-500">
                        Giriş yapmamış ziyaretçi (e-posta yok)
                      </span>
                    ) : (
                      <>
                        <div>{row.customerName ?? "—"}</div>
                        <div className="text-xs text-gray-500">{row.customerEmail ?? "—"}</div>
                      </>
                    )}
                  </td>
                  {showTeam && (
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {row.teamName ?? "—"}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONES[row.status]}`}
                    >
                      {STATUS_LABELS[row.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.partCount} / {row.unitCount}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.totalKurus === null ? (
                      <span className="text-xs text-amber-700">fiyatlanmadı</span>
                    ) : (
                      formatCurrency(row.totalKurus, "tr")
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.reviewKind ? (
                      <span
                        className={row.staleReviewKind ? "text-xs text-gray-400" : "text-xs"}
                        title={
                          row.staleReviewKind
                            ? "Eski talep: teklif artık incelemede değil."
                            : undefined
                        }
                      >
                        {REVIEW_KIND_LABELS[row.reviewKind] ?? row.reviewKind}
                        {row.staleReviewKind ? " (geçmiş)" : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                    {row.reviewRequestedAt && !row.staleReviewKind && (
                      <div className="text-[11px] text-gray-500">
                        {formatDateTime(row.reviewRequestedAt, "tr")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className={row.expired ? "text-red-600" : "text-gray-600"}>
                      {formatDateTime(row.expiresAt, "tr")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(page > 1 || hasNext) && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={href(tab, page - 1, q)} className="text-green-700 hover:underline">
              ← Önceki
            </Link>
          ) : (
            <span className="text-gray-300">← Önceki</span>
          )}
          <span className="text-gray-500">
            Sayfa {page} · sayfa başına {pageSize}
          </span>
          {hasNext ? (
            <Link href={href(tab, page + 1, q)} className="text-green-700 hover:underline">
              Sonraki →
            </Link>
          ) : (
            <span className="text-gray-300">Sonraki →</span>
          )}
        </div>
      )}
    </div>
  );
}
