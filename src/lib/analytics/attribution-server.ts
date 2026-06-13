/**
 * Server-side attribution reader. Reconstructs the full {@link Attribution}
 * snapshot from the first-party cookies set by the edge middleware, plus the
 * consent decision, so it can be persisted on an order draft at checkout time.
 *
 * Server-only — depends on Next request/cookie primitives.
 */

import "server-only";
import type { NextRequest } from "next/server";
import { attributionFromCookies, denormalizeAttribution } from "./attribution";
import { parseConsent, defaultConsent } from "./consent";
import { CONSENT_COOKIE } from "./consent";
import type { Attribution } from "./types";

/**
 * Build the attribution snapshot from a NextRequest's cookies, embedding the
 * consent decision so a later out-of-request emitter can honour it.
 */
export function attributionFromRequest(request: NextRequest): Attribution {
  const get = (name: string) => request.cookies.get(name)?.value;
  const attribution = attributionFromCookies(get);
  const consent = parseConsent(get(CONSENT_COOKIE)) ?? defaultConsent();
  attribution.consent = { analytics: consent.analytics, marketing: consent.marketing };
  return attribution;
}

/**
 * Map an attribution snapshot to the denormalised draft/order columns. Returns
 * the column object ready to spread into a drizzle insert.
 */
export function attributionColumns(a: Attribution): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  attributionChannel: string | null;
  visitorId: string | null;
  attribution: Attribution;
} {
  const d = denormalizeAttribution(a);
  return {
    utmSource: d.utmSource,
    utmMedium: d.utmMedium,
    utmCampaign: d.utmCampaign,
    utmContent: d.utmContent,
    utmTerm: d.utmTerm,
    attributionChannel: d.channel,
    visitorId: d.visitorId,
    attribution: a,
  };
}
