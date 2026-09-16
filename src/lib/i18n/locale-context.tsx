"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "./types";
import type { Dictionary } from "./dictionaries";
import { getDictionary } from "./dictionaries";

interface LocaleContextValue {
  locale: Locale;
  dictionary: Dictionary;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const dictionary = getDictionary(locale);
  return (
    <LocaleContext.Provider value={{ locale, dictionary }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx.locale;
}

/**
 * Sözlüğü OKUYAN taraf. Sağlayıcı yoksa BİLEREK hata atar.
 *
 * Hata yutulmuyor: eksik bir sağlayıcı, sessizce yanlış dilde (ya da anahtar
 * adıyla) metin göstermekten iyidir. Bunun bedeli, sağlayıcının gerçekten her
 * ağaçta bulunmasıdır — bu yüzden PANEL DÜZENLERİNİN HER BİRİ sağlayıcıyı
 * kendisi kurar (admin/layout.tsx, manufacturer/layout.tsx,
 * painter/layout.tsx) ve kök düzenden miras beklemez. /admin bunu yapmayan tek
 * paneldi ve kenar çubuğu üç kez sağlayıcısız render edilip sayfayı 500'e
 * düşürdü; panelin kabuğu (AdminSidebar) artık metinlerini sunucudan prop
 * olarak alıyor, yani kabuk hiçbir koşulda bu hatayı atamaz.
 */
export function useDictionary(): Dictionary {
  const ctx = useContext(LocaleContext);
  if (!ctx)
    throw new Error("useDictionary must be used within LocaleProvider");
  return ctx.dictionary;
}
