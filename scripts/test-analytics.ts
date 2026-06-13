// Pure-logic tests for the analytics core: attribution parsing/channel
// derivation, consent (de)serialisation, and the event routing dedup invariants.
//
// Run: npx tsx scripts/test-analytics.ts

import {
  parseUtmParams,
  hasAttributionParams,
  deriveChannel,
  buildTouch,
  parseTouchCookie,
  denormalizeAttribution,
} from "../src/lib/analytics/attribution";
import {
  defaultConsent,
  grantAll,
  denyAll,
  parseConsent,
  serializeConsent,
  hasDecided,
  CONSENT_VERSION,
} from "../src/lib/analytics/consent";
import {
  EVENTS,
  isEventName,
  consentCategoryFor,
  type EventName,
} from "../src/lib/analytics/events";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const qs = (s: string) => new URLSearchParams(s);

// ─── parseUtmParams ──────────────────────────────────────────────
{
  const p = parseUtmParams(
    qs("utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=abc&fbclid=xyz")
  );
  check("parses utm_source", p.utmSource === "google");
  check("parses utm_medium", p.utmMedium === "cpc");
  check("parses utm_campaign", p.utmCampaign === "spring");
  check("parses gclid", p.gclid === "abc");
  check("parses fbclid", p.fbclid === "xyz");
  check("empty params → empty object", Object.keys(parseUtmParams(qs(""))).length === 0);
  check("hasAttributionParams true", hasAttributionParams(p));
  check("hasAttributionParams false", !hasAttributionParams(parseUtmParams(qs("foo=bar"))));
}

// ─── deriveChannel ───────────────────────────────────────────────
check("gclid → paid_search", deriveChannel(parseUtmParams(qs("gclid=1"))) === "paid_search");
check("fbclid → paid_social", deriveChannel(parseUtmParams(qs("fbclid=1"))) === "paid_social");
check("ttclid → paid_social", deriveChannel(parseUtmParams(qs("ttclid=1"))) === "paid_social");
check(
  "msclkid → paid_search",
  deriveChannel(parseUtmParams(qs("msclkid=1"))) === "paid_search"
);
check(
  "google + cpc → paid_search",
  deriveChannel(parseUtmParams(qs("utm_source=google&utm_medium=cpc"))) === "paid_search"
);
check(
  "facebook organic → organic_social",
  deriveChannel(parseUtmParams(qs("utm_source=facebook"))) === "organic_social"
);
check(
  "facebook + paid → paid_social",
  deriveChannel(parseUtmParams(qs("utm_source=facebook&utm_medium=paid_social"))) ===
    "paid_social"
);
check("email medium → email", deriveChannel(parseUtmParams(qs("utm_medium=email"))) === "email");
check(
  "organic search source → organic_search",
  deriveChannel(parseUtmParams(qs("utm_source=google&utm_medium=organic"))) === "organic_search"
);
check("nothing → direct", deriveChannel(parseUtmParams(qs(""))) === "direct");
check(
  "referrer only → referral",
  deriveChannel(parseUtmParams(qs("")), "https://t.co/x") === "referral"
);

// ─── buildTouch / parseTouchCookie ───────────────────────────────
{
  check(
    "buildTouch empty + no referrer → null",
    buildTouch(parseUtmParams(qs("")), {}) === null
  );
  const t = buildTouch(parseUtmParams(qs("utm_source=google&gclid=1")), {
    landingPage: "/create?x=1",
    referrer: "https://google.com",
    now: 1234,
  });
  check("buildTouch sets channel", t?.channel === "paid_search");
  check("buildTouch sets ts", t?.ts === 1234);
  check("buildTouch sets landingPage", t?.landingPage === "/create?x=1");
  const round = parseTouchCookie(JSON.stringify(t));
  check("parseTouchCookie round-trips", round?.utmSource === "google");
  check("parseTouchCookie invalid → null", parseTouchCookie("{not json") === null);
  check("parseTouchCookie undefined → null", parseTouchCookie(undefined) === null);
}

