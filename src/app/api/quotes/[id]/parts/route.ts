/**
 * `POST /api/quotes/[id]/parts` — sahnelenmiş bir yüklemeyi teklife bağlar.
 *
 * Dosyanın kendisi buraya GELMEZ: `/api/uploads/chunk` onu parça parça
 * sahnelemiştir ve burada yalnız `uploadId` taşınır. Doğrulama, 20'lik tavan
 * ve analiz kuyruğu servis katmanında, teklif kilidi altında yürür.
 */
import { NextResponse, type NextRequest } from "next/server";
import { handleRouteFailure, UPLOAD_FAILED_ERROR } from "@/lib/api/route-error";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import { addPartFromUpload, QuoteServiceError } from "@/lib/services/quote-service";
import { accessOr404, jsonBody, presentedResponse, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  const limit = await rateLimitAsync(`quote:part:ip:${extractClientIp(request)}`, 200, 60 * 60 * 1000);
  if (!limit.success) {
    throw new QuoteServiceError(
      "Çok fazla parça eklediniz; bir süre sonra tekrar deneyin.",
      429,
      "rate_limited"
    );
  }

  const body = (await jsonBody(request)) as { uploadId?: unknown; fileName?: unknown };
  if (typeof body?.uploadId !== "string" || typeof body?.fileName !== "string") {
    throw new QuoteServiceError("Yükleme bilgisi eksik.", 400, "invalid_body");
  }

  await addPartFromUpload(found.access, { uploadId: body.uploadId, fileName: body.fileName });
  return presentedResponse(request, id);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes/[id]/parts", UPLOAD_FAILED_ERROR);
  }
}
