/**
 * `POST /api/quotes/[id]/split` — teklifi teknolojiye göre böler.
 *
 * İlk teknoloji yerinde kalır, her diğer teknoloji kendi teklifine taşınır.
 * Cevap hem yeni numaraları hem kaynak teklifin TAZE gövdesini taşır: ekran
 * bölmeden sonra ikinci bir istek atmak zorunda kalmasın.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { splitByTechnology } from "@/lib/services/quote-service";
import { accessOr404, presentedWith, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  const { newQuoteNumbers } = await splitByTechnology(found.access);
  return presentedWith(request, id, { newQuoteNumbers });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes/[id]/split", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
