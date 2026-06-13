/**
 * Central analytics configuration. Reads the public (NEXT_PUBLIC_*) tag IDs that
 * are safe to inline into the client bundle, plus a couple of behaviour flags.
 *
 * Everything here is intentionally *isomorphic* — it must be importable from both
 * server and client code. Server-only secrets (CAPI tokens, measurement-protocol
 * api_secret, …) live in `server-dispatch.ts` and are read from `process.env`
 * lazily so they never leak into the browser bundle.
 *
 * Design goal: when no IDs are configured every tag/event becomes a no-op, so the
 * whole stack is safe to ship before the marketing accounts exist. Nothing throws.
 */

const trim = (v: string | undefined): string => (v ?? "").trim();

/** Google Tag Manager container, e.g. "GTM-XXXXXX". Preferred entry point. */
export const GTM_ID = trim(process.env.NEXT_PUBLIC_GTM_ID);

/** GA4 Measurement ID, e.g. "G-XXXXXXXXXX". */
export const GA4_ID = trim(process.env.NEXT_PUBLIC_GA4_ID);

/** Meta (Facebook) Pixel ID. */
export const META_PIXEL_ID = trim(process.env.NEXT_PUBLIC_META_PIXEL_ID);

/** TikTok Pixel ID. */
export const TIKTOK_PIXEL_ID = trim(process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID);

/** Sentry browser DSN (public by design). */
export const SENTRY_DSN = trim(process.env.NEXT_PUBLIC_SENTRY_DSN);

/** Default purchase/value currency. Figurünica is TRY-only today. */
export const CURRENCY = "TRY";

/**
 * When true, the client tracker mirrors every event to `console.debug` and the
 * server dispatcher logs each forwarded payload. Enable in staging to verify the
 * funnel without opening the vendor debuggers. Off in production by default.
 */
export const ANALYTICS_DEBUG =
  trim(process.env.NEXT_PUBLIC_ANALYTICS_DEBUG) === "1";

/** GTM is the preferred container; true when an ID is configured. */
export const hasGTM = GTM_ID.length > 0;
export const hasGA4 = GA4_ID.length > 0;
export const hasMetaPixel = META_PIXEL_ID.length > 0;
export const hasTikTokPixel = TIKTOK_PIXEL_ID.length > 0;

/**
 * Whether any browser tag at all is configured. Used to decide if the consent
 * banner / tag loader needs to render. (Sentry is independent of consent.)
 */
export const hasAnyClientTag =
  hasGTM || hasGA4 || hasMetaPixel || hasTikTokPixel;
