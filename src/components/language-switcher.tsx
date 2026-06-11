"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/locale-context";
import { enabledLocales, LOCALE_COOKIE } from "@/lib/i18n/types";

export function LanguageSwitcher() {
  const router = useRouter();
  const locale = useLocale();

  // Tek dil aktifken dil değiştirici gösterilmez (şimdilik yalnızca Türkçe).
  if (enabledLocales.length < 2) return null;

  const toggle = () => {
    const next = locale === "en" ? "tr" : "en";
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  };

  return (
    <button
      onClick={toggle}
      className="text-sm font-medium text-text-muted hover:text-green-400 transition-colors"
      title={locale === "en" ? "Türkçe'ye geç" : "Switch to English"}
    >
      {locale === "en" ? "TR" : "EN"}
    </button>
  );
}
