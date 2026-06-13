/**
 * Server-side analytics dispatcher.
 *
 * Responsibilities:
 *   1. Persist every funnel event to the `analytics_events` table (first-party,
 *      always — this is the data behind the admin marketing dashboard, and is
 *      deduplicated on `event_id` so webhook retries never double-count).
 *   2. Forward conversion events to the vendor server APIs — GA4 Measurement
 *      Protocol, Meta Conversions API, TikTok Events API — honouring consent and
 *      reusing the client `event_id` so the platforms deduplicate browser+server.
 *
 * This module is server-only (imports the DB + node:crypto). Never throws into
 * business logic: all vendor I/O is wrapped and fire-and-forget-safe.
 */

import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { analyticsEvents } from "@/lib/db/schema";
import { EVENTS, type EventName } from "./events";
import { denormalizeAttribution } from "./attribution";
import { ANALYTICS_DEBUG, CURRENCY, GA4_ID, META_PIXEL_ID, TIKTOK_PIXEL_ID } from "./config";
import type { Attribution } from "./types";

// Server-only secrets — read lazily so they never reach the client bundle.
const GA4_API_SECRET = (process.env.GA4_API_SECRET ?? "").trim();
const META_CAPI_TOKEN = (process.env.META_CAPI_ACCESS_TOKEN ?? "").trim();
const META_TEST_EVENT_CODE = (process.env.META_CAPI_TEST_EVENT_CODE ?? "").trim();
const META_API_VERSION = "v21.0";
const TIKTOK_TOKEN = (process.env.TIKTOK_EVENTS_API_TOKEN ?? "").trim();

export interface ServerEventInput {
  name: EventName;
  /** Shared dedup id (matches the browser pixel's event_id when paired). */
  eventId: string;
  source: "client" | "server";
  visitorId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  /** Draft reference / order number for funnel joins. */
  reference?: string | null;
  productId?: string | null;
  valueKurus?: number | null;
  currency?: string;
  attribution?: Attribution | null;
  /** Consent snapshot governing vendor forwarding. */
  consent?: { analytics?: boolean; marketing?: boolean } | null;
  pagePath?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** PII for CAPI advanced matching (hashed before leaving the server). */
  user?: { email?: string | null; phone?: string | null } | null;
  props?: Record<string, unknown> | null;
}

const sha256 = (v: string): string =>
  createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

function timeoutFetch(url: string, init: RequestInit, ms = 2500): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/**
 * Record an event: persist it, then forward to the configured vendor server APIs
 * per the event's `server` routing matrix. Resolves once persistence is done;
 * vendor forwarding is awaited but never allowed to throw.
 */
export async function recordEvent(input: ServerEventInput): Promise<void> {
  const denorm = input.attribution
    ? denormalizeAttribution(input.attribution)
    : {
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
        channel: null,
        visitorId: null,
      };

  try {
    await db
      .insert(analyticsEvents)
      .values({
        eventId: input.eventId,
        name: input.name,
        source: input.source,
        visitorId: input.visitorId ?? denorm.visitorId ?? null,
        sessionId: input.sessionId ?? null,
        userId: input.userId ?? null,
        reference: input.reference ?? null,
        productId: input.productId ?? null,
        valueKurus: input.valueKurus ?? null,
        currency: input.currency ?? CURRENCY,
        utmSource: denorm.utmSource,
        utmMedium: denorm.utmMedium,
        utmCampaign: denorm.utmCampaign,
        channel: denorm.channel,
        pagePath: input.pagePath ?? null,
        userAgent: input.userAgent ?? null,
        ip: input.ip ? sha256(input.ip).slice(0, 32) : null, // store hashed, not raw
        props: input.props ?? null,
      })
      // Idempotent: a retried webhook or a client+server pair with the same id
      // collapses to a single stored row.
      .onConflictDoNothing({ target: analyticsEvents.eventId });
  } catch (err) {
    if (ANALYTICS_DEBUG) console.warn("[analytics.server] persist failed", err);
  }

  // Vendor forwarding (consent-gated). Errors are swallowed per-vendor.
  const analyticsOk = input.consent?.analytics !== false ? input.consent?.analytics : false;
  const marketingOk = input.consent?.marketing === true;
  const route = EVENTS[input.name].server;

  const jobs: Promise<unknown>[] = [];
  // GA4 Measurement Protocol is only ever sent by server-truth emitters. Client
  // events reach GA4 via gtag in the browser, so the client mirror must NOT
  // re-send them here or GA4 would double-count.
  if (route.ga4 && GA4_ID && GA4_API_SECRET && analyticsOk && input.source === "server") {
    jobs.push(guard("ga4", forwardGA4(route.ga4, input)));
  }
  if (route.meta && META_PIXEL_ID && META_CAPI_TOKEN && marketingOk) {
    jobs.push(guard("meta", forwardMeta(route.meta, input)));
  }
  if (route.tiktok && TIKTOK_PIXEL_ID && TIKTOK_TOKEN && marketingOk) {
    jobs.push(guard("tiktok", forwardTikTok(route.tiktok, input)));
  }
  if (jobs.length) await Promise.allSettled(jobs);
}

async function guard(vendor: string, p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (ANALYTICS_DEBUG) console.warn(`[analytics.server] ${vendor} forward failed`, err);
  }
}

