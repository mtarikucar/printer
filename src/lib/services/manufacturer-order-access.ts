import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, orders } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";

/**
 * The gate every manufacturer file route repeats: signed in, account active,
 * and the order is actually theirs. Returns the order or a ready error.
 */
export async function manufacturerOrderOrError(
  orderId: string
): Promise<
  | { ok: true; order: { id: string; orderNumber: string } }
  | { ok: false; response: Response }
> {
  const session = await getManufacturerSession();
  if (!session) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { status: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return { ok: false, response: Response.json({ error: "Account not active" }, { status: 403 }) };
  }
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, orderId), eq(orders.manufacturerId, session.manufacturerId)),
    columns: { id: true, orderNumber: true },
  });
  if (!order) {
    return { ok: false, response: Response.json({ error: "Order not found" }, { status: 404 }) };
  }
  return { ok: true, order };
}
