/**
 * `GET /api/customer/frameworks/[number]` — anlaşmanın tam hâli.
 *
 * `/cerceve/[number]` ekranı SSE haberi aldığında bu ucu yeniden çeker: canlı
 * kanal fiyat taşımaz (`emitFrameworkChanged` yalnız kimlik yayınlar), arayüz
 * haberi alınca anlaşmayı KENDİ YETKİSİYLE okur.
 *
 * ERİŞİM: `quote_frameworks.user_id` = oturum sahibi, ya da admin oturumu.
 * Anonim çerez dalı ve paylaşım jetonu YOK (`resolveFrameworkViewer`).
 *
 * Numara ERİŞİM VERMEZ: `C-000123` tahmin edilebilir, numara yalnız satırı
 * BULUR. Erişimi olmayan izleyici 404 alır — "var ama senin değil" bilgisi bile
 * sızmaz.
 */
import { NextResponse } from "next/server";
import { CUSTOMER_READ_FAILED_ERROR, handleRouteFailure } from "@/lib/api/route-error";
import { frameworkSurfacesEnabled, resolveFrameworkAccess } from "@/lib/services/quote-access";
import { loadFrameworkDetail } from "@/lib/services/quote-framework";
import { presentFramework } from "@/lib/services/quote-framework-present";
import { getPublicUrl } from "@/lib/services/storage";
import { frameworkNotFound } from "../_shared";

export const dynamic = "force-dynamic";

async function handleGET(params: Promise<{ number: string }>): Promise<NextResponse> {
  // Adres parçası TRY'IN İÇİNDE çözülür: `await params` de fırlayabilir ve
  // yakalamanın dışında kalan bir okuma, Next'in sıfır baytlık 500'ünü
  // bırakırdı (depo kuralı: "beklenmeyen hata = gövdesi olan cevap").
  const { number } = await params;
  if (!(await frameworkSurfacesEnabled())) return frameworkNotFound();
  const access = await resolveFrameworkAccess(number);
  if (!access) return frameworkNotFound();
  const detail = await loadFrameworkDetail(access.frameworkId);
  // Erişim çözümünden SONRA silinmiş/okunamayan satır: aynı cevap, aynı
  // gerekçe.
  if (!detail) return frameworkNotFound();
  return NextResponse.json(
    presentFramework({
      detail,
      viewer: access.viewer,
      now: new Date(),
      sign: getPublicUrl,
    })
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ number: string }> }
) {
  try {
    return await handleGET(params);
  } catch (e) {
    return handleRouteFailure(
      e,
      "GET /api/customer/frameworks/[number]",
      CUSTOMER_READ_FAILED_ERROR
    );
  }
}
