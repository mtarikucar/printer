import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { markChannelRead } from "@/lib/services/order-chat";
import { getNotificationQueue, mfgMessageEmailJobId } from "@/lib/queue/queues";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: { id: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  await markChannelRead(order.id, "manufacturer_admin", "counterparty");

  // Manufacturer has now seen the thread — cancel any pending "unread message"
  // email scheduled by the admin messages route.
  await getNotificationQueue()
    .remove(mfgMessageEmailJobId(order.id))
    .catch(() => {});

  return NextResponse.json({ success: true });
}
