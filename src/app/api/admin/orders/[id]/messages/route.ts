import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import {
  getEmailQueue,
  getNotificationQueue,
  mfgMessageEmailJobId,
} from "@/lib/queue/queues";
import {
  listOrderMessages,
  createOrderMessage,
  countChannelUnread,
  saveChatAttachment,
} from "@/lib/services/order-chat";
import type { MessageChannel } from "@/lib/services/order-messages";

// Admin is the only role that can read/write either channel; the channel comes
// from a validated query param (?channel=customer_admin|manufacturer_admin).
function parseChannel(request: NextRequest): MessageChannel | null {
  const c = new URL(request.url).searchParams.get("channel");
  return c === "customer_admin" || c === "manufacturer_admin" ? c : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const channel = parseChannel(request);
  if (!channel) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  const { id } = await params;

  const [msgs, unreadCount] = await Promise.all([
    listOrderMessages(id, channel, "admin"),
    countChannelUnread(id, channel, "admin"),
  ]);
  return NextResponse.json({ messages: msgs, unreadCount });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const channel = parseChannel(request);
  if (!channel) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { id: true, email: true, orderNumber: true, customerName: true, locale: true, manufacturerId: true },
  });
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

  // Customer email is coalesced: only on the first unread message (avoids a
  // burst for back-to-back admin replies). The chat updates live per-message
  // via the realtime `message` event regardless.
  let shouldEmailCustomer = false;
  if (channel === "customer_admin") {
    const unreadBefore = await countChannelUnread(id, channel, "counterparty");
    shouldEmailCustomer = unreadBefore === 0;
  }

  await createOrderMessage({
    orderId: id,
    channel,
    senderType: "admin",
    senderEmail: a.session.user.email,
    body,
    attachmentKey,
    attachmentThumbnailKey,
  });

  if (shouldEmailCustomer) {
    await getEmailQueue()
      .add("new-message", {
        type: "new_message",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        locale: order.locale === "en" ? "en" : "tr",
      })
      .catch((e) => console.error("new_message email enqueue failed", e));
  }

  // Manufacturer: the message is delivered live in-app. Schedule a delayed
  // "unread message" email that fires in 30 min — UNLESS the manufacturer reads
  // the thread first (the read-receipt route removes this job). A stable jobId
  // means back-to-back messages keep one pending email, timed from the first
  // unread message.
  if (channel === "manufacturer_admin" && order.manufacturerId) {
    await getNotificationQueue()
      .add(
        "manufacturer-message-email",
        { orderId: id },
        { jobId: mfgMessageEmailJobId(id), delay: 30 * 60 * 1000 }
      )
      .catch((e) => console.error("mfg message-email schedule failed", e));
  }

  return NextResponse.json({ success: true });
}
