import type { Metadata } from "next";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { productPriceTiers, products } from "@/lib/db/schema";
import { SiteHeader } from "@/components/site-header";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { queryShopProducts } from "@/lib/services/shop-query";
import { effectiveMaxQty } from "@/lib/config/bulk";
import { BulkOrderClient, type BulkProduct } from "./bulk-order-client";

export const metadata: Metadata = {
  title: "Toplu Sipariş | Figurunica",
  description:
    "Anahtarlık, magnet ve diğer küçük ürünlerde adet arttıkça birim fiyat düşer. Ürünleri seçin, adetleri girin, tek seferde sepete ekleyin.",
};

// The bulk order sheet: every bulk-eligible product in one table with a
// quantity box per row and a single "add everything" button. Reuses the
// storefront's own catalogue query so the active-product and suspended-seller
// gates can't drift from /shop.
export default async function TopluSiparisPage() {
  const dict = getDictionary(await getLocale());
  const { items } = await queryShopProducts({ bulkOnly: true, limit: 60 });

  const ids = items.map((i) => i.id);
  const [tierRows, settingRows] = await Promise.all([
    ids.length
      ? db
          .select({
            productId: productPriceTiers.productId,
            minQuantity: productPriceTiers.minQuantity,
            unitPriceKurus: productPriceTiers.unitPriceKurus,
          })
          .from(productPriceTiers)
          .where(inArray(productPriceTiers.productId, ids))
          .orderBy(asc(productPriceTiers.minQuantity))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            id: products.id,
            bulkEnabled: products.bulkEnabled,
            bulkMaxQuantity: products.bulkMaxQuantity,
            bulkLeadTimeDays: products.bulkLeadTimeDays,
          })
          .from(products)
          .where(and(inArray(products.id, ids), eq(products.bulkEnabled, true)))
      : Promise.resolve([]),
  ]);

  const settingsById = new Map(settingRows.map((s) => [s.id, s]));
  const tiersByProduct = new Map<
    string,
    Array<{ minQuantity: number; unitPriceKurus: number }>
  >();
  for (const t of tierRows) {
    const list = tiersByProduct.get(t.productId) ?? [];
    list.push({ minQuantity: t.minQuantity, unitPriceKurus: t.unitPriceKurus });
    tiersByProduct.set(t.productId, list);
  }

  const bulkProducts: BulkProduct[] = items.map((p) => {
    const s = settingsById.get(p.id);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      imageUrl: p.imageUrl,
      priceKurus: p.priceKurus,
      leadTimeDays: s?.bulkLeadTimeDays ?? p.leadTimeDays,
      maxQuantity: effectiveMaxQty({
        bulkEnabled: s?.bulkEnabled ?? true,
        bulkMaxQuantity: s?.bulkMaxQuantity ?? null,
      }),
      tiers: tiersByProduct.get(p.id) ?? [],
    };
  });

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-serif text-3xl text-text-primary">
          {dict["bulk.title"]}
        </h1>
        <p className="mt-2 max-w-2xl text-text-secondary">{dict["bulk.intro"]}</p>

        <BulkOrderClient products={bulkProducts} />
      </div>
    </main>
  );
}
