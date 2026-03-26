import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
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

  const rejectableStatuses = ["review", "approved", "failed_generation", "failed_mesh", "generating", "processing_mesh", "paid"] as const;

  // Atomic status transition
  const [order] = await db
    .update(orders)
    .set({
      status: "rejected",
      failureReason: body.reason || d["api.order.rejectedDefault"],
      adminNotes: body.notes,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, id), inArray(orders.status, [...rejectableStatuses])))
    .returning();

  if (!order) {
    return NextResponse.json(
      { error: d["api.order.invalidStatusForReject"] },
      { status: 400 }
    );
  }

  await db.insert(adminActions).values({
    orderId: id,
    action: "reject",
    adminEmail: session.user.email,
    notes: body.notes,
  });

  // Email customer about refund
  await getEmailQueue().add("refund", {
    type: "order_refunded",
    to: order.email,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    locale,
  });

  return NextResponse.json({ success: true });
}
