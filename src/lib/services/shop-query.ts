import { and, asc, desc, eq, ilike, gte, lte, inArray, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import type { ProductListItem } from "@/components/product-card";
import { getCategoryByPath, getSubtreeIds } from "@/lib/services/categories";

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
  const sort =
    f.sort === "price_asc" || f.sort === "price_desc" ? f.sort : "newest";
  const orderBy =
    sort === "price_asc"
      ? [asc(products.priceKurus)]
      : sort === "price_desc"
        ? [desc(products.priceKurus)]
        : [desc(products.createdAt)];

  const conds: SQL[] = [eq(products.status, "active")];
  // Category filter is now a node PATH; match the node + its whole subtree, so
  // selecting "figurine" also returns "figurine/marvel" products. An unknown
  // path yields an impossible filter (no products) rather than ignoring it.
  if (f.category) {
    const node = await getCategoryByPath(f.category);
    const subtreeIds = node ? await getSubtreeIds(node.path) : [];
    conds.push(
      subtreeIds.length
        ? inArray(products.categoryId, subtreeIds)
        : eq(products.id, "00000000-0000-0000-0000-000000000000")
    );
  }
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
    with: {
      manufacturer: { columns: { companyName: true } },
      categoryNode: { columns: { path: true, name: true } },
    },
  });

  const hasMore = rows.length > limit;
  const items: ProductListItem[] = rows.slice(0, limit).map((p) => ({
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
  return { items, hasMore };
}
