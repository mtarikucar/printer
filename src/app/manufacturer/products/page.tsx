export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, productImages, products } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { getPublicUrl } from "@/lib/services/storage";
import { ProductsClient } from "./products-client";

export default async function ManufacturerProductsPage() {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    redirect("/manufacturer/dashboard");
  }

  const locale = await getLocale();

  // `with:` BİLEREK YOK: görsel SAYISI yalnızca gösteriliyor, ama ilişkisel
  // sorgu TEK ifadedir — `product_images` okunamadığında ürün listesinin tamamı
  // kaybolurdu.
  const rows = await db.query.products.findMany({
    where: eq(products.manufacturerId, session.manufacturerId),
    orderBy: [desc(products.createdAt)],
  });

  const productIds = rows.map((p) => p.id);
  const imageRead = productIds.length
    ? await db
        .select({ productId: productImages.productId })
        .from(productImages)
        .where(inArray(productImages.productId, productIds))
        .catch((e) => {
          console.error("ürünlerim: görsel sayıları okunamadı", e);
          return null;
        })
    : [];
  const imageCountsUnreadable = imageRead === null;
  const imageCountByProduct = new Map<string, number>();
  for (const img of imageRead ?? []) {
    imageCountByProduct.set(img.productId, (imageCountByProduct.get(img.productId) ?? 0) + 1);
  }

  const list = rows.map((p) => ({
    id: p.id,
    title: p.title,
    priceKurus: p.priceKurus,
    status: p.status,
    category: p.category,
    material: p.material,
    imageCount: imageCountByProduct.get(p.id) ?? 0,
    primaryImageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      {imageCountsUnreadable && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Görsel sayıları şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            Kartlarda &quot;0 görsel&quot; görünüyor; bu bir ÖLÇÜM değil,
            okunamayan bir kayıttır. Yüklediğiniz görseller SİLİNMEDİ — yeniden
            yüklemeyin, birkaç dakika sonra sayfayı yenileyin.
          </p>
        </div>
      )}
      <ProductsClient products={list} locale={locale} />
    </div>
  );
}
