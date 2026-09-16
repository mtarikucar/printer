export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, productImages, products } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getPublicUrl } from "@/lib/services/storage";
import { getProductSpec } from "@/lib/services/product-spec";
import { getCostLines } from "@/lib/services/product-cost-lines";
import { costLineRowFromKurus } from "@/lib/config/cost-line-row";
import { EditProductClient } from "./edit-client";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    redirect("/manufacturer/dashboard");
  }

  const { id } = await params;

  // `with:` BİLEREK YOK: görseller yalnızca GÖSTERİLİYOR, ama ilişkisel sorgu
  // TEK ifadedir — `product_images` okunamadığında düzenleme sayfasının tamamı
  // 500 verirdi.
  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, id),
      eq(products.manufacturerId, session.manufacturerId)
    ),
  });

  if (!product) notFound();

  // Düzenleme formu: okunamayan bölüm boş gelirse KAYDEDİLDİĞİNDE gerçekten
  // silinir. O yüzden eksik veriyle form açılmaz; sayfa sebebi yazar.
  const [imageRead, specRead, costRead] = await Promise.all([
    db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sortOrder))
      .catch((e) => {
        console.error("ürün düzenleme: görseller okunamadı", e);
        return null;
      }),
    getProductSpec(product.id).catch((e) => {
      console.error("ürün düzenleme: üretim künyesi okunamadı", e);
      return null;
    }),
    getCostLines(product.id).catch((e) => {
      console.error("ürün düzenleme: maliyet kalemleri okunamadı", e);
      return null;
    }),
  ]);
  const unreadable = [
    imageRead === null && "ürün görselleri",
    specRead === null && "üretim künyesi (dosyalar, malzeme listesi, montaj adımları)",
    costRead === null && "maliyet kalemleri",
  ].filter((x): x is string => typeof x === "string");
  // Daraltma TEK TEK yapılır: `unreadable.length > 0` TypeScript'e null'ların
  // elendiğini SÖYLEMEZ, oysa aşağısı bu değerlerin dolu olmasına dayanır.
  if (imageRead === null || specRead === null || costRead === null) {
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
            DEĞİL, BİLİNMİYOR — boş bir formu kaydetseydiniz o kayıtlar gerçekten
            silinecekti. Ürününüz ve verileri yerinde duruyor; birkaç dakika
            sonra sayfayı yenileyin.
          </p>
        </div>
      </div>
    );
  }

  const images = imageRead.map((img) => ({
    id: img.id,
    url: getPublicUrl(img.storageKey),
  }));

  // Yukarıda KORUMALI okundu; burada ikinci kez sorgulanmaz.
  const spec = specRead;
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

  const costLines = costRead;

  const serialized = {
    id: product.id,
    title: product.title,
    description: product.description,
    priceKurus: product.priceKurus,
    costLines: costLines.map(costLineRowFromKurus),
    material: product.material,
    categoryId: product.categoryId,
    leadTimeDays: product.leadTimeDays,
    status: product.status,
    rejectionReason: product.rejectionReason,
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <EditProductClient
        product={serialized}
        initialImages={images}
        initialFiles={spec.files}
        initialComponents={initialComponents}
        initialSteps={initialSteps}
      />
    </div>
  );
}
