/**
 * `PATCH` — parçanın yapılandırmasını değiştirir (teknoloji, malzeme, renk,
 * yüzey, katman, doluluk, adet, birim, ölçek, not, uyarı onayı, hedef fiyat).
 * `DELETE` — parçayı yumuşak siler.
 *
 * İkisi de teklifin snapshot'ına karşı doğrulanır; tanınmayan bir alan ya da
 * katalogda olmayan bir anahtar 400 "Geçersiz seçenek" alır.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { deletePart, parsePartPatch, updatePart } from "@/lib/services/quote-service";
import { accessOr404, jsonBody, presentedResponse, quoteRouteBody } from "../../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; partId: string }> };

async function handlePATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, partId } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  await updatePart(found.access, partId, parsePartPatch(await jsonBody(request)));
  return presentedResponse(request, id);
}

async function handleDELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, partId } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  await deletePart(found.access, partId);
  return presentedResponse(request, id);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePATCH(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "PATCH /api/quotes/[id]/parts/[partId]",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handleDELETE(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "DELETE /api/quotes/[id]/parts/[partId]",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}
