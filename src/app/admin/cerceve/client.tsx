"use client";

/**
 * Çerçeve anlaşma listesinin ekranı.
 *
 * Süzgeçler BAĞLANTIDIR (istemci state'i değil): bir anlaşmayı açıp geri dönen
 * admin aynı süzgeçte kalır ve listenin bir sayfası paylaşılabilir bir adrestir
 * (teklif kuyruğu deseni).
 *
 * TUTARLAR UÇTAN GELİR: bu dosyada çarpma, bölme, oran YOKTUR. Taahhüt toplamı
 * TEK-SEVKİYAT projeksiyonudur ve Σ parti tutarı DEĞİLDİR — o rakam detay
 * sayfasında AYRI bir alanda durur.
 */
import Link from "next/link";
import {
  FRAMEWORK_STATUS_LABELS_TR,
  FRAMEWORK_STATUS_TONES,
} from "./[id]/framework-values";
import { FRAMEWORK_STATUSES, type FrameworkStatus } from "@/lib/config/quote-framework";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { FrameworkListItem } from "@/lib/services/quote-framework";

function href(status: FrameworkStatus | null, page: number): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/cerceve?${query}` : "/admin/cerceve";
}

export function FrameworkListClient({
  status,
  page,
  items,
  hasNext = false,
  readError,
}: {
  status: FrameworkStatus | null;
  page: number;
  items: FrameworkListItem[];
  hasNext?: boolean;
  readError?: string;
}) {
  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">Çerçeve siparişler</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Kurumsal müşteri bir kerede büyük miktar <strong>taahhüt eder</strong>, fiyat
        anlaşma boyunca <strong>kilitlenir</strong>, teslim <strong>partiler</strong>
        hâlinde planlanır. <strong>Ödeme parti başınadır</strong>: anlaşmanın kendisi
        bir satış değildir, her parti serbest bırakıldığında kendi siparişi olarak
        ödenir ve üretilir.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2">
        <Link
          href={href(null, 1)}
          className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
            status === null
              ? "bg-green-600 font-medium text-white"
              : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          Tümü
        </Link>
        {FRAMEWORK_STATUSES.map((key) => (
          <Link
            key={key}
            href={href(key, 1)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              status === key
                ? "bg-green-600 font-medium text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {FRAMEWORK_STATUS_LABELS_TR[key]}
          </Link>
        ))}
      </nav>

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
          Bu süzgeçte çerçeve anlaşma yok. Anlaşma, fiyatlanmış bir teklifin karar
          ekranından (<code>/admin/teklifler/…</code>) kurulur.
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Anlaşma</th>
                <th className="px-4 py-3">Kaynak teklif</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3 text-right">Taahhüt (adet)</th>
                <th className="px-4 py-3 text-right">Tek sevkiyatta</th>
                <th className="px-4 py-3 text-right">Parti</th>
                <th className="px-4 py-3">Fiyat kilidi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/cerceve/${row.id}`}
                      className="font-medium text-green-700 hover:underline"
                    >
                      {row.number}
                    </Link>
                    {row.title && <div className="text-xs text-gray-500">{row.title}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.quoteNumber}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${FRAMEWORK_STATUS_TONES[row.status]}`}
                    >
                      {FRAMEWORK_STATUS_LABELS_TR[row.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{row.committedUnits}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatCurrency(row.committedTotalKurus, "tr")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.plannedBatchCount} planlı / {row.batchCount}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className={row.lockExpired ? "text-red-600" : "text-gray-600"}>
                      {formatDate(row.priceLockedUntil, "tr")}
                      {row.lockExpired ? " (doldu)" : ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          &quot;Tek sevkiyatta&quot; sütunu, taahhüdün TAMAMI tek siparişte sevk
          edilseydi ödenecek tutardır. Partilerin toplamı DEĞİLDİR: sabit ve
          parça-başı ek hizmetler her partide yeniden tahsil edilir. İki rakam da
          anlaşma detayında ayrı ayrı durur.
        </p>
      )}

      {(page > 1 || hasNext) && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          {page > 1 ? (
            <Link href={href(status, page - 1)} className="text-green-700 hover:underline">
              ← Önceki
            </Link>
          ) : (
            <span className="text-gray-300">← Önceki</span>
          )}
          <span className="text-gray-500">Sayfa {page}</span>
          {hasNext ? (
            <Link href={href(status, page + 1)} className="text-green-700 hover:underline">
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
