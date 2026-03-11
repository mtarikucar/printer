import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/services/customer-auth";
import { db } from "@/lib/db";
import { digitalOrders } from "@/lib/db/schema";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: d["api.auth.required"] }, { status: 401 });
  }

  const orders = await db
    .select()
    .from(digitalOrders)
    .where(eq(digitalOrders.userId, session.userId))
    .orderBy(desc(digitalOrders.createdAt));

  return NextResponse.json({ digitalOrders: orders });
}
