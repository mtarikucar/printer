import { type NextRequest } from "next/server";
import { type Locale, defaultLocale, enabledLocales, LOCALE_COOKIE } from "./types";

export function getRequestLocale(request: NextRequest): Locale {
  const value = request.cookies.get(LOCALE_COOKIE)?.value;
  if (enabledLocales.includes(value as Locale)) return value as Locale;
  return defaultLocale;
}
