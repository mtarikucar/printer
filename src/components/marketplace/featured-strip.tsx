"use client";

import Link from "next/link";
import { ProductCard, type ProductListItem } from "@/components/product-card";
import { useDictionary } from "@/lib/i18n/locale-context";

export function FeaturedStrip({ products }: { products: ProductListItem[] }) {
  const d = useDictionary();
  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-5 py-12 md:py-16">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-green-600">
            {d["landing.market.cats.eyebrow"]}
          </p>
          <h2 className="mt-2 font-serif text-2xl text-text-primary md:text-3xl">
            {d["home.featured.title"]}
          </h2>
        </div>
        <Link
          href="/shop"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-green-600 hover:text-green-700"
        >
          {d["home.featured.viewAll"]}
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0l-6-6m6 6l-6 6" />
          </svg>
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
