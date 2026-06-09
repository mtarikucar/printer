"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  query,
  material = null,
  priceMin = null,
  priceMax = null,
  hasMore: initialHasMore = false,
}: {
  products: ProductListItem[];
  activeCategory?: string | null;
  availableCategories?: string[];
  activeSort?: SortKey;
  query?: string | null;
  material?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  hasMore?: boolean;
}) {
  const d = useDictionary();
  const router = useRouter();

  const [extra, setExtra] = useState<ProductListItem[]>([]);
  const [offset, setOffset] = useState(products.length);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [minInput, setMinInput] = useState(priceMin != null ? String(Math.round(priceMin / 100)) : "");
  const [maxInput, setMaxInput] = useState(priceMax != null ? String(Math.round(priceMax / 100)) : "");

  const all = [...products, ...extra];

  const categoryLabel = (cat: string) =>
    d[`product.category.${cat}` as keyof typeof d] || cat;

  const visibleCategories = PRODUCT_CATEGORIES.filter(
    (cat) => !availableCategories || availableCategories.includes(cat) || cat === activeCategory
  );

  // URL builder preserving every active axis; `changes` override (null clears).
  const buildUrl = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams();
    if (activeCategory) params.set("category", activeCategory);
    if (activeSort !== "newest") params.set("sort", activeSort);
    if (query) params.set("q", query);
    if (material) params.set("material", material);
    if (priceMin != null) params.set("priceMin", String(priceMin));
    if (priceMax != null) params.set("priceMax", String(priceMax));
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    return qs ? `/shop?${qs}` : "/shop";
  };

  const sortLabel: Record<SortKey, string> = {
    newest: d["shop.sort.newest"],
    price_asc: d["shop.sort.priceAsc"],
    price_desc: d["shop.sort.priceDesc"],
  };

  const loadMore = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeCategory) params.set("category", activeCategory);
    if (activeSort !== "newest") params.set("sort", activeSort);
    if (query) params.set("q", query);
    if (material) params.set("material", material);
    if (priceMin != null) params.set("priceMin", String(priceMin));
    if (priceMax != null) params.set("priceMax", String(priceMax));
    params.set("offset", String(offset));
    try {
      const r = await fetch(`/api/shop/products?${params}`);
      if (r.ok) {
        const dd = await r.json();
        setExtra((e) => [...e, ...dd.items]);
        setOffset((o) => o + dd.items.length);
        setHasMore(dd.hasMore);
      }
    } finally {
      setLoading(false);
    }
  };

  const applyPrice = () => {
    router.push(
      buildUrl({
        priceMin: minInput ? String(Math.round(Number(minInput) * 100)) : null,
        priceMax: maxInput ? String(Math.round(Number(maxInput) * 100)) : null,
      })
    );
  };

  const MATERIALS = [
    { key: null, label: d["shop.filter.all" as keyof typeof d] || "Tümü" },
    { key: "resin", label: d["material.resin"] },
    { key: "filament", label: d["material.filament"] },
  ];

  return (
    <div>
      {/* Category filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Link
          href={buildUrl({ category: null })}
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
            href={buildUrl({ category: cat })}
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

      {/* Material + price filters */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{d["shop.filter.material"]}:</span>
          {MATERIALS.map((m) => {
            const active = material === m.key;
            return (
              <Link
                key={m.key ?? "all"}
                href={buildUrl({ material: m.key })}
                className={`rounded-full px-3 py-1 transition-colors ${
                  active ? "bg-green-50 text-green-700 ring-1 ring-green-500/30" : "text-text-secondary hover:bg-bg-elevated"
                }`}
              >
                {m.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">{d["shop.filter.price"]}:</span>
          <input
            value={minInput}
            onChange={(e) => setMinInput(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={d["shop.filter.min"]}
            inputMode="numeric"
            className="w-20 rounded-lg border border-bg-subtle bg-bg-base px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <span className="text-text-muted">–</span>
          <input
            value={maxInput}
            onChange={(e) => setMaxInput(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={d["shop.filter.max"]}
            inputMode="numeric"
            className="w-20 rounded-lg border border-bg-subtle bg-bg-base px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={applyPrice}
            className="rounded-full bg-text-primary px-3 py-1 text-xs font-semibold text-bg-base hover:opacity-90"
          >
            {d["shop.filter.apply"]}
          </button>
        </div>
      </div>

      {/* Toolbar: count (+ query) + sort */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8 border-t border-border-default pt-4">
        <p className="flex items-center gap-2 text-sm text-text-muted">
          {query && (
            <span className="rounded-full bg-bg-elevated px-2.5 py-0.5 font-medium text-text-primary">
              “{query}”
            </span>
          )}
          <span>
            {all.length}
            {hasMore ? "+" : ""} {d["shop.results"]}
          </span>
        </p>
        <div className="flex items-center gap-1 text-sm">
          <span className="mr-1 hidden text-text-muted sm:inline">{d["shop.sort.label"]}:</span>
          {SORT_OPTIONS.map((s) => (
            <Link
              key={s}
              href={buildUrl({ sort: s === "newest" ? null : s })}
              className={`rounded-full px-3 py-1 transition-colors ${
                activeSort === s ? "bg-text-primary text-bg-base" : "text-text-secondary hover:bg-bg-elevated"
              }`}
            >
              {sortLabel[s]}
            </Link>
          ))}
        </div>
      </div>

      {all.length === 0 ? (
        <p className="text-center text-text-muted py-20">
          {d["shop.empty" as keyof typeof d] || "Henüz ürün yok."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
            {all.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          {hasMore && (
            <div className="mt-10 text-center">
              <button
                onClick={loadMore}
                disabled={loading}
                className="rounded-full border border-border-default bg-white px-8 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated disabled:opacity-60"
              >
                {loading ? "…" : d["shop.loadMore"]}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
