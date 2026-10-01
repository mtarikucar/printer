/**
 * `GET /api/customer/frameworks?page=` — müşterinin çerçeve anlaşma listesi.
 *
 * OTURUM ZORUNLU ve ANONİM ÇERÇEVE YOK: `quote_frameworks.user_id` NOT NULL
 * (F1'in şeması), yani bir çerezle "bana ait anlaşmalar" diye bir küme
 * tanımlanamaz ve tanımlanmamalı — taahhüt bir kişiye/şirkete yazılır.
 * PAYLAŞIM JETONU DA YOK: anlaşma kurumsal ve kişiye özeldir.
 *
 * Fiyat kapısı listede de uygulanır (`presentCustomerFrameworkList`): servis
 * satırı tutarı koşulsuz taşıyor, çünkü aynı işlev admin listesini de
 * besliyor.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getSessionUser } from "@/lib/services/customer-auth";
import { frameworkSurfacesEnabled } from "@/lib/services/quote-access";
import { listCustomerFrameworks } from "@/lib/services/quote-framework";
import { presentCustomerFrameworkList } from "@/lib/services/quote-framework-present";
import { frameworkNotFound } from "./_shared";

export const dynamic = "force-dynamic";

function pageOf(request: NextRequest): number {
  const raw = Number(request.nextUrl.searchParams.get("page") ?? "1");
  return Number.isSafeInteger(raw) && raw >= 1 ? raw : 1;
}

async function handleGET(request: NextRequest): Promise<NextResponse> {
  // Bayrak kapalıyken uç YOK gibi davranır; admin oturumu iç test için geçer
  // (`quoteApiEnabled` deseni).
  if (!(await frameworkSurfacesEnabled())) return frameworkNotFound();
  const session = await getSessionUser();
  if (!session) {
    const d = getDictionary(getRequestLocale(request));
    return NextResponse.json({ error: d["api.auth.notLoggedIn"] }, { status: 401 });
  }
  const result = await listCustomerFrameworks(session.userId, pageOf(request));
  return NextResponse.json({
    // Liste SAHİBİNİNDİR: oturumun kullanıcısı `user_id` ile eşleşen satırları
    // okuyor, yani fiyat kapısı açıktır. Alan yine de BEYAN edilir — kapı bir
    // görünüm ayarı değil, gövdeyi kuran kuraldır.
    items: presentCustomerFrameworkList(result.items, { canSeePrices: true }),
    hasNext: result.hasNext,
  });
}

export async function GET(request: NextRequest) {
  try {
    return await handleGET(request);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/customer/frameworks", CUSTOMER_READ_FAILED_ERROR);
  }
}
