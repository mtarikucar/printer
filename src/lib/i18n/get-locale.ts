import { cookies } from "next/headers";
import { type Locale, defaultLocale, LOCALE_COOKIE } from "./types";

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const value = cookieStore.get(LOCALE_COOKIE)?.value;
  if (value === "tr" || value === "en") return value;
  return defaultLocale;
}
