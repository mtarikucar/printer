/**
 * `GET /api/quotes/[id]` — teklifin TEK gövdesi (fiyat kapısı uygulanmış).
 * `PATCH /api/quotes/[id]` — başlık, teslim kademesi, ek hizmetler, fatura.
 *
 * `[id]` hem uuid hem `T-000123` olabilir; numara yalnız satırı BULUR, hakkı
 * oturum/çerez/paylaşım token'ı verir (bkz. quote-access.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  CUSTOMER_ACTION_FAILED_ERROR,
  CUSTOMER_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { loadPresentedQuote, parseQuotePatch, updateQuote } from "@/lib/services/quote-service";
import { accessOr404, jsonBody, presentedResponse, quoteRouteBody } from "../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id);
  if ("response" in found) return found.response;
  return NextResponse.json(await loadPresentedQuote(found.access));
}

async function handlePATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  await updateQuote(found.access, parseQuotePatch(await jsonBody(request)));
  return presentedResponse(request, id);
}

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handleGET(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "GET /api/quotes/[id]", CUSTOMER_READ_FAILED_ERROR);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePATCH(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/quotes/[id]", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
