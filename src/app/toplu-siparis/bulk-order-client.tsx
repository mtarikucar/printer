"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/i18n/format";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { useCart } from "@/lib/cart/cart-context";
import { QuantityInput } from "@/components/cart/quantity-input";
import { nextTier, pickTier, type PriceTierConfig } from "@/lib/config/bulk";

export interface BulkProduct {
  id: string;
  slug: string | null;
  title: string;
  imageUrl: string | null;
  priceKurus: number;
  leadTimeDays: number | null;
  maxQuantity: number;
  tiers: PriceTierConfig[];
}

/**
 * Order sheet: pick quantities across several products, see each row re-price
 * as it crosses a tier, then add the whole sheet to the cart in one request.
 *
 * Prices here are a preview computed with the same pickTier the server uses;
 * /api/cart re-prices everything authoritatively on add, so a stale tier can
 * never become a charged tier.
 */
export function BulkOrderClient({ products }: { products: BulkProduct[] }) {
  const locale = useLocale();
  const d = useDictionary();
  const router = useRouter();
  const { addMany } = useCart();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  const rows = useMemo(
    () =>
      products.map((p) => {
        const q = qty[p.id] ?? 0;
        const tier = pickTier(p.tiers, q);
        const unit = tier?.unitPriceKurus ?? p.priceKurus;
        return {
          product: p,
          quantity: q,
          unitPriceKurus: unit,
          lineTotalKurus: unit * q,
          next: nextTier(p.tiers, q),
          discounted: unit < p.priceKurus,
        };
      }),
    [products, qty]
  );

  const selected = rows.filter((r) => r.quantity > 0);
  const total = selected.reduce((s, r) => s + r.lineTotalKurus, 0);
  const savings = selected.reduce(
    (s, r) => s + (r.product.priceKurus - r.unitPriceKurus) * r.quantity,
    0
  );

  const addAll = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await addMany(
        selected.map((r) => ({ productId: r.product.id, quantity: r.quantity }))
      );
      setAdded(true);
      setQty({});
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (products.length === 0) {
    return (
      <div className="card mt-8 py-16 text-center">
        <p className="text-text-muted">{d["bulk.none"]}</p>
        <Link
          href="/shop"
          className="mt-4 inline-block rounded-full bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
        >
          Mağazaya git
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {rows.map(({ product: p, quantity, unitPriceKurus, lineTotalKurus, next, discounted }) => (
          <div key={p.id} className="card flex flex-wrap items-center gap-4 p-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-bg-elevated">
              {p.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <Link
                href={p.slug ? `/shop/${p.slug}` : "/shop"}
                className="font-medium text-text-primary hover:text-green-600"
              >
                {p.title}
              </Link>
              <p className="mt-0.5 flex items-baseline gap-2 text-sm">
                <span
                  className={
                    discounted
                      ? "font-semibold text-green-700"
                      : "text-text-secondary"
                  }
                >
                  {d["bulk.perUnit"].replace(
                    "{price}",
                    formatCurrency(unitPriceKurus, locale)
                  )}
                </span>
                {discounted && (
                  <span className="text-xs text-text-muted line-through">
                    {formatCurrency(p.priceKurus, locale)}
                  </span>
                )}
              </p>
              {p.tiers.length > 0 && (
                <p className="mt-0.5 text-xs text-text-muted">
                  {p.tiers
                    .map(
                      (t) =>
                        `${t.minQuantity}+ ${formatCurrency(t.unitPriceKurus, locale)}`
                    )
                    .join(" · ")}
                </p>
              )}
              {quantity > 0 && next && (
                <button
                  type="button"
                  onClick={() => setQty((s) => ({ ...s, [p.id]: next.minQuantity }))}
                  className="mt-1 text-xs font-medium text-green-700 hover:underline"
                >
                  {d["bulk.completeTo"]
                    .replace("{qty}", String(next.minQuantity))
                    .replace(
                      "{price}",
                      formatCurrency(next.unitPriceKurus, locale)
                    )}
                </button>
              )}
            </div>

            <div className="flex items-center gap-4">
              <QuantityInput
                value={quantity}
                min={0}
                max={p.maxQuantity}
                onChange={(n) => setQty((s) => ({ ...s, [p.id]: n }))}
              />
              <span className="w-24 text-right text-sm font-semibold tabular-nums text-text-primary">
                {quantity > 0 ? formatCurrency(lineTotalKurus, locale) : "—"}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="card h-fit p-5 lg:sticky lg:top-6">
        <h2 className="font-medium text-text-primary">{d["bulk.summary"]}</h2>
        {selected.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">{d["bulk.summaryEmpty"]}</p>
        ) : (
          <>
            <div className="mt-3 space-y-1 text-sm">
              {selected.map((r) => (
                <div key={r.product.id} className="flex justify-between gap-3">
                  <span className="truncate text-text-secondary">
                    {r.product.title} × {r.quantity}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatCurrency(r.lineTotalKurus, locale)}
                  </span>
                </div>
              ))}
            </div>
            {savings > 0 && (
              <div className="mt-3 flex justify-between border-t border-border-default pt-3 text-sm text-green-700">
                <span>{d["bulk.savings"]}</span>
                <span className="font-semibold">
                  −{formatCurrency(savings, locale)}
                </span>
              </div>
            )}
            <div className="mt-2 flex justify-between font-bold text-text-primary">
              <span>{d["cart.total"]}</span>
              <span>{formatCurrency(total, locale)}</span>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={addAll}
          disabled={busy || selected.length === 0}
          className="mt-5 w-full rounded-full bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? d["bulk.adding"] : d["bulk.addAll"]}
        </button>

        {added && (
          <Link
            href="/cart"
            className="mt-3 block text-center text-sm font-medium text-green-700 hover:underline"
          >
            {d["bulk.addedGoToCart"]}
          </Link>
        )}

        <p className="mt-4 text-xs text-text-muted">{d["bulk.leadTimeNotice"]}</p>
      </div>
    </div>
  );
}
