/**
 * `POST /api/quotes/[id]/claim` — anonim teklifi giriş yapan hesaba devreder.
 *
 * Fiyat kapısındaki kayıt/giriş adımından sonra çağrılır. Koşul teklifin
 * SAHİPSİZ olması ve çerezin tutmasıdır; bağlantıya sahip olmak devralma
 * hakkı VERMEZ (spec §"Erişim ve fiyat gizleme").
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { getAnonymousId, getSessionUser } from "@/lib/services/customer-auth";
import { claimQuote, QuoteServiceError } from "@/lib/services/quote-service";
import { accessOr404, presentedResponse, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const session = await getSessionUser();
  if (!session) {
    throw new QuoteServiceError("Bu işlem için giriş yapmalısınız.", 401, "not_logged_in");
  }
  // Erişim ÖNCE çözülür: devralma denemesi, teklifi zaten görebilen birinden
  // gelmelidir; aksi hâlde uç bir teklif numarası tarayıcısına dönerdi.
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  const anonymousId = await getAnonymousId();
  if (anonymousId) await claimQuote(found.access.quote.id, session.userId, anonymousId);
  // Devralma gerçekleşmese de (teklif zaten sahibinin) taze gövde döner:
  // istemci için sonuç aynıdır — "artık benim".
  return presentedResponse(request, id);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes/[id]/claim", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