function major(valueKurus?: number | null): number | undefined {
  return typeof valueKurus === "number" ? Math.round(valueKurus) / 100 : undefined;
}

/* ── GA4 Measurement Protocol ──────────────────────────────────────────── */
async function forwardGA4(eventName: string, input: ServerEventInput): Promise<void> {
  const clientId = input.visitorId || input.sessionId || input.eventId;
  const value = major(input.valueKurus);
  const params: Record<string, unknown> = {
    currency: input.currency ?? CURRENCY,
    value,
    transaction_id: input.reference,
    session_id: input.sessionId,
    engagement_time_msec: 1,
  };
  if (input.productId) {
    params.items = [{ item_id: input.productId, quantity: 1, price: value }];
  }
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
    GA4_ID
  )}&api_secret=${encodeURIComponent(GA4_API_SECRET)}`;
  await timeoutFetch(url, {
    method: "POST",
    body: JSON.stringify({
      client_id: clientId,
      user_id: input.userId ?? undefined,
      events: [{ name: eventName, params: clean(params) }],
    }),
  });
}

/* ── Meta Conversions API ──────────────────────────────────────────────── */
async function forwardMeta(eventName: string, input: ServerEventInput): Promise<void> {
  const userData: Record<string, unknown> = {};
  if (input.user?.email) userData.em = [sha256(input.user.email)];
  if (input.user?.phone) userData.ph = [sha256(input.user.phone.replace(/[^0-9]/g, ""))];
  if (input.visitorId) userData.external_id = [sha256(input.visitorId)];
  if (input.ip) userData.client_ip_address = input.ip;
  if (input.userAgent) userData.client_user_agent = input.userAgent;
  const fbc = input.attribution?.lastTouch?.fbclid ?? input.attribution?.firstTouch?.fbclid;
  if (fbc) userData.fbc = `fb.1.${Date.now()}.${fbc}`;

  const customData: Record<string, unknown> = {
    currency: input.currency ?? CURRENCY,
    value: major(input.valueKurus),
  };
  if (input.productId) {
    customData.content_type = "product";
    customData.content_ids = [input.productId];
  }
  if (input.reference) customData.order_id = input.reference;

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: "website",
        event_source_url: input.pagePath ?? undefined,
        user_data: userData,
        custom_data: clean(customData),
      },
    ],
  };
  if (META_TEST_EVENT_CODE) body.test_event_code = META_TEST_EVENT_CODE;

  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(
    META_CAPI_TOKEN
  )}`;
  await timeoutFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ── TikTok Events API (v1.3) ──────────────────────────────────────────── */
async function forwardTikTok(eventName: string, input: ServerEventInput): Promise<void> {
  const userData: Record<string, unknown> = {};
  if (input.user?.email) userData.email = sha256(input.user.email);
  if (input.user?.phone) userData.phone = sha256(input.user.phone.replace(/[^0-9]/g, ""));
  if (input.visitorId) userData.external_id = sha256(input.visitorId);
  if (input.ip) userData.ip = input.ip;
  if (input.userAgent) userData.user_agent = input.userAgent;
  const ttclid = input.attribution?.lastTouch?.ttclid ?? input.attribution?.firstTouch?.ttclid;
  if (ttclid) userData.ttclid = ttclid;

  const properties: Record<string, unknown> = {
    currency: input.currency ?? CURRENCY,
    value: major(input.valueKurus),
  };
  if (input.productId) {
    properties.contents = [{ content_id: input.productId, quantity: 1, price: major(input.valueKurus) }];
    properties.content_type = "product";
  }

  const body = {
    event_source: "web",
    event_source_id: TIKTOK_PIXEL_ID,
    data: [
      {
        event: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        user: userData,
        properties: clean(properties),
        page: input.pagePath ? { url: input.pagePath } : undefined,
      },
    ],
  };
  await timeoutFetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Access-Token": TIKTOK_TOKEN },
    body: JSON.stringify(body),
  });
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

/**
 * Convenience helper for the authoritative server-side purchase event. Builds a
 * deterministic `event_id` from the order number so duplicate webhook deliveries
 * collapse to one stored row + one vendor conversion.
 */
export async function recordPurchase(args: {
  orderNumber: string;
  valueKurus: number;
  userId?: string | null;
  productId?: string | null;
  attribution?: Attribution | null;
  user?: { email?: string | null; phone?: string | null } | null;
}): Promise<void> {
  await recordEvent({
    name: "purchase",
    eventId: `purchase:${args.orderNumber}`,
    source: "server",
    reference: args.orderNumber,
    valueKurus: args.valueKurus,
    userId: args.userId ?? null,
    productId: args.productId ?? null,
    attribution: args.attribution ?? null,
    visitorId: args.attribution?.visitorId ?? null,
    sessionId: args.attribution?.sessionId ?? null,
    user: args.user ?? null,
    // Purchase is a server-truth conversion; honour the consent captured at
    // checkout time (stored on the attribution snapshot), default deny for ads.
    consent: readStoredConsent(args.attribution),
  });
}

/** Consent snapshot persisted on the attribution object at checkout time. */
export function readStoredConsent(
  a: Attribution | null | undefined
): { analytics: boolean; marketing: boolean } {
  const c = (a as { consent?: { analytics?: boolean; marketing?: boolean } } | null | undefined)
    ?.consent;
  return { analytics: Boolean(c?.analytics), marketing: Boolean(c?.marketing) };
}
