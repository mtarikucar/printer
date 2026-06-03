import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { FigurunicaLanding } from "@/components/figurunica/landing";
import { pickFigurunicaDict } from "@/components/figurunica/dict";
import { ProductCard, type ProductListItem } from "@/components/product-card";
import { getPublicUrl } from "@/lib/services/storage";

export const revalidate = 60;

export default async function HomePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  // Marketplace-first: surface the newest active products above the custom
  // figurine landing.
  const rows = await db.query.products.findMany({
    where: eq(products.status, "active"),
    orderBy: [desc(products.createdAt)],
    limit: 8,
    with: { manufacturer: { columns: { companyName: true } } },
  });

  const featured: ProductListItem[] = rows.map((p) => ({
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

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      {featured.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 pt-12">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl md:text-3xl font-serif text-text-primary">
              {d["home.featured.title" as keyof typeof d] || "Mağazadan Seçmeler"}
            </h2>
            <Link
              href="/shop"
              className="text-sm font-medium text-green-600 hover:text-green-700"
            >
              {d["home.featured.viewAll" as keyof typeof d] || "Tümünü gör"} →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {featured.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      <FigurunicaLanding d={pickFigurunicaDict(d)} />
    </main>
  );
}
