import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { SiteHeader } from "@/components/site-header";
import { MarketplaceLanding } from "@/components/marketplace/landing";
import { type ProductListItem } from "@/components/product-card";
import { getPublicUrl } from "@/lib/services/storage";

export const revalidate = 60;

export default async function HomePage() {
  // Newest active products for the featured strip on the marketplace landing.
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
      <MarketplaceLanding featured={featured} />
    </main>
  );
}
