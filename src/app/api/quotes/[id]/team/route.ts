/**
 * `/api/quotes/[id]/team` — teklifi takıma BAĞLA / takımdan AYIR (0072).
 *
 * YÖNTEM KÜMESİ SÖZLEŞMEDİR (tasarım §6.1):
 *
 *   POST   teklifi çağıranın takımına bağla
 *   DELETE teklifi çağıranın takımından ayır
 *
 * GET YOKTUR ve olmayacak: teklifin takımı zaten `PresentedQuote.team` ile
 * geliyor (`GET /api/quotes/[id]`), ikinci bir okuma ucu aynı gerçeğin ikinci
 * bir kopyası olurdu. `scripts/test-customer-team-api.ts` bu kümeyi UÇTAN
 * çiviliyor (fazla ya da eksik yöntem = kırmızı).
 *
 * KAPILARIN SIRASI (ikisinde de aynı):
 *   1. `quoteRouteBody` → `instant_quote_enabled` kapalıysa 404,
 *   2. `teamsEnabled` → takım özelliği kapalıysa 404 (403 DEĞİL: kapalı bir
 *      özelliğin varlığını duyurmanın anlamı yok); her yöntem kapıyı KENDİ
 *      gövdesinde sorar ve cevabı satır içinde yazar — ortak bir yardımcıya
 *      gizlenen kapı, bir sonraki uçta çağrılmayı unutabilir
 *      (`api/customer/team/_shared.ts` başlığının kuralı),
 *   3. oturum yoksa 401,
 *   4. oran limiti (gövde okunmadan ÖNCE),
 *   5. erişim (`accessOr404`) + KİŞİSEL SAHİPLİK,
 *   6. servis: rol kapısı + koşullu UPDATE + denetim satırı.
 *
 * 5. ADIM NEDEN SAHİPLİK ARAR: bağlama/ayırma teklifin kendisine değil, kimin
 * GÖREBİLECEĞİNE dokunuyor. Bir takım yetkilisinin, takımın hiç görmediği bir
 * teklifi (ör. meslektaşının kişisel teklifini ya da bir yabancının teklifini)
 * takıma çekmesi, sahibinin rızası olmadan dosyalarını paylaşmak olurdu —
 * KVKK tarafında savunulamaz. Bu yüzden POST'un kapısı `viewer.isOwner` +
 * `quote.userId === session.userId`tir ve takım dalı BURADA işe yaramaz.
 * AYIRMA da aynı kapıdan geçer: teklif takıma bağlıyken üye `isTeam` dalından
 * gelir ve `isOwner` false olur, o yüzden DELETE sahiplik yerine ÜYELİK arar
 * (servis `team_id = <çağıranın takımı>` koşuluyla yazıyor) — rol kuralı
 * (`canDetachQuote`: `member` yalnız kendi açtığını ayırır) orada duruyor.
 *
 * `quotes.order_id IS NULL` koşulu DEĞİŞMEZ 5'tir ve servis katmanında,
 * koşullu UPDATE'in İÇİNDE durur: ön okuma ile yazma arasında araya giren bir
 * ödeme de reddedilsin.
 */
import { NextResponse, type NextRequest } from "next/server";
import { CUSTOMER_ACTION_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { getSessionUser } from "@/lib/services/customer-auth";
import { attachQuoteToTeam, detachQuoteFromTeam } from "@/lib/services/customer-team";
// Bayrak kapısı import sırasında da ÖNCE gelir: `scripts/test-customer-team-api.ts`
// "oturum kapısı bayraktan SONRA" iddiasını dosya metninde ölçüyor.
import { teamsEnabled } from "@/lib/services/quote-access";
import { extractClientIp, rateLimitAsync } from "@/lib/services/rate-limit";
import {
  TEAM_NOT_FOUND,
  teamRouteBody,
  teamTooManyRequests,
  teamUnauthorized,
} from "@/app/api/customer/team/_shared";
import { accessOr404, presentedBody, quoteNotFound, quoteRouteBody } from "../../_shared";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Saatte 30 bağla/ayır: insan hızında bir eylem, otomasyon değil. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Cevap: `{ success: true, quote: <taze gövde> | null }`.
 *
 * Gövde TAZE gelir çünkü yazma `PresentedQuote.team`i doldurup boşaltıyor ve
 * ekranın rozeti oradan çiziliyor — `{ success: true }` dönen bir uç istemciyi
 * ikinci bir `GET` atmaya zorlardı (depo deseni: `presentedResponse`).
 *
 * `quote: null` TEK BİR HÂLDE olur ve bir hata DEĞİLDİR: AYIRAN kişi teklifi
 * kendisi açmamışsa (ör. meslektaşının teklifini ayıran takım sahibi), ayırma
 * işlemi onun erişimini de kapatır — gören göz yalnız takım üyeliğiydi. O hâlde
 * 404 dönmek başarılı bir yazmayı hata gibi göstermek olurdu; ekran bu alanı
 * "tekliften çık" diye okur.
 */
async function presentedAfterWrite(
  request: NextRequest,
  id: string
): Promise<NextResponse> {
  return NextResponse.json({ success: true, quote: await presentedBody(request, id) });
}

async function handlePOST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`quote-team-attach:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)).success) {
    return teamTooManyRequests();
  }

  const { id } = await ctx.params;
  const found = await accessOr404(request, id);
  if ("response" in found) return found.response;
  const { quote, viewer } = found.access;
  // KİŞİSEL SAHİPLİK (dosya başlığı · 5. adım): takım dalından gelen bir üye
  // başkasının teklifini takıma ÇEKEMEZ.
  if (!viewer.isOwner || quote.userId === null || quote.userId !== session.userId) {
    return NextResponse.json(
      { error: "Teklifi takıma yalnız sahibi bağlayabilir.", code: "not_owner" },
      { status: 403 }
    );
  }

  await attachQuoteToTeam({ actorUserId: session.userId, quoteId: quote.id });
  return presentedAfterWrite(request, id);
}

async function handleDELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  if (!(await teamsEnabled(null))) {
    return NextResponse.json({ error: TEAM_NOT_FOUND, code: "team_not_found" }, { status: 404 });
  }
  const session = await getSessionUser();
  if (!session) return teamUnauthorized(request);
  const ip = extractClientIp(request);
  if (!(await rateLimitAsync(`quote-team-detach:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)).success) {
    return teamTooManyRequests();
  }

  const { id } = await ctx.params;
  const found = await accessOr404(request, id);
  if ("response" in found) return found.response;
  const { quote, viewer } = found.access;
  // AYIRMA: erişim ya kişisel sahiplikten ya TAKIM üyeliğinden gelir; hangi
  // takıma bağlı olduğu ve rol kuralı servis katmanında (koşullu UPDATE).
  if (!viewer.isOwner && !viewer.isTeam) return quoteNotFound();

  await detachQuoteFromTeam({ actorUserId: session.userId, quoteId: quote.id });
  return presentedAfterWrite(request, id);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => teamRouteBody(() => handlePOST(request, ctx)));
  } catch (e) {
    return handleRouteFailure(e, "POST /api/quotes/[id]/team", CUSTOMER_ACTION_FAILED_ERROR);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    return await quoteRouteBody(() => teamRouteBody(() => handleDELETE(request, ctx)));
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/quotes/[id]/team", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
