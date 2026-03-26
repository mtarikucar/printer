import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const MAX_BULK_SIZE = 50;

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: d["api.auth.unauthorized"] }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as {
    orderIds: string[];
    action: "approve" | "start-printing";
  };

  if (!body.orderIds?.length || !body.action) {
    return NextResponse.json({ error: "orderIds and action are required" }, { status: 400 });
  }

  if (body.orderIds.length > MAX_BULK_SIZE) {
    return NextResponse.json(
      { error: `Maximum ${MAX_BULK_SIZE} orders per bulk action` },
      { status: 400 }
    );
  }

  const allOrders = await db.query.orders.findMany({
    where: inArray(orders.id, body.orderIds),
  });

  let processed = 0;
  let skipped = 0;

  const requiredStatus = body.action === "approve" ? "review" : "approved";
  const newStatus = body.action === "approve" ? "approved" : "printing";
  const actionType = body.action === "approve" ? "approve" : "print";
  const emailType = body.action === "approve" ? "order_approved" : "order_printing";
  const emailJobName = body.action === "approve" ? "approved" : "printing";

  const eligible = allOrders.filter((o) => o.status === requiredStatus);
  skipped = allOrders.length - eligible.length;

  // Process all updates in a single transaction
  const emailJobs: Array<{
    email: string;
    orderNumber: string;
    customerName: string;
  }> = [];

  await db.transaction(async (tx) => {
    for (const order of eligible) {
      // Atomic status transition within transaction
      // For start-printing, exclude manufacturer-assigned orders
      const conditions = [eq(orders.id, order.id), eq(orders.status, requiredStatus as any)];
      if (body.action === "start-printing") {
        conditions.push(isNull(orders.manufacturerId));
      }
      const [updated] = await tx
        .update(orders)
        .set({ status: newStatus as any, updatedAt: new Date() })
        .where(and(...conditions))
        .returning();

      if (!updated) {
        skipped++;
        continue;
      }

      await tx.insert(adminActions).values({
        orderId: order.id,
        action: actionType,
        adminEmail: session.user!.email!,
        notes: "Bulk action",
      });

      emailJobs.push({
        email: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
      });

      processed++;
    }
  });

  // Enqueue emails after transaction commits
  for (const job of emailJobs) {
    await getEmailQueue().add(emailJobName, {
      type: emailType,
      to: job.email,
      orderNumber: job.orderNumber,
      customerName: job.customerName,
      locale,
    });
  }

  return NextResponse.json({ success: true, processed, skipped });
}