// ─── denormalizeAttribution ──────────────────────────────────────
{
  const d = denormalizeAttribution({
    firstTouch: { utmSource: "google", channel: "paid_search" },
    lastTouch: { utmSource: "tiktok", utmCampaign: "promo", channel: "paid_social" },
    visitorId: "v1",
  });
  check("denorm: last-touch wins source", d.utmSource === "tiktok");
  check("denorm: last-touch campaign", d.utmCampaign === "promo");
  check("denorm: channel from last-touch", d.channel === "paid_social");
  check("denorm: visitorId", d.visitorId === "v1");
  check(
    "denorm: falls back to first-touch",
    denormalizeAttribution({ firstTouch: { utmSource: "x", channel: "referral" } }).utmSource ===
      "x"
  );
  check("denorm: empty → direct channel", denormalizeAttribution({}).channel === "direct");
}

// ─── consent ─────────────────────────────────────────────────────
{
  check("defaultConsent denies analytics", defaultConsent().analytics === false);
  check("defaultConsent denies marketing", defaultConsent().marketing === false);
  check("defaultConsent not decided", !hasDecided(defaultConsent()));
  check("grantAll grants both", grantAll().analytics && grantAll().marketing);
  check("grantAll is decided", hasDecided(grantAll()));
  check("denyAll denies both", !denyAll().analytics && !denyAll().marketing);
  check("denyAll is decided", hasDecided(denyAll()));

  const round = parseConsent(serializeConsent(grantAll()));
  check("consent round-trips analytics", round?.analytics === true);
  check("consent round-trips marketing", round?.marketing === true);
  check("parseConsent null → null", parseConsent(null) === null);
  check("parseConsent garbage → null", parseConsent("not-json") === null);
  check(
    "parseConsent version mismatch → null (re-prompt)",
    parseConsent(
      encodeURIComponent(JSON.stringify({ analytics: true, marketing: true, version: CONSENT_VERSION + 99, ts: 1 }))
    ) === null
  );
  check("necessary always true", parseConsent(serializeConsent(denyAll()))?.necessary === true);
}

// ─── events: catalogue + dedup invariants ────────────────────────
{
  const names: EventName[] = [
    "page_view",
    "view_item",
    "photo_upload",
    "add_to_cart",
    "begin_checkout",
    "add_payment_info",
    "purchase",
    "refund",
  ];
  check("all event names present", names.every((n) => !!EVENTS[n]));
  check("isEventName true", isEventName("purchase"));
  check("isEventName false", !isEventName("nope"));

  check("page_view → analytics consent", consentCategoryFor("page_view") === "analytics");
  check("refund → analytics consent", consentCategoryFor("refund") === "analytics");
  check("purchase → marketing consent", consentCategoryFor("purchase") === "marketing");

  // Dedup invariants: GA4 conversions are server-only (no client GA4 fire), so
  // a refresh can't inflate them; engagement events are client-only for GA4.
  check("purchase: no client GA4", EVENTS.purchase.client.ga4 === null);
  check("purchase: server GA4 set", EVENTS.purchase.server.ga4 === "purchase");
  check("add_payment_info: no client GA4", EVENTS.add_payment_info.client.ga4 === null);
  check("add_payment_info: server GA4 set", EVENTS.add_payment_info.server.ga4 === "add_payment_info");
  check("refund: client fully null", Object.values(EVENTS.refund.client).every((v) => v === null));
  check("view_item: no server GA4 (client gtag owns it)", EVENTS.view_item.server.ga4 === null);
  check("add_to_cart: no server GA4", EVENTS.add_to_cart.server.ga4 === null);
  check("begin_checkout: no server GA4", EVENTS.begin_checkout.server.ga4 === null);
  // Meta/TikTok purchase fires on both sides (deduped by event_id).
  check("purchase: client + server Meta both set",
    EVENTS.purchase.client.meta === "Purchase" && EVENTS.purchase.server.meta === "Purchase");
}

console.log(`\n${pass}/${pass + fail} analytics checks passed`);
if (fail > 0) process.exit(1);
