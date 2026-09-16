import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { sseResponse } from "@/lib/realtime/sse-response";
import { topics } from "@/lib/realtime/events";
import { handleRouteFailure, PARTNER_READ_FAILED_ERROR } from "@/lib/api/route-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const session = await getManufacturerSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  return sseResponse(req, [topics.manufacturer(session.manufacturerId)]);
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(req: Request) {
  try {
    return await handleGET(req);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/realtime/manufacturer", PARTNER_READ_FAILED_ERROR);
  }
}
