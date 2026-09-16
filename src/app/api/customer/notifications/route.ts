import { NextResponse } from "next/server";
import { and, eq, desc, isNull, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerNotifications } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { handleRouteFailure, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

async function handleGET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [rows, unread] = await Promise.all([
    db.query.customerNotifications.findMany({
      where: eq(customerNotifications.userId, session.userId),
      orderBy: [desc(customerNotifications.createdAt)],
      limit: 50,
    }),
    db
      .select({ value: count() })
      .from(customerNotifications)
      .where(
        and(
          eq(customerNotifications.userId, session.userId),
          isNull(customerNotifications.readAt)
        )
      ),
  ]);

  return NextResponse.json({
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.readAt != null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount: Number(unread[0]?.value ?? 0),
  });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET() {
  try {
    return await handleGET();
  } catch (e) {
    return handleRouteFailure(e, "GET /api/customer/notifications", CUSTOMER_READ_FAILED_ERROR);
  }
}
