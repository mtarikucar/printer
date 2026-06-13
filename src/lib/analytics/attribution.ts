/**
 * Attribution capture helpers. Isomorphic: the param parser + channel derivation
 * run in both the edge middleware (server) and the browser fallback (client).
 *
 * Cookie strategy (all first-party, SameSite=Lax):
 *   - `fig_ft`  first-touch attribution JSON   (180 days, write-once)
 *   - `fig_lt`  last-touch  attribution JSON   (180 days, overwritten on new touch)
 *   - `fig_vid` stable visitor id              (400 days)
 *   - `fig_sid` session id                     (30-min sliding window)
 *
 * These are "necessary"-tier first-party measurement cookies (no third-party
 * tracking, no PII) used to attribute a paid order to the campaign that drove it.
 */

import type { Attribution, AttributionTouch, ClickIds, UtmParams } from "./types";

export const ATTR_COOKIE = {
  firstTouch: "fig_ft",
  lastTouch: "fig_lt",
  visitorId: "fig_vid",
  sessionId: "fig_sid",
} as const;

export const VISITOR_ID_MAX_AGE = 400 * 24 * 60 * 60; // 400 days (Chrome cap)
export const TOUCH_MAX_AGE = 180 * 24 * 60 * 60; // 180 days
export const SESSION_MAX_AGE = 30 * 60; // 30 minutes (sliding)

const UTM_KEYS: Array<[keyof UtmParams, string]> = [
  ["utmSource", "utm_source"],
  ["utmMedium", "utm_medium"],
  ["utmCampaign", "utm_campaign"],
  ["utmContent", "utm_content"],
  ["utmTerm", "utm_term"],
];

const CLICK_KEYS: Array<keyof ClickIds> = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "ttclid",
  "msclkid",
];

const clamp = (v: string, max = 255): string => v.slice(0, max);

/** Extract UTM + click ids from a URLSearchParams-like object. */
export function parseUtmParams(params: URLSearchParams): UtmParams & ClickIds {
  const out: UtmParams & ClickIds = {};
  for (const [field, qs] of UTM_KEYS) {
    const v = params.get(qs);
    if (v) out[field] = clamp(v);
  }
  for (const key of CLICK_KEYS) {
    const v = params.get(key);
    if (v) out[key] = clamp(v);
  }
  return out;
}

/** True when at least one attribution-bearing parameter is present. */
export function hasAttributionParams(p: UtmParams & ClickIds): boolean {
  return Object.values(p).some((v) => typeof v === "string" && v.length > 0);
}

/**
 * Derive a coarse marketing channel from the touch, loosely following GA4's
 * default channel grouping. Used for the admin channel/campaign breakdown.
 */
export function deriveChannel(
  p: UtmParams & ClickIds,
  referrer?: string
): string {
  const source = (p.utmSource ?? "").toLowerCase();
  const medium = (p.utmMedium ?? "").toLowerCase();

  const paidMedium = /(^|[^a-z])(cpc|ppc|paid|paidsearch|paid_social|cpm|cpv|display|retargeting)([^a-z]|$)/.test(
    medium
  );

  if (p.gclid || p.gbraid || p.wbraid || p.msclkid) return "paid_search";
  if (p.ttclid || source.includes("tiktok")) return "paid_social";
  if (p.fbclid) return "paid_social";

  if (medium === "email" || source === "email" || source === "newsletter")
    return "email";
  if (/(facebook|instagram|meta|fb|ig|linkedin|twitter|x\.com|pinterest|snapchat|youtube)/.test(source)) {
    return paidMedium ? "paid_social" : "organic_social";
  }
  if (paidMedium) {
    return /(google|bing|yandex|search)/.test(source)
      ? "paid_search"
      : "paid_other";
  }
  if (medium === "organic" || /(google|bing|yandex|duckduckgo)/.test(source))
    return "organic_search";
  if (source || referrer) return "referral";
  return "direct";
}

/** Build an attribution touch from params + context (returns null when empty). */
export function buildTouch(
  params: UtmParams & ClickIds,
  ctx: { landingPage?: string; referrer?: string; now?: number }
): AttributionTouch | null {
  if (!hasAttributionParams(params) && !ctx.referrer) return null;
  return {
    ...params,
    channel: deriveChannel(params, ctx.referrer),
    landingPage: ctx.landingPage ? clamp(ctx.landingPage, 512) : undefined,
    referrer: ctx.referrer ? clamp(ctx.referrer, 512) : undefined,
    ts: ctx.now ?? Date.now(),
  };
}

/** Safely JSON-parse an attribution cookie value. */
export function parseTouchCookie(value: string | undefined): AttributionTouch | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as AttributionTouch) : null;
  } catch {
    return null;
  }
}

/**
 * Assemble the persisted Attribution object (for a draft/order) from the four
 * cookies. `firstTouch`/`lastTouch` are JSON; ids are opaque strings.
 */
export function attributionFromCookies(get: (name: string) => string | undefined): Attribution {
  return {
    firstTouch: parseTouchCookie(get(ATTR_COOKIE.firstTouch)) ?? undefined,
    lastTouch: parseTouchCookie(get(ATTR_COOKIE.lastTouch)) ?? undefined,
    visitorId: get(ATTR_COOKIE.visitorId) || undefined,
    sessionId: get(ATTR_COOKIE.sessionId) || undefined,
  };
}

/** Flatten the most useful denormalised columns for fast SQL grouping. */
export function denormalizeAttribution(a: Attribution): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  channel: string | null;
  visitorId: string | null;
} {
  // Last-touch wins for "what campaign closed the sale"; fall back to first-touch.
  const t = a.lastTouch ?? a.firstTouch ?? {};
  return {
    utmSource: t.utmSource ?? null,
    utmMedium: t.utmMedium ?? null,
    utmCampaign: t.utmCampaign ?? null,
    utmContent: t.utmContent ?? null,
    utmTerm: t.utmTerm ?? null,
    channel: t.channel ?? (a.lastTouch || a.firstTouch ? "referral" : "direct"),
    visitorId: a.visitorId ?? null,
  };
}
