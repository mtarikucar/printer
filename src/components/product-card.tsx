"use client";

import Link from "next/link";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";

export interface ProductListItem {
  id: string;
  slug: string | null;
  title: string;
  priceKurus: number;
  material: string | null;
  category: string | null;
  leadTimeDays: number | null;
  imageUrl: string | null;
  /** Seller company name, or null for platform-owned products. */
  sellerName: string | null;
}

const MATERIAL_BADGE: Record<string, string> = {
  resin: "bg-purple-100 text-purple-700 border-purple-200",
  filament: "bg-sky-100 text-sky-700 border-sky-200",
};

export function ProductCard({ product }: { product: ProductListItem }) {
  const d = useDictionary();
  const locale = useLocale();

  const href = product.slug ? `/shop/${product.slug}` : "/shop";
  const materialLabel = product.material
    ? d[`material.${product.material}` as keyof typeof d] || product.material
    : null;

  return (
    <Link
      href={href}
      className="group card overflow-hidden block focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-bg-base"
    >
      <div className="aspect-square bg-bg-elevated relative overflow-hidden">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted">
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {materialLabel && (
          <div className="absolute top-3 right-3">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                MATERIAL_BADGE[product.material ?? ""] ||
                "bg-gray-100 text-gray-600 border-gray-200"
              }`}
            >
              {materialLabel}
            </span>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-text-primary line-clamp-2 min-h-[2.5rem]">
          {product.title}
        </p>
        <p className="mt-1 text-base font-semibold text-text-primary">
          {formatCurrency(product.priceKurus, locale)}
        </p>
        {product.sellerName && (
          <p className="mt-0.5 text-xs text-text-muted truncate">
            {product.sellerName}
          </p>
        )}
      </div>
    </Link>
  );
}
