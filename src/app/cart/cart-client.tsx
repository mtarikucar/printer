"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import { useCart } from "@/lib/cart/cart-context";
import { QuantityInput } from "@/components/cart/quantity-input";
import { WhatsAppButton } from "@/components/whatsapp/whatsapp-button";

interface CartItem {
  id: string;
  productId: string;
  slug: string | null;
  title: string;
  priceKurus: number;
  /** Undiscounted unit price — display only, never summed. */
  listPriceKurus: number;
  appliedTierMinQuantity: number | null;
  /** Total units of this product across the cart (the tier basis). */
  productQuantity: number;
  maxQuantity: number;
  bulkEnabled: boolean;
  isBoxItem: boolean;
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
  const [savings, setSavings] = useState(0);
  const [loading, setLoading] = useState(true);

  const apply = (data: {
    items: CartItem[];
    totalKurus: number;
    bulkSavingsKurus?: number;
  }) => {
    setItems(data.items);
    setTotal(data.totalKurus);
    setSavings(data.bulkSavingsKurus ?? 0);
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

  // Group by pricing basis, because that is what the customer needs explained.
  // Box lines are ONE group regardless of design — their price comes from the
  // box total, so removing a design can re-price every other design in the box.
  // Everything else groups by product: two variant lines of one keychain share
  // a per-product tier neither line can explain alone.
  const groups = useMemo(() => {
    const byKey = new Map<string, CartItem[]>();
    for (const it of items) {
      const key = it.isBoxItem ? "__box__" : it.productId;
      const list = byKey.get(key);
      if (list) list.push(it);
      else byKey.set(key, [it]);
    }
    // The box first — it is the headline purchase when present.
    return [...byKey.entries()]
      .sort(([a], [b]) => (a === "__box__" ? -1 : b === "__box__" ? 1 : 0))
      .map(([key, list]) => ({ key, items: list, isBox: key === "__box__" }));
  }, [items]);

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
            {groups.map(({ key, items: group, isBox }) => {
              const head = group[0];
              const showGroupHeader = isBox || (group.length > 1 && head.bulkEnabled);
              return (
                <div key={key} className="space-y-3">
                  {showGroupHeader && (
                    <p className="px-1 text-xs text-text-secondary">
                      {isBox
                        ? d["box.cartGroup"].replace(
                            "{qty}",
                            String(head.productQuantity)
                          )
                        : d["bulk.groupTotal"]
                            .replace("{title}", head.title)
                            .replace("{qty}", String(head.productQuantity))}
                      {head.appliedTierMinQuantity != null && (
                        <>
                          {" · "}
                          <span className="font-semibold text-green-700">
                            {d["bulk.perUnit"].replace(
                              "{price}",
                              formatCurrency(head.priceKurus, locale)
                            )}
                          </span>{" "}
                          ({d["bulk.groupTierNote"]})
                        </>
                      )}
                    </p>
                  )}

                  {group.map((it) => (
                    <div key={it.id} className="card flex gap-4 p-3">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-bg-elevated">
                        {it.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
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
                        {(it.selectedOptions.length > 0 ||
                          it.selectedAddons.length > 0) && (
                          <p className="mt-0.5 text-xs text-text-muted">
                            {[
                              ...it.selectedOptions.map((o) => o.choiceName),
                              ...it.selectedAddons.map((a) => a.name),
                            ].join(" · ")}
                          </p>
                        )}
                        <p className="mt-1 flex items-baseline gap-2 text-sm font-semibold text-text-primary">
                          {formatCurrency(it.priceKurus, locale)}
                          {it.listPriceKurus > it.priceKurus && (
                            <span className="text-xs font-normal text-text-muted line-through">
                              {formatCurrency(it.listPriceKurus, locale)}
                            </span>
                          )}
                        </p>
                        {it.quantity >= it.maxQuantity && (
                          <p className="mt-1 text-xs text-text-muted">
                            {d["bulk.capReached"].replace(
                              "{max}",
                              String(it.maxQuantity)
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end justify-between">
                        <button
                          onClick={() => setQty(it.id, 0)}
                          className="text-xs text-text-muted transition-colors hover:text-error"
                        >
                          {d["cart.remove"]}
                        </button>
                        <QuantityInput
                          size="sm"
                          value={it.quantity}
                          max={it.maxQuantity}
                          onChange={(n) => setQty(it.id, n)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div className="card h-fit p-5">
            {savings > 0 && (
              <div className="mb-2 flex items-center justify-between text-sm text-green-700">
                <span>{d["bulk.savings"]}</span>
                <span className="font-semibold">
                  −{formatCurrency(savings, locale)}
                </span>
              </div>
            )}
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
            {items.some((it) => it.quantity >= it.maxQuantity) && (
              <p className="mt-3 text-xs text-text-muted">
                {d["bulk.capReachedHint"]}
              </p>
            )}
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
