import type { MetadataRoute } from "next";

/**
 * Crawl policy, split by what a bot actually DOES.
 *
 * The distinction that matters: a RETRIEVAL bot fetches a page so an AI
 * assistant can answer with it and cite us; a TRAINING crawler collects text
 * for a future model and never sends anyone here. OpenAI's own docs are
 * explicit — "Sites that are opted out of OAI-SearchBot will not be shown in
 * ChatGPT search answers", while GPTBot merely "indicates a site's content
 * should not be used in training". So we allow every retrieval bot by name and
 * disallow the pure training crawlers: we get cited without feeding training
 * corpora. Nine of the eleven retrieval bots are not training crawlers at all,
 * so this costs nothing.
 *
 * `facebookexternalhit` is deliberately absent from every disallow list — it
 * renders WhatsApp/Instagram link previews, and WhatsApp is where our orders
 * come from.
 *
 * Blocked for everyone: infra (`/admin`, `/api`, `/manufacturer`, `/painter`,
 * the Sentry tunnel `/monitoring`) and transactional / token-bearing customer
 * URLs. One carve-out: `/api/files/products/` — storefront product photos are
 * served from there and a `Product.image` pointing at a robots-blocked URL is
 * dropped by Google and disapproved by Merchant Center. robots.txt matching is
 * longest-match-wins, so the 21-character Allow beats `Disallow: /api/`.
 *
 * NOT blocked (deliberately): `/account`, `/login`, `/register`,
 * `/forgot-password`. Google keeps discovering these via nav links, and a
 * robots.txt block only lands them in Search Console's "Blocked by robots.txt"
 * bucket without ever de-indexing them (Google can't read a `noindex` it isn't
 * allowed to crawl). Instead they stay crawlable and the root layout emits
 * `noindex` for them (see `@/lib/seo/policy` → NOINDEX_PREFIXES), which actually drops
 * them from the index and clears that report.
 */

/** Fetch pages so an AI assistant can answer with — and cite — them. */
const RETRIEVAL_BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "OAI-AdsBot",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "Googlebot",
  "Googlebot-Image",
  "bingbot",
  "Applebot",
  "meta-webindexer",
  "Amzn-SearchBot",
  "Amzn-User",
  "MistralAI-Index",
  "MistralAI-User",
  "DuckAssistBot",
  "YouBot",
] as const;

/** Collect text for model training. Blocking these costs zero citations. */
const TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "meta-externalagent",
  "Amazonbot",
  "MistralAI-Training",
  "Webzio-Extended",
  "Diffbot",
  "cohere-training-data-crawler",
] as const;

/**
 * Storefront product photos — the one `/api/` path crawlers must reach.
 *
 * Task 8 moves product images to an unsigned `/media/products/` route, which is
 * allowed by default (no disallow covers it). This carve-out stays anyway: URLs
 * already indexed under `/api/files/products/` keep working, and a call site
 * that was missed during the `getPublicImageUrl` migration still emits one.
 */
const PRODUCT_IMAGES = "/api/files/products/";

const DISALLOW = [
  "/admin/",
  "/api/",
  "/manufacturer/",
  "/painter/",
  "/monitoring",
  "/cart",
  "/checkout",
  "/pay/",
  "/track/",
  "/havale/",
  "/quote/",
  "/yolculuk/",
  "/atolye/katil/",
  "/reset-password/",
  "/verify-email/",
  // Account and auth surfaces. Nothing here is useful in a search result or an
  // AI answer, and /account is a private page. They also carry `noindex`
  // metadata: robots.txt stops crawling, but a URL discovered elsewhere can
  // still be indexed without the meta tag.
  "/account",
  "/login",
  "/register",
  "/forgot-password",
];

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";

  return {
    rules: [
      {
        userAgent: [...RETRIEVAL_BOTS],
        allow: ["/", PRODUCT_IMAGES],
        disallow: DISALLOW,
      },
      {
        userAgent: "*",
        allow: ["/", PRODUCT_IMAGES],
        disallow: DISALLOW,
      },
      {
        userAgent: [...TRAINING_BOTS],
        disallow: ["/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    // robots.txt's `Host` directive takes a bare hostname (Yandex-only, but be
    // correct); `baseUrl` is a full URL.
    host: new URL(baseUrl).host,
  };
}
