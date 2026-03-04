import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { orderNumber } = await params;

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.orderNumber, orderNumber),
      eq(orders.userId, session.userId)
    ),
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        limit: 1,
      },
    },
  });

  if (!order) {
    return NextResponse.json(
      { error: d["api.order.notFound"] },
      { status: 404 }
    );
  }

  if (order.generationAttempts.length === 0) {
    return NextResponse.json(
      { error: "No completed generation available" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { isPublic, displayName } = body as {
    isPublic: boolean;
    displayName?: string;
  };

  await db
    .update(orders)
    .set({
      isPublic,
      publicDisplayName: isPublic ? (displayName || null) : order.publicDisplayName,
      publishedAt: isPublic && !order.publishedAt ? new Date() : order.publishedAt,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  return NextResponse.json({ success: true, isPublic });
}
