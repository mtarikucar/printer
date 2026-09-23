/**
 * `POST /api/admin/quotes/[id]/price` — manuel fiyatlama.
 *
 * Gövde: `{ expectedUpdatedAt, parts: [{ partId, unitKurus | null }],
 * expiresInDays, reason }`. Tutarlar KURUŞ ve KDV DAHİL nihai birim fiyattır;
 * doğrulama servistedir (tek kapı), uç yalnız oturumu ve kimliği çözer.
 */
import { type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { priceQuoteManually } from "@/lib/services/quote-admin";
import { adminJsonBody, adminQuoteContext, outcomeResponse } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await adminQuoteContext(ctx);
    if ("response" in a) return a.response;

    const body = await adminJsonBody(request);
    const outcome = await priceQuoteManually({
      quoteId: a.quoteId,
      adminEmail: a.session.user.email,
      expectedUpdatedAt: String(body.expectedUpdatedAt ?? ""),
      parts: body.parts as Array<{ partId: string; unitKurus: number | null }>,
      expiresInDays: body.expiresInDays as number,
      reason: body.reason as string,
    });
    return outcomeResponse(outcome);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/quotes/[id]/price", ADMIN_ACTION_FAILED_ERROR);
  }
}
