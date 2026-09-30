"use client";

import { useCallback, useEffect, useState, type JSX } from "react";
import Link from "next/link";
import { useDisplayCurrency } from "@/components/quote/display-currency";
import { displayRate, fill, money } from "@/components/quote/format";
import type {
  CustomerQuoteListItem,
  DisplayCurrency,
  QuoteStatus,
} from "@/lib/config/quote-types";
import { formatDate } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * `/account/teklifler` — müşterinin teklif listesi.
 *
 * Liste uçtan (`GET /api/customer/quotes`) gelir; bu bileşen hiçbir fiyat
 * hesaplamaz. `totalKurus` teklifin önbellek kolonudur ve fiyatlanamayan
 * teklifte NULL'dur: o satırda rakam yerine tire yazılır. Uydurma bir "₺0,00",
 * müşteriye bedava bir teklif sözü verirdi.
 */

const PAGE_SIZE_HINT = 20;

/** Rozet tonu: bitmiş iş yeşil, bekleyen iş nötr, süresi dolan uyarı. */
const STATUS_TONE: Record<QuoteStatus, string> = {
  draft: "bg-bg-muted text-text-secondary",
  needs_review: "bg-warning-50 text-warning-500",
  quoted: "bg-green-50 text-green-700",
  ordered: "bg-success-50 text-success",
  expired: "bg-bg-muted text-text-muted",
  cancelled: "bg-bg-muted text-text-muted",
};

/**
 * Ekranda gösterilecek durum. Süresi geçmiş ama hâlâ `draft` duran teklif
 * (saatlik bakım işi henüz dokunmamış) müşteriye "Taslak" demez: açtığında
 * göreceği şey süre dolumu uyarısıdır.
 */
function displayStatus(item: CustomerQuoteListItem): QuoteStatus {
  if (item.status === "ordered" || item.status === "cancelled") return item.status;
  return item.expired ? "expired" : item.status;
}

export function QuoteListTable({
  items,
  currency = "TRY",
}: {
  items: CustomerQuoteListItem[];
  /**
   * Gösterim birimi tercihi. Her satır TEKLİFİN KENDİ donmuş kuruyla çevrilir
   * (bugünün bülteniyle değil): aksi hâlde liste, aynı teklifin sayfasından
   * farklı bir sayı gösterirdi. Kuru olmayan satır ₺ kalır.
   */
  currency?: DisplayCurrency;
}): JSX.Element {
  const d = useDictionary();
  const c = (key: "number" | "title" | "parts" | "status" | "total" | "expiry") =>
    d[`instantQuote.account.quotes.column.${key}`];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border-default text-xs text-text-muted">
            <th scope="col" className="py-3 pr-4 font-medium">{c("number")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("title")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("parts")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("status")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("total")}</th>
            <th scope="col" className="py-3 pr-4 font-medium">{c("expiry")}</th>
            <th scope="col" className="py-3 font-medium">
              <span className="sr-only">{d["instantQuote.account.quotes.open"]}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const status = displayStatus(item);
            return (
              <tr key={item.id} className="border-b border-bg-subtle align-middle">
                <td className="py-3 pr-4 font-mono text-[13px] text-text-primary">
                  {item.number}
                </td>
                <td className="py-3 pr-4 text-text-secondary">{item.title ?? "—"}</td>
                <td className="py-3 pr-4 text-text-secondary">
                  {fill(d["instantQuote.summary.parts"], {
                    parts: item.partCount,
                    units: item.unitCount,
                  })}
                </td>
                <td className="py-3 pr-4">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}
                  >
                    {d[`instantQuote.status.${status}`]}
                  </span>
                </td>
                <td className="py-3 pr-4 font-mono text-[13px] tabular-nums text-text-primary">
                  {item.totalKurus === null
                    ? "—"
                    : money(item.totalKurus, displayRate(item.fxSnapshot, currency))}
                </td>
                <td className="py-3 pr-4 text-text-secondary">
                  {formatDate(item.expiresAt, "tr")}
                </td>
                <td className="py-3 text-right whitespace-nowrap">
                  <Link
                    href={`/teklif/${encodeURIComponent(item.number)}`}
                    className="text-sm font-medium text-green-600 underline-offset-4 hover:underline"
                  >
                    {d["instantQuote.account.quotes.open"]}
                  </Link>
                  {item.orderNumber ? (
                    <Link
                      href={`/track/${encodeURIComponent(item.orderNumber)}`}
                      className="ml-3 text-sm font-medium text-text-secondary underline-offset-4 hover:underline"
                    >
                      {d["instantQuote.account.quotes.orderLink"]}
                    </Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AccountQuotesClient(): JSX.Element {
  const d = useDictionary();
  // Tercih çalışma alanındaki seçiciyle AYNI depodan gelir: müşteri teklif
  // sayfasında € seçtiyse listede de € okur. Burada seçici yoktur — bir liste
  // ekranı, tercihi değiştirmenin yeri değil.
  const currency = useDisplayCurrency();
  const [items, setItems] = useState<CustomerQuoteListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (next: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customer/quotes?page=${next}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as {
        items: CustomerQuoteListItem[];
        hasNext: boolean;
      };
      // Sayfa eklenerek büyür (sonsuz liste): "daha fazla"ya basan müşteri
      // ilk sayfayı kaybetmemeli.
      setItems((prev) => (next === 1 ? body.items : [...prev, ...body.items]));
      setHasNext(body.hasNext);
      setPage(next);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  if (loading && items.length === 0) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-12 rounded-xl" />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <p className="rounded-xl bg-error-50 p-3 text-sm text-error">
        {d["instantQuote.account.quotes.loadFailed"]}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border-default bg-bg-elevated p-8 text-center">
        <p className="text-text-secondary">{d["instantQuote.account.quotes.empty"]}</p>
        <Link href="/3d-baski" className="btn-primary mt-5 inline-flex !px-5 !py-2.5 text-sm">
          {d["instantQuote.account.quotes.emptyAction"]}
        </Link>
      </div>
    );
  }

  return (
    <>
      <QuoteListTable items={items} currency={currency} />
      {hasNext ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(page + 1)}
          className="btn-secondary mt-6 !px-5 !py-2.5 text-sm"
        >
          {loading ? d["common.loading"] : `Sonraki ${PAGE_SIZE_HINT} teklif`}
        </button>
      ) : null}
    </>
  );
}
