/**
 * Teknik çizim (PDF): `POST` yükler, `DELETE` kaldırır, `GET` indirir.
 *
 * Çizim üreticiye giden bir belgedir; bu yüzden içerik kontrolü `%PDF` sihirli
 * baytıyla yapılır ve indirme YALNIZ sahibe/admine açıktır — paylaşım
 * bağlantısı teknik çizimi göstermez.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  CUSTOMER_ACTION_FAILED_ERROR,
  CUSTOMER_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { UUID_RE } from "@/lib/services/quote-access";
import { drawingKeyFor, QuoteServiceError, setDrawing } from "@/lib/services/quote-service";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import { getFileBuffer } from "@/lib/services/storage";
import {
  accessOr404,
  presentedResponse,
  quoteNotFound,
  quoteRouteBody,
} from "../../../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; partId: string }> };

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, partId } = await ctx.params;
  // Biçim kontrolü GÖVDE OKUNMADAN: `partId` depolama yoluna girer, ve 20 MB'ı
  // okuyup sonra reddetmek saldırgana bedava bir yükleme kanalı bırakır.
  if (!UUID_RE.test(partId)) return quoteNotFound();
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  const limit = await rateLimitAsync(
    `quote:drawing:ip:${extractClientIp(request)}`,
    200,
    60 * 60 * 1000
  );
  if (!limit.success) {
    throw new QuoteServiceError(
      "Çok fazla teknik çizim yüklediniz; bir süre sonra tekrar deneyin.",
      429,
      "rate_limited"
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new QuoteServiceError("Teknik çizim dosyası bulunamadı.", 400, "invalid_body");
  }
  await setDrawing(found.access, partId, file);
  return presentedResponse(request, id);
}

async function handleDELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, partId } = await ctx.params;
  if (!UUID_RE.test(partId)) return quoteNotFound();
  const found = await accessOr404(request, id, { forEdit: true });
  if ("response" in found) return found.response;

  await setDrawing(found.access, partId, null);
  return presentedResponse(request, id);
}

async function handleGET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, partId } = await ctx.params;
  if (!UUID_RE.test(partId)) return quoteNotFound();
  const found = await accessOr404(request, id);
  if ("response" in found) return found.response;
  const { viewer, quote } = found.access;
  if (!viewer.isOwner && !viewer.isAdmin) return quoteNotFound();

  const drawing = await drawingKeyFor(quote.id, partId);
  if (!drawing) return quoteNotFound();

  const bytes = await getFileBuffer(drawing.key);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // `inline`: müşteri çizimi tarayıcıda açıp doğrulayabilsin.
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(drawing.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "POST /api/quotes/[id]/parts/[partId]/drawing",
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
      "DELETE /api/quotes/[id]/parts/[partId]/drawing",
      CUSTOMER_ACTION_FAILED_ERROR
    );
  }
}

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handleGET(request, ctx));
  } catch (e) {
    return handleRouteFailure(
      e,
      "GET /api/quotes/[id]/parts/[partId]/drawing",
      CUSTOMER_READ_FAILED_ERROR
    );
  }
}
