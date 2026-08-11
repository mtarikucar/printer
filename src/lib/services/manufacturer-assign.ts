import { and, eq, isNull, or, type SQL } from "drizzle-orm";
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
