import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

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

  const allOrders = await db.query.orders.findMany({
    where: inArray(orders.id, body.orderIds),
  });

  let processed = 0;
  let skipped = 0;

  if (body.action === "approve") {
    const eligible = allOrders.filter((o) => o.status === "review");
    skipped = allOrders.length - eligible.length;

    for (const order of eligible) {
      await db
        .update(orders)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      await db.insert(adminActions).values({
        orderId: order.id,
        action: "approve",
        adminEmail: session.user.email,
        notes: "Bulk action",
      });

      await getEmailQueue().add("approved", {
        type: "order_approved",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        locale,
      });

      processed++;
    }
  } else if (body.action === "start-printing") {
    const eligible = allOrders.filter((o) => o.status === "approved");
    skipped = allOrders.length - eligible.length;

    for (const order of eligible) {
      await db
        .update(orders)
        .set({ status: "printing", updatedAt: new Date() })
        .where(eq(orders.id, order.id));

      await db.insert(adminActions).values({
        orderId: order.id,
        action: "print",
        adminEmail: session.user.email,
        notes: "Bulk action",
      });

      await getEmailQueue().add("printing", {
        type: "order_printing",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        locale,
      });

      processed++;
    }
  }

  return NextResponse.json({ success: true, processed, skipped });
}
