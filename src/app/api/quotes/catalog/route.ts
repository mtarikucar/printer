/**
 * `GET /api/quotes/catalog` — açılış sayfasındaki yükleyicinin kataloğu.
 *
 * FİYAT YOKTUR: burada henüz bir teklif ve dolayısıyla bir izleyici yok;
 * fiyat kapısı ancak teklifin içinde uygulanabilir.
 *
 * Bayrak kapısının TEK istisnası: kapalıyken 404 dönmez, `enabled: false`
 * döner. Açılış sayfası "Yakında" diyebilmek için bu cevabı okur; 404 ona
 * yalnızca "bir arıza var" derdi.
 *
 * KATALOG YALNIZ BAYRAK AÇIKKEN OKUNUR. Bu uç, `SiteHeader` her sayfada mount
 * olduğu için bayrak kapalıyken de HER genel sayfa açılışında çağrılır; sonda
 * cevabın yalnız `enabled` alanını okur. Kapalı hâlde de katalog sorgulamak,
 * atılacak bir gövde için beş `select` ve (`max: 5` olan) havuzdan beş bağlantı
 * demekti. Dahası: yönetici son aktif teknolojiyi pasifleştirirse okuma
 * `QuoteCatalogError` fırlatır ve o anda HER genel sayfa açılışı bir 500
 * günlüğü üretirdi.
 */
import { NextResponse } from "next/server";
import { CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { quoteApiEnabled, stepUploadsEnabled } from "@/lib/services/quote-access";
import { loadActiveSnapshot } from "@/lib/services/quote-catalog";
import { presentPublicCatalog } from "@/lib/services/quote-present";
import { openQuoteRouteBody } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * `private`: cevap ÇEREZE göre değişir — bayrak kapalıyken bile admin oturumu
 * `enabled: true` alır (`quoteApiEnabled`). Paylaşılan bir vekil `public` bir
 * "kapalı" gövdesini saklasaydı, bayrak açıldıktan sonra müşterileri eski akışa
 * çiviler, admine de yanlış cevabı verirdi.
 */
const DISABLED_CACHE_CONTROL = "private, max-age=60";

async function handleGET(): Promise<NextResponse> {
  const enabled = await quoteApiEnabled();
  if (!enabled) {
    return NextResponse.json(
      { enabled: false, catalog: null },
      { headers: { "Cache-Control": DISABLED_CACHE_CONTROL } }
    );
  }
  // Bu uçta izleyici YOK (henüz teklif de yok), bu yüzden STEP kapısı oturumdan
  // okunur: bayrak kapalıyken yalnız admin `.step` seçebilir.
  const [snapshot, stepEnabled] = await Promise.all([
    loadActiveSnapshot(),
    stepUploadsEnabled(null),
  ]);
  return NextResponse.json({ enabled, catalog: presentPublicCatalog(snapshot, stepEnabled) });
}

export async function GET() {
  try {
    return await openQuoteRouteBody(handleGET);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/quotes/catalog", CUSTOMER_READ_FAILED_ERROR);
  }
}
