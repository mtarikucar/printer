import type { MetadataRoute } from "next";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { pageUpdatedAt } from "@/lib/config/page-updated";

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
  // /create artık sunucu bileşeni ve ürün gerçeklerini (ölçü, fiyat, teslim
  // süresi) Suspense sınırının DIŞINDA yayınlıyor — önceliğin 0.5'te tutulma
  // gerekçesi (gövdesiz istemci sayfası) 2026-10-02'de ortadan kalktı. Huninin
  // girişi olduğu için /shop ile aynı kademede.
  { path: "/create", changeFrequency: "weekly", priority: 0.9 },
  { path: "/figur", changeFrequency: "weekly", priority: 0.8 },
  // Instant 3D-printing quote: the service landing page and its material
  // library. Both are server-rendered with catalogue numbers, which is what
  // makes them worth crawling; the quote workspace itself is noindex.
  { path: "/3d-baski", changeFrequency: "weekly", priority: 0.9 },
  { path: "/3d-baski/malzemeler", changeFrequency: "monthly", priority: 0.7 },
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

  // `lastModified` SAYFANIN TARİHİDİR, render anının değil.
  //
  // Burada eskiden `new Date()` vardı: her istekte "şimdi" diyen bir sitemap
  // tazelik SİNYALİ değil GÜRÜLTÜDÜR — içerik altı ay önce yazılmış olsa bile
  // taze görünür, ve arama motorları sürekli "şimdi" diyen bir `lastmod`u
  // yok saymayı öğrenince gerçek bir güncelleme de duyulmaz olur.
  //
  // Tarih `PAGE_UPDATED_AT`ten gelir; yani sayfaların GÖRÜNÜR "Son güncelleme"
  // satırıyla AYNI kaynak (ikinci bir tarih listesi tutulmuyor). Günün ortası
  // UTC: tarih yerel saat diliminde (Europe/Istanbul) kaymasın.
  //
  // Listede olmayan bir yol için tarih UYDURULMAZ — alan hiç yazılmaz, çünkü
  // yanlış bir `lastmod` hiç `lastmod` olmamasından kötüdür.
  // `scripts/test-sitemap.ts` her statik rotanın kayıtlı olmasını zorunlu
  // kılıyor, yani bu dal pratikte boş; yine de sessiz bir "şimdi"ye düşmek
  // yerine alanı atlıyor.
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => {
    const iso = pageUpdatedAt(r.path);
    return {
      url: `${baseUrl}${r.path}`,
      ...(iso ? { lastModified: new Date(`${iso}T12:00:00Z`) } : {}),
      changeFrequency: r.changeFrequency,
      priority: r.priority,
    };
  });

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
