"use client";

import { useEffect, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { ProductListItem } from "@/components/product-card";
import { ProductRow } from "./product-row";

/**
 * "Recently viewed" shelf for the homepage. Fetches the server-side (Redis)
 * recency list keyed by the viewer (account or guest cookie) and renders a
 * product row. Renders nothing until there's at least one viewed product, so
 * first-time visitors see no empty section.
 */
export function RecentlyViewed() {
  const d = useDictionary();
  const [items, setItems] = useState<ProductListItem[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/recently-viewed")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items: ProductListItem[] }) => {
        if (alive) setItems(data.items ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <ProductRow
      title={d["store.row.recent" as keyof typeof d] || "Son Gezdikleriniz"}
      products={items}
    />
  );
}
