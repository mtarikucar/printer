import type { Locale } from "./types";

const LOCALE_MAP: Record<Locale, string> = {
  en: "tr-TR",
  tr: "tr-TR",
};

export function formatCurrency(amountKurus: number, locale: Locale): string {
  return (amountKurus / 100).toLocaleString(LOCALE_MAP[locale], {
    style: "currency",
    currency: "TRY",
  });
}

export function formatDate(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(LOCALE_MAP[locale]);
}

export function formatDateLong(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(LOCALE_MAP[locale], {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDateTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(LOCALE_MAP[locale]);
}

export function formatNumber(n: number, locale: Locale): string {
  return n.toLocaleString(LOCALE_MAP[locale]);
}
