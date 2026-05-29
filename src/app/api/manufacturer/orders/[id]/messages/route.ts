import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import {
  listOrderMessages,
  createOrderMessage,
  countChannelUnread,
  saveChatAttachment,
} from "@/lib/services/order-chat";

// Manufacturer ↔ admin channel only — forced server-side. The manufacturer can
// never read the customer_admin channel.
const CHANNEL = "manufacturer_admin" as const;

async function requireActiveManufacturer() {
  const session = await getManufacturerSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { status: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return {
      error: NextResponse.json({ error: "Your account is not active" }, { status: 403 }),
    };
  }
  return { session };
}

async function resolveOwnedOrder(id: string, manufacturerId: string) {
  return db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, manufacturerId)),
    columns: { id: true },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireActiveManufacturer();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const order = await resolveOwnedOrder(id, auth.session.manufacturerId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const [msgs, unreadCount] = await Promise.all([
    listOrderMessages(order.id, CHANNEL, "manufacturer"),
    countChannelUnread(order.id, CHANNEL, "counterparty"),
  ]);
  return NextResponse.json({ messages: msgs, unreadCount });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireActiveManufacturer();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const order = await resolveOwnedOrder(id, auth.session.manufacturerId);
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

  const msgId = await createOrderMessage({
    orderId: order.id,
    channel: CHANNEL,
    senderType: "manufacturer",
    senderId: auth.session.manufacturerId,
    body,
    attachmentKey,
    attachmentThumbnailKey,
  });
  return NextResponse.json({ success: true, id: msgId });
}
