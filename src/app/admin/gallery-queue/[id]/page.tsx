export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq, desc, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts } from "@/lib/db/schema";
import { currentModelUrl, orderHasOwnModel } from "@/lib/config/order-model-presence";
import { GalleryReviewClient } from "./client";

export default async function AdminGalleryReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    // `with:` BİLEREK YOK: fotoğraf ve eski üretim denemesi yalnızca
    // GÖSTERİLİYOR, ama ilişkisel sorgu TEK ifadedir — biri okunamadığında
    // galeri inceleme sayfasının tamamı 500 verirdi.
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      email: true,
      figurineSize: true,
      style: true,
      modifiers: true,
      publicDisplayName: true,
      galleryCategory: true,
      galleryTags: true,
      galleryReviewStatus: true,
      galleryReviewReason: true,
      createdAt: true,
      // Admin-uploaded model is the real source since auto-3D was removed.
      modelUploadedAt: true,
      modelGlbKey: true,
      modelGlbUrl: true,
      modelStlKey: true,
      modelStlUrl: true,
    },
  });
  if (!order) notFound();

  // Yalnız GÖSTERİLEN iki okuma: ayrı ve korumalı.
  const [photoRead, attemptRead] = await Promise.all([
    db
      .select({ originalUrl: orderPhotos.originalUrl })
      .from(orderPhotos)
      .where(eq(orderPhotos.orderId, id))
      .limit(1)
      .catch((e) => {
        console.error("gallery-queue: müşteri fotoğrafı okunamadı", e);
        return null;
      }),
    db
      .select({ outputGlbUrl: generationAttempts.outputGlbUrl })
      .from(generationAttempts)
      .where(
        and(eq(generationAttempts.orderId, id), eq(generationAttempts.status, "succeeded"))
      )
      .orderBy(desc(generationAttempts.createdAt))
      .limit(1)
      .catch((e) => {
        console.error("gallery-queue: eski üretim denemesi okunamadı", e);
        return null;
      }),
  ]);
  const photosUnreadable = photoRead === null;
  const photoRows = photoRead ?? [];
  const attemptsUnreadable = attemptRead === null;
  const attemptRows = attemptRead ?? [];

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      {(photosUnreadable || attemptsUnreadable) && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
        >
          <p className="font-semibold">
            Bu siparişin bazı görselleri şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            {[
              photosUnreadable && "müşterinin yüklediği fotoğraf",
              attemptsUnreadable && "eski üretim denemesinin 3B çıktısı",
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            okunamadı: BOŞ DEĞİL, bilinmiyor. Galeriye yayımlama kararını
            görselleri GÖRMEDEN vermeyin; birkaç dakika sonra sayfayı yenileyin.
          </p>
        </div>
      )}
      {/* KARAR KAPISI İSTEMCİYE GEÇER.
          Bu ekranın tek işi, müşterinin görselini GÖREREK yayımlama kararı
          vermek. Bayrak gönderilmediğinde istemci, okunamayan fotoğrafı
          "fotoğraf yok" diye ÖLÇÜLMÜŞ bir yokluk gibi gösteriyor ve üç kararı
          da (onayla, hediye çeki + onayla, reddet) açık bırakıyordu — yukarıdaki
          şeridin "görselleri GÖRMEDEN karar vermeyin" cümlesinin tam tersi. */}
      <GalleryReviewClient
        photoUnreadable={photosUnreadable}
        modelUnreadable={attemptsUnreadable}
        review={{
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          email: order.email,
          figurineSize: order.figurineSize ?? "",
          style: order.style,
          modifiers: order.modifiers ?? [],
          publicDisplayName: order.publicDisplayName,
          galleryCategory: order.galleryCategory,
          galleryTags: order.galleryTags ?? [],
          galleryReviewStatus: order.galleryReviewStatus,
          galleryReviewReason: order.galleryReviewReason,
          createdAt: order.createdAt.toISOString(),
          photoUrl: photoRows[0]?.originalUrl ?? null,
          // The generation attempt stands in only for an order with no model of
          // its own — otherwise an STL-only revision would preview the
          // superseded generated mesh here as if it were the figure.
          glbUrl: currentModelUrl(order, "glb", attemptRows[0]),
          // Separate from glbUrl so an STL-only order reads "no 3D preview"
          // rather than "GLB not ready": the gallery publishes from the photo
          // and never needs a GLB.
          hasModel: orderHasOwnModel(order) || attemptRows.length > 0,
        }}
      />
    </div>
  );
}
