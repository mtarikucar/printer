export const dynamic = "force-dynamic";

import { listPublishedGalleryItems, listPendingGalleryReviews } from "@/lib/services/gallery-review";
import { normalizeFileUrl } from "@/lib/services/storage";
import { AdminGalleryClient } from "./client";

/**
 * Admin gallery surface. Two sub-tabs on a single page:
 *  - "Kuyruk" (?tab=queue): publication requests awaiting review (was /admin/gallery-queue).
 *  - "Yayında" (default): published figurines + featured curation.
 */
export default async function AdminGalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab = tab === "queue" ? "queue" : "published";

  const [rows, pendingRows] = await Promise.all([
    listPublishedGalleryItems(200),
    listPendingGalleryReviews(200),
  ]);

  const items = rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    name: r.publicDisplayName || r.customerName,
    // Gallery only ever contains custom figurines (marketplace products are not
    // published here), so figurineSize is always set; coalesce for the type.
    figurineSize: r.figurineSize ?? "",
    style: r.style,
    category: r.galleryCategory,
    tags: r.galleryTags ?? [],
    slug: r.gallerySlug,
    featured: r.galleryFeatured,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    thumbnailUrl: normalizeFileUrl(r.photos[0]?.originalUrl ?? null),
  }));

  const pending = pendingRows.map((it) => ({
    id: it.id,
    orderNumber: it.orderNumber,
    name: it.publicDisplayName || it.customerName,
    figurineSize: it.figurineSize ?? "",
    style: it.style,
    category: it.galleryCategory,
    tags: it.galleryTags ?? [],
    createdAt: it.createdAt.toISOString(),
  }));

  return <AdminGalleryClient items={items} pending={pending} initialTab={initialTab} />;
}
