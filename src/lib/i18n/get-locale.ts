import { cookies } from "next/headers";
import { type Locale, defaultLocale, enabledLocales, LOCALE_COOKIE } from "./types";

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get(LOCALE_COOKIE)?.value;
  if (enabledLocales.includes(value as Locale)) return value as Locale;
  return defaultLocale;
}
