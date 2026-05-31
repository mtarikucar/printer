import { publishRealtime } from "./bus";
import { topics } from "./events";

interface OrderEventInput {
  orderId: string;
  orderNumber: string;
  userId?: string | null; // customer user id
  manufacturerId?: string | null;
  status?: string | null;
  manufacturerStatus?: string | null;
}

/**
 * Emit an order status/state change to every surface that cares: the order's
 * own room, the admin firehose, the public track page, and (when present) the
 * owning customer and assigned manufacturer.
 */
export async function emitOrderChanged(o: OrderEventInput): Promise<void> {
  const t = [topics.order(o.orderId), topics.admin(), topics.track(o.orderNumber)];
  if (o.userId) t.push(topics.customer(o.userId));
  if (o.manufacturerId) t.push(topics.manufacturer(o.manufacturerId));
  await publishRealtime(t, {
    kind: "order",
    orderId: o.orderId,
    orderNumber: o.orderNumber,
    status: o.status ?? null,
    manufacturerStatus: o.manufacturerStatus ?? null,
  });
}

interface MessageEventInput {
  orderId: string;
  orderNumber: string;
  channel: string; // customer_admin | manufacturer_admin
  senderType: string; // customer | admin | manufacturer
  userId?: string | null;
  manufacturerId?: string | null;
}

/**
 * Emit a new chat message. Routed by channel: customer_admin reaches the
 * customer (track + account) and admin; manufacturer_admin reaches the assigned
 * manufacturer and admin. The order room always gets it (open detail views).
 */
export async function emitOrderMessage(m: MessageEventInput): Promise<void> {
  const t = [topics.order(m.orderId), topics.admin()];
  if (m.channel === "customer_admin") {
    t.push(topics.track(m.orderNumber));
    if (m.userId) t.push(topics.customer(m.userId));
  } else if (m.channel === "manufacturer_admin") {
    if (m.manufacturerId) t.push(topics.manufacturer(m.manufacturerId));
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
