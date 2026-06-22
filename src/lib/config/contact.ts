export const CONTACT_PHONE_DISPLAY = "+90 546 678 04 95";
export const CONTACT_PHONE_HREF = "tel:+905466780495";

export const CONTACT_EMAIL = "info@figurunica.com";
export const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`;

export const CONTACT_ADDRESS_FULL =
  "Şehit Osman Avcı Mahallesi, Akın 688 Sitesi B32, Etimesgut / Ankara";

export const CONTACT_ADDRESS_LINES = [
  "Şehit Osman Avcı Mahallesi",
  "Akın 688 Sitesi B32",
  "Etimesgut / Ankara",
] as const;

export const CONTACT_MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(
    "Şehit Osman Avcı Mahallesi Akın 688 Sitesi B32 Etimesgut Ankara"
  );

// WhatsApp (customer support + click-to-order). Digits only, E.164 without the
// leading "+", as wa.me expects. Single source of truth — change it here. Plain
// constants (no env) so this module stays usable from client components.
export const WHATSAPP_NUMBER = "905466780495";
export const WHATSAPP_DISPLAY = "+90 546 678 04 95";

/**
 * Build a click-to-chat WhatsApp deep link. Works in app + browser. Pass an
 * optional prefilled message (it is URL-encoded for you).
 */
export function buildWhatsAppUrl(message?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/**
 * Normalize a free-text Turkish phone number into wa.me digits (E.164 without
 * the leading "+"): strips non-digits, drops a leading domestic 0, and ensures
 * the 90 country code. Used to build a click-to-chat link to a CUSTOMER's number
 * (e.g. admin sending a payment link).
 */
export function toWhatsAppDigits(phone: string): string {
  let dd = phone.replace(/\D/g, "");
  if (dd.startsWith("00")) dd = dd.slice(2); // international "00" call prefix
  if (dd.startsWith("0")) dd = dd.slice(1); // domestic trunk 0
  if (!dd.startsWith("90")) dd = "90" + dd;
  return dd;
}
