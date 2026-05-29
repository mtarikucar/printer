// Shipping carriers + tracking-URL builders. Pure + unit-tested
// (scripts/test-carriers.ts). 'other' has no public deep-link so its URL is null
// (the raw tracking number is still shown to the customer).

export type Carrier = "yurtici" | "aras" | "mng" | "ptt" | "surat" | "other";

export const CARRIERS: Carrier[] = ["yurtici", "aras", "mng", "ptt", "surat", "other"];

const URL_BUILDERS: Record<Carrier, ((t: string) => string) | null> = {
  yurtici: (t) =>
    `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${encodeURIComponent(t)}`,
  aras: (t) => `https://kargotakip.araskargo.com.tr/?code=${encodeURIComponent(t)}`,
  mng: (t) => `https://www.mngkargo.com.tr/gonderitakip/?code=${encodeURIComponent(t)}`,
  ptt: (t) => `https://gonderitakip.ptt.gov.tr/Track/Verify?q=${encodeURIComponent(t)}`,
  surat: (t) =>
    `https://www.suratkargo.com.tr/KargoTakip/?kargotakipno=${encodeURIComponent(t)}`,
  other: null,
};

export function isCarrier(v: string): v is Carrier {
  return (CARRIERS as string[]).includes(v);
}

export function trackingUrl(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined
): string | null {
  if (!carrier || !trackingNumber) return null;
  if (!isCarrier(carrier)) return null;
  const builder = URL_BUILDERS[carrier];
  return builder ? builder(trackingNumber) : null;
}
