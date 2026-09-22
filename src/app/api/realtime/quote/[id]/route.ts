import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { quotes } from "@/lib/db/schema";
import { getAnonymousId, getSessionUser } from "@/lib/services/customer-auth";
import { sseResponse } from "@/lib/realtime/sse-response";
import { topics } from "@/lib/realtime/events";
import { handleRouteFailure, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Teklif odasının canlı akışı: parça analizi bitince sayfa kendini tazeler.
 *
 * Akış hiçbir fiyat ya da geometri taşımaz, ama yine de SAHİBİNE AÇIKTIR:
 * "şu teklifin şu parçası hazır oldu" bilgisi bile başkasının işidir. Yetkisiz
 * istek 403 değil 404 alır — T-numarasını deneyerek teklif var mı yok mu
 * öğrenilmesin. Paylaşım token'ı bu uca girmez: paylaşım görünümü durağandır.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(): Response {
  return Response.json({ error: "Teklif bulunamadı.", code: "quote_not_found" }, { status: 404 });
}

async function handleGET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Biçimi bozuk kimlik veritabanına HİÇ gitmez: `uuid = $1` geçersiz metinle
  // hata atar ve 404 olması gereken istek 500'e dönerdi.
  if (!UUID.test(id)) return notFound();

  const [quote] = await db
    .select({ userId: quotes.userId, anonymousId: quotes.anonymousId })
    .from(quotes)
    .where(eq(quotes.id, id))
    .limit(1);
  if (!quote) return notFound();

  const session = await getSessionUser();
  const anonymousId = quote.userId === null ? await getAnonymousId() : null;
  const allowed = quote.userId
    ? session?.userId === quote.userId
    : Boolean(anonymousId) && quote.anonymousId === anonymousId;
  if (!allowed) return notFound();

  return sseResponse(req, [topics.quote(id)]);
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
    return handleRouteFailure(e, "GET /api/realtime/quote/[id]", CUSTOMER_READ_FAILED_ERROR);
  }
}
