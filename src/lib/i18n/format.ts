import type { Locale } from "./types";
import type { DisplayCurrency } from "@/lib/config/quote-types";
import { APP_TIME_ZONE } from "@/lib/config/timezone";

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

/**
 * Bir para biriminin MINOR birimini (kuruş/cent/penny) o birimin simgesiyle
 * yazar. `formatCurrency` DEĞİŞTİRİLMEDİ: depoda kırk küstü çağrı yeri var ve
 * hepsi TRY; ikinci bir parametre eklemek o yerlerin hepsini "acaba hangi
 * birim" sorusuna açardı.
 *
 * `DisplayCurrency` KAPALI bir kümedir ve üyelerinin hepsinin minor birimi iki
 * hanedir (TRY/EUR/USD/GBP) — `/100` bu yüzden doğrudur. JPY gibi ondalığı
 * farklı bir birim kümeye girerse bu bölme de o gün ele alınmak zorunda; tip
 * kapıyı o güne kadar kapalı tutar.
 *
 * Buradaki tek aritmetik minor → majör ölçek değişimidir; PARA çevirimi
 * (kuruş → döviz) bu dosyada YOKTUR, `quote-currency.ts`in işidir.
 */
export function formatMoneyMinor(
  minor: number,
  currency: DisplayCurrency,
  locale: Locale
): string {
  return (minor / 100).toLocaleString(LOCALE_MAP[locale], { style: "currency", currency });
}

export function formatDate(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(LOCALE_MAP[locale], { timeZone: APP_TIME_ZONE });
}

export function formatDateLong(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(LOCALE_MAP[locale], {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDateTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(LOCALE_MAP[locale], { timeZone: APP_TIME_ZONE });
}

export function formatNumber(n: number, locale: Locale): string {
  return n.toLocaleString(LOCALE_MAP[locale]);
}
