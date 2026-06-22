"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import { useCart } from "@/lib/cart/cart-context";
import { WhatsAppButton } from "@/components/whatsapp/whatsapp-button";

interface CartItem {
  id: string;
  productId: string;
  slug: string | null;
  title: string;
  priceKurus: number;
  imageUrl: string | null;
  sellerName: string | null;
  quantity: number;
  lineTotalKurus: number;
  selectedOptions: { groupName: string; choiceName: string }[];
  selectedAddons: { name: string }[];
}

export function CartClient() {
  const d = useDictionary();
  const locale = useLocale();
  const { refresh } = useCart();
  const [items, setItems] = useState<CartItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const apply = (data: { items: CartItem[]; totalKurus: number }) => {
    setItems(data.items);
    setTotal(data.totalKurus);
  };

  useEffect(() => {
    fetch("/api/cart")
      .then((r) => (r.ok ? r.json() : null))
      .then((dd) => {
        if (dd) apply(dd);
      })
      .finally(() => setLoading(false));
  }, []);

  const setQty = async (id: string, quantity: number) => {
    const r = await fetch("/api/cart", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, quantity }),
    });
    if (r.ok) {
      apply(await r.json());
      refresh();
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-text-muted">…</div>;
  }

  return (
    <>
      <h1 className="mb-6 font-serif text-2xl text-text-primary md:text-3xl">
        {d["cart.title"]}
      </h1>
      {items.length === 0 ? (
        <div className="card py-16 text-center">
          <p className="text-text-muted">{d["cart.empty"]}</p>
          <Link
            href="/shop"
            className="mt-4 inline-block rounded-full bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
          >
            {d["cart.continue"]}
          </Link>
        </div>
      ) : (
        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-3 md:col-span-2">
            {items.map((it) => (
              <div key={it.id} className="card flex gap-4 p-3">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-bg-elevated">
                  {it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imageUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={it.slug ? `/shop/${it.slug}` : "/shop"}
                    className="font-medium text-text-primary hover:text-green-600"
                  >
                    {it.title}
                  </Link>
                  {it.sellerName && (
                    <p className="text-xs text-text-muted">{it.sellerName}</p>
                  )}
                  {(it.selectedOptions.length > 0 || it.selectedAddons.length > 0) && (
                    <p className="mt-0.5 text-xs text-text-muted">
                      {[
                        ...it.selectedOptions.map((o) => o.choiceName),
                        ...it.selectedAddons.map((a) => a.name),
                      ].join(" · ")}
                    </p>
                  )}
                  <p className="mt-1 text-sm font-semibold text-text-primary">
                    {formatCurrency(it.priceKurus, locale)}
                  </p>
                </div>
                <div className="flex flex-col items-end justify-between">
                  <button
                    onClick={() => setQty(it.id, 0)}
                    className="text-xs text-text-muted transition-colors hover:text-error"
                  >
                    {d["cart.remove"]}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setQty(it.id, Math.max(1, it.quantity - 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-border-default text-text-secondary hover:bg-bg-elevated"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm">{it.quantity}</span>
                    <button
                      onClick={() => setQty(it.id, Math.min(20, it.quantity + 1))}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-border-default text-text-secondary hover:bg-bg-elevated"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card h-fit p-5">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">{d["cart.total"]}</span>
              <span className="text-xl font-bold text-text-primary">
                {formatCurrency(total, locale)}
              </span>
            </div>
            <Link
              href="/checkout"
              className="mt-5 block w-full rounded-full bg-green-600 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-green-700"
            >
              {d["cart.checkout"]}
            </Link>
            <WhatsAppButton
              message={`Merhaba! Sepetimdeki ürünleri WhatsApp'tan sipariş etmek istiyorum:\n${items
                .map((it) => `• ${it.title} × ${it.quantity}`)
                .join("\n")}\n\nToplam: ${formatCurrency(total, locale)}`}
              label="WhatsApp'tan Sipariş Ver"
              variant="outline"
              className="mt-3 w-full"
            />
          </div>
        </div>
      )}
    </>
  );
}
