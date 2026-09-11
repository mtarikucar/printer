export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts } from "@/lib/db/schema";
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
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        orderBy: [desc(generationAttempts.createdAt)],
        limit: 1,
        columns: { outputGlbUrl: true },
      },
      photos: {
        columns: { originalUrl: true, thumbnailUrl: true },
        limit: 1,
      },
    },
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

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <GalleryReviewClient
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
          photoUrl: order.photos[0]?.originalUrl ?? null,
          // The generation attempt stands in only for an order with no model of
          // its own — otherwise an STL-only revision would preview the
          // superseded generated mesh here as if it were the figure.
          glbUrl: currentModelUrl(order, "glb", order.generationAttempts[0]),
          // Separate from glbUrl so an STL-only order reads "no 3D preview"
          // rather than "GLB not ready": the gallery publishes from the photo
          // and never needs a GLB.
          hasModel: orderHasOwnModel(order) || order.generationAttempts.length > 0,
        }}
      />
    </div>
  );
}
