import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerNotifications } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { handleRouteFailure, CUSTOMER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// Mark all of the customer's unread notifications read.
async function handlePOST() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db
    .update(customerNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(customerNotifications.userId, session.userId),
        isNull(customerNotifications.readAt)
      )
    );
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
    return handleRouteFailure(e, "POST /api/customer/notifications/read", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
