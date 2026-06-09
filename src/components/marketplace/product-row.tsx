"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { ProductCard, type ProductListItem } from "@/components/product-card";

// A titled product shelf: heading + "view all" + a dense responsive grid.
export function ProductRow({
  title,
  products,
  viewAllHref,
}: {
  title: string;
  products: ProductListItem[];
  viewAllHref?: string;
}) {
  const d = useDictionary();
  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 py-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl text-text-primary md:text-2xl">{title}</h2>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="shrink-0 text-sm font-medium text-green-600 transition-colors hover:text-green-700"
          >
            {d["home.featured.viewAll"]} →
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4 lg:grid-cols-5">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
