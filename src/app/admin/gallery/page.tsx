export const dynamic = "force-dynamic";

import { listPublishedGalleryItems } from "@/lib/services/gallery-review";
import { normalizeFileUrl } from "@/lib/services/storage";
import { AdminGalleryClient } from "./client";

/**
 * Admin curation surface for the public gallery. Lists every published
 * figurine (featured first) and lets the admin toggle which ones appear in
 * the "Öne Çıkan Figürinler" rail at the top of /gallery.
 */
export default async function AdminGalleryPage() {
  const rows = await listPublishedGalleryItems(200);
  const items = rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    name: r.publicDisplayName || r.customerName,
    figurineSize: r.figurineSize,
    style: r.style,
    category: r.galleryCategory,
    tags: r.galleryTags ?? [],
    slug: r.gallerySlug,
    featured: r.galleryFeatured,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    thumbnailUrl: normalizeFileUrl(r.photos[0]?.originalUrl ?? null),
  }));

  return <AdminGalleryClient items={items} />;
}
