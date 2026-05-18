import type { MetadataRoute } from "next";
import { desc, eq, and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

/**
 * Sitemap surfacing the public, indexable routes plus every published
 * gallery item. Refreshed by Next.js on revalidate (default behaviour for
 * `MetadataRoute` exports).
 *
 * Per-style landing pages (Q2 in the roadmap) will be added here once they
 * ship — until then, gallery filtering does the SEO work.
 */

const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "", changeFrequency: "daily", priority: 1.0 },
  { path: "/create", changeFrequency: "weekly", priority: 0.9 },
  { path: "/gallery", changeFrequency: "daily", priority: 0.8 },
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

  // Public gallery items — published orders that have reached a renderable
  // state. We surface order number as the URL fragment for now; once Q3
  // (per-figurine detail page with slug) ships this becomes a slug-based
  // URL pointing at `/gallery/[slug]`.
  let galleryEntries: MetadataRoute.Sitemap = [];
  try {
    const rows = await db
      .select({
        orderNumber: orders.orderNumber,
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

    galleryEntries = rows.map((r) => ({
      url: `${baseUrl}/gallery#${encodeURIComponent(r.orderNumber)}`,
      lastModified: r.updatedAt ?? r.publishedAt ?? now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    }));
  } catch (err) {
    // Sitemap generation must never crash the route — if DB is down at
    // build / render time we just serve the static portion.
    console.error("[sitemap] gallery query failed", err);
  }

  return [...staticEntries, ...galleryEntries];
}
