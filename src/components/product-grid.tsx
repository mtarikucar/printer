"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { ProductCard, type ProductListItem } from "@/components/product-card";
import { PRODUCT_CATEGORIES } from "@/lib/validators/product";

export function ProductGrid({
  products,
  activeCategory,
}: {
  products: ProductListItem[];
  activeCategory?: string | null;
}) {
  const d = useDictionary();

  const categoryLabel = (cat: string) =>
    d[`product.category.${cat}` as keyof typeof d] || cat;

  return (
    <div>
      {/* Category filter — links keep it server-render friendly + shareable. */}
      <div className="flex flex-wrap gap-2 mb-8">
        <Link
          href="/shop"
          className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
            !activeCategory
              ? "bg-text-primary text-bg-base border-text-primary"
              : "border-bg-subtle text-text-secondary hover:bg-bg-elevated"
          }`}
        >
          {d["shop.filter.all" as keyof typeof d] || "Tümü"}
        </Link>
        {PRODUCT_CATEGORIES.map((cat) => (
          <Link
            key={cat}
            href={`/shop?category=${cat}`}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
              activeCategory === cat
                ? "bg-text-primary text-bg-base border-text-primary"
                : "border-bg-subtle text-text-secondary hover:bg-bg-elevated"
            }`}
          >
            {categoryLabel(cat)}
          </Link>
        ))}
      </div>

      {products.length === 0 ? (
        <p className="text-center text-text-muted py-20">
          {d["shop.empty" as keyof typeof d] || "Henüz ürün yok."}
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
