/**
 * Shared analytics types. Isomorphic — safe to import from client and server.
 */

/** Marketing attribution parameters parsed from the landing URL. */
export interface UtmParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

/** Ad-platform click identifiers used for server-side conversion matching. */
export interface ClickIds {
  /** Google Ads */
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  /** Meta */
  fbclid?: string;
  /** TikTok */
  ttclid?: string;
  /** Microsoft Ads */
  msclkid?: string;
}

/** A single attribution "touch" — captured at a point in time. */
export interface AttributionTouch extends UtmParams, ClickIds {
  /** Normalised marketing channel, e.g. "paid_search", "paid_social". */
  channel?: string;
  /** First page the visitor landed on (path + query). */
  landingPage?: string;
  /** document.referrer / Referer header at the time of the touch. */
  referrer?: string;
  /** Epoch ms when the touch was recorded. */
  ts?: number;
}

/**
 * Full attribution snapshot persisted on a draft/order. We keep both the
 * first-touch (what originally acquired the visitor) and the last-touch (the
 * campaign right before they converted) so reporting can use either model.
 */
export interface Attribution {
  firstTouch?: AttributionTouch;
  lastTouch?: AttributionTouch;
  /** Stable per-browser visitor id (1y cookie). */
  visitorId?: string;
  /** Session id (30-min sliding cookie). */
  sessionId?: string;
  /**
   * Consent snapshot captured at checkout. Persisted on the draft/order so the
   * server-truth purchase event (fired later from the webhook, with no request
   * cookies available) can honour the visitor's advertising-consent choice.
   */
  consent?: { analytics: boolean; marketing: boolean };
}

/** KVKK/GDPR-style consent categories. `necessary` is always granted. */
export interface ConsentState {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  /** Schema/policy version the choice was made against. */
  version: number;
  /** Epoch ms when the choice was recorded. */
  ts: number;
}

/** Canonical funnel event shape passed to the client tracker. */
export interface TrackPayload {
  /** Optional client-supplied dedup id; one is generated if omitted. */
  eventId?: string;
  /** Monetary value in *minor units* (kuruş) when relevant. */
  valueKurus?: number;
  currency?: string;
  /** Product/listing id when the event is item-scoped. */
  productId?: string;
  /** Human label for the item (product title / "Figurin (orta · resin)"). */
  itemName?: string;
  quantity?: number;
  /** Funnel reference (draft reference / order number) when known. */
  reference?: string;
  /** Arbitrary extra properties forwarded verbatim to the vendors. */
  [key: string]: unknown;
}
