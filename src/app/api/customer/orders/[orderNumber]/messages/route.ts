import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import {
  listOrderMessages,
  createOrderMessage,
  countChannelUnread,
  saveChatAttachment,
} from "@/lib/services/order-chat";

// Customer ↔ admin channel only — forced server-side, never from the body.
const CHANNEL = "customer_admin" as const;

async function resolveOwnedOrder(orderNumber: string, userId: string) {
  return db.query.orders.findFirst({
    where: and(eq(orders.orderNumber, orderNumber), eq(orders.userId, userId)),
    columns: { id: true, status: true, customerNote: true },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orderNumber } = await params;
  const order = await resolveOwnedOrder(orderNumber, session.userId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const [msgs, unreadCount] = await Promise.all([
    listOrderMessages(order.id, CHANNEL, "customer"),
    countChannelUnread(order.id, CHANNEL, "counterparty"),
  ]);
  return NextResponse.json({
    messages: msgs,
    unreadCount,
    customerNote: order.customerNote ?? "",
    noteEditable: !["shipped", "delivered"].includes(order.status),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orderNumber } = await params;
  const order = await resolveOwnedOrder(orderNumber, session.userId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const form = await request.formData();
  const body = ((form.get("body") as string | null) ?? "").trim();
  const file = form.get("file");
  if (!body && !(file instanceof File)) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  if (body.length > 4000) {
    return NextResponse.json({ error: "Message too long" }, { status: 400 });
  }

  let attachmentKey: string | null = null;
  let attachmentThumbnailKey: string | null = null;
  if (file instanceof File) {
    try {
      const saved = await saveChatAttachment(file);
      attachmentKey = saved.attachmentKey;
      attachmentThumbnailKey = saved.attachmentThumbnailKey;
    } catch {
      return NextResponse.json({ error: "Invalid attachment" }, { status: 400 });
    }
  }

  const id = await createOrderMessage({
    orderId: order.id,
    channel: CHANNEL,
    senderType: "customer",
    senderId: session.userId,
    body,
    attachmentKey,
    attachmentThumbnailKey,
  });
  return NextResponse.json({ success: true, id });
}
