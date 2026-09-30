"use client";

import type { JSX } from "react";
import type { FrozenFxRate, PriceBreakPoint } from "@/lib/config/quote-types";
import { useDictionary } from "@/lib/i18n/locale-context";
import { money } from "./format";

/**
 * Adet kademe tablosu: "10 alırsan birim fiyat ne olur".
 *
 * Yalnız fiyat kapısını geçmiş izleyiciye çizilir — bileşen bunu KENDİ
 * kontrol etmez, `priceBreaks` zaten yalnız o izleyicinin gövdesinde vardır
 * (`presentQuote`). Müşterinin ŞU ANKİ adedi işaretlenir: tablo bir teklif
 * değil, bulunduğu yeri gösteren bir ölçektir.
 */
export function QuotePriceBreakTable({
  breaks,
  quantity,
  rate = null,
}: {
  breaks: PriceBreakPoint[];
  quantity: number;
  /** Seçili gösterim biriminin DONMUŞ kuru; `null` = bağlayıcı ₺. */
  rate?: FrozenFxRate | null;
}): JSX.Element | null {
  const d = useDictionary();
  if (breaks.length === 0) return null;

  // Müşterinin adedi hangi kademeye düşüyor: eşit ya da altındaki EN BÜYÜK
  // kademe (5 adet alan biri "5+" satırındadır, "10+" satırında değil).
  const activeQty = breaks.reduce(
    (best, point) => (point.quantity <= quantity ? Math.max(best, point.quantity) : best),
    breaks[0].quantity
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border-default">
      <table className="w-full text-xs">
        <caption className="sr-only">{d["instantQuote.price.breaks"]}</caption>
        <thead>
          <tr className="bg-bg-muted text-text-secondary">
            <th scope="col" className="px-2.5 py-1.5 text-left font-medium">
              {d["instantQuote.price.breaks.quantity"]}
            </th>
            <th scope="col" className="px-2.5 py-1.5 text-right font-medium">
              {d["instantQuote.price.breaks.unit"]}
            </th>
          </tr>
        </thead>
        <tbody>
          {breaks.map((point) => {
            const active = point.quantity === activeQty;
            return (
              <tr
                key={point.quantity}
                className={active ? "bg-accent-soft font-medium" : undefined}
              >
                <td className="px-2.5 py-1.5 tabular-nums">{point.quantity}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums">
                  {money(point.unitKurus, rate)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
