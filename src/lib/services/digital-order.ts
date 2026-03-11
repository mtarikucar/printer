import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { digitalOrders } from "@/lib/db/schema";
import { getFileBuffer } from "@/lib/services/storage";
import { sendEmail } from "@/lib/services/email";
import type { Locale } from "@/lib/i18n/types";

export async function confirmDigitalOrder(id: string, locale: Locale) {
  const [updated] = await db
    .update(digitalOrders)
    .set({
      status: "ready",
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(digitalOrders.id, id), inArray(digitalOrders.status, ["pending_payment", "paid"])))
    .returning();

  if (!updated) {
    throw new Error("Digital order not found or already confirmed");
  }

  const downloadUrl = `${process.env.NEXT_PUBLIC_APP_URL}/digital/${updated.id}`;

  await sendEmail({
    type: "digital_order_ready",
    to: updated.email,
    orderNumber: updated.orderNumber,
    customerName: updated.customerName,
    downloadUrl,
    locale,
  });
}

export async function getStlBuffer(digitalOrderId: string, userId: string) {
  const order = await db.query.digitalOrders.findFirst({
    where: and(
      eq(digitalOrders.id, digitalOrderId),
      eq(digitalOrders.userId, userId)
    ),
  });

  if (!order) throw new Error("Digital order not found");
  if (order.status !== "ready") throw new Error("Digital order not ready");
  if (!order.stlFileKey) throw new Error("STL file not available");

  const buffer = await getFileBuffer(order.stlFileKey);

  await db
    .update(digitalOrders)
    .set({
      downloadCount: sql`${digitalOrders.downloadCount} + 1`,
      lastDownloadAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(digitalOrders.id, digitalOrderId));

  return { buffer, filename: `${order.orderNumber}.stl` };
}
