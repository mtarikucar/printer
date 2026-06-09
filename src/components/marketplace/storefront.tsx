"use client";

import { useDictionary } from "@/lib/i18n/locale-context";
import { pickFigurunicaDict } from "@/components/figurunica/dict";
import { FigFooter } from "@/components/figurunica/sections";
import type { ProductListItem } from "@/components/product-card";
import { PRODUCT_CATEGORIES } from "@/lib/validators/product";
import { CategoryRibbon } from "./category-ribbon";
import { PromoBanner } from "./promo-banner";
import { ProductRow } from "./product-row";
import { CustomStrip } from "./custom-strip";

// The homepage IS the marketplace: category ribbon → promo banner → New
// Arrivals → one shelf per populated category → a secondary custom strip →
// footer. The marketing story now lives on /figur + /nasil-calisir.
export function StorefrontHome({ products }: { products: ProductListItem[] }) {
  const d = useDictionary();
  const fig = pickFigurunicaDict(d);

  const newest = products.slice(0, 10);
  const populatedCats = PRODUCT_CATEGORIES.filter((c) =>
    products.some((p) => p.category === c)
  );

  return (
    <>
      <CategoryRibbon />
      <PromoBanner />
      <ProductRow
        title={d["store.row.new"]}
        products={newest}
        viewAllHref="/shop?sort=newest"
      />
      {populatedCats.map((c) => (
        <ProductRow
          key={c}
          title={d[`product.category.${c}` as keyof typeof d]}
          products={products.filter((p) => p.category === c).slice(0, 5)}
          viewAllHref={`/shop?category=${c}`}
        />
      ))}
      <CustomStrip />
      <FigFooter d={fig} />
    </>
  );
}
