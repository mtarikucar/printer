# Analytics, Attribution & Tracking

End-to-end measurement so we can tell, for every visitor: **which campaign they
came from, where they got stuck, and whether they made us money.** Everything is
env-driven and degrades to a no-op when IDs are missing, so it's safe to ship
before the marketing accounts exist.

## 1. Configure the tags (env)

All optional — see `.env.example` for the full list.

| Env | Purpose |
| --- | --- |
| `NEXT_PUBLIC_GTM_ID` | Google Tag Manager container (preferred). |
| `NEXT_PUBLIC_GA4_ID` | GA4 Measurement ID. Loaded directly when GTM isn't set. |
| `NEXT_PUBLIC_META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` | Meta pixel + Conversions API. |
| `NEXT_PUBLIC_TIKTOK_PIXEL_ID` + `TIKTOK_EVENTS_API_TOKEN` | TikTok pixel + Events API. |
| `GA4_API_SECRET` | GA4 Measurement Protocol secret (server purchase import). |
| `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_ORG/PROJECT/AUTH_TOKEN`) | Error monitoring + source maps. |

If you use **GTM**, point the container's GA4/Meta/TikTok tags at the normalised
`dataLayer` events we push (`page_view`, `view_item`, `add_to_cart`,
`begin_checkout`, `add_payment_info`, `purchase`), each carrying `event_id`,
`value`, `currency`, `product_id`, `reference`. If you don't use GTM, set the
individual IDs and the tags load directly.

## 2. Consent (KVKK)

`src/components/analytics/` renders a cookie-consent banner. Google Consent Mode
v2 defaults everything to **denied**; GA/GTM run cookieless until the visitor
opts in, and the **Meta/TikTok pixels do not load at all** until marketing
consent is granted. First-party measurement cookies (`fig_vid`, `fig_sid`,
`fig_ft`, `fig_lt`) are necessary-tier (no PII, no third-party sharing) and power
attribution + the admin dashboard regardless of consent. The choice is stored in
`fig_consent` and can be re-opened via `useConsent().reopen()`.

## 3. Attribution flow

1. **Middleware** (`src/middleware.ts`) captures UTM + click ids (`gclid`,
   `fbclid`, `ttclid`, …) from any landing URL into first-party cookies
   (first-touch is write-once, last-touch refreshes), plus a stable visitor id
   and a sliding session id.
2. **Checkout** (`/api/orders`) reads those cookies and persists the full
   attribution snapshot (+ denormalised `utm_*` / `attribution_channel` columns)
   onto the `order_drafts` row.
3. **Promotion** (`promoteDraftToOrder`) copies attribution verbatim onto the
   `orders` row(s), so every paid order is traceable to its campaign.

## 4. Funnel events (client + server)

| Event | Client | Server (authoritative) |
| --- | --- | --- |
| `page_view` | SPA tracker | — (stored first-party) |
| `view_item` | shop detail | CAPI mirror |
| `photo_upload` | create flow | — |
| `add_to_cart` | cart context | CAPI mirror |
| `begin_checkout` | checkout form | CAPI mirror |
| `add_payment_info` | checkout form (pixel) | `/api/orders` (GA4 MP + CAPI) |
| `purchase` | track page (pixel) | PayTR webhook → `promoteDraftToOrder` (GA4 MP + CAPI) |

**Dedup model.** Every event carries an `event_id`. The browser mirrors each
event to `/api/analytics/collect`, which forwards to Meta/TikTok CAPI with the
*same* id (the platforms deduplicate browser+server). GA4 Measurement Protocol is
only ever sent by the server-truth emitters (never the client mirror), so GA4
can't double-count. `purchase` uses a deterministic id (`purchase:<orderNumber>`)
so webhook retries and thank-you-page refreshes collapse to one conversion. All
funnel events are also written to the first-party `analytics_events` table.

## 5. Admin dashboard

`/admin/analytics` (date-range selectable): net revenue, orders, AOV, conversion
rate, cart abandonment, payment abandonment, a session-based funnel, and
channel / campaign / product-performance breakdowns — driven by `orders`,
`order_drafts` and `analytics_events`.

## 6. Sentry

`sentry.{server,edge}.config.ts` + `src/instrumentation-client.ts`, wired through
`src/instrumentation.ts` and `next.config.ts` (`withSentryConfig`, only when a
DSN is set). Errors report only in production. `src/app/global-error.tsx`
captures render crashes.

## 7. Quality gate

`npm run verify` = lint → typecheck → build → unit tests. Enforced in CI
(`.github/workflows/ci.yml` on PRs) and as a blocking `quality` job before the
deploy build (`.github/workflows/deploy.yml`). `tsc --noEmit` is the
authoritative type gate.

## 8. Migration

`drizzle/0015_analytics_attribution.sql` adds the attribution columns to
`order_drafts`/`orders` and the `analytics_events` table. Applied automatically
by the deploy migrate step.
