import { sseResponse } from "@/lib/realtime/sse-response";
import { topics } from "@/lib/realtime/events";
import { handleRouteFailure, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

// Public: the order-tracking page has no login. The stream is scoped to a
// single order number (a hard-to-guess identifier) and only carries that
// order's own status/message signals — no cross-order data.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(
  req: Request,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const { orderNumber } = await params;
  return sseResponse(req, [topics.track(orderNumber)]);
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(req: Request, ctx: { params: Promise<{ orderNumber: string }> }) {
  try {
    return await handleGET(req, ctx);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/realtime/track/[orderNumber]", CUSTOMER_READ_FAILED_ERROR);
  }
}
