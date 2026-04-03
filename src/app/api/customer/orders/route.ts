import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { normalizeFileUrl } from "@/lib/services/storage";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: d["api.auth.notLoggedIn"] }, { status: 401 });
  }

  const customerOrders = await db.query.orders.findMany({
    where: eq(orders.userId, session.userId),
    orderBy: [desc(orders.createdAt)],
    columns: {
      id: true,
      orderNumber: true,
      status: true,
      figurineSize: true,
      amountKurus: true,
      createdAt: true,
      trackingNumber: true,
      isPublic: true,
    },
    with: {
      photos: {
        columns: { originalUrl: true },
        limit: 1,
      },
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputGlbUrl: true },
        orderBy: [desc(generationAttempts.createdAt)],
        limit: 1,
      },
    },
  });

  const result = customerOrders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    figurineSize: order.figurineSize,
    amountKurus: order.amountKurus,
    createdAt: order.createdAt,
    trackingNumber: order.trackingNumber,
    isPublic: order.isPublic,
    glbUrl: normalizeFileUrl(order.generationAttempts[0]?.outputGlbUrl ?? null),
    thumbnailUrl: normalizeFileUrl(order.photos[0]?.originalUrl ?? null),
  }));

  return NextResponse.json({ orders: result });
}
