import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { SiteHeader } from "@/components/site-header";
import { StorefrontHome } from "@/components/marketplace/storefront";
import { type ProductListItem } from "@/components/product-card";
import { getPublicUrl } from "@/lib/services/storage";
import { getChildCategories } from "@/lib/services/categories";

export const revalidate = 60;

export default async function HomePage() {
  // Active catalog for the storefront — grouped into shelves client-side.
  const rows = await db.query.products.findMany({
    where: eq(products.status, "active"),
    orderBy: [desc(products.createdAt)],
    limit: 60,
    with: {
      manufacturer: { columns: { companyName: true } },
      categoryNode: { columns: { path: true, name: true } },
    },
  });

  const items: ProductListItem[] = rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    priceKurus: p.priceKurus,
    material: p.material,
    categoryPath: p.categoryNode?.path ?? null,
    categoryName: p.categoryNode?.name ?? null,
    leadTimeDays: p.leadTimeDays,
    imageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    sellerName: p.manufacturer?.companyName ?? null,
    ratingAvgX100: p.ratingAvgX100,
    ratingCount: p.ratingCount,
  }));

  // Root categories drive the ribbon + one shelf per populated root.
  const roots = (await getChildCategories(null)).map((c) => ({
    path: c.path,
    name: c.name,
  }));

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <StorefrontHome products={items} roots={roots} />
    </main>
  );
}
