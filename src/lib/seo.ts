/**
 * Central SEO policy. Both the canonical URL and the noindex decision are
 * derived from the request pathname in the root layout's `generateMetadata`
 * (fed by the `x-pathname` header the middleware sets), so every route — server
 * or client component, static or faceted — gets a correct self-referencing
 * canonical and the right index directive from a single place. This is what
 * consolidates `/shop?category=…` / `?utm=…` variants onto one indexable URL
 * and keeps private/transactional pages out of the index.
 */

/**
 * Path prefixes that must never be indexed: per-user account/session pages,
 * auth utility screens and transactional/token URLs. A page matches when its
 * pathname equals the prefix or sits directly beneath it.
 *
 * Note: prefixes that also appear in `robots.ts` disallow (e.g. `/cart`,
 * `/checkout`, `/pay`) can't actually be crawled to see this `noindex` — the
 * robots block already keeps them out. Listing them here is belt-and-suspenders
 * so the directive is correct if the robots block is ever relaxed. The pages
 * that rely on this to be de-indexed (`/account`, `/login`, `/register`,
 * `/forgot-password`) are intentionally left crawlable in `robots.ts`.
 */
export const NOINDEX_PREFIXES = [
  "/account",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/cart",
  "/checkout",
  "/track",
  "/quote",
  "/havale",
  "/pay",
] as const;

/** True when `pathname` is (or sits under) a route that must not be indexed. */
export function isNoindexPath(pathname: string): boolean {
  return NOINDEX_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}
