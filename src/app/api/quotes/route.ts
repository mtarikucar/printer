/**
 * `POST /api/quotes` — boş bir teklif açar.
 *
 * Teklif yükleme yapmadan ÖNCE açılır: müşteri dosyayı sürükler, uç teklifi
 * yaratır ve tarayıcı `/teklif/T-…`'ye gider; parçalar oradan eklenir. Bu
 * yüzden kötüye kullanım kapısı da burada: Turnstile bir kez burada
 * doğrulanır, sonraki parça eklemeleri teklifin sahipliğiyle korunur.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { getOrCreateAnonymousId, getSessionUser } from "@/lib/services/customer-auth";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import { createQuote, QuoteServiceError } from "@/lib/services/quote-service";
import { verifyTurnstileToken } from "@/lib/services/turnstile";
import { jsonBody, quoteRouteBody } from "./_shared";

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const TOO_MANY = "Çok fazla teklif açtınız; bir süre sonra tekrar deneyin.";

async function handlePOST(request: NextRequest): Promise<NextResponse> {
  const body = (await jsonBody(request)) as { turnstileToken?: unknown; termsAccepted?: unknown };
  if (body?.termsAccepted !== true) {
    throw new QuoteServiceError(
      "Mesafeli satış sözleşmesini ve ön bilgilendirmeyi onaylayın.",
      400,
      "terms_required"
    );
  }

  const ip = extractClientIp(request);
  const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  if (!(await verifyTurnstileToken(token, ip))) {
    throw new QuoteServiceError(
      "Güvenlik doğrulaması başarısız; sayfayı yenileyip tekrar deneyin.",
      400,
      "turnstile_failed"
    );
  }

  const session = await getSessionUser();
  // Girişsiz ziyaretçi için kimlik BURADA üretilir (çerez yazılır): teklifin
  // sahipliği ona bağlanır ve giriş yapınca `claim` ile devredilir.
  const anonymousId = session ? null : await getOrCreateAnonymousId();

  const perIp = await rateLimitAsync(`quote:create:ip:${ip}`, 20, HOUR_MS);
  if (!perIp.success) throw new QuoteServiceError(TOO_MANY, 429, "rate_limited");
  const identity = session?.userId ?? anonymousId;
  if (identity) {
    const perIdentity = await rateLimitAsync(`quote:create:anon:${identity}`, 10, HOUR_MS);
    if (!perIdentity.success) throw new QuoteServiceError(TOO_MANY, 429, "rate_limited");
  }

  const quote = await createQuote({
    userId: session?.userId ?? null,
    anonymousId,
    termsAccepted: true,
  });
  return NextResponse.json(quote, { status: 201 });
}

export async function POST(request: NextRequest) {
  try {
    return await quoteRouteBody(() => handlePOST(request));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
