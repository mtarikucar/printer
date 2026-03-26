import nodemailer from "nodemailer";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n/dictionaries";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_PORT === "465",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM_EMAIL = process.env.SMTP_FROM || "Figurine Studio <siparis@figurinestudio.com>";

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface SendEmailParams {
  type:
    | "order_confirmation"
    | "generation_failed"
    | "order_shipped"
    | "order_refunded"
    | "revision_request"
    | "gift_card_received"
    | "order_approved"
    | "order_printing"
    | "order_delivered"
    | "admin_custom"
    | "order_assigned"
    | "manufacturer_shipped";
  to: string;
  orderNumber: string;
  customerName: string;
  trackingNumber?: string;
  adminEmail?: string;
  manufacturerEmail?: string;
  companyName?: string;
  photoUrl?: string;
  glbUrl?: string;
  revisionNote?: string;
  giftCardCode?: string;
  giftCardAmount?: number;
  giftCardMessage?: string;
  senderName?: string;
  customSubject?: string;
  customBody?: string;
  locale?: Locale;
}

function getTemplates(locale: Locale) {
  const d = getDictionary(locale);
  const trackUrl = (orderNumber: string) =>
    `${process.env.NEXT_PUBLIC_APP_URL}/track/${orderNumber}`;

  const templates: Record<
    SendEmailParams["type"],
    (params: SendEmailParams) => { subject: string; html: string }
  > = {
    order_confirmation: (p) => ({
      subject: d["email.confirmation.subject"].replace("{orderNumber}", escHtml(p.orderNumber)),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.confirmation.heading"].replace("{customerName}", escHtml(p.customerName))}</h1>
          <p>${d["email.confirmation.body"]}</p>
          <p><strong>${d["email.confirmation.orderNumber"]}</strong> ${p.orderNumber}</p>
          <h2>${d["email.confirmation.nextSteps"]}</h2>
          <ol>
            <li>${d["email.confirmation.step1"]}</li>
            <li>${d["email.confirmation.step2"]}</li>
            <li>${d["email.confirmation.step3"]}</li>
            <li>${d["email.confirmation.step4"]}</li>
          </ol>
          <p>${d["email.confirmation.trackPrompt"]}</p>
          <a href="${trackUrl(p.orderNumber)}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${d["email.confirmation.trackButton"]}
          </a>
          <p style="margin-top: 24px; color: #666;">${d["email.confirmation.estimate"]}</p>
        </div>
      `,
    }),

    generation_failed: (p) => ({
      subject: d["email.generationFailed.subject"].replace("{orderNumber}", p.orderNumber),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.generationFailed.heading"].replace("{customerName}", escHtml(p.customerName))}</h1>
          <p>${d["email.generationFailed.body"]}</p>
          <p><strong>${d["email.generationFailed.orderNumber"]}</strong> ${p.orderNumber}</p>
          <p>${d["email.generationFailed.followUp"]}</p>
          <a href="${trackUrl(p.orderNumber)}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${d["email.generationFailed.trackButton"]}
          </a>
        </div>
      `,
    }),

    order_shipped: (p) => ({
      subject: d["email.shipped.subject"].replace("{orderNumber}", p.orderNumber),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.shipped.heading"].replace("{customerName}", escHtml(p.customerName))}</h1>
          <p>${d["email.shipped.body"]}</p>
          <p><strong>${d["email.shipped.orderNumber"]}</strong> ${escHtml(p.orderNumber)}</p>
          ${p.trackingNumber ? `<p><strong>${d["email.shipped.trackingNumber"]}</strong> ${escHtml(p.trackingNumber)}</p>` : ""}
          <h2>${d["email.shipped.kitContents"]}</h2>
          <ul>
            <li>${d["email.shipped.item1"]}</li>
            <li>${d["email.shipped.item2"]}</li>
            <li>${d["email.shipped.item3"]}</li>
            <li>${d["email.shipped.item4"]}</li>
            <li>${d["email.shipped.item5"]}</li>
          </ul>
          <a href="${trackUrl(p.orderNumber)}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${d["email.shipped.trackButton"]}
          </a>
        </div>
      `,
    }),

    order_refunded: (p) => ({
      subject: d["email.refunded.subject"].replace("{orderNumber}", p.orderNumber),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.refunded.heading"].replace("{customerName}", escHtml(p.customerName))}</h1>
          <p>${d["email.refunded.body"]}</p>
          <p><strong>${d["email.refunded.orderNumber"]}</strong> ${p.orderNumber}</p>
          <p>${d["email.refunded.apology"]}</p>
        </div>
      `,
    }),

    revision_request: (p) => ({
      subject: d["email.revision.subject"].replace("{customerEmail}", p.to),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.revision.heading"]}</h1>
          <p><strong>${d["email.revision.customer"]}</strong> ${escHtml(p.customerName)} (${escHtml(p.to)})</p>
          ${p.photoUrl ? `<p><strong>${d["email.revision.photo"]}</strong> <a href="${p.photoUrl}">${d["email.revision.viewPhoto"]}</a></p>` : ""}
          ${p.glbUrl ? `<p><strong>${d["email.revision.model"]}</strong> <a href="${p.glbUrl}">${d["email.revision.viewModel"]}</a></p>` : ""}
          <div style="margin: 16px 0; padding: 12px; background: #fef3c7; border-radius: 8px;">
            <p style="margin: 0; font-weight: 600;">${d["email.revision.noteLabel"]}</p>
            <p style="margin: 8px 0 0;">${escHtml(p.revisionNote || "")}</p>
          </div>
          <p>${d["email.revision.action"]}</p>
        </div>
      `,
    }),

    gift_card_received: (p) => {
      const amountFormatted = p.giftCardAmount
        ? `₺${(p.giftCardAmount / 100).toLocaleString("tr-TR")}`
        : "";
      return {
        subject: d["email.giftCard.subject"].replace("{amount}", amountFormatted),
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #1a1a1a;">${d["email.giftCard.heading"].replace("{customerName}", escHtml(p.customerName))}</h1>
            <p>${d["email.giftCard.body"].replace("{senderName}", escHtml(p.senderName || "Figurine Studio"))}</p>
            ${p.giftCardMessage ? `<div style="margin: 16px 0; padding: 16px; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #22c55e;"><p style="margin: 0; font-style: italic;">"${escHtml(p.giftCardMessage)}"</p></div>` : ""}
            <div style="margin: 24px 0; padding: 24px; background: #f9fafb; border-radius: 12px; text-align: center;">
              <p style="margin: 0; font-size: 14px; color: #6b7280;">${d["email.giftCard.codeLabel"]}</p>
              <p style="margin: 8px 0; font-size: 28px; font-weight: bold; font-family: monospace; color: #1a1a1a; letter-spacing: 2px;">${p.giftCardCode}</p>
              <p style="margin: 8px 0 0; font-size: 24px; font-weight: bold; color: #22c55e;">${amountFormatted}</p>
            </div>
            <p>${d["email.giftCard.howToUse"]}</p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/create"
               style="display: inline-block; background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              ${d["email.giftCard.startButton"]}
            </a>
          </div>
        `,
      };
    },

    order_approved: (p) => ({
      subject: d["email.approved.subject"].replace("{orderNumber}", p.orderNumber),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.approved.heading"].replace("{customerName}", escHtml(p.customerName))}</h1>
          <p>${d["email.approved.body"]}</p>
          <p><strong>${d["email.approved.orderNumber"]}</strong> ${p.orderNumber}</p>
          <a href="${trackUrl(p.orderNumber)}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${d["email.approved.trackButton"]}
          </a>
        </div>
      `,
    }),

    order_printing: (p) => ({
      subject: d["email.printing.subject"].replace("{orderNumber}", p.orderNumber),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.printing.heading"].replace("{customerName}", escHtml(p.customerName))}</h1>
          <p>${d["email.printing.body"]}</p>
          <p><strong>${d["email.printing.orderNumber"]}</strong> ${p.orderNumber}</p>
          <a href="${trackUrl(p.orderNumber)}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${d["email.printing.trackButton"]}
          </a>
        </div>
      `,
    }),

    order_delivered: (p) => ({
      subject: d["email.delivered.subject"].replace("{orderNumber}", p.orderNumber),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.delivered.heading"].replace("{customerName}", escHtml(p.customerName))}</h1>
          <p>${d["email.delivered.body"]}</p>
          <p><strong>${d["email.delivered.orderNumber"]}</strong> ${p.orderNumber}</p>
          <a href="${trackUrl(p.orderNumber)}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${d["email.delivered.trackButton"]}
          </a>
        </div>
      `,
    }),

    admin_custom: (p) => ({
      subject: p.customSubject || d["email.adminCustom.subject"].replace("{orderNumber}", p.orderNumber),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.adminCustom.heading"].replace("{customerName}", escHtml(p.customerName))}</h1>
          <div style="white-space: pre-wrap;">${escHtml(p.customBody || "")}</div>
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;" />
          <p><strong>${d["email.adminCustom.orderNumber"]}</strong> ${p.orderNumber}</p>
          <a href="${trackUrl(p.orderNumber)}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 16px;">
            ${d["email.adminCustom.trackButton"]}
          </a>
          <p style="margin-top: 24px; color: #999; font-size: 12px;">Figurine Studio</p>
        </div>
      `,
    }),

    order_assigned: (p) => ({
      subject: d["email.assigned.subject"].replace("{orderNumber}", escHtml(p.orderNumber)),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.assigned.heading"]}</h1>
          <p>${d["email.assigned.body"]}</p>
          <p><strong>${d["email.assigned.orderNumber"]}</strong> ${escHtml(p.orderNumber)}</p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/manufacturer/orders"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${d["email.assigned.dashboardButton"]}
          </a>
          <p style="margin-top: 24px; color: #999; font-size: 12px;">Figurine Studio</p>
        </div>
      `,
    }),

    manufacturer_shipped: (p) => ({
      subject: d["email.manufacturerShipped.subject"].replace("{orderNumber}", escHtml(p.orderNumber)),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.manufacturerShipped.heading"]}</h1>
          <p>${d["email.manufacturerShipped.body"].replace("{companyName}", escHtml(p.companyName || "")).replace("{orderNumber}", escHtml(p.orderNumber))}</p>
          <p><strong>${d["email.manufacturerShipped.orderNumber"]}</strong> ${escHtml(p.orderNumber)}</p>
          ${p.trackingNumber ? `<p><strong>${d["email.manufacturerShipped.trackingNumber"]}</strong> ${escHtml(p.trackingNumber)}</p>` : ""}
          <a href="${trackUrl(p.orderNumber)}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${d["email.adminCustom.trackButton"]}
          </a>
          <p style="margin-top: 24px; color: #999; font-size: 12px;">Figurine Studio</p>
        </div>
      `,
    }),
  };

  return templates;
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const locale = params.locale || defaultLocale;
  const templates = getTemplates(locale);
  const template = templates[params.type](params);

  const recipient =
    params.type === "order_assigned" && params.manufacturerEmail
      ? params.manufacturerEmail
      : params.type === "manufacturer_shipped" && params.adminEmail
        ? params.adminEmail
        : params.type === "revision_request" && params.adminEmail
          ? params.adminEmail
          : params.to;

  await transporter.sendMail({
    from: FROM_EMAIL,
    to: recipient,
    subject: template.subject,
    html: template.html,
  });
}
