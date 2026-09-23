"use client";

import type { JSX } from "react";
import type { AddonPriceType, PresentedCatalog } from "@/lib/config/quote-types";
import { formatCurrency } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useDictionary } from "@/lib/i18n/locale-context";
import { fill } from "./format";

type Addon = PresentedCatalog["addons"][number];

/**
 * Bir ek hizmetin katalog ücretinin HANGİ BİRİME işlediği.
 *
 * `per_unit` bir hizmetin yanına çıplak "₺50,00" yazmak yalan olurdu: on
 * adetlik bir teklifte o satır ₺500'dür. Ücretin yanında biriminin durması,
 * özetteki gerçek satır tutarıyla arasındaki farkı açıklar.
 */
export function addonPriceNote(d: Dictionary, priceType: AddonPriceType | undefined): string {
  if (priceType === "per_part") return d["instantQuote.addons.perPart"];
  if (priceType === "per_unit") return d["instantQuote.addons.perUnit"];
  return "";
}

/**
 * Ek hizmet seçici. Seçim teklif düzeyindedir (parça başına değil); sunucu
 * `addonKeys` dizisinin tamamını alır, bu yüzden her tıklama listenin YENİ
 * hâlini gönderir.
 */
export function AddonsPicker({
  addons,
  selected,
  disabled,
  onChange,
}: {
  addons: Addon[];
  selected: string[];
  disabled?: boolean;
  onChange: (keys: string[]) => void;
}): JSX.Element | null {
  const d = useDictionary();
  if (addons.length === 0) return null;

  const toggle = (key: string) =>
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-text-primary">
        {d["instantQuote.addons.title"]}
      </legend>

      <ul className="space-y-1.5">
        {addons.map((addon) => {
          const note = addonPriceNote(d, addon.priceType);
          return (
            <li key={addon.key}>
              <label
                className={`flex items-start gap-2.5 rounded-lg px-1 py-1 ${
                  disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-bg-muted"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  checked={selected.includes(addon.key)}
                  disabled={disabled}
                  onChange={() => toggle(addon.key)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-sm text-text-primary">{addon.name}</span>
                    {typeof addon.priceKurus === "number" && (
                      <span className="text-sm tabular-nums text-text-primary">
                        {formatCurrency(addon.priceKurus, "tr")}
                        {note && (
                          <span className="ml-1 text-[11px] font-normal text-text-muted">
                            {note}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  {(addon.description || addon.leadDaysExtra > 0) && (
                    <span className="mt-0.5 block text-xs text-text-muted">
                      {addon.description}
                      {addon.description && addon.leadDaysExtra > 0 && " · "}
                      {addon.leadDaysExtra > 0 &&
                        fill(d["instantQuote.addons.leadExtra"], { days: addon.leadDaysExtra })}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
