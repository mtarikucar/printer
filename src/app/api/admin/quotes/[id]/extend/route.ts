/**
 * `POST /api/admin/quotes/[id]/extend` — geçerlilik süresini uzatır.
 *
 * Gövde: `{ days, reason }`. Tutara DOKUNMAZ, bu yüzden bekleyen bir ödeme
 * varken de çalışır: `/pay/<ref>` bağlantısındaki tutar aynı kalır.
 */
import { type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { extendQuoteExpiry } from "@/lib/services/quote-admin";
import { adminJsonBody, adminQuoteContext, outcomeResponse } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await adminQuoteContext(ctx);
    if ("response" in a) return a.response;

    const body = await adminJsonBody(request);
    const outcome = await extendQuoteExpiry({
      quoteId: a.quoteId,
      adminEmail: a.session.user.email,
      days: body.days as number,
      reason: body.reason as string,
    });
    return outcomeResponse(outcome);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/quotes/[id]/extend", ADMIN_ACTION_FAILED_ERROR);
  }
}
