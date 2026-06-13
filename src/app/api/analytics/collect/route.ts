import { NextRequest, NextResponse } from "next/server";
import { recordEvent } from "@/lib/analytics/server";
import { isEventName } from "@/lib/analytics/events";
import { attributionFromRequest } from "@/lib/analytics/attribution-server";
import { getClientIp } from "@/lib/utils/request";

export const runtime = "nodejs";

/**
 * Client → server analytics mirror. The browser tracker POSTs every funnel event
 * here so it can be (a) persisted for the admin dashboard and (b) forwarded to
 * the Meta / TikTok Conversions APIs server-side, reusing the browser's
 * `event_id` so the platforms deduplicate. GA4 is intentionally NOT forwarded
 * from here (the browser already sent it via gtag) — see recordEvent.
 *
 * Always returns 204 and never throws into the client.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return new NextResponse(null, { status: 204 });

    const name = body.name;
    if (!isEventName(name)) return new NextResponse(null, { status: 204 });

    const eventId = typeof body.eventId === "string" ? body.eventId.slice(0, 128) : null;
    if (!eventId) return new NextResponse(null, { status: 204 });

    const payload = (body.payload ?? {}) as Record<string, unknown>;
    const str = (v: unknown, max = 255): string | null =>
      typeof v === "string" && v.length ? v.slice(0, max) : null;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

    // Attribution + consent come from the authoritative first-party cookies, not
    // the request body (which the client can't be fully trusted to set).
    const attribution = attributionFromRequest(request);
    const ip = await getClientIp().catch(() => null);

    await recordEvent({
      name,
      eventId,
      source: "client",
      visitorId: str(body.visitorId, 64) ?? attribution.visitorId ?? null,
      sessionId: str(body.sessionId, 64) ?? attribution.sessionId ?? null,
      reference: str(payload.reference),
      productId: str(payload.productId, 64),
      valueKurus: num(payload.valueKurus),
      currency: str(payload.currency, 8) ?? undefined,
      attribution,
      consent: attribution.consent ?? null,
      pagePath: str(body.pagePath, 512),
      ip,
      userAgent: str(request.headers.get("user-agent"), 512),
      props: payload,
    });
  } catch {
    /* never surface tracking errors to the client */
  }
  return new NextResponse(null, { status: 204 });
}
