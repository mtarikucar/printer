/**
 * `GET /api/quotes/catalog` — açılış sayfasındaki yükleyicinin kataloğu.
 *
 * FİYAT YOKTUR: burada henüz bir teklif ve dolayısıyla bir izleyici yok;
 * fiyat kapısı ancak teklifin içinde uygulanabilir.
 *
 * Bayrak kapısının TEK istisnası: kapalıyken 404 dönmez, `enabled: false`
 * döner. Açılış sayfası "Yakında" diyebilmek için bu cevabı okur; 404 ona
 * yalnızca "bir arıza var" derdi.
 */
import { NextResponse } from "next/server";
import { CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { quoteApiEnabled } from "@/lib/services/quote-access";
import { loadActiveSnapshot } from "@/lib/services/quote-catalog";
import { presentPublicCatalog } from "@/lib/services/quote-present";
import { openQuoteRouteBody } from "../_shared";

export const dynamic = "force-dynamic";

async function handleGET(): Promise<NextResponse> {
  const [enabled, snapshot] = await Promise.all([quoteApiEnabled(), loadActiveSnapshot()]);
  return NextResponse.json({ enabled, catalog: presentPublicCatalog(snapshot) });
}

export async function GET() {
  try {
    return await openQuoteRouteBody(handleGET);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/quotes/catalog", CUSTOMER_READ_FAILED_ERROR);
  }
}
