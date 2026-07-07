// Email notifications for the Workshop Request ("Atölye Talebi") feature.
//
// Kept separate from the order-centric `sendEmail` template registry: workshop
// leads have no orderNumber and their own copy. We compose HTML here and send
// via the generic `sendRawEmail`. All dynamic values pass through `escHtml`.
// Every send is the caller's responsibility to wrap in `.catch()` so a mail
// failure never rolls back the DB write (mirrors the rest of the codebase).

import { sendRawEmail, escHtml } from "./email";
import type { workshopRequests } from "@/lib/db/schema";
import {
  venueTypeLabel,
  ageGroupLabel,
  workshopTypeLabel,
} from "@/lib/workshop/constants";

type WorkshopRequest = typeof workshopRequests.$inferSelect;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "system@figurunica.com";
const BRAND_FOOTER = `<p style="margin-top:24px;color:#999;font-size:12px;">Figurünica</p>`;

function formatKurus(kurus?: number | null): string {
  if (kurus === undefined || kurus === null) return "";
  return `₺${(kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value?: Date | string | null): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return String(value);
  }
}

function row(label: string, value?: string | null): string {
  if (!value) return "";
  return `<tr>
    <td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;">${escHtml(
      label
    )}</td>
    <td style="padding:4px 0;color:#111827;font-size:14px;">${escHtml(value)}</td>
  </tr>`;
}

function detailsTable(req: WorkshopRequest): string {
  return `<table style="border-collapse:collapse;margin:16px 0;">
    ${row("Referans", req.reference)}
    ${row("Ad Soyad", req.contactName)}
    ${row("E-posta", req.contactEmail)}
    ${row("Telefon", req.contactPhone)}
    ${row("Kurum / İşletme", req.organizationName)}
    ${row("Mekân türü", venueTypeLabel(req.venueType))}
    ${row("İl / İlçe", `${req.city} / ${req.district}`)}
    ${row("Adres", req.addressLine)}
    ${row("Katılımcı sayısı", String(req.participantCount))}
    ${row("Yaş grubu", ageGroupLabel(req.ageGroup))}
    ${row("Etkinlik türü", workshopTypeLabel(req.workshopType))}
    ${row("Tercih edilen tarih", req.preferredDate)}
    ${row("Alternatif tarih", req.alternativeDate)}
    ${row("Bütçe", req.budgetRange)}
    ${row("Nereden duydu", req.howHeard)}
    ${row("Mesaj", req.message)}
  </table>`;
}

function wrap(inner: string): string {
  return `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color:#1f2937;">${inner}${BRAND_FOOTER}</div>`;
}

/**
 * Fire both emails triggered by a new submission:
 *  (a) internal alert to ADMIN_EMAIL with the full request + reply-to requester,
 *  (b) confirmation to the requester with their reference number.
 * Each send is independent; a failure of one does not block the other.
 */
