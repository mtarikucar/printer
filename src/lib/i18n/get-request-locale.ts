import { type NextRequest } from "next/server";
import { type Locale, defaultLocale, LOCALE_COOKIE } from "./types";

export function getRequestLocale(request: NextRequest): Locale {
  const value = request.cookies.get(LOCALE_COOKIE)?.value;
  if (value === "tr" || value === "en") return value;
  return defaultLocale;
}
