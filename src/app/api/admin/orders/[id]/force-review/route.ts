import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: d["api.auth.unauthorized"] }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const reviewableStatuses = ["paid", "generating", "processing_mesh"] as const;

  // Atomic status transition
  const [order] = await db
    .update(orders)
    .set({ status: "review", updatedAt: new Date() })
    .where(and(eq(orders.id, id), inArray(orders.status, [...reviewableStatuses])))
    .returning();

  if (!order) {
    return NextResponse.json(
      { error: d["api.order.invalidStatusForRegenerate"] },
      { status: 400 }
    );
  }

  await db.insert(adminActions).values({
    orderId: id,
    action: "edit",
    adminEmail: session.user.email,
    notes: body.notes || "Manually moved to review",
  });

  return NextResponse.json({ success: true });
}
