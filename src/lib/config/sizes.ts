/**
 * Figurine size — single source of truth.
 *
 * A size is either one of the three catalogue preset KEYS ("kucuk"/"orta"/
 * "buyuk", which the public /create flow sells at fixed prices) or a real,
 * free-form measurement for a bespoke order ("17,5 cm", "15×10×22 cm"). The DB
 * column is plain text (migration 0036) exactly like `style` before it, so a
 * new size needs no migration.
 *
 * Nothing outside this file may hardcode a size label or a mm/cm figure.
 *
 * NOTE: no `import "server-only"` here — BullMQ workers reach pricing/config
 * modules through order-draft.ts and would crash-loop on it.
 */

/** Catalogue presets. `heightMm` is the ONE place the nominal heights live. */
export const SIZE_PRESETS = [
  { key: "kucuk", heightMm: 60, labelKey: "sizes.kucuk", labelTr: "Küçük" },
  { key: "orta", heightMm: 80, labelKey: "sizes.orta", labelTr: "Orta" },
  { key: "buyuk", heightMm: 120, labelKey: "sizes.buyuk", labelTr: "Büyük" },
] as const;

export const SIZE_PRESET_KEYS = ["kucuk", "orta", "buyuk"] as const;
export type SizePresetKey = (typeof SIZE_PRESET_KEYS)[number];

/** Quick-fill chips (cm) for the bespoke size field in the admin panels. */
export const SIZE_PRESETS_CM = [6, 8, 10, 12, 15, 18, 20, 25] as const;

/** Max stored/typed length of a free-form size. */
export const SIZE_TEXT_MAX = 40;

export function isSizePreset(v: unknown): v is SizePresetKey {
  return (
    typeof v === "string" && (SIZE_PRESET_KEYS as readonly string[]).includes(v)
  );
}

export function presetHeightMm(key: SizePresetKey): number {
  return SIZE_PRESETS.find((p) => p.key === key)!.heightMm;
}

/** 80 → "8 cm"; 175 → "17,5 cm" (tr-TR decimal comma, 1 decimal max). */
export function formatCm(mm: number): string {
  return `${formatCmValue(mm / 10)} cm`;
}

function formatCmValue(cm: number): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(cm);
}

/**
 * Normalizes what a human typed into the canonical stored form.
 * Runs on BOTH client (instant feedback) and server (never trust the client).
 *
 *   "18"        → "18 cm"        "17.5cm"  → "17,5 cm"
 *   "175 mm"    → "17,5 cm"      "15x10x22"→ "15×10×22 cm"
 *   "orta"      → "orta" (preset key kept as-is)
 */
export function normalizeSizeInput(
  raw: string
): { ok: true; value: string } | { ok: false; error: string } {
  const text = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return { ok: true, value: "" };
  if (text.length > SIZE_TEXT_MAX) {
    return {
      ok: false,
      error: `Ölçü en fazla ${SIZE_TEXT_MAX} karakter olabilir.`,
    };
  }
  const lower = text.toLocaleLowerCase("tr");
  if (isSizePreset(lower)) return { ok: true, value: lower };

  const numbers = text.match(/\d+(?:[.,]\d{1,2})?/g);
  if (!numbers || numbers.length === 0) {
    return {
      ok: false,
      error: "Ölçüyü cm cinsinden yazın (örn. 18 cm veya 15×10×22 cm).",
    };
  }
  if (numbers.length > 3) {
    return { ok: false, error: "En fazla üç ölçü girin (en×boy×yükseklik)." };
  }

  // "mm" without "cm" means the whole input is in millimetres.
  const inMm = lower.includes("mm") && !lower.includes("cm");
  const values: number[] = [];
  for (const n of numbers) {
    let v = parseFloat(n.replace(",", "."));
    if (!Number.isFinite(v)) {
      return { ok: false, error: "Ölçü sayısal olmalı (örn. 18 cm)." };
    }
    if (inMm) v = v / 10;
    v = Math.round(v * 10) / 10;
    if (v < 1 || v > 100) {
      return { ok: false, error: "Ölçü 1–100 cm aralığında olmalı." };
    }
    values.push(v);
  }

  return { ok: true, value: `${values.map(formatCmValue).join("×")} cm` };
}

type SizeDictionary = Record<string, unknown>;

/** Display string for surfaces that have the i18n dictionary. */
export function sizeDisplay(
  size: string | null | undefined,
  d: SizeDictionary,
  opts?: { short?: boolean }
): string {
  if (!size) return "";
  const preset = SIZE_PRESETS.find((p) => p.key === size);
  if (!preset) return size;
  const cm = `~${formatCm(preset.heightMm)}`;
  if (opts?.short) return cm;
  const label = (d[preset.labelKey] as string) || preset.labelTr;
  return `${label} (${cm})`;
}

/** Display string for Turkish-only surfaces without a dictionary in scope. */
export function sizeDisplayTr(
  size: string | null | undefined,
  opts?: { short?: boolean }
): string {
  if (!size) return "";
  const preset = SIZE_PRESETS.find((p) => p.key === size);
  if (!preset) return size;
  const cm = `~${formatCm(preset.heightMm)}`;
  return opts?.short ? cm : `${preset.labelTr} (${cm})`;
}
