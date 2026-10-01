import { topics } from "@/lib/realtime/events";
import { sseResponse } from "@/lib/realtime/sse-response";
import { frameworkSurfacesEnabled, resolveFrameworkAccess } from "@/lib/services/quote-access";
import { CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { frameworkNotFound } from "@/app/api/customer/frameworks/_shared";

/**
 * ÇERÇEVE ODASININ canlı akışı: `/cerceve/[number]` ekranı burada `framework:<id>`
 * konusuna abone olur ve parti planı/serbest bırakma/iptal/uzatma haberini alır
 * almaz anlaşmayı KENDİ YETKİSİYLE yeniden çeker.
 *
 * NEDEN ODA, müşteri akışı DEĞİL: `emitFrameworkChanged` olayı her zaman
 * `topics.framework(id)`ye düşer, ama `topics.customer(userId)`ye yalnız
 * çağıran `userId` verdiğinde düşer — `createFrameworkFromQuote` ve
 * `planBatches` vermiyor (sonuçlarında sahip kimliği yok). Müşteri akışına
 * abone olan bir ekran, admin parti planını kurduğunda TAZELENMEZDİ; dahası
 * `/api/realtime/customer` MÜŞTERİ oturumu ister, yani anlaşmayı admin
 * oturumuyla açan biri (lansman öncesi iç test) hiç canlı olmazdı.
 *
 * İKİNCİ BİR ERİŞİM MATRİSİ KURULMAZ: kapı, sayfanın ve iki müşteri ucunun
 * kullandığı AYNI iki işlevdir (`frameworkSurfacesEnabled` +
 * `resolveFrameworkAccess`), yani "sayfayı açabilen akışı da dinler" eşitliği
 * tek yerden gelir. Akışın kendisi FİYAT TAŞIMAZ (`kind: "framework"` yalnız
 * kimlik), ama yine de erişim ister: "şu anlaşmada bir şey değişti" bilgisi
 * bile başkasının işidir.
 *
 * Yetkisiz/bayrağı kapalı istek 403 değil 404 alır (gerekçe `_shared.ts`).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await frameworkSurfacesEnabled())) return frameworkNotFound();
  const { id } = await params;
  // Biçimi bozuk kimlik veritabanına HİÇ gitmez: `resolveFrameworkAccess` uuid
  // olmayan değeri `C-` numarası olarak ayrıştırır ve ayrıştıramazsa `null`
  // döner — yani geçersiz metin 500 değil 404 olur.
  const access = await resolveFrameworkAccess(id);
  if (!access) return frameworkNotFound();
  return sseResponse(req, [topics.framework(access.frameworkId)]);
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await handleGET(req, ctx);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/realtime/framework/[id]", CUSTOMER_READ_FAILED_ERROR);
  }
}
