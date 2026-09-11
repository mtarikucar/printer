import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { SiteHeader } from "@/components/site-header";
import { StorefrontHome } from "@/components/marketplace/storefront";
import { type ProductListItem } from "@/components/product-card";
import { getPublicImageUrl } from "@/lib/services/storage";
import { getChildCategories } from "@/lib/services/categories";
import { getNetworkMapData } from "@/lib/services/network-map";
import type { NetworkMapData } from "@/lib/config/network-map";

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
    imageUrl: p.primaryImageKey ? getPublicImageUrl(p.primaryImageKey) : null,
    sellerName: p.manufacturer?.companyName ?? null,
    ratingAvgX100: p.ratingAvgX100,
    ratingCount: p.ratingCount,
  }));

  // Üretim ağı haritası DEKORATİF bir bölümdür: verisi gelmezse anasayfa
  // çökmemeli. Yerel geliştirme veritabanı şema ile senkron değil (ör. painters
  // tablosu yok), bu yüzden sorgu gerçekten patlayabilir.
  let networkMap: NetworkMapData | null = null;
  try {
    networkMap = await getNetworkMapData();
  } catch (err) {
    console.warn("[home] üretim ağı haritası yüklenemedi:", err);
  }

  // Root categories drive the ribbon + one shelf per populated root.
  const roots = (await getChildCategories(null)).map((c) => ({
    path: c.path,
    name: c.name,
  }));

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <StorefrontHome products={items} roots={roots} networkMap={networkMap} />
    </main>
  );
}
