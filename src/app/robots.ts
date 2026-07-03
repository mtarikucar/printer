import type { MetadataRoute } from "next";

/**
 * Public crawl directives. Block infra (`/admin/*`, `/api/*`,
 * `/manufacturer/*`, the Sentry tunnel `/monitoring`) and transactional /
 * token-bearing customer URLs (`/cart`, `/checkout`, `/pay/*`, `/track/*`,
 * `/havale/*`, `/quote/*`, `/reset-password/*`, `/verify-email/*`) — we don't
 * want them crawled at all.
 *
 * NOT blocked here (deliberately): `/account`, `/login`, `/register`,
 * `/forgot-password`. Google keeps discovering these via nav links, and a
 * robots.txt block only lands them in Search Console's "Blocked by robots.txt"
 * bucket without ever de-indexing them (Google can't read a `noindex` it isn't
 * allowed to crawl). Instead they stay crawlable and the root layout emits
 * `noindex` for them (see `@/lib/seo` → NOINDEX_PREFIXES), which actually drops
 * them from the index and clears that report.
 *
 * Sitemap reference points to /sitemap.xml (Next.js auto-generates from
 * `src/app/sitemap.ts`).
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/shop", "/nasil-calisir", "/privacy", "/terms"],
        disallow: [
          "/admin/",
          "/api/",
          "/manufacturer/",
          "/monitoring",
          "/cart",
          "/checkout",
          "/pay/",
          "/track/",
          "/havale/",
          "/quote/",
          "/reset-password/",
          "/verify-email/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
