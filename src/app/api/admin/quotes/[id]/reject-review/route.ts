/**
 * `POST /api/admin/quotes/[id]/reject-review` — incelemeyi fiyat vermeden
 * kapatır.
 *
 * Gövde: `{ reason }`. Teklif TASLAĞA döner ve gerekçe müşterinin teklif
 * sayfasındaki nota (`review_note`) yazılır; müşteri düzenleyip yeniden
 * isteyebilir.
 */
import { type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { rejectReview } from "@/lib/services/quote-admin";
import { adminJsonBody, adminQuoteContext, outcomeResponse } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await adminQuoteContext(ctx);
    if ("response" in a) return a.response;

    const body = await adminJsonBody(request);
    const outcome = await rejectReview({
      quoteId: a.quoteId,
      adminEmail: a.session.user.email,
      reason: body.reason as string,
    });
    return outcomeResponse(outcome);
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/admin/quotes/[id]/reject-review",
      ADMIN_ACTION_FAILED_ERROR
    );
  }
}
