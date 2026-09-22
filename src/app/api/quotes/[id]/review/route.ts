/**
 * `POST /api/quotes/[id]/review` — "Manuel teklif iste" / "RFQ" / "Hedef fiyat".
 *
 * Teklifi `needs_review` yapar ve admin sırasına koyar. Hangi türün
 * isteneceğine EKRAN karar vermez: gövdedeki `kind` servis katmanında teklifin
 * durumuna karşı doğrulanır (incelemede olan teklif ikinci kez sıraya girmez).
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import { parseReviewRequest, QuoteServiceError, requestReview } from "@/lib/services/quote-service";
import { accessOr404, jsonBody, presentedResponse, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  // İnceleme talebi bir İNSAN işine dönüşür (admin okur, cevap yazar); tek bir
  // ziyaretçinin sırayı doldurması engellenir.
  const limit = await rateLimitAsync(
    `quote:review:ip:${extractClientIp(request)}`,
    20,
    60 * 60 * 1000
  );
  if (!limit.success) {
    throw new QuoteServiceError(
      "Çok fazla inceleme talebi gönderdiniz; bir süre sonra tekrar deneyin.",
      429,
      "rate_limited"
    );
  }

  await requestReview(found.access, parseReviewRequest(await jsonBody(request)));
  return presentedResponse(request, id);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes/[id]/review", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
