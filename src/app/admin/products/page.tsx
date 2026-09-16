export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { manufacturers, productImages, products } from "@/lib/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { getPublicUrl } from "@/lib/services/storage";
import { getLocale } from "@/lib/i18n/get-locale";
import { ProductsClient, type AdminProduct } from "./products-client";

export default async function AdminProductsPage() {
  const locale = await getLocale();

  // `with:` BİLEREK YOK: görseller ve satıcı adı yalnızca GÖSTERİLİYOR, ama
  // ilişkisel sorgu TEK ifadedir — biri okunamadığında ürün listesinin tamamı
  // (onay bekleyenler dâhil) kaybolurdu.
  const pending = await db.query.products.findMany({
    where: eq(products.status, "pending_review"),
    orderBy: [desc(products.submittedAt)],
  });

  const all = await db.query.products.findMany({
    orderBy: [desc(products.createdAt)],
  });

  const productIds = [...new Set([...pending, ...all].map((p) => p.id))];
  const sellerIds = [
    ...new Set(
      [...pending, ...all].map((p) => p.manufacturerId).filter((x): x is string => !!x)
    ),
  ];
  const [imageRead, sellerRead] = await Promise.all([
    productIds.length
      ? db
          .select()
          .from(productImages)
          .where(inArray(productImages.productId, productIds))
          .catch((e) => {
            console.error("admin products: görseller okunamadı", e);
            return null;
          })
      : [],
    sellerIds.length
      ? db
          .select({ id: manufacturers.id, companyName: manufacturers.companyName })
          .from(manufacturers)
          .where(inArray(manufacturers.id, sellerIds))
          .catch((e) => {
            console.error("admin products: satıcı adları okunamadı", e);
            return null;
          })
      : [],
  ]);
  const imagesUnreadable = imageRead === null;
  type ProductImageRow = NonNullable<typeof imageRead>[number];
  const imagesByProduct = new Map<string, ProductImageRow[]>();
  for (const img of imageRead ?? []) {
    const list = imagesByProduct.get(img.productId) ?? [];
    list.push(img);
    imagesByProduct.set(img.productId, list);
  }
  const sellersUnreadable = sellerRead === null;
  const sellerById = new Map((sellerRead ?? []).map((m) => [m.id, m.companyName]));

  const serialize = (p: (typeof all)[number]): AdminProduct => ({
    id: p.id,
    slug: p.slug,
    ownerType: p.ownerType,
    title: p.title,
    priceKurus: p.priceKurus,
    description: p.description,
    material: p.material,
    category: p.category,
    leadTimeDays: p.leadTimeDays,
    status: p.status,
    rejectionReason: p.rejectionReason,
    sellerName: p.manufacturerId
      ? sellerById.get(p.manufacturerId) ??
        (sellersUnreadable ? "Satıcı adı okunamadı" : "Platform")
      : "Platform",
    createdAt: p.createdAt.toISOString(),
    submittedAt: p.submittedAt ? p.submittedAt.toISOString() : null,
    primaryImageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    images: (imagesByProduct.get(p.id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((img) => ({
        id: img.id,
        url: getPublicUrl(img.storageKey),
        sortOrder: img.sortOrder,
      })),
  });

  return (
    <div className="p-4 sm:p-8">
      {(imagesUnreadable || sellersUnreadable) && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Listenin bazı bilgileri şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            {[
              imagesUnreadable &&
                "ürün görselleri (kartlarda görsel yok gibi görünüyor — SİLİNMEDİLER)",
              sellersUnreadable && "satıcı adları",
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            okunamadı: bu alanlar BOŞ DEĞİL, bilinmiyor. Ürünler ve durumları
            gerçektir; görselleri GÖRMEDEN onay/ret vermeyin.
          </p>
        </div>
      )}
      <ProductsClient
        pending={pending.map(serialize)}
        all={all.map(serialize)}
        locale={locale}
      />
    </div>
  );
}
