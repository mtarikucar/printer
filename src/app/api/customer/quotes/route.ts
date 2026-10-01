/**
 * `GET /api/customer/quotes?page=&scope=` — hesap sayfasındaki teklif listesi.
 *
 * Oturum ZORUNLU: anonim teklifler listelenmez, çünkü bir çerezle "bana ait
 * teklifler" diye bir küme tanımlamak, aynı tarayıcıyı paylaşan iki kişiyi
 * birbirinin teklifine bakar hâle getirirdi.
 *
 * `scope=team` YALNIZ takıma bağlı satırları döndürür (`/account/takim`
 * ekranı). Daraltmanın UÇTA olmasının sebebi sayfalamadır: sayfa 1'i
 * istemcide süzmek, son 20 teklifi kişisel olan müşteride takımın bütün
 * tekliflerini sessizce kaybediyordu. Tanınmayan her değer `all`dır —
 * kapsamın GENİŞ tarafı bugünkü davranış olduğu için yedek yolu da o.
 * Kapsam bir YETKİ kapısı DEĞİL: iki değer de aynı `teamScope` yüklemiyle
 * sınırlı (bir kullanıcı en fazla bir takımda).
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getSessionUser } from "@/lib/services/customer-auth";
import { quoteApiEnabled } from "@/lib/services/quote-access";
import {
  listCustomerQuotes,
  type CustomerQuoteListScope,
} from "@/lib/services/quote-service";

export const dynamic = "force-dynamic";

function pageOf(request: NextRequest): number {
  const raw = Number(request.nextUrl.searchParams.get("page") ?? "1");
  return Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
}

function scopeOf(request: NextRequest): CustomerQuoteListScope {
  return request.nextUrl.searchParams.get("scope") === "team" ? "team" : "all";
}

async function handleGET(request: NextRequest): Promise<NextResponse> {
  if (!(await quoteApiEnabled())) {
    return NextResponse.json({ error: "Teklif bulunamadı.", code: "quote_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) {
    const d = getDictionary(getRequestLocale(request));
    return NextResponse.json({ error: d["api.auth.notLoggedIn"] }, { status: 401 });
  }
  return NextResponse.json(
    await listCustomerQuotes(session.userId, pageOf(request), scopeOf(request))
  );
}

export async function GET(request: NextRequest) {
  try {
    return await handleGET(request);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/customer/quotes", CUSTOMER_READ_FAILED_ERROR);
  }
}
