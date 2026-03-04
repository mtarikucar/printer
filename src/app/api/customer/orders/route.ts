import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

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
      orderNumber: true,
      status: true,
      figurineSize: true,
      amountKurus: true,
      createdAt: true,
      trackingNumber: true,
      isPublic: true,
    },
  });

  return NextResponse.json({ orders: customerOrders });
}
