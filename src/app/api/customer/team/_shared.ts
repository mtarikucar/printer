/**
 * `/api/customer/team/**` uçlarının ortak parçaları (0072).
 *
 * Bu dosya bir ROTA DEĞİLDİR (App Router yalnız `route.ts` adını rota sayar).
 *
 * BURAYA NE GİRER, NE GİRMEZ: yalnız CEVAP ÇEVİRİSİ ve saf yardımcılar girer.
 * **Bayrak kapısı ve oran limiti BİLEREK burada DEĞİL**, her rotanın kendi
 * dosyasında: ikisi de "bu uç var mı" ve "bu istek çok mu" sorularının cevabı ve
 * tek bir sarmalayıcıya gizlendiklerinde bir sonraki uç onları çağırmayı
 * unutabilir. `scripts/test-customer-team-api.ts` tam bu yüzden her rota
 * DOSYASININ metninde `teamsEnabled` + `404` + `rateLimitAsync` arıyor.
 */
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { TeamServiceError } from "@/lib/services/customer-team";

/**
 * Bayrak kapalıyken dönen cümle. **404, 403 DEĞİL**: kapalı bir özelliğin
 * varlığını duyurmanın anlamı yok (`quote-access.ts`in aynı gerekçesi). Admin
 * oturumu iç test için kapıdan geçer (`teamsEnabled`).
 */
export const TEAM_NOT_FOUND = "Takım bulunamadı.";

/** Oturum yoksa: mevcut `/api/customer/**` deseni (401 + sözlük cümlesi). */
export function teamUnauthorized(request: NextRequest): NextResponse {
  const d = getDictionary(getRequestLocale(request));
  return NextResponse.json({ error: d["api.auth.notLoggedIn"] }, { status: 401 });
}

/** Oran limiti aşıldı. Gövde TÜRKÇE: ekran bunu olduğu gibi basabilir. */
export function teamTooManyRequests(): NextResponse {
  return NextResponse.json(
    { error: "Çok fazla istek gönderildi. Lütfen bir süre sonra tekrar deneyin.", code: "rate_limited" },
    { status: 429 }
  );
}

/**
 * Uç gövdesi: işi koşar ve BİLİNEN retleri cevaba çevirir.
 *
 * Beklenmeyen hata BİLEREK yukarı fırlar: son çare cevabını her rota KENDİ
 * dosyasında, `handleRouteFailure` ile yazar. Bu bir üslup tercihi değil, depo
 * kuralı — "beklenmeyen hata = gövdesi olan cevap" pini
 * (`scripts/test-order-status-policy.ts`, API yüzeyini SÜPÜREN iddia) son çareyi
 * ucun kendi `catch`inde arar ve çözemediği bir dönüşü ("`return known`")
 * GARANTİ SAYMAZ. `quoteRouteBody` (`src/app/api/quotes/_shared.ts`) birebir
 * aynı şekilde yazılmıştır ve aynı sebeple.
 */
export async function teamRouteBody(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (e) {
    const known = teamErrorResponse(e);
    if (known) return known;
    throw e;
  }
}

/**
 * BEKLENEN retlerin cevabı: servis hatası ya da gövde doğrulama hatası.
 * Tanımadığı hata için `null` döner.
 */
function teamErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof TeamServiceError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      { error: e.issues[0]?.message ?? "Geçersiz istek gövdesi.", code: "invalid_body" },
      { status: 400 }
    );
  }
  return null;
}

/** Bozuk JSON gövdesi de BEKLENEN bir rettir, boş gövdeli 500 değil. */
export async function teamJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new TeamServiceError("İstek gövdesi okunamadı.", 400, "invalid_body");
  }
}

/**
 * KVKK onay kutusu — `z.literal(true)` (`api/workshop-requests/route.ts:71`
 * deseni). İşaretlenmemiş kutu 400 ile döner; "varsayılan olarak onaylı" diye
 * bir hâl YOKTUR, çünkü onayın kanıtı kullanıcının eylemidir.
 */
export const kvkkConsentField = z.literal(true, {
  message: "Devam etmek için bilgilendirmeyi onaylamanız gerekir",
});

/**
 * Alıcı başına oran limitinin ANAHTARI.
 *
 * İki iş birden yapar:
 *
 * 1. **Takma adları daraltır** — `foo+etiket@` ve Gmail'de `f.o.o@` AYNI gerçek
 *    gelen kutusuna düşer. Daraltılmazsa bir yönetici `kurban+1@`, `kurban+2@`
 *    diye sınırsız taze kova üretip aynı adrese davet yağdırabilir. Desen
 *    `api/workshop-requests/route.ts:28`den KOPYALANDI (o dosya bu sevkiyatta
 *    açılmıyor; ortak bir yardımcıya çıkarmak onu değiştirmek olurdu).
 * 2. **Adresi Redis anahtarından çıkarır** — `sha256`. Oran limiti anahtarları
 *    Redis'te ve hata ayıklama çıktılarında görünür; davet edilen kişinin
 *    e-postasının orada açık yazması gereksiz bir yayılım olurdu.
 */
export function inviteEmailRateKey(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return crypto.createHash("sha256").update(lower).digest("hex");
  let local = lower.slice(0, at).split("+")[0];
  let domain = lower.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return crypto.createHash("sha256").update(`${local}@${domain}`).digest("hex");
}
