import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { ProductGrid } from "@/components/product-grid";
import { PRODUCT_CATEGORIES } from "@/lib/validators/product";
import { queryShopProducts } from "@/lib/services/shop-query";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const d = getDictionary(locale);
  return {
    title: `${d["shop.title" as keyof typeof d] || "Mağaza"} — Figurunica`,
    description:
      d["shop.subtitle" as keyof typeof d] ||
      "Üreticilerin hazır baskı ürünleri.",
  };
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    sort?: string;
    q?: string;
    material?: string;
    priceMin?: string;
    priceMax?: string;
  }>;
}) {
  const locale = await getLocale();
  const d = getDictionary(locale);
  const sp = await searchParams;

  const term = sp.q?.trim() || null;
  const activeCategory =
    sp.category && (PRODUCT_CATEGORIES as readonly string[]).includes(sp.category)
      ? sp.category
      : null;
  const activeSort =
    sp.sort === "price_asc" || sp.sort === "price_desc" ? sp.sort : "newest";
  const material =
    sp.material === "resin" || sp.material === "filament" ? sp.material : null;
  const priceMin = sp.priceMin ? Number(sp.priceMin) : null;
  const priceMax = sp.priceMax ? Number(sp.priceMax) : null;

  const { items, hasMore } = await queryShopProducts({
    category: activeCategory,
    sort: activeSort,
    q: term,
    material,
    priceMin,
    priceMax,
    offset: 0,
  });

  // Categories that actually have active products — drives the filter tabs.
  const activeCatRows = await db
    .selectDistinct({ category: products.category })
    .from(products)
    .where(eq(products.status, "active"));
  const availableCategories = activeCatRows
    .map((r) => r.category)
    .filter((c): c is string => c !== null);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <section className="max-w-6xl mx-auto px-4 pt-12 pb-6 text-center">
        <h1 className="text-4xl md:text-5xl font-serif text-text-primary">
          {d["shop.title" as keyof typeof d] || "Mağaza"}
        </h1>
        <p className="mt-4 text-lg text-text-secondary max-w-xl mx-auto">
          {d["shop.subtitle" as keyof typeof d] ||
            "Üreticilerimizin hazır baskı ürünlerini keşfedin."}
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-8 pb-20">
        <ProductGrid
          products={items}
          activeCategory={activeCategory}
          availableCategories={availableCategories}
          activeSort={activeSort}
          query={term}
          material={material}
          priceMin={priceMin}
          priceMax={priceMax}
          hasMore={hasMore}
        />
      </section>
    </main>
  );
}
