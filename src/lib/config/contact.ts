export const CONTACT_PHONE_DISPLAY = "+90 850 840 73 03";
export const CONTACT_PHONE_HREF = "tel:+908508407303";

export const CONTACT_EMAIL = "info@figurunica.com";
export const CONTACT_EMAIL_HREF = `mailto:${CONTACT_EMAIL}`;

/**
 * ADRES BURADA DEĞİL: `business-identity.ts`te.
 *
 * Burada bir zamanlar `CONTACT_ADDRESS_FULL` / `CONTACT_ADDRESS_LINES` /
 * `CONTACT_MAPS_URL` vardı ve üçü de posta kodu TAŞIMIYORDU. Sonuç: yasal
 * sayfalar `06820`li adresi, her ticari sayfanın footer'ı ve `/contact` ise
 * eksik olanı gösteriyordu — yani bir harita/işletme eşleştiricisinin okuduğu
 * NAP bloğu (isim-adres-telefon) her yerde eksikti. Üçü de kaldırıldı;
 * karşılıkları `BUSINESS_ADDRESS_LINES`, `BUSINESS_ADDRESS_FULL` ve
 * `BUSINESS_MAPS_URL`.
 *
 * Bağımlılık yönü bunu zorunlu kılıyor: `business-identity.ts` BU dosyadan
 * telefon/e-posta alıyor, yani ters yönde bir import döngü olurdu. Adresin
 * yapısal hâli (`BUSINESS_ADDRESS`, schema.org `PostalAddress`) zaten orada
 * duruyordu; görünen hâlleri de onun yanına taşındı ki tek kaynak kalsın.
 */



// WhatsApp (customer support + click-to-order). Digits only, E.164 without the
// leading "+", as wa.me expects. Single source of truth — change it here. Plain
// constants (no env) so this module stays usable from client components.
export const WHATSAPP_NUMBER = "908508407303";
export const WHATSAPP_DISPLAY = "+90 850 840 73 03";

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
