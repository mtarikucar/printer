"use client";

import { useDictionary } from "@/lib/i18n/locale-context";
import { pickFigurunicaDict } from "@/components/figurunica/dict";
import { FigFooter } from "@/components/figurunica/sections";
import type { ProductListItem } from "@/components/product-card";
import { CategoryRibbon } from "./category-ribbon";
import { PromoBanner } from "./promo-banner";
import { ProductRow } from "./product-row";
import { CustomStrip } from "./custom-strip";

export interface RootCategory {
  path: string;
  name: string;
}

// A product belongs to a root shelf via the first segment of its category path
// (e.g. "figurine/marvel" → root "figurine"), so deeply-nested products still
// surface on their top-level shelf.
function rootSegment(categoryPath: string | null): string | null {
  return categoryPath ? categoryPath.split("/")[0] : null;
}

// The homepage IS the marketplace: category ribbon → promo banner → New
// Arrivals → one shelf per populated root category → a secondary custom strip →
// footer. The marketing story now lives on /figur + /nasil-calisir.
export function StorefrontHome({
  products,
  roots,
}: {
  products: ProductListItem[];
  roots: RootCategory[];
}) {
  const d = useDictionary();
  const fig = pickFigurunicaDict(d);

  const newest = products.slice(0, 10);
  const populatedRoots = roots.filter((r) =>
    products.some((p) => rootSegment(p.categoryPath) === r.path)
  );

  return (
    <>
      <CategoryRibbon categories={roots} />
      <PromoBanner />
      <ProductRow
        title={d["store.row.new"]}
        products={newest}
        viewAllHref="/shop?sort=newest"
      />
      {populatedRoots.map((r) => (
        <ProductRow
          key={r.path}
          title={r.name}
          products={products
            .filter((p) => rootSegment(p.categoryPath) === r.path)
            .slice(0, 5)}
          viewAllHref={`/shop?category=${encodeURIComponent(r.path)}`}
        />
      ))}
      <CustomStrip />
      <FigFooter d={fig} />
    </>
  );
}
