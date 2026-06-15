"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { RootCategory } from "./storefront";

// Trendyol-style category ribbon under the header: quick horizontal access to
// every top-level category (data-driven from the admin-managed tree). Scrolls
// horizontally on small screens. Drilling into subcategories happens on /shop.
export function CategoryRibbon({ categories }: { categories: RootCategory[] }) {
  const d = useDictionary();

  return (
    <nav className="sticky top-16 z-40 border-b border-border-default bg-bg-base/90 backdrop-blur">
      <div className="mx-auto max-w-6xl px-2">
        <div className="flex gap-1 overflow-x-auto py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link
            href="/shop"
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
          >
            {d["landing.market.cats.all"]}
          </Link>
          {categories.map((c) => (
            <Link
              key={c.path}
              href={`/shop?category=${encodeURIComponent(c.path)}`}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
            >
              <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              {c.name}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
