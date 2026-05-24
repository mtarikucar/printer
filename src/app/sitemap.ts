import type { MetadataRoute } from "next";
import { desc, eq, and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { STYLE_SLUGS } from "@/lib/styles/landing-content";

/**
 * Sitemap surfacing the public, indexable routes plus every published
 * gallery item. Refreshed by Next.js on revalidate (default behaviour for
 * `MetadataRoute` exports).
 *
 * Per-style landing pages (Q2 in the roadmap) are listed below for SEO.
 */

const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "", changeFrequency: "daily", priority: 1.0 },
  { path: "/create", changeFrequency: "weekly", priority: 0.9 },
  { path: "/gallery", changeFrequency: "daily", priority: 0.8 },
  { path: "/styles", changeFrequency: "monthly", priority: 0.8 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${baseUrl}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // Per-style landing pages (Q2). Each carries paid-ad + SEO weight and is
  // pre-rendered, so we surface them at a high priority.
  const styleEntries: MetadataRoute.Sitemap = STYLE_SLUGS.map((slug) => ({
    url: `${baseUrl}/styles/${slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.85,
  }));

  // Public gallery items — published orders that have reached a renderable
  // state. We surface order number as the URL fragment for now; once Q3
  // (per-figurine detail page with slug) ships this becomes a slug-based
  // URL pointing at `/gallery/[slug]`.
  let galleryEntries: MetadataRoute.Sitemap = [];
  try {
    const rows = await db
      .select({
        orderNumber: orders.orderNumber,
        gallerySlug: orders.gallerySlug,
        publishedAt: orders.publishedAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.isPublic, true),
          inArray(orders.status, ["approved", "printing", "shipped", "delivered"])
        )
      )
      .orderBy(desc(orders.publishedAt))
      .limit(5000);

    // Rows approved before Q3 don't have a slug yet. Fall back to a
    // fragment URL on /gallery so the orderNumber still lands somewhere
    // usable; once admin re-saves the row a slug gets generated.
    galleryEntries = rows.map((r) => ({
      url: r.gallerySlug
        ? `${baseUrl}/gallery/${r.gallerySlug}`
        : `${baseUrl}/gallery#${encodeURIComponent(r.orderNumber)}`,
      lastModified: r.updatedAt ?? r.publishedAt ?? now,
      changeFrequency: "monthly" as const,
      priority: r.gallerySlug ? 0.7 : 0.5,
    }));
  } catch (err) {
    // Sitemap generation must never crash the route — if DB is down at
    // build / render time we just serve the static portion.
    console.error("[sitemap] gallery query failed", err);
  }

  return [...staticEntries, ...styleEntries, ...galleryEntries];
}
