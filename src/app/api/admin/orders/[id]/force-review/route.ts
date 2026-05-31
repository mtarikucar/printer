import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const a = await requireAdmin();


  if ("response" in a) return a.response;


  const session = { user: { email: a.session.user.email } };

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
      { error: "Order is not in a status that can be force-reviewed" },
      { status: 400 }
    );
  }

  await db.insert(adminActions).values({
    orderId: id,
    action: "force_review",
    adminEmail: session.user.email,
    notes: body.notes || "Manually moved to review",
  });
  void d;

  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
  });

  return NextResponse.json({ success: true });
}
