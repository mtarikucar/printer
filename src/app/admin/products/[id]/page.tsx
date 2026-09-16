export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, productImages, products } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { getProductSpec } from "@/lib/services/product-spec";
import { getCostLines } from "@/lib/services/product-cost-lines";
import { costLineRowFromKurus } from "@/lib/config/cost-line-row";
import { getLocale } from "@/lib/i18n/get-locale";
import { EditProductClient, type EditableProduct } from "./edit-client";

export default async function AdminEditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();

  // `with:` BİLEREK YOK: görseller ve satıcı adı yalnızca GÖSTERİLİYOR, ama
  // ilişkisel sorgu TEK ifadedir — biri okunamadığında ürün düzenleme
  // sayfasının tamamı 500 verirdi.
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
  });
  if (!product) notFound();

  // BU SAYFA BİR DÜZENLEME FORMUDUR: okunamayan bir bölüm boş gelirse, admin
  // kaydettiği anda o bölümü GERÇEKTEN siler. Bu yüzden burada "boş göster"
  // seçeneği yok — okunamayan bölüm varsa form hiç açılmaz, sayfa sebebi yazar.
  const [imageRead, sellerRead, specRead, costRead] = await Promise.all([
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sortOrder))
      .catch((e) => {
        console.error("admin product edit: görseller okunamadı", e);
        return null;
      }),
    product.manufacturerId
      ? db
          .select({ companyName: manufacturers.companyName })
          .from(manufacturers)
          .where(eq(manufacturers.id, product.manufacturerId))
          .catch((e) => {
            console.error("admin product edit: satıcı adı okunamadı", e);
            return null;
          })
      : [],
    getProductSpec(product.id).catch((e) => {
      console.error("admin product edit: üretim künyesi okunamadı", e);
      return null;
    }),
    getCostLines(product.id).catch((e) => {
      console.error("admin product edit: maliyet kalemleri okunamadı", e);
      return null;
    }),
  ]);
  const unreadable = [
    imageRead === null && "ürün görselleri",
    sellerRead === null && "satıcı adı",
    specRead === null && "üretim künyesi (dosyalar, malzeme listesi, montaj adımları)",
    costRead === null && "maliyet kalemleri",
  ].filter((x): x is string => typeof x === "string");
  // Daraltma TEK TEK yapılır: `unreadable.length > 0` TypeScript'e null'ların
  // elendiğini SÖYLEMEZ, oysa aşağıdaki form bu değerlerin dolu olmasına dayanır.
  if (
    imageRead === null ||
    sellerRead === null ||
    specRead === null ||
    costRead === null
  ) {
    return (
      <div className="p-4 sm:p-8 max-w-3xl">
        <div
          role="alert"
          className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Ürün düzenleme formu şu anda açılamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            Şu bölümler okunamadı: {unreadable.join(" · ")}. Bu bölümler BOŞ
            DEĞİL, BİLİNMİYOR — formu boş değerlerle açsaydık, kaydettiğiniz anda
            o kayıtları gerçekten silecekti. Ürün ve verileri yerinde duruyor;
            birkaç dakika sonra sayfayı yenileyin.
          </p>
        </div>
      </div>
    );
  }
  const spec = specRead;
  const costLines = costRead;
  const productImageRows = imageRead;
  const initialComponents = spec.components.map((c) => ({
    name: c.name,
    quantity: c.quantity,
    unit: c.unit ?? "",
    notes: c.notes ?? "",
  }));
  const initialSteps = spec.steps.map((s) => ({
    instruction: s.instruction,
    imageKey: s.imageKey,
    imageUrl: s.imageUrl,
  }));

  const serialized: EditableProduct = {
    id: product.id,
    ownerType: product.ownerType,
    title: product.title,
    description: product.description,
    priceKurus: product.priceKurus,
    material: product.material,
    categoryId: product.categoryId,
    leadTimeDays: product.leadTimeDays,
    status: product.status,
    rejectionReason: product.rejectionReason,
    sellerName: sellerRead?.[0]?.companyName ?? "Platform",
    // Kalem kırılımı. Boş dizi = kırılımsız (eski) ürün; form o zaman fiyatı
    // tek bir üretim kalemine dönüştürerek başlar.
    costLines: costLines.map(costLineRowFromKurus),
    images: productImageRows
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((img) => ({
        id: img.id,
        url: getPublicUrl(img.storageKey),
        sortOrder: img.sortOrder,
      })),
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <EditProductClient
        product={serialized}
        locale={locale}
        initialFiles={spec.files}
        initialComponents={initialComponents}
        initialSteps={initialSteps}
      />
    </div>
  );
}
