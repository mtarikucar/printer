import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, manufacturerNotifications } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";

export type ManufacturerNotificationType =
  | "order_assigned"
  | "order_cancelled"
  | "admin_message"
  | "system_announcement"
  | "qc_result";

interface NotifyArgs {
  manufacturerId: string;
  type: ManufacturerNotificationType;
  subject: string;
  body: string;
  orderId?: string;
}

/**
 * Persist a manufacturer-targeted notification and enqueue the email delivery.
 *
 * Robustness:
 *   - The DB insert is the source of truth (inbox row). If email enqueue fails
 *     we still return the row id — caller's main operation (e.g. order
 *     assignment) shouldn't roll back because of a queue blip.
 *   - The email worker stamps `emailSentAt` / `emailFailedReason` after
 *     dispatch.
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

  try {
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
  } catch (err) {
    // Inbox row is already persisted; mark the failure so admin/worker can
    // retry or alert.
    console.error(
      `notifyManufacturer: email enqueue failed for notification ${row.id}`,
      err
    );
    await db
      .update(manufacturerNotifications)
      .set({
        emailFailedReason: err instanceof Error ? err.message : "enqueue failed",
      })
      .where(eq(manufacturerNotifications.id, row.id))
      .catch(() => {});
  }

  return row.id;
}
