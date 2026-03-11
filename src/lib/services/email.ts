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

interface SendEmailParams {
  type:
    | "order_confirmation"
    | "generation_failed"
    | "order_shipped"
    | "order_refunded"
    | "revision_request"
    | "gift_card_received"
    | "digital_order_ready";
  to: string;
  orderNumber: string;
  customerName: string;
  trackingNumber?: string;
  adminEmail?: string;
  photoUrl?: string;
  glbUrl?: string;
  revisionNote?: string;
  giftCardCode?: string;
  giftCardAmount?: number;
  giftCardMessage?: string;
  senderName?: string;
  downloadUrl?: string;
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
      subject: d["email.confirmation.subject"].replace("{orderNumber}", p.orderNumber),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.confirmation.heading"].replace("{customerName}", p.customerName)}</h1>
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
          <h1 style="color: #1a1a1a;">${d["email.generationFailed.heading"].replace("{customerName}", p.customerName)}</h1>
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
          <h1 style="color: #1a1a1a;">${d["email.shipped.heading"].replace("{customerName}", p.customerName)}</h1>
          <p>${d["email.shipped.body"]}</p>
          <p><strong>${d["email.shipped.orderNumber"]}</strong> ${p.orderNumber}</p>
          ${p.trackingNumber ? `<p><strong>${d["email.shipped.trackingNumber"]}</strong> ${p.trackingNumber}</p>` : ""}
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
          <h1 style="color: #1a1a1a;">${d["email.refunded.heading"].replace("{customerName}", p.customerName)}</h1>
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
          <p><strong>${d["email.revision.customer"]}</strong> ${p.customerName} (${p.to})</p>
          ${p.photoUrl ? `<p><strong>${d["email.revision.photo"]}</strong> <a href="${p.photoUrl}">${d["email.revision.viewPhoto"]}</a></p>` : ""}
          ${p.glbUrl ? `<p><strong>${d["email.revision.model"]}</strong> <a href="${p.glbUrl}">${d["email.revision.viewModel"]}</a></p>` : ""}
          <div style="margin: 16px 0; padding: 12px; background: #fef3c7; border-radius: 8px;">
            <p style="margin: 0; font-weight: 600;">${d["email.revision.noteLabel"]}</p>
            <p style="margin: 8px 0 0;">${p.revisionNote || ""}</p>
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
            <h1 style="color: #1a1a1a;">${d["email.giftCard.heading"].replace("{customerName}", p.customerName)}</h1>
            <p>${d["email.giftCard.body"].replace("{senderName}", p.senderName || "")}</p>
            ${p.giftCardMessage ? `<div style="margin: 16px 0; padding: 16px; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #22c55e;"><p style="margin: 0; font-style: italic;">"${p.giftCardMessage}"</p></div>` : ""}
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

    digital_order_ready: (p) => ({
      subject: d["email.digitalReady.subject"].replace("{orderNumber}", p.orderNumber),
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">${d["email.digitalReady.heading"].replace("{customerName}", p.customerName)}</h1>
          <p>${d["email.digitalReady.body"]}</p>
          <p><strong>${d["email.digitalReady.orderNumber"]}</strong> ${p.orderNumber}</p>
          ${p.downloadUrl ? `<a href="${p.downloadUrl}"
             style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${d["email.digitalReady.downloadButton"]}
          </a>` : ""}
          <p style="margin-top: 24px; color: #666;">${d["email.digitalReady.note"]}</p>
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
    params.type === "revision_request" && params.adminEmail
      ? params.adminEmail
      : params.to;

  await transporter.sendMail({
    from: FROM_EMAIL,
    to: recipient,
    subject: template.subject,
    html: template.html,
  });
}
