/**
 * `POST /api/quotes/[id]/requote` — aynı parçalarla BUGÜNÜN kataloğundan yeni
 * bir teklif açar.
 *
 * `reprice`ten farkı: kaynak teklife dokunulmaz. Siparişe dönmüş ya da süresi
 * dolmuş bir teklif de yeniden alınabilir — "Yeniden teklif al" düğmesi tam
 * olarak orada işe yarar.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { QuoteServiceError, requote } from "@/lib/services/quote-service";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import { accessOr404, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  // Her çağrı yeni bir teklif satırı ve parça dosyalarının kopyası demek:
  // `POST /api/quotes` ile aynı saatlik tavan.
  const limit = await rateLimitAsync(
    `quote:requote:ip:${extractClientIp(request)}`,
    20,
    60 * 60 * 1000
  );
  if (!limit.success) {
    throw new QuoteServiceError(
      "Çok fazla teklif açtınız; bir süre sonra tekrar deneyin.",
      429,
      "rate_limited"
    );
  }

  const created = await requote(found.access);
  return NextResponse.json(created, { status: 201 });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes/[id]/requote", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
