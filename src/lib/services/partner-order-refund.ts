import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { isRefunded } from "@/lib/config/order-status-policy";

/**
 * After a partner's guarded UPDATE matched no row: is the reason that the
 * partner's OWN order was refunded? Lets the manufacturer and painter routes
 * answer 409 REFUNDED_ORDER_ERROR instead of a status error the partner cannot
 * act on.
 *
 * Scoped to the calling partner on purpose. `isOrderRefunded()`
 * (manufacturer-assign.ts) looks an order up by id alone. That is right for the
 * admin, but on a partner route it would tell a manufacturer or painter whether
 * ANY order id they know (one revoked from them, say) was refunded. An order
 * the partner no longer holds answers false, and the route keeps its plain
 * "not found / wrong status" reply.
 *
 * A refund detaches both partners (order-refund.ts), so this only fires for
 * rows that stayed attached: refunds from before the detach existed, or a
 * refund racing the partner's click.
 */
export async function isPartnerOrderRefunded(
  orderId: string,
  partner: { manufacturerId: string } | { painterId: string }
): Promise<boolean> {
  const owner =
    "manufacturerId" in partner
      ? eq(orders.manufacturerId, partner.manufacturerId)
      : eq(orders.painterId, partner.painterId);
  const row = await db.query.orders.findFirst({
    where: and(eq(orders.id, orderId), owner),
    columns: { paymentStatus: true },
  });
  return !!row && isRefunded(row);
}
