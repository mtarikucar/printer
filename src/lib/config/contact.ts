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
