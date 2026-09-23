/**
 * `POST /api/admin/quotes/[id]/target` — hedef fiyat kararı.
 *
 * Gövde: `{ decision: "accept" | "counter" | "reject", counters?, reason,
 * expectedUpdatedAt }`. `accept` müşterinin YAZDIĞI hedefi manuel fiyat yapar;
 * ayrı bir tutar gönderilmez (ve gönderilse de okunmaz).
 */
import { type NextRequest } from "next/server";
import { ADMIN_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { decideTargetPrice } from "@/lib/services/quote-admin";
import { adminJsonBody, adminQuoteContext, outcomeResponse } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const a = await adminQuoteContext(ctx);
    if ("response" in a) return a.response;

    const body = await adminJsonBody(request);
    const outcome = await decideTargetPrice({
      quoteId: a.quoteId,
      adminEmail: a.session.user.email,
      decision: body.decision as "accept" | "counter" | "reject",
      counters: body.counters as Array<{ partId: string; unitKurus: number }> | undefined,
      reason: body.reason as string,
      expectedUpdatedAt: String(body.expectedUpdatedAt ?? ""),
    });
    return outcomeResponse(outcome);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/quotes/[id]/target", ADMIN_ACTION_FAILED_ERROR);
  }
}