export async function sendWorkshopRequestReceivedEmails(
  req: WorkshopRequest
): Promise<void> {
  const adminHtml = wrap(`
    <h1 style="color:#1a1a1a;font-size:20px;">Yeni atölye talebi — ${escHtml(
      req.reference
    )}</h1>
    <p><strong>${escHtml(req.contactName)}</strong> mekânında bir Figurünica atölyesi düzenlenmesini talep etti.</p>
    ${detailsTable(req)}
    ${
      APP_URL
        ? `<a href="${APP_URL}/admin/workshop-requests" style="display:inline-block;background:#16a34a;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Admin panelinde aç</a>`
        : ""
    }
  `);

  const customerHtml = wrap(`
    <h1 style="color:#1a1a1a;font-size:20px;">Talebiniz alındı, teşekkürler!</h1>
    <p>Merhaba ${escHtml(req.contactName)},</p>
    <p>Mekânınızda atölye düzenlenmesine yönelik talebinizi aldık. Ekibimiz en kısa sürede sizinle iletişime geçecek.</p>
    <div style="margin:20px 0;padding:16px;background:#f0fdf4;border-radius:12px;border-left:4px solid #22c55e;">
      <p style="margin:0;font-size:13px;color:#6b7280;">Talep referansınız</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;font-family:monospace;letter-spacing:1px;">${escHtml(
        req.reference
      )}</p>
    </div>
    <p style="color:#6b7280;font-size:13px;">Bu referans numarasını bizimle iletişimde saklayabilirsiniz.</p>
  `);

  await Promise.allSettled([
    sendRawEmail({
      to: ADMIN_EMAIL,
      subject: `Yeni atölye talebi — ${req.reference}`,
      html: adminHtml,
      replyTo: req.contactEmail,
    }),
    sendRawEmail({
      to: req.contactEmail,
      subject: `Atölye talebiniz alındı — ${req.reference}`,
      html: customerHtml,
    }),
  ]);
}

/**
 * Notify the requester when an admin moves the request to a customer-visible
 * state. No-op for statuses that shouldn't email (new/reviewing/cancelled).
 */
export async function sendWorkshopStatusEmail(
  req: WorkshopRequest,
  status: string
): Promise<void> {
  let subject: string;
  let inner: string;

  if (status === "scheduled") {
    const dateStr = formatDate(req.scheduledAt);
    subject = `Atölyeniz planlandı — ${req.reference}`;
    inner = `
      <h1 style="color:#16a34a;font-size:20px;">Atölyeniz planlandı 🎉</h1>
      <p>Merhaba ${escHtml(req.contactName)},</p>
      <p><strong>${escHtml(
        req.reference
      )}</strong> referanslı atölye talebiniz onaylandı ve planlandı.</p>
      <table style="border-collapse:collapse;margin:16px 0;">
        ${dateStr ? row("Planlanan tarih", dateStr) : ""}
        ${
          req.quotedPriceKurus != null
            ? row("Teklif tutarı", formatKurus(req.quotedPriceKurus))
            : ""
        }
        ${row("Adres", `${req.addressLine} (${req.city}/${req.district})`)}
      </table>
      <p>Detaylar için ekibimiz sizinle iletişime geçecek. Sorularınız için bu e-postayı yanıtlayabilirsiniz.</p>
    `;
  } else if (status === "rejected") {
    subject = `Atölye talebiniz hakkında — ${req.reference}`;
    inner = `
      <h1 style="color:#1a1a1a;font-size:20px;">Atölye talebiniz hakkında</h1>
      <p>Merhaba ${escHtml(req.contactName)},</p>
      <p><strong>${escHtml(
        req.reference
      )}</strong> referanslı atölye talebinizi maalesef şu an için karşılayamıyoruz.</p>
      ${
        req.rejectionReason
          ? `<div style="margin:16px 0;padding:12px;background:#f9fafb;border-radius:8px;"><p style="margin:0;color:#6b7280;font-size:13px;">Not</p><p style="margin:6px 0 0;">${escHtml(
              req.rejectionReason
            )}</p></div>`
          : ""
      }
      <p>İlginiz için teşekkür ederiz. İleride tekrar değerlendirmekten memnuniyet duyarız.</p>
    `;
  } else if (status === "completed") {
    subject = `Atölyeniz tamamlandı — teşekkürler! (${req.reference})`;
    inner = `
      <h1 style="color:#16a34a;font-size:20px;">Atölyeniz tamamlandı 🎨</h1>
      <p>Merhaba ${escHtml(req.contactName)},</p>
      <p>Bizi tercih ettiğiniz için teşekkür ederiz! Atölye deneyiminizi sevdiklerinizle paylaşmanızdan mutluluk duyarız.</p>
      <p>Yeni bir etkinlik için her zaman buradayız.</p>
    `;
  } else {
    // reviewing / new / cancelled → no customer email.
    return;
  }

  await sendRawEmail({
    to: req.contactEmail,
    subject,
    html: wrap(inner),
  }).catch((e) => console.error("workshop status email failed (non-fatal)", e));
}
