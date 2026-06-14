import type { MetadataRoute } from "next";

/**
 * Public crawl directives. Block all `/admin/*`, `/api/*`, `/manufacturer/*`
 * (private business panel), and the customer-only `/account` + `/track/*`
 * pages — they're not indexable anyway (require session) and we don't want
 * search engines wasting crawl budget on them.
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
          "/account",
          "/track/",
          "/havale/",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password/",
          "/verify-email/",
          "/cart",
          "/checkout",
          "/quote/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
