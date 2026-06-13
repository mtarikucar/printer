/**
 * Cookie-consent state (KVKK / GDPR). Isomorphic helpers for reading and writing
 * the consent cookie. The cookie is the single source of truth that both the tag
 * loader (client) and the server dispatcher honour.
 *
 * Categories:
 *   - necessary  always on (auth, cart, CSRF, first-party measurement cookies)
 *   - analytics  GA4 / GTM analytics storage
 *   - marketing  Meta + TikTok advertising pixels & remarketing
 */

import type { ConsentState } from "./types";

export const CONSENT_COOKIE = "fig_consent";
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60; // 180 days

/** No decision yet → everything but necessary is denied (default-deny). */
export function defaultConsent(): ConsentState {
  return {
    necessary: true,
    analytics: false,
    marketing: false,
    version: CONSENT_VERSION,
    ts: 0,
  };
}

export function grantAll(): ConsentState {
  return {
    necessary: true,
    analytics: true,
    marketing: true,
    version: CONSENT_VERSION,
    ts: Date.now(),
  };
}

export function denyAll(): ConsentState {
  return {
    necessary: true,
    analytics: false,
    marketing: false,
    version: CONSENT_VERSION,
    ts: Date.now(),
  };
}

/** Parse the consent cookie value; returns null when absent/invalid/outdated. */
export function parseConsent(value: string | undefined | null): ConsentState | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(value));
    if (!raw || typeof raw !== "object") return null;
    if (raw.version !== CONSENT_VERSION) return null; // re-prompt on policy change
    return {
      necessary: true,
      analytics: Boolean(raw.analytics),
      marketing: Boolean(raw.marketing),
      version: CONSENT_VERSION,
      ts: typeof raw.ts === "number" ? raw.ts : 0,
    };
  } catch {
    return null;
  }
}

/** Whether the user has actively made a choice (vs. the implicit default). */
export function hasDecided(state: ConsentState): boolean {
  return state.ts > 0;
}

export function serializeConsent(state: ConsentState): string {
  return encodeURIComponent(JSON.stringify(state));
}
