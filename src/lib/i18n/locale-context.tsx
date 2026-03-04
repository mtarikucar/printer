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

export function useDictionary(): Dictionary {
  const ctx = useContext(LocaleContext);
  if (!ctx)
    throw new Error("useDictionary must be used within LocaleProvider");
  return ctx.dictionary;
}
