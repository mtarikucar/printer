import { and, eq, isNull, ne, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  adminActions,
  generationAttempts,
  manufacturers,
  orderItems,
  orders,
} from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import {
  REFUNDED_PAYMENT_STATUS,
  isRefunded,
} from "@/lib/config/order-status-policy";

/**
 * The one place an order is handed to a manufacturer.
 *
 * The "guarded update → audit row → notify → emit" sequence used to be written
 * out three times (the admin assign route, the N12 decline reassignment, and
 * now automatic assignment for platform products). Three copies meant three
 * chances for one of them to forget the concurrency guard or the SSE emit.
 */

/**
 * Statuses from which an order may be handed to a manufacturer:
 * custom/upload orders after admin approval, and marketplace orders straight
 * from payment — a platform-owned product is born `paid` + unassigned, so
 * without this it could never be assigned at all.
 */
export function assignableStatusGuard(): SQL {
  return or(
    eq(orders.status, "approved"),
    and(eq(orders.status, "paid"), eq(orders.orderType, "marketplace"))
  )!;
}

/**
 * The refund guard every forward action puts INSIDE its atomic UPDATE: the SQL
 * twin of `!isRefunded(order)` (order-status-policy.ts). In the write, not in a
 * pre-read, so a refund landing between a route's read and its write still
 * wins.
 *
 * "Not refunded", deliberately not "payment succeeded": the rule stops exactly
 * the refunded orders. Manual, havale, zero-amount and workshop orders may sit
 * at another payment status and must keep moving; a 'succeeded' requirement
 * would silently freeze them the day such a status exists.
 *
 * It lives here, beside assignableStatusGuard(), because assignment is the
 * forward action every path funnels through and this module is already safe to
 * load in the BullMQ worker; order-status-policy.ts is pure and holds no SQL.
 */
export function notRefundedGuard(): SQL {
  return ne(orders.paymentStatus, REFUNDED_PAYMENT_STATUS);
}

/**
 * After a guarded UPDATE matched no row: was a refund the reason? Lets a route
 * answer 409 REFUNDED_ORDER_ERROR instead of a status error that sends the
 * admin looking for a problem that is not there.
 */
export async function isOrderRefunded(orderId: string): Promise<boolean> {
  const row = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { paymentStatus: true },
  });
  return !!row && isRefunded(row);
}

/**
 * Does this order have anything a manufacturer could actually produce?
 *
 * An order with nothing to print must never reach a partner — that is exactly
 * how an assigned order ended up showing someone an empty screen. Printable
 * content = an uploaded model, a legacy generated model, a marketplace product
 * (its own or per line item), or — for a manual/WhatsApp order — at least one
 * written line item.
 *
 * Also the discriminator that keeps `kickOffMarketplaceOrder` honest: a
 * platform catalogue product has a productId, an admin-typed WhatsApp order
 * does not, so the latter still routes to `awaiting_model`.
 */
export async function orderHasPrintableContent(orderId: string): Promise<boolean> {
  const target = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: {
      id: true,
      modelGlbKey: true,
      modelStlKey: true,
      productId: true,
      uploadedModelId: true,
      selectedAddons: true,
    },
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { id: true },
        limit: 1,
      },
    },
  });
  if (!target) return false;
  if (
    target.modelGlbKey ||
    target.modelStlKey ||
    target.productId ||
    target.uploadedModelId ||
    target.generationAttempts.length > 0 ||
    (target.selectedAddons?.length ?? 0) > 0
  ) {
    return true;
  }
  // Cart sub-orders carry their products per line (there is no orders→items
  // relation), so check that table directly.
  const lineProducts = await db
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return lineProducts.some((i) => !!i.productId);
}

export type AssignFailure =
  | "manufacturer_unavailable"
  | "no_printable_content"
  | "not_assignable";

/**
 * Admin-facing Turkish copy per failure, shared by the single and the bulk
 * assign routes so both say the same thing. Typed on AssignFailure, so a new
 * reason is a compile error there rather than an undefined entry at runtime.
 * `not_assignable` names the refund because a refunded order fails with it
 * (see notRefundedGuard); the old English text sent the admin looking for a
 * status problem.
 */
export const ASSIGN_FAILURE_MESSAGES: Record<AssignFailure, string> = {
  manufacturer_unavailable: "Üretici bulunamadı ya da aktif değil.",
  no_printable_content:
    "Bu siparişte üreticiye gönderilecek basılabilir içerik yok (model, ürün veya kalem). Önce 3D modeli yükleyin ya da sipariş kalemlerini girin.",
  not_assignable:
    "Sipariş atanamaz: bulunamadı, onaylı değil, zaten atanmış ya da iade edilmiş.",
};

