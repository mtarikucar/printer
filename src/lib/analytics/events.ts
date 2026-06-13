/**
 * Canonical funnel event catalogue. One internal name per funnel step, each with
 * the vendor-specific event names and a routing matrix that decides *where* the
 * event is allowed to fire. This is what keeps client + server tracking from
 * double-counting:
 *
 *   - GA4: engagement events fire client-side (gtag); `purchase` fires
 *     server-side only (Measurement Protocol) so it can't be inflated by a
 *     page refresh on the thank-you page.
 *   - Meta / TikTok: fire on BOTH client (pixel) and server (CAPI) using a
 *     shared `event_id`, which the platforms deduplicate.
 *
 * Isomorphic — imported by both the client tracker and the server dispatcher.
 */

export type EventName =
  | "page_view"
  | "view_item"
  | "photo_upload"
  | "add_to_cart"
  | "begin_checkout"
  | "add_payment_info"
  | "purchase";

interface VendorRoute {
  /** GA4 recommended event name (null = don't send to GA4). */
  ga4: string | null;
  /** Meta standard/custom event name. */
  meta: string | null;
  /** TikTok event name. */
  tiktok: string | null;
}

export interface EventDef {
  /** Browser-side vendor routing. */
  client: VendorRoute;
  /** Server-side vendor routing (CAPI / Measurement Protocol). */
  server: VendorRoute;
}

export const EVENTS: Record<EventName, EventDef> = {
  page_view: {
    client: { ga4: "page_view", meta: "PageView", tiktok: "Pageview" },
    server: { ga4: null, meta: null, tiktok: null },
  },
  view_item: {
    client: { ga4: "view_item", meta: "ViewContent", tiktok: "ViewContent" },
    server: { ga4: null, meta: "ViewContent", tiktok: "ViewContent" },
  },
  // Custom event: not a standard step in any vendor's funnel, but a strong
  // intent signal for this product (user uploaded a photo to generate from).
  photo_upload: {
    client: { ga4: "photo_upload", meta: "PhotoUpload", tiktok: "PhotoUpload" },
    server: { ga4: null, meta: null, tiktok: null },
  },
  add_to_cart: {
    client: { ga4: "add_to_cart", meta: "AddToCart", tiktok: "AddToCart" },
    server: { ga4: null, meta: "AddToCart", tiktok: "AddToCart" },
  },
  begin_checkout: {
    client: {
      ga4: "begin_checkout",
      meta: "InitiateCheckout",
      tiktok: "InitiateCheckout",
    },
    server: { ga4: null, meta: "InitiateCheckout", tiktok: "InitiateCheckout" },
  },
  // Payment initiated = draft created + payment token issued (server truth).
  // GA4 is owned by the server here (null on the client) so it can't be
  // inflated by a re-render; the pixels fire on both sides with a shared id.
  add_payment_info: {
    client: { ga4: null, meta: "AddPaymentInfo", tiktok: "AddPaymentInfo" },
    server: { ga4: "add_payment_info", meta: "AddPaymentInfo", tiktok: "AddPaymentInfo" },
  },
  // Purchase = draft promoted to a paid order (server truth, from the webhook).
  // GA4 only server-side to avoid refresh inflation; pixels on both with dedup.
  purchase: {
    client: { ga4: null, meta: "Purchase", tiktok: "CompletePayment" },
    server: { ga4: "purchase", meta: "Purchase", tiktok: "CompletePayment" },
  },
};

export function isEventName(v: unknown): v is EventName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(EVENTS, v);
}

/**
 * Which consent category an event needs. Analytics-tier covers GA4 funnel
 * engagement; marketing-tier covers anything that also feeds the ad pixels.
 * We treat all item/funnel events as needing both (they fire to ad pixels too),
 * while page_view only needs analytics.
 */
export function consentCategoryFor(name: EventName): "analytics" | "marketing" {
  return name === "page_view" ? "analytics" : "marketing";
}
