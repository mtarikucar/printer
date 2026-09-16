import { publishRealtime } from "./bus";
import { topics } from "./events";

interface OrderEventInput {
  orderId: string;
  orderNumber: string;
  userId?: string | null; // customer user id
  manufacturerId?: string | null;
  /**
   * Atanmış boyacı. Boyacı konusu Faz 2'de açıldı: model sürümü, boyacı
   * değişimi ve admin mesajları boyacı paneline de ulaşmalı — daha önce
   * boyacıya yalnız e-posta gidiyordu ve panel elle yenilenene kadar eski
   * dosyayı gösteriyordu.
   */
  painterId?: string | null;
  status?: string | null;
  manufacturerStatus?: string | null;
  painterStatus?: string | null;
}

/**
 * Emit an order status/state change to every surface that cares: the order's
 * own room, the admin firehose, the public track page, and (when present) the
 * owning customer, the assigned manufacturer and the assigned painter.
 */
export async function emitOrderChanged(o: OrderEventInput): Promise<void> {
  const t = [topics.order(o.orderId), topics.admin(), topics.track(o.orderNumber)];
  if (o.userId) t.push(topics.customer(o.userId));
  if (o.manufacturerId) t.push(topics.manufacturer(o.manufacturerId));
  if (o.painterId) t.push(topics.painter(o.painterId));
  await publishRealtime(t, {
    kind: "order",
    orderId: o.orderId,
    orderNumber: o.orderNumber,
    status: o.status ?? null,
    manufacturerStatus: o.manufacturerStatus ?? null,
    painterStatus: o.painterStatus ?? null,
  });
}

interface MessageEventInput {
  orderId: string;
  orderNumber: string;
  channel: string; // customer_admin | manufacturer_admin | painter_admin
  senderType: string; // customer | admin | manufacturer | painter
  userId?: string | null;
  manufacturerId?: string | null;
  painterId?: string | null;
}

/**
 * Emit a new chat message. Routed by channel: customer_admin reaches the
 * customer (track + account) and admin; manufacturer_admin reaches the assigned
 * manufacturer and admin; painter_admin reaches the assigned painter and admin.
 * The order room always gets it (open detail views).
 *
 * `painter_admin` is NOT a message_channel enum value — that channel lives in
 * its own table (services/order-partner-chat.ts) precisely because a pg enum
 * value cannot be removed in a down migration. Here it is just a routing
 * string, so nothing in the database has to change for it to exist.
 */
export async function emitOrderMessage(m: MessageEventInput): Promise<void> {
  const t = [topics.order(m.orderId), topics.admin()];
  if (m.channel === "customer_admin") {
    t.push(topics.track(m.orderNumber));
    if (m.userId) t.push(topics.customer(m.userId));
  } else if (m.channel === "manufacturer_admin") {
    if (m.manufacturerId) t.push(topics.manufacturer(m.manufacturerId));
  } else if (m.channel === "painter_admin") {
    if (m.painterId) t.push(topics.painter(m.painterId));
  }
  await publishRealtime(t, {
    kind: "message",
    orderId: m.orderId,
    channel: m.channel,
    senderType: m.senderType,
  });
}

export async function emitCustomerNotification(userId: string): Promise<void> {
  await publishRealtime([topics.customer(userId)], {
    kind: "notification",
    scope: "customer",
  });
}

export async function emitManufacturerNotification(
  manufacturerId: string
): Promise<void> {
  await publishRealtime([topics.manufacturer(manufacturerId)], {
    kind: "notification",
    scope: "manufacturer",
  });
}

export async function emitPainterNotification(painterId: string): Promise<void> {
  await publishRealtime([topics.painter(painterId)], {
    kind: "notification",
    scope: "painter",
  });
}
