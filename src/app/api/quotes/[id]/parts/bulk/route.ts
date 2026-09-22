/**
 * `POST /api/quotes/[id]/parts/bulk` — "Hepsini seç" işlemleri.
 *
 * Gövde: `{partIds, patch}` ya da `{partIds, delete: true}`. Tek işlemde
 * yapılır ve fiyat BİR KEZ yeniden hesaplanır: yirmi parçayı tek tek
 * güncellemek yirmi sürüm artışı ve yirmi yeniden hesap demekti.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { bulkUpdateParts, parsePartPatch, QuoteServiceError } from "@/lib/services/quote-service";
import { accessOr404, jsonBody, presentedResponse, quoteRouteBody } from "../../../_shared";

export const dynamic = "force-dynamic";

const MAX_BULK_PARTS = 100;

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  const body = (await jsonBody(request)) as {
    partIds?: unknown;
    patch?: unknown;
    delete?: unknown;
  };
  if (
    !Array.isArray(body?.partIds) ||
    body.partIds.length === 0 ||
    body.partIds.length > MAX_BULK_PARTS ||
    body.partIds.some((value) => typeof value !== "string")
  ) {
    throw new QuoteServiceError("Geçersiz parça listesi.", 400, "invalid_body");
  }
  const partIds = body.partIds as string[];

  if (body.delete === true) {
    await bulkUpdateParts(found.access, partIds, { delete: true });
  } else {
    await bulkUpdateParts(found.access, partIds, parsePartPatch(body.patch));
  }
  return presentedResponse(request, id);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/quotes/[id]/parts/bulk",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}
