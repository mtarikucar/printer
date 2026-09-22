/**
 * `POST /api/quotes/[id]/reprice` — bugünün kataloğuyla yeniden fiyatlar.
 *
 * Süresi dolmuş teklifin ÇIKIŞ YOLU budur, bu yüzden `forEdit` aranmaz:
 * süre dolumu düzenlemeyi kapatır ama yeniden fiyatlamayı değil. Erişim
 * yine de düzenleyebilen izleyiciyle sınırlıdır (paylaşım bağlantısı bir
 * teklifi yeniden fiyatlayamaz).
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { repriceQuote } from "@/lib/services/quote-service";
import { accessOr404, presentedResponse, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  await repriceQuote(found.access);
  return presentedResponse(request, id);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes/[id]/reprice", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
