import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, manufacturerNotifications } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";

export type ManufacturerNotificationType =
  | "order_assigned"
  | "order_cancelled"
  | "admin_message"
  | "system_announcement";

interface NotifyArgs {
  manufacturerId: string;
  type: ManufacturerNotificationType;
  subject: string;
  body: string;
  orderId?: string;
}

/**
 * Persist a manufacturer-targeted notification and enqueue the email delivery.
 * The email worker stamps `emailSentAt` (or `emailFailedReason`) on the row after dispatch.
 */
export async function notifyManufacturer({
  manufacturerId,
  type,
  subject,
  body,
  orderId,
}: NotifyArgs): Promise<string> {
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, manufacturerId),
    columns: { email: true, companyName: true },
  });
  if (!manufacturer) throw new Error("MANUFACTURER_NOT_FOUND");

  const [row] = await db
    .insert(manufacturerNotifications)
    .values({
      manufacturerId,
      orderId: orderId ?? null,
      type,
      subject,
      body,
    })
    .returning({ id: manufacturerNotifications.id });

  await getEmailQueue().add("manufacturer-notification", {
    type: "manufacturer_notification",
    to: manufacturer.email,
    orderNumber: orderId ?? "",
    customerName: manufacturer.companyName,
    manufacturerNotificationId: row.id,
    notificationSubject: subject,
    notificationBody: body,
    notificationType: type,
    locale: "tr",
  });

  return row.id;
}
