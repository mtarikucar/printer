/**
 * `GET /api/customer/quotes?page=` — hesap sayfasındaki teklif listesi.
 *
 * Oturum ZORUNLU: anonim teklifler listelenmez, çünkü bir çerezle "bana ait
 * teklifler" diye bir küme tanımlamak, aynı tarayıcıyı paylaşan iki kişiyi
 * birbirinin teklifine bakar hâle getirirdi.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getSessionUser } from "@/lib/services/customer-auth";
import { quoteApiEnabled } from "@/lib/services/quote-access";
import { listCustomerQuotes } from "@/lib/services/quote-service";

export const dynamic = "force-dynamic";

function pageOf(request: NextRequest): number {
  const raw = Number(request.nextUrl.searchParams.get("page") ?? "1");
  return Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
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
  return NextResponse.json(await listCustomerQuotes(session.userId, pageOf(request)));
}

export async function GET(request: NextRequest) {
  try {
    return await handleGET(request);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/customer/quotes", CUSTOMER_READ_FAILED_ERROR);
  }
}
