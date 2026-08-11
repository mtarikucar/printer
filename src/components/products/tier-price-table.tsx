"use client";

import { formatCurrency } from "@/lib/i18n/format";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import type { PriceTierConfig } from "@/lib/config/bulk";

export type PriceTier = PriceTierConfig;

/**
 * The volume ladder, shown as ranges the buyer can read at a glance
 * ("1-9 ₺30 · 10-49 ₺26 · 50+ ₺22"). Upper bounds are derived from the next
 * rung, so the ladder never has to store them and can't drift.
 */
export function TierPriceTable({
  basePriceKurus,
  tiers,
  quantity,
  className,
}: {
  basePriceKurus: number;
  tiers: PriceTier[];
  /** Highlights the row the buyer is currently in. */
  quantity?: number;
  className?: string;
}) {
  const locale = useLocale();
  const d = useDictionary();
  if (tiers.length === 0) return null;

  const sorted = [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
  const rows = [
    { from: 1, to: sorted[0].minQuantity - 1, unitPriceKurus: basePriceKurus },
    ...sorted.map((t, i) => ({
      from: t.minQuantity,
      to: i + 1 < sorted.length ? sorted[i + 1].minQuantity - 1 : null,
      unitPriceKurus: t.unitPriceKurus,
    })),
  ];

  return (
    <div className={className}>
      <p className="mb-1.5 text-xs font-medium text-text-secondary">
        {d["bulk.priceTable"]}
      </p>
      <div className="overflow-hidden rounded-lg border border-border-default">
        {rows.map((r) => {
          const active =
            quantity != null &&
            quantity >= r.from &&
            (r.to == null || quantity <= r.to);
          const saving = basePriceKurus - r.unitPriceKurus;
          return (
            <div
              key={r.from}
              className={`flex items-center justify-between px-3 py-1.5 text-sm ${
                active
                  ? "bg-green-50 font-semibold text-green-800"
                  : "text-text-secondary"
              }`}
            >
              <span>
                {r.to == null
                  ? d["bulk.tierOpenRange"].replace("{from}", String(r.from))
                  : d["bulk.tierRange"]
                      .replace("{from}", String(r.from))
                      .replace("{to}", String(r.to))}
              </span>
              <span className="flex items-center gap-2">
                {saving > 0 && (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-700">
                    {d["bulk.discountBadge"].replace(
                      "{percent}",
                      String(Math.round((saving / basePriceKurus) * 100))
                    )}
                  </span>
                )}
                <span className="tabular-nums">
                  {formatCurrency(r.unitPriceKurus, locale)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

