import { db } from "@/lib/db";
import { customerNotifications } from "@/lib/db/schema";
import { emitCustomerNotification } from "@/lib/realtime/emit";

// Insert an in-app notification for a customer (Faz 4 notification center).
// Best-effort: never throws so it can't break the triggering operation.
export async function notifyCustomer(args: {
  userId: string;
  orderId?: string | null;
  type: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    await db.insert(customerNotifications).values({
      userId: args.userId,
      orderId: args.orderId ?? null,
      type: args.type,
      title: args.title,
      body: args.body,
    });
    // Realtime: nudge the customer's notification bell to refetch.
    await emitCustomerNotification(args.userId);
  } catch (err) {
    console.error("notifyCustomer failed (non-fatal)", err);
  }
}
