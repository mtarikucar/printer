/**
 * `POST /api/quotes/[id]/parts/[partId]/duplicate` — parçayı çoğaltır.
 *
 * Aynı dosyanın ikinci bir yapılandırmasını denemenin (farklı malzeme, farklı
 * yüzey) en kısa yolu; analiz sonucu kopyalandığı için müşteri beklemez.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { duplicatePart } from "@/lib/services/quote-service";
import { accessOr404, presentedResponse, quoteRouteBody } from "../../../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; partId: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, partId } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  await duplicatePart(found.access, partId);
  return presentedResponse(request, id);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/quotes/[id]/parts/[partId]/duplicate",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}
