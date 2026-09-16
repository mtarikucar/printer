import { NextResponse } from "next/server";
import { getIndexNowKey } from "@/lib/services/indexnow";
import { handleRouteFailure, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * IndexNow key file.
 *
 * The spec's default is `https://host/<key>.txt`, which would need a catch-all
 * route. It also allows any location as long as the submission names it in
 * `keyLocation`, which is what we do — one fixed path, no routing gymnastics.
 *
 * 404 when unconfigured: serving an empty body would make the key look valid
 * and get submissions rejected with no obvious cause.
 */
async function handleGET() {
  const key = getIndexNowKey();
  // Cevabı okuyan asıl taraf bir arama motoru ve o yalnız DURUM KODUNA bakar;
  // ama bu adresi tarayıcıda açan yönetici de bir ekrandır. Gövde bu yüzden
  // Türkçe: kimse İngilizce bir "Not found" ile baş başa kalmasın.
  if (!key) {
    return NextResponse.json(
      { error: "IndexNow anahtarı tanımlı değil." },
      { status: 404 }
    );
  }
  return new NextResponse(key, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap.
 *
 * NEDEN BU ROTADA DA: kural, ucun bulunduğu KLASÖRÜN değil ucun kuralıdır. Bu
 * dosyada hiç `try` yoktu; `getIndexNowKey()` fırladığında Next'in sıfır
 * baytlık 500'ü dönüyordu (bkz. src/lib/api/route-error.ts).
 */
export async function GET() {
  try {
    return await handleGET();
  } catch (e) {
    return handleRouteFailure(e, "GET /indexnow-key.txt", CUSTOMER_READ_FAILED_ERROR);
  }
}
