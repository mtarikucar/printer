export type Locale = "en" | "tr";

// Şimdilik yalnızca Türkçe aktif. İngilizce sözlük/altyapı korunuyor;
// yeniden açmak için bu listeye "en" eklemek yeterli.
export const enabledLocales: readonly Locale[] = ["tr"];

export const defaultLocale: Locale = "tr";

export const LOCALE_COOKIE = "locale";
