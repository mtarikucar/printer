import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/services/customer-auth";
import { handleRouteFailure, AUTH_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

async function handlePOST() {
  await clearSessionCookie();
  return NextResponse.json({ success: true });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePOST` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function POST() {
  try {
    return await handlePOST();
  } catch (e) {
    return handleRouteFailure(e, "POST /api/auth/logout", AUTH_ACTION_FAILED_ERROR);
  }
}
