import type { MetadataRoute } from "next";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";

/**
 * Sitemap of the public, indexable surface: the static routes plus every
 * active marketplace product.
 *
 * Product URLs were missing entirely, so the whole catalogue was undiscoverable
 * — a crawler could only reach the first 24 items rendered on /shop, and the
 * rest sat behind a robots-disallowed /api pagination call.
 *
 * Every path here must be crawlable per `src/app/robots.ts`; a sitemap entry
 * that robots blocks produces a Search Console warning. `scripts/test-sitemap.ts`
 * asserts that.
 */

/** Revalidate hourly so the product query does not run on every request. */
export const revalidate = 3600;

export const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "", changeFrequency: "daily", priority: 1.0 },
  { path: "/shop", changeFrequency: "daily", priority: 0.9 },
  // /create is a client component with no server-rendered body yet, so it is
  // deliberately NOT at 0.9 — raise it once the page has a server shell.
  { path: "/create", changeFrequency: "weekly", priority: 0.5 },
  { path: "/figur", changeFrequency: "weekly", priority: 0.8 },
  { path: "/urunler", changeFrequency: "weekly", priority: 0.7 },
  { path: "/nasil-calisir", changeFrequency: "monthly", priority: 0.7 },
  { path: "/toplu-siparis", changeFrequency: "monthly", priority: 0.6 },
  { path: "/anahtarlik-kutusu", changeFrequency: "monthly", priority: 0.6 },
  { path: "/atolye", changeFrequency: "monthly", priority: 0.5 },
  { path: "/kargo", changeFrequency: "monthly", priority: 0.4 },
  { path: "/iade", changeFrequency: "monthly", priority: 0.4 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/cerez", changeFrequency: "yearly", priority: 0.3 },
  { path: "/mesafeli-satis", changeFrequency: "yearly", priority: 0.3 },
  { path: "/on-bilgilendirme", changeFrequency: "yearly", priority: 0.3 },
  { path: "/ticari-ileti", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${baseUrl}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // `products.slug` is nullable (`text("slug").unique()`, no `.notNull()`), so a
  // row without one would produce `/shop/null`.
  let productEntries: MetadataRoute.Sitemap = [];
  try {
    const rows = await db
      .select({ slug: products.slug, updatedAt: products.updatedAt })
      .from(products)
      .where(and(eq(products.status, "active"), isNotNull(products.slug)));

    // `products.updatedAt` is `.notNull().defaultNow()` (schema.ts:1428), so it
    // is always a real Date — no fallback needed.
    productEntries = rows.map((row) => ({
      url: `${baseUrl}/shop/${row.slug}`,
      lastModified: row.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));
  } catch {
    // A DB hiccup must not make /sitemap.xml a 500 — search engines treat a
    // failing sitemap as a hard error and stop re-fetching it. Degrade to the
    // static routes instead.
    productEntries = [];
  }

  return [...staticEntries, ...productEntries];
}
