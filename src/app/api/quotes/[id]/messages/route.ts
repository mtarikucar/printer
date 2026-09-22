/**
 * `GET|POST /api/quotes/[id]/messages` — teklif sohbeti (müşteri tarafı).
 *
 * YALNIZ SAHİP: paylaşım bağlantısını alan kişi sohbeti okuyamaz da yazamaz da
 * — konuşma müşteri ile ekip arasındadır ve içinde fiyat pazarlığı geçer.
 * Gönderenin rolü SUNUCUDA sabittir ("customer"); gövdeden rol okunmaz.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  CUSTOMER_ACTION_FAILED_ERROR,
  CUSTOMER_READ_FAILED_ERROR,
  handleRouteFailure,
} from "@/lib/api/route-error";
import { createQuoteMessage, listQuoteMessages } from "@/lib/services/quote-chat";
import { QuoteServiceError } from "@/lib/services/quote-service";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import { accessOr404, quoteNotFound, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id);
  if ("response" in found) return found.response;
  if (!found.access.viewer.isOwner) return quoteNotFound();

  return NextResponse.json(await listQuoteMessages(found.access.quote.id, "customer"));
}

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const found = await accessOr404(request, id);
  if ("response" in found) return found.response;
  if (!found.access.viewer.isOwner) return quoteNotFound();

  const limit = await rateLimitAsync(
    `quote:message:ip:${extractClientIp(request)}`,
    60,
    60 * 60 * 1000
  );
  if (!limit.success) {
    throw new QuoteServiceError(
      "Çok fazla mesaj gönderdiniz; bir süre sonra tekrar deneyin.",
      429,
      "rate_limited"
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new QuoteServiceError("İstek gövdesi okunamadı.", 400, "invalid_body");
  }
  const file = form.get("file");
  await createQuoteMessage({
    quoteId: found.access.quote.id,
    sender: "customer",
    senderUserId: found.access.sessionUserId,
    body: String(form.get("body") ?? ""),
    file: file instanceof File ? file : null,
  });
  return NextResponse.json(await listQuoteMessages(found.access.quote.id, "customer"));
}

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handleGET(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "GET /api/quotes/[id]/messages", CUSTOMER_READ_FAILED_ERROR);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => handlePOST(request, ctx));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes/[id]/messages", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
