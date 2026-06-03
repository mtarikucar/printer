// NOTE: We import from 'libphonenumber-js/core' with explicit metadata rather than from
// 'libphonenumber-js' directly, to avoid a tsx 4.x source-map resolution bug that causes
// tsx to load the raw ESM source files (which lack bundled metadata) instead of the
// compiled CJS build. This produces the same runtime behaviour; Next.js/webpack is unaffected.
import {
  parsePhoneNumber as _parsePhoneNumber,
  type CountryCode,
} from "libphonenumber-js/core";
import metadata from "libphonenumber-js/metadata.min.json";

export type { CountryCode };

export const DEFAULT_COUNTRY: CountryCode = "TR";

export interface Country {
  iso: CountryCode;
  /** English/Turkish-agnostic display name; localize at the call site if needed. */
  name: string;
  dialCode: string;
  flag: string;
}

// Curated list — Türkiye first (default), then the markets we realistically see.
// Keep short; libphonenumber validates the actual number for the chosen country.
export const COUNTRIES: Country[] = [
  { iso: "TR", name: "Türkiye", dialCode: "+90", flag: "🇹🇷" },
  { iso: "US", name: "United States", dialCode: "+1", flag: "🇺🇸" },
  { iso: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧" },
  { iso: "DE", name: "Deutschland", dialCode: "+49", flag: "🇩🇪" },
  { iso: "NL", name: "Nederland", dialCode: "+31", flag: "🇳🇱" },
  { iso: "FR", name: "France", dialCode: "+33", flag: "🇫🇷" },
  { iso: "AZ", name: "Azərbaycan", dialCode: "+994", flag: "🇦🇿" },
  { iso: "SA", name: "السعودية", dialCode: "+966", flag: "🇸🇦" },
  { iso: "AE", name: "الإمارات", dialCode: "+971", flag: "🇦🇪" },
];

function parsePhoneNumberFromString(input: string, country: CountryCode) {
  return _parsePhoneNumber(input, country, metadata as never);
}

/**
 * Parse a user-typed phone (with or without leading 0, spaces, or +CC) for the
 * given country and return canonical E.164 (e.g. "+905321234567"), or null if
 * the value is not a valid number for that country.
 */
export function normalizePhone(
  input: string,
  country: CountryCode = DEFAULT_COUNTRY
): string | null {
  if (!input || !input.trim()) return null;
  try {
    const parsed = parsePhoneNumberFromString(input.trim(), country);
    if (!parsed || !parsed.isValid()) return null;
    return parsed.number; // E.164
  } catch {
    return null;
  }
}

export function isValidPhone(
  input: string,
  country: CountryCode = DEFAULT_COUNTRY
): boolean {
  return normalizePhone(input, country) !== null;
}

/** Human-friendly international formatting for display, e.g. "+90 532 123 45 67". */
export function formatPhoneDisplay(e164: string): string {
  try {
    // For E.164 input we don't need a default country hint
    const parsed = _parsePhoneNumber(e164, metadata as never);
    return parsed ? parsed.formatInternational() : e164;
  } catch {
    return e164;
  }
}

/** Best-effort: detect which curated country an E.164 belongs to (for re-render). */
export function detectCountry(e164: string | null | undefined): CountryCode {
  if (!e164) return DEFAULT_COUNTRY;
  try {
    const parsed = _parsePhoneNumber(e164, metadata as never);
    return (parsed?.country as CountryCode) ?? DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}

import { z } from "zod";

/**
 * Zod field for a phone number. Accepts a user-typed or already-E.164 string,
 * validates it against `country` (default TR), and transforms to E.164.
 * Compose with `.optional()` / `.nullable()` at the call site.
 */
export function phoneField(
  country: CountryCode = DEFAULT_COUNTRY,
  message = "Invalid phone number"
) {
  return z
    .string()
    .transform((v, ctx) => {
      const e164 = normalizePhone(v, country);
      if (!e164) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return e164;
    });
}
