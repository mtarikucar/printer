import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { painters, painterNotifications } from "@/lib/db/schema";
import { sendRawEmail, escHtml } from "@/lib/services/email";
import { emitPainterNotification } from "@/lib/realtime/emit";

export type PainterNotificationType =
  | "order_assigned"
  | "admin_message"
  | "system_announcement"
  | "payout"
  | "qc_result"
  // Siparişin modeline yeni bir sürüm yüklendi. Boyacı için bu, ELİNDEKİ
  // baskının eski sürüme ait olabileceği anlamına gelir; dosyayı sessizce
  // değiştirmek yerine haber verilir (partner-model-ack.ts).
  | "model_revision";

interface NotifyArgs {
  painterId: string;
  type: PainterNotificationType;
  subject: string;
  body: string;
  orderId?: string;
}

/**
 * Persist a painter-targeted notification and best-effort send the email.
 *
 * Robustness:
 *   - The DB insert is the source of truth (inbox row). If the email send
 *     fails we still return the row id — the caller's main operation (e.g.
 *     order assignment / payout) shouldn't roll back because of an SMTP blip.
 *   - Mirrors `notifyManufacturer`, but sends via the generic `sendRawEmail`
 *     path (composing simple HTML) instead of the templated `sendEmail` union.
 *   - The realtime nudge is no longer deferred: the painter panel now has its
 *     own SSE topic (realtime/events.ts `topics.painter`), so an inbox row
 *     reaches an open panel without waiting for a manual refresh.
 *   - `emailSentAt` / `emailFailedReason` are stamped inline after dispatch.
 */
export async function notifyPainter({
  painterId,
  type,
  subject,
  body,
  orderId,
}: NotifyArgs): Promise<string> {
  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, painterId),
    columns: { email: true, companyName: true },
  });
  if (!painter) throw new Error("PAINTER_NOT_FOUND");

  const [row] = await db
    .insert(painterNotifications)
    .values({
      painterId,
      orderId: orderId ?? null,
      type,
      subject,
      body,
    })
    .returning({ id: painterNotifications.id });

  // Realtime: nudge the painter's notification surface to refetch. Best-effort,
  // exactly like notifyManufacturer — the inbox row is the source of truth.
  await emitPainterNotification(painterId).catch(() => {});

  try {
    await sendRawEmail({
      to: painter.email,
      subject: subject || `Figurunica — ${orderId ?? ""}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${escHtml(subject)}</h1>
          <div style="white-space: pre-wrap; color: #1f2937;">${escHtml(body)}</div>
          <p style="margin-top:24px;"><a href="${process.env.NEXT_PUBLIC_APP_URL}/painter/jobs" style="display:inline-block;background:#4f46e5;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;">Boyacı paneli</a></p>
        </div>
      `,
    });
    await db
      .update(painterNotifications)
      .set({ emailSentAt: new Date() })
      .where(eq(painterNotifications.id, row.id))
      .catch(() => {});
  } catch (err) {
    // Inbox row is already persisted; mark the failure so admin can retry or
    // alert. The caller's operation is unaffected.
    console.error(
      `notifyPainter: email send failed for notification ${row.id}`,
      err
    );
    await db
      .update(painterNotifications)
      .set({
        emailFailedReason: err instanceof Error ? err.message : "send failed",
      })
      .where(eq(painterNotifications.id, row.id))
      .catch(() => {});
  }

  return row.id;
}
