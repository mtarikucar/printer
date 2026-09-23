"use client";

import Link from "next/link";
import type { JSX } from "react";
import { QuoteCheckoutForm } from "@/components/quote/quote-checkout-form";
import { fill } from "@/components/quote/format";
import { Card } from "@/components/ui";
import { KDV_RATE_BPS } from "@/lib/config/prices";
import type { PresentedQuote, QuoteTotals } from "@/lib/config/quote-types";
import type { TurkishAddress } from "@/lib/db/schema";
import { formatCurrency } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Ödeme sayfasının gövdesi: solda form, sağda FİŞ.
 *
 * Fiş, çalışma alanındaki özet panelinin ödeme anındaki hâlidir: müşteri
 * "neyi, kaç paraya, ne zaman" sorusunun üçünü de kart bilgisini girmeden
 * önce görmeli (MSY m.6/2-a özetinin ekrandaki karşılığı; sözleşme kutusunun
 * kendi özet bloğu da formda ayrıca duruyor).
 *
 * Buradaki her rakam SUNUCUDAN gelir (`totals`, `havaleDiscountKurus`); bu
 * dosyada çarpma, bölme ya da oran yoktur.
 */
export function QuoteCheckoutClient({
  quote,
  totalKurus,
  havaleDiscountKurus,
  savedAddress,
}: {
  quote: PresentedQuote;
  totalKurus: number;
  havaleDiscountKurus: number;
  savedAddress: TurkishAddress | null;
}): JSX.Element {
  const d = useDictionary();
  const totals = quote.totals as QuoteTotals;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-text-primary">
          {d["instantQuote.checkout.title"]} · {quote.number}
        </h1>
        <Link
          href={`/teklif/${encodeURIComponent(quote.number)}`}
          className="text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          {d["instantQuote.checkout.backToQuote"]}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card padding="md" className="order-2 lg:order-1">
          <QuoteCheckoutForm
            quote={quote}
            totalKurus={totalKurus}
            havaleDiscountKurus={havaleDiscountKurus}
            savedAddress={savedAddress}
          />
        </Card>

        <Card padding="none" className="order-1 h-fit overflow-hidden lg:order-2 lg:sticky lg:top-6">
          <div className="border-b border-border-default px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">
              {d["instantQuote.checkout.summaryTitle"]}
            </h2>
          </div>

          <div className="space-y-4 px-4 py-4">
            <p className="text-xs text-text-muted">
              {fill(d["instantQuote.summary.parts"], {
                parts: quote.partCount,
                units: quote.unitCount,
              })}
            </p>

            <ul className="space-y-2">
              {quote.parts.map((part) => (
                <li key={part.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-text-secondary">
                    {part.name}
                    {part.config.quantity > 1 && (
                      <span className="text-text-muted"> × {part.config.quantity}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-text-secondary">
                    {part.price ? formatCurrency(part.price.lineKurus, "tr") : "—"}
                  </span>
                </li>
              ))}
            </ul>

            {totals.addonLines.length > 0 && (
              <dl className="space-y-1.5 border-t border-border-default pt-3">
                {totals.addonLines.map((line) => (
                  <div key={line.key} className="flex items-baseline justify-between gap-3">
                    <dt className="text-sm text-text-secondary">{line.name}</dt>
                    <dd className="text-sm tabular-nums text-text-secondary">
                      {formatCurrency(line.kurus, "tr")}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {totals.minOrderTopUpKurus > 0 && (
              <div className="flex items-baseline justify-between gap-3 border-t border-border-default pt-3">
                <span className="text-sm text-text-secondary">
                  {d["instantQuote.summary.minOrderTopUp"]}
                </span>
                <span className="text-sm tabular-nums text-text-secondary">
                  {formatCurrency(totals.minOrderTopUpKurus, "tr")}
                </span>
              </div>
            )}

            <div className="border-t border-border-default pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-text-primary">
                  {d["instantQuote.summary.total"]}
                </span>
                <span className="text-xl font-semibold tabular-nums text-text-primary">
                  {formatCurrency(totalKurus, "tr")}
                </span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {d["instantQuote.summary.kdvIncluded"]}
                {" · "}
                {fill(d["instantQuote.summary.kdv"], { rate: KDV_RATE_BPS / 100 })}{" "}
                <span className="tabular-nums">{formatCurrency(totals.kdvKurus, "tr")}</span>
              </p>
              {havaleDiscountKurus > 0 && (
                <p className="mt-1 text-xs text-text-secondary">
                  {d["payment.havaleDiscount"]}{" "}
                  <span className="tabular-nums">−{formatCurrency(havaleDiscountKurus, "tr")}</span>
                </p>
              )}
            </div>

            {quote.shipByDate && (
              <p className="text-xs text-text-muted">
                {fill(d["instantQuote.lead.shipBy"], { date: quote.shipByDate })}
              </p>
            )}
            <p className="text-xs text-text-muted">{d["instantQuote.summary.freeShipping"]}</p>
          </div>
        </Card>
      </div>
    </main>
  );
}
