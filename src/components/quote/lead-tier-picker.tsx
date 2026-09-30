"use client";

import type { JSX } from "react";
import type { FrozenFxRate, LeadOption, LeadTierKey } from "@/lib/config/quote-types";
import { formatDateLong } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import { fill, money } from "./format";

/**
 * Teslim kademesi seçici — "ne kadar beklersem ne kadar öderim".
 *
 * Kademeler gerçek `radio` girdileridir: klavyeyle ok tuşlarıyla gezilir,
 * ekran okuyucu grubu tek bir soru olarak okur. Süslü düğmelerle taklit
 * edilseydi ikisi de kaybolurdu.
 *
 * **Kargoya teslim tarihi yalnız SEÇİLİ kademede yazılır.** Diğer kademelerin
 * tarihini sunucu hesaplamadı (`shipByDate` teklif düzeyinde tek bir alandır)
 * ve istemci iş günü sayamaz: tatil takvimi, cutoff saati ve İstanbul takvimi
 * sunucudadır. Tahmini bir tarih basmak, müşteriye tutmayacağımız bir söz
 * vermek olurdu.
 */
export function LeadTierPicker({
  options,
  value,
  shipByDate,
  disabled,
  onChange,
  rate = null,
}: {
  options: LeadOption[];
  value: LeadTierKey;
  /** Seçili gösterim biriminin DONMUŞ kuru; `null` = bağlayıcı ₺. */
  rate?: FrozenFxRate | null;
  /** Seçili kademe için kargoya teslim tarihi (ISO); yoksa null. */
  shipByDate: string | null;
  disabled?: boolean;
  onChange: (key: LeadTierKey) => void;
}): JSX.Element | null {
  const d = useDictionary();
  if (options.length === 0) return null;

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-text-primary">
        {d["instantQuote.lead.title"]}
      </legend>

      <div className="divide-y divide-border-default overflow-hidden rounded-xl border border-border-default">
        {options.map((option) => {
          const active = option.key === value;
          return (
            <label
              key={option.key}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors ${
                active ? "bg-accent-soft" : "hover:bg-bg-muted"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="quote-lead-tier"
                className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                checked={active}
                disabled={disabled}
                onChange={() => onChange(option.key)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {option.name}
                </span>
                <span className="block text-xs text-text-muted">
                  {option.leadDays === null
                    ? d["instantQuote.lead.unavailable"]
                    : fill(d["instantQuote.lead.days"], { days: option.leadDays })}
                  {active && shipByDate && (
                    <>
                      {" · "}
                      {fill(d["instantQuote.lead.shipBy"], {
                        date: formatDateLong(shipByDate, "tr"),
                      })}
                    </>
                  )}
                </span>
              </span>
              {/* Fiyat kapısı kapalıyken sunucu `totalKurus` alanını hiç
                  göndermez; burada gösterilecek bir şey de yoktur. */}
              {typeof option.totalKurus === "number" && (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                  {money(option.totalKurus, rate)}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
