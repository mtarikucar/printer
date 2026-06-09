import { and, asc, desc, eq, ilike, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import type { ProductListItem } from "@/components/product-card";
import { PRODUCT_CATEGORIES } from "@/lib/validators/product";

export const SHOP_PAGE_SIZE = 24;

export interface ShopFilters {
  category?: string | null;
  sort?: string | null;
  q?: string | null;
  material?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  offset?: number;
  limit?: number;
}

// Single source for the storefront catalogue query — used by the SSR /shop page
// and the load-more API so filters + sort + pagination stay identical.
export async function queryShopProducts(
  f: ShopFilters
): Promise<{ items: ProductListItem[]; hasMore: boolean }> {
  const activeCategory =
    f.category && (PRODUCT_CATEGORIES as readonly string[]).includes(f.category)
      ? f.category
      : null;
  const sort =
    f.sort === "price_asc" || f.sort === "price_desc" ? f.sort : "newest";
  const orderBy =
    sort === "price_asc"
      ? [asc(products.priceKurus)]
      : sort === "price_desc"
        ? [desc(products.priceKurus)]
        : [desc(products.createdAt)];

  const conds: SQL[] = [eq(products.status, "active")];
  if (activeCategory) conds.push(eq(products.category, activeCategory));
  if (f.q?.trim()) conds.push(ilike(products.title, `%${f.q.trim()}%`));
  if (f.material === "resin" || f.material === "filament") {
    conds.push(eq(products.material, f.material));
  }
  if (f.priceMin != null && Number.isFinite(f.priceMin)) {
    conds.push(gte(products.priceKurus, f.priceMin));
  }
  if (f.priceMax != null && Number.isFinite(f.priceMax)) {
    conds.push(lte(products.priceKurus, f.priceMax));
  }

  const limit = f.limit ?? SHOP_PAGE_SIZE;
  const offset = f.offset ?? 0;
  // Fetch one extra row to detect "has more" without a count query.
  const rows = await db.query.products.findMany({
    where: and(...conds),
    orderBy,
    limit: limit + 1,
    offset,
    with: { manufacturer: { columns: { companyName: true } } },
  });

  const hasMore = rows.length > limit;
  const items: ProductListItem[] = rows.slice(0, limit).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    priceKurus: p.priceKurus,
    material: p.material,
    category: p.category,
    leadTimeDays: p.leadTimeDays,
    imageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    sellerName: p.manufacturer?.companyName ?? null,
    ratingAvgX100: p.ratingAvgX100,
    ratingCount: p.ratingCount,
  }));
  return { items, hasMore };
}