export type AssignResult =
  | {
      ok: true;
      order: {
        id: string;
        orderNumber: string;
        userId: string;
        status: string;
      };
    }
  | { ok: false; reason: AssignFailure };

export interface AssignArgs {
  orderId: string;
  manufacturerId: string;
  /** Writes an `assign_manufacturer` audit row. Omit for non-admin callers. */
  adminEmail?: string;
  /** Overrides the default notification copy (e.g. the decline-reassign wording). */
  notification?: { subject: string; body: string };
  /**
   * Extra condition the order must still satisfy. Defaults to
   * assignableStatusGuard(); pass `null` to skip the status check entirely
   * (the decline path has already validated the order's state).
   */
  statusGuard?: SQL | null;
  /** Skip the printable-content check when the caller already proved it. */
  skipPrintableCheck?: boolean;
}

/**
 * Assign an order to a manufacturer, atomically and idempotently.
 *
 * The update requires the order to still be unassigned (NULL or 'unassigned'),
 * which is what stops a concurrent admin action, an auto-assignment and a
 * decline retry from all landing on the same order. Losing that race is not an
 * error for the caller to retry — it means someone else already assigned it.
 *
 * It also refuses a refunded order (notRefundedGuard): that fails with
 * `not_assignable`, whoever the caller is.
 */
export async function assignManufacturerToOrder(
  args: AssignArgs
): Promise<AssignResult> {
  const { orderId, manufacturerId } = args;

  const manufacturer = await db.query.manufacturers.findFirst({
    where: and(
      eq(manufacturers.id, manufacturerId),
      eq(manufacturers.status, "active")
    ),
    columns: { id: true, companyName: true },
  });
  if (!manufacturer) return { ok: false, reason: "manufacturer_unavailable" };

  if (!args.skipPrintableCheck && !(await orderHasPrintableContent(orderId))) {
    return { ok: false, reason: "no_printable_content" };
  }

  const statusGuard =
    args.statusGuard === undefined ? assignableStatusGuard() : args.statusGuard;
  const conditions = [
    eq(orders.id, orderId),
    // Unassigned means NULL (never touched) or the explicit 'unassigned' the
    // cart fan-out writes for platform products — both are up for grabs.
    or(isNull(orders.manufacturerStatus), eq(orders.manufacturerStatus, "unassigned"))!,
    // A refunded order keeps its status (refund-end-state decision) and the
    // refund detaches the partner, so it sits at approved/paid + unassigned —
    // exactly what an assignable order looks like. Without this the admin
    // "Ata" button, bulk assign and automatic assignment would put a refunded
    // order back on a partner's bench and a fresh earning would accrue at ship.
    // It lives in the UPDATE (not a pre-read) so a refund landing between
    // ranking and this write still wins, and outside `statusGuard` so the
    // decline path (statusGuard: null) is covered too. The reason stays
    // `not_assignable`: callers map reasons through fixed tables, and a new
    // member would reach them as an unknown key.
    notRefundedGuard(),
  ];
  if (statusGuard) conditions.push(statusGuard);

  const [order] = await db
    .update(orders)
    .set({
      manufacturerId,
      manufacturerStatus: "assigned",
      assignedToManufacturerAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning({
      id: orders.id,
      orderNumber: orders.orderNumber,
      userId: orders.userId,
      customerName: orders.customerName,
      status: orders.status,
    });

  if (!order) return { ok: false, reason: "not_assignable" };

  if (args.adminEmail) {
    await db.insert(adminActions).values({
      orderId,
      action: "assign_manufacturer",
      adminEmail: args.adminEmail,
      notes: `Assigned to ${manufacturer.companyName}`,
    });
  }

  // Best-effort: a failed inbox/email write must not undo a committed
  // assignment — the order is already on the partner's bench either way.
  try {
    await notifyManufacturer({
      manufacturerId,
      type: "order_assigned",
      subject:
        args.notification?.subject ??
        `Yeni sipariş atandı: ${order.orderNumber}`,
      body:
        args.notification?.body ??
        `Sayın ${manufacturer.companyName},\n\n${order.orderNumber} numaralı sipariş size atandı. Lütfen üretici panelinizden 24 saat içinde kabul veya reddedin.\n\nMüşteri: ${order.customerName}`,
      orderId,
    });
  } catch (err) {
    console.error(`assignManufacturerToOrder: notify failed for ${orderId}`, err);
  }

  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId,
    status: order.status,
    manufacturerStatus: "assigned",
  });

  return {
    ok: true,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      status: order.status,
    },
  };
}
