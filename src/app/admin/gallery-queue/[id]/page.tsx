export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts } from "@/lib/db/schema";
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
    },
  });
  if (!order) notFound();

  return (
    <div className="p-8 max-w-4xl">
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
          glbUrl: order.generationAttempts[0]?.outputGlbUrl ?? null,
        }}
      />
    </div>
  );
}
