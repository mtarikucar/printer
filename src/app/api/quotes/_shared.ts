/**
 * `/api/quotes/**` uçlarının ortak kabuğu.
 *
 * Her uç aynı üç şeyi yapar ve üçünü de burada yapar: bayrak kapısı, erişim
 * çözümü, hata çevirisi. Kopyalanan bir kabuk, bir gün bayrak kontrolünü
 * unutulan uçta açık bırakırdı.
 *
 * Bu dosya bir ROTA DEĞİLDİR (App Router yalnız `route.ts` adını rota sayar).
 */
import { NextResponse, type NextRequest } from "next/server";
import type { PresentedQuote } from "@/lib/config/quote-types";
import {
  quoteApiEnabled,
  resolveQuoteAccess,
  type QuoteAccess,
} from "@/lib/services/quote-access";
import { loadPresentedQuote, QuoteServiceError } from "@/lib/services/quote-service";

export const QUOTE_NOT_FOUND = "Teklif bulunamadı.";

/** Erişimi olmayan izleyiciye "yok" denir: "var ama senin değil" de bir bilgidir. */
export function quoteNotFound(): NextResponse {
  return NextResponse.json({ error: QUOTE_NOT_FOUND, code: "quote_not_found" }, { status: 404 });
}

function serviceError(e: unknown): NextResponse | null {
  if (!(e instanceof QuoteServiceError)) return null;
  return NextResponse.json(
    { error: e.message, ...(e.code ? { code: e.code } : {}) },
    { status: e.status }
  );
}

/**
 * Uç gövdesi: önce BAYRAK (kapalıyken uç yokmuş gibi 404; admin oturumu iç
 * test için geçer), sonra iş, sonra BİLİNEN hataların çevirisi.
 *
 * Beklenmeyen hata BİLEREK yukarı fırlar: son çare cevabını her rota KENDİ
 * dosyasında, `handleRouteFailure` ile yazar. Bu bir üslup tercihi değil, depo
 * kuralı — "beklenmeyen hata = gövdesi olan cevap" pini (bkz.
 * `scripts/test-order-status-policy.ts`) son çareyi ucun kendi `catch`inde
 * arar; ortak bir sarmalayıcıya gizlenen cümleyi göremez.
 */
export async function quoteRouteBody(run: () => Promise<NextResponse>): Promise<NextResponse> {
  if (!(await quoteApiEnabled())) return quoteNotFound();
  try {
    return await run();
  } catch (e) {
    const known = serviceError(e);
    if (known) return known;
    throw e;
  }
}

/** Bayrak kapısı OLMADAN çalışan uçlar (yalnız `/api/quotes/catalog`). */
export async function openQuoteRouteBody(
  run: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await run();
  } catch (e) {
    const known = serviceError(e);
    if (known) return known;
    throw e;
  }
}

/** `?t=` paylaşım token'ı. */
export function shareTokenOf(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("t");
}

/**
 * Erişimi çözer; yoksa 404 döner. `forEdit` salt okunur izleyiciyi de dışarıda
 * bırakır — düzenleme uçlarının varlığı paylaşım bağlantısına açılmaz.
 */
export async function accessOr404(
  request: NextRequest,
  idOrNumber: string,
  opts: { forEdit?: boolean } = {}
): Promise<{ access: QuoteAccess } | { response: NextResponse }> {
  const access = await resolveQuoteAccess(idOrNumber, {
    shareToken: shareTokenOf(request),
    forEdit: opts.forEdit,
  });
  if (!access) return { response: quoteNotFound() };
  return { access };
}

/**
 * Yazımdan SONRA teklifin taze gövdesi.
 *
 * Her mutasyon sürümü artırır ve fiyatı yeniden hesaplar; istemciye eski
 * gövdeyi geri vermek, bir sonraki isteğinde sürüm çakışması demek olurdu.
 */
export async function presentedBody(
  request: NextRequest,
  idOrNumber: string
): Promise<PresentedQuote | null> {
  const fresh = await resolveQuoteAccess(idOrNumber, { shareToken: shareTokenOf(request) });
  if (!fresh) return null;
  return loadPresentedQuote(fresh);
}

export async function presentedResponse(
  request: NextRequest,
  idOrNumber: string
): Promise<NextResponse> {
  const body = await presentedBody(request, idOrNumber);
  if (!body) return quoteNotFound();
  return NextResponse.json(body);
}

/**
 * Taze gövde + ucun kendi sonucu (bölmede yeni numaralar, içe aktarmada sayı).
 * Ekranın iki istek atmasına gerek kalmasın diye tek cevapta birleşir.
 */
export async function presentedWith(
  request: NextRequest,
  idOrNumber: string,
  extra: Record<string, unknown>
): Promise<NextResponse> {
  const body = await presentedBody(request, idOrNumber);
  if (!body) return quoteNotFound();
  return NextResponse.json({ ...extra, quote: body });
}

/** Gövdeyi JSON olarak okur; bozuk gövde 400 ile reddedilir. */
export async function jsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new QuoteServiceError("İstek gövdesi okunamadı.", 400, "invalid_body");
  }
}
