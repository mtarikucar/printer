"use client";

import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  detectCountry,
  normalizePhone,
  type CountryCode,
} from "@/lib/phone";

export interface PhoneInputProps {
  /** Selected country ISO (controlled). */
  country: CountryCode;
  /** Raw national-part text the user typed (controlled). */
  nationalNumber: string;
  onCountryChange: (c: CountryCode) => void;
  onNationalNumberChange: (v: string) => void;
  required?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
}

/**
 * Country-code dropdown (default 🇹🇷 +90) + national-number field. Purely
 * controlled: the parent owns `country` + `nationalNumber` and derives the
 * E.164 value via `phoneInputToE164` on submit.
 */
export function PhoneInput({
  country,
  nationalNumber,
  onCountryChange,
  onNationalNumberChange,
  required,
  id,
  className,
  placeholder,
}: PhoneInputProps) {
  const inputCls =
    className ??
    "w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent";
  return (
    <div className="flex gap-2">
      <select
        aria-label="Country code"
        value={country}
        onChange={(e) => onCountryChange(e.target.value as CountryCode)}
        className="px-2 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shrink-0"
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.iso}>
            {c.flag} {c.dialCode}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        required={required}
        value={nationalNumber}
        onChange={(e) => onNationalNumberChange(e.target.value)}
        placeholder={placeholder ?? "5XX XXX XX XX"}
        className={inputCls}
      />
    </div>
  );
}

/** Derive canonical E.164 from the controlled component state, or null if invalid. */
export function phoneInputToE164(
  country: CountryCode,
  nationalNumber: string
): string | null {
  return normalizePhone(nationalNumber, country);
}

/** Seed component state from an existing E.164 value (for edit forms). */
export function e164ToPhoneInput(e164: string | null | undefined): {
  country: CountryCode;
  nationalNumber: string;
} {
  if (!e164) return { country: DEFAULT_COUNTRY, nationalNumber: "" };
  // Strip the dial code so the national part shows in the text field.
  const c = detectCountry(e164);
  const dial = COUNTRIES.find((x) => x.iso === c)?.dialCode.replace("+", "");
  const national =
    dial && e164.startsWith(`+${dial}`)
      ? e164.slice(dial.length + 1)
      : e164.replace(/^\+/, "");
  return { country: c, nationalNumber: national };
}
