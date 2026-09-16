import { auth } from "@/lib/auth/config";
import { sseResponse } from "@/lib/realtime/sse-response";
import { topics } from "@/lib/realtime/events";
import { handleRouteFailure, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

// Node runtime (ioredis) + never static so the stream stays open per-request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: Request) {
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") {
    return new Response("Unauthorized", { status: 401 });
  }
  return sseResponse(req, [topics.admin()]);
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
    return handleRouteFailure(e, "GET /api/realtime/admin", ADMIN_READ_FAILED_ERROR);
  }
}
