"use client";

import { useEffect, useState } from "react";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { useCart } from "@/lib/cart/cart-context";

interface CartItem {
  productId: string;
  title: string;
  quantity: number;
  lineTotalKurus: number;
}

export function CheckoutClient() {
  const d = useDictionary();
  const locale = useLocale();
  const { refresh } = useCart();
  const [items, setItems] = useState<CartItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/cart")
      .then((r) => (r.ok ? r.json() : null))
      .then((dd) => {
        if (dd) {
          setItems(dd.items);
          setTotal(dd.totalKurus);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-20 text-center text-text-muted">…</div>;
  if (items.length === 0)
    return <div className="py-20 text-center text-text-muted">{d["cart.empty"]}</div>;

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="card h-fit p-5">
        <h2 className="mb-3 font-medium text-text-primary">{d["checkout.summary"]}</h2>
        {items.map((it) => (
          <div key={it.productId} className="flex justify-between py-1 text-sm text-text-secondary">
            <span className="truncate pr-3">
              {it.title} × {it.quantity}
            </span>
            <span className="shrink-0">{formatCurrency(it.lineTotalKurus, locale)}</span>
          </div>
        ))}
        <div className="mt-3 flex justify-between border-t border-border-default pt-3 font-bold text-text-primary">
          <span>{d["cart.total"]}</span>
          <span>{formatCurrency(total, locale)}</span>
        </div>
      </div>
      <div className="card p-5">
        <CheckoutForm
          orderPayload={{
            orderType: "marketplace",
            items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          }}
          priceKurus={total}
          submitLabel={d["cart.checkout"]}
          onSuccess={async () => {
            await fetch("/api/cart", { method: "DELETE" }).catch(() => {});
            refresh();
          }}
        />
      </div>
    </div>
  );
}
