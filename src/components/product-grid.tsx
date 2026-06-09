"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { ProductCard, type ProductListItem } from "@/components/product-card";
import { PRODUCT_CATEGORIES } from "@/lib/validators/product";

const SORT_OPTIONS = ["newest", "price_asc", "price_desc"] as const;
type SortKey = (typeof SORT_OPTIONS)[number];

export function ProductGrid({
  products,
  activeCategory,
  availableCategories,
  activeSort = "newest",
}: {
  products: ProductListItem[];
  activeCategory?: string | null;
  availableCategories?: string[];
  activeSort?: SortKey;
}) {
  const d = useDictionary();

  const categoryLabel = (cat: string) =>
    d[`product.category.${cat}` as keyof typeof d] || cat;

  // Only surface categories that actually have active products (plus the one
  // currently being viewed), so the tab bar doesn't advertise empty sections.
  const visibleCategories = PRODUCT_CATEGORIES.filter(
    (cat) =>
      !availableCategories ||
      availableCategories.includes(cat) ||
      cat === activeCategory
  );

  // Hrefs preserve the *other* axis: changing category keeps the sort, and
  // changing sort keeps the category. Defaults (no category / newest) are
  // omitted so the canonical URLs stay clean and shareable.
  const buildHref = (cat: string | null, sort: SortKey) => {
    const params = new URLSearchParams();
    if (cat) params.set("category", cat);
    if (sort !== "newest") params.set("sort", sort);
    const qs = params.toString();
    return qs ? `/shop?${qs}` : "/shop";
  };

  const sortLabel: Record<SortKey, string> = {
    newest: d["shop.sort.newest"],
    price_asc: d["shop.sort.priceAsc"],
    price_desc: d["shop.sort.priceDesc"],
  };

  return (
    <div>
      {/* Category filter — links keep it server-render friendly + shareable. */}
      <div className="flex flex-wrap gap-2 mb-5">
        <Link
          href={buildHref(null, activeSort)}
          className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
            !activeCategory
              ? "bg-text-primary text-bg-base border-text-primary"
              : "border-bg-subtle text-text-secondary hover:bg-bg-elevated"
          }`}
        >
          {d["shop.filter.all" as keyof typeof d] || "Tümü"}
        </Link>
        {visibleCategories.map((cat) => (
          <Link
            key={cat}
            href={buildHref(cat, activeSort)}
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

      {/* Toolbar: result count + sort. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8 border-t border-border-default pt-4">
        <p className="text-sm text-text-muted">
          {products.length} {d["shop.results"]}
        </p>
        <div className="flex items-center gap-1 text-sm">
          <span className="mr-1 hidden text-text-muted sm:inline">
            {d["shop.sort.label"]}:
          </span>
          {SORT_OPTIONS.map((s) => (
            <Link
              key={s}
              href={buildHref(activeCategory ?? null, s)}
              className={`rounded-full px-3 py-1 transition-colors ${
                activeSort === s
                  ? "bg-text-primary text-bg-base"
                  : "text-text-secondary hover:bg-bg-elevated"
              }`}
            >
              {sortLabel[s]}
            </Link>
          ))}
        </div>
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
