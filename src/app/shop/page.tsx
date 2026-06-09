import type { Metadata } from "next";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { ProductGrid } from "@/components/product-grid";
import type { ProductListItem } from "@/components/product-card";
import { getPublicUrl } from "@/lib/services/storage";
import { PRODUCT_CATEGORIES } from "@/lib/validators/product";

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
  searchParams: Promise<{ category?: string }>;
}) {
  const locale = await getLocale();
  const d = getDictionary(locale);
  const { category } = await searchParams;

  // Only a known category narrows the query; anything else lists everything.
  const activeCategory =
    category && (PRODUCT_CATEGORIES as readonly string[]).includes(category)
      ? category
      : null;

  const rows = await db.query.products.findMany({
    where: activeCategory
      ? and(eq(products.status, "active"), eq(products.category, activeCategory))
      : eq(products.status, "active"),
    orderBy: [desc(products.createdAt)],
    with: {
      manufacturer: { columns: { companyName: true } },
    },
  });

  const items: ProductListItem[] = rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    priceKurus: p.priceKurus,
    material: p.material,
    category: p.category,
    leadTimeDays: p.leadTimeDays,
    imageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    sellerName: p.manufacturer?.companyName ?? null,
  }));

  // Categories that actually have active products — drives the filter tabs so
  // empty categories don't advertise depth the catalog doesn't have yet.
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
        />
      </section>
    </main>
  );
}
