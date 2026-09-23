/**
 * `POST /api/admin/quotes/[id]/reopen` — süresi dolmuş ya da iptal edilmiş
 * teklifi yeniden açar.
 *
 * Gövde: `{ reason }`. Teklif TASLAĞA döner ve kataloğun geçerlilik süresi
 * kadar yeni bir bitiş tarihi alır; fiyat verilmiş sayılmaz.
 */
import { type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { reopenQuote } from "@/lib/services/quote-admin";
import { adminJsonBody, adminQuoteContext, outcomeResponse } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await adminQuoteContext(ctx);
    if ("response" in a) return a.response;

    const body = await adminJsonBody(request);
    const outcome = await reopenQuote({
      quoteId: a.quoteId,
      adminEmail: a.session.user.email,
      reason: body.reason as string,
    });
    return outcomeResponse(outcome);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/quotes/[id]/reopen", ADMIN_ACTION_FAILED_ERROR);
  }
}
