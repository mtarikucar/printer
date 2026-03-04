import type { Locale } from "../types";
import type { Dictionary } from "./en";
import en from "./en";
import tr from "./tr";

const dictionaries: Record<Locale, Dictionary> = { en, tr };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export type { Dictionary };
