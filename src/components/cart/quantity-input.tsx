"use client";

import { useEffect, useState } from "react";

/**
 * Quantity control that can actually express a bulk order.
 *
 * The steppers alone forced 200 clicks to reach 200 units, so the number is a
 * real text field. It is a free-text field on purpose: typing "25" passes
 * through "2" and "5", and clamping on every keystroke would rewrite "2" to the
 * minimum and make the field impossible to use. So we keep the raw string
 * locally and only commit a clamped, valid number on blur/Enter — the parent
 * never sees an out-of-range value.
 */
export function QuantityInput({
  value,
  max,
  min = 1,
  onChange,
  disabled,
  size = "md",
}: {
  value: number;
  max: number;
  min?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const [draft, setDraft] = useState(String(value));

  // Re-sync when the server clamps or another control changes the quantity.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Math.round(Number(raw));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const step = (delta: number) => {
    const next = Math.max(min, Math.min(max, value + delta));
    if (next !== value) onChange(next);
  };

  const btn =
    size === "sm"
      ? "h-7 w-7 text-sm"
      : "h-9 w-9 text-base";
  const field = size === "sm" ? "h-7 w-14 text-sm" : "h-9 w-16 text-base";

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Adet azalt"
        disabled={disabled || value <= min}
        onClick={() => step(-1)}
        className={`${btn} flex items-center justify-center rounded-full border border-border-default text-text-secondary transition-colors hover:bg-bg-elevated disabled:opacity-40`}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Adet"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        className={`${field} rounded-lg border border-border-default bg-bg-base text-center tabular-nums text-text-primary`}
      />
      <button
        type="button"
        aria-label="Adet artır"
        disabled={disabled || value >= max}
        onClick={() => step(1)}
        className={`${btn} flex items-center justify-center rounded-full border border-border-default text-text-secondary transition-colors hover:bg-bg-elevated disabled:opacity-40`}
      >
        +
      </button>
    </div>
  );
}
