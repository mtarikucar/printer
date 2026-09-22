/**
 * `POST /api/quotes/[id]/parts/import` — parça kütüphanesinden bu teklife
 * parça kopyalar (`{sourcePartIds}`).
 *
 * OTURUM ZORUNLU: kütüphane kullanıcıya aittir ve kaynak parçanın sahipliği
 * servis katmanında `userId` ile ikinci kez doğrulanır — parça kimliğini
 * tahmin etmek başkasının dosyasını kopyalamaya yetmez.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { getSessionUser } from "@/lib/services/customer-auth";
import { importParts, QuoteServiceError } from "@/lib/services/quote-service";
import { accessOr404, jsonBody, presentedWith, quoteRouteBody } from "../../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const session = await getSessionUser();
  if (!session) {
    throw new QuoteServiceError("Bu işlem için giriş yapmalısınız.", 401, "not_logged_in");
  }
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  const body = (await jsonBody(request)) as { sourcePartIds?: unknown };
  if (
    !Array.isArray(body?.sourcePartIds) ||
    body.sourcePartIds.some((value) => typeof value !== "string")
  ) {
    throw new QuoteServiceError("Geçersiz parça listesi.", 400, "invalid_body");
  }

  const imported = await importParts(
    found.access,
    body.sourcePartIds as string[],
    session.userId
  );
  return presentedWith(request, id, { imported });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/quotes/[id]/parts/import",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}
