import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { categories, manufacturers, products } from "@/lib/db/schema";
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
  // `with:` BİLEREK YOK: satıcı adı ve kategori düğümü yalnızca GÖSTERİLİYOR,
  // ama ilişkisel sorgu TEK ifadedir — biri okunamadığında ANASAYFA tamamen 500
  // verirdi. İkisi aşağıda ayrı ve korumalı okunur; okunamazlarsa kart o
  // satırsız çizilir (yanlış bir şey söylemez), vitrin ayakta kalır.
  const rows = await db.query.products.findMany({
    where: eq(products.status, "active"),
    orderBy: [desc(products.createdAt)],
    limit: 60,
  });

  const sellerIds = [
    ...new Set(rows.map((p) => p.manufacturerId).filter((x): x is string => !!x)),
  ];
  const categoryIds = [
    ...new Set(rows.map((p) => p.categoryId).filter((x): x is string => !!x)),
  ];
  const [sellerRead, categoryRead] = await Promise.all([
    sellerIds.length
      ? db
          .select({ id: manufacturers.id, companyName: manufacturers.companyName })
          .from(manufacturers)
          .where(inArray(manufacturers.id, sellerIds))
          .catch((e) => {
            console.error("anasayfa: satıcı adları okunamadı", e);
            return [];
          })
      : [],
    categoryIds.length
      ? db
          .select({ id: categories.id, path: categories.path, name: categories.name })
          .from(categories)
          .where(inArray(categories.id, categoryIds))
          .catch((e) => {
            console.error("anasayfa: kategoriler okunamadı", e);
            return [];
          })
      : [],
  ]);
  const sellerById = new Map(sellerRead.map((m) => [m.id, m.companyName]));
  const categoryById = new Map(categoryRead.map((c) => [c.id, c]));

  const items: ProductListItem[] = rows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    priceKurus: p.priceKurus,
    material: p.material,
    categoryPath: categoryById.get(p.categoryId ?? "")?.path ?? null,
    categoryName: categoryById.get(p.categoryId ?? "")?.name ?? null,
    leadTimeDays: p.leadTimeDays,
    imageUrl: p.primaryImageKey ? getPublicImageUrl(p.primaryImageKey) : null,
    sellerName: sellerById.get(p.manufacturerId ?? "") ?? null,
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
