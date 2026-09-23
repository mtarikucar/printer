"use client";

import type { JSX } from "react";
import type { DfmIssue, PresentedCatalog } from "@/lib/config/quote-types";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import { fill } from "./format";

/**
 * Üretilebilirlik (DfM) uyarıları.
 *
 * Çekirdek (`quote-dfm.ts`) yalnız KOD + PARAMETRE üretir; cümle sözlükte,
 * cümlenin kurulumu burada. Tek yerde olmasının sebebi ekranın üç ayrı
 * noktada (parça kartı, özellik paneli, özet) aynı uyarıyı farklı kelimelerle
 * anlatmaya başlamasını engellemek.
 *
 * Şiddet RENGE değil ÇÖZÜME çevrilir: "hata" müşterinin bir şey değiştirmesi
 * gereken hâl, "uyarı" ise onaylayıp devam edebileceği hâldir — bu yüzden
 * onay kutusu yalnız uyarılar için çıkar.
 */

/** Sayısal parametreler Türkçe ayraçla yazılır (0.8 → "0,8"). */
function localize(params: DfmIssue["params"]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    out[key] =
      typeof value === "number"
        ? value.toLocaleString("tr-TR", { maximumFractionDigits: 2 })
        : value;
  }
  return out;
}

function technologyName(catalog: PresentedCatalog | undefined, key: unknown): string {
  if (typeof key !== "string") return "";
  return catalog?.technologies.find((t) => t.key === key)?.name ?? key;
}

/**
 * Bir uyarının müşteriye görünen cümlesi. `too_large` iki ek cümle taşıyabilir
 * (sığan teknoloji / önerilen ölçek); ikisi de PARAMETRE VARSA eklenir.
 */
export function dfmMessage(
  d: Dictionary,
  issue: DfmIssue,
  catalog?: PresentedCatalog
): string {
  const params = localize(issue.params);

  if (issue.code === "qty_over_auto" && issue.params?.reason === "total") {
    const template = d["instantQuote.dfm.qty_over_auto.total"];
    const max = issue.params?.maxTotalKurus;
    // Fiyat kapısı kapalı izleyicide `maxTotalKurus` gövdeye HİÇ girmez
    // (`presentQuote` kuruş taşıyan parametreleri ayıklar); o hâlde tutarı
    // anmayan cümle yazılır — yer tutucunun kendisi ekranda durmaz.
    return typeof max === "number"
      ? fill(template, { maxTotal: formatCurrency(max, "tr") })
      : template.replace(/\s*\(\{maxTotal\}\)/, "");
  }

  const base = fill(d[`instantQuote.dfm.${issue.code}` as keyof Dictionary], params);
  if (issue.code !== "too_large") return base;

  const extra: string[] = [];
  if (issue.params?.fitsTechnology !== undefined) {
    extra.push(
      fill(d["instantQuote.dfm.too_large.fitsTechnology"], {
        technology: technologyName(catalog, issue.params.fitsTechnology),
      })
    );
  }
  if (issue.params?.fitScale !== undefined) {
    // Parametrenin adı `fitScale`, cümledeki yer tutucu `{scale}`: eşlemeyi
    // yapmazsak müşteri "Ölçeği {scale} yaparsanız sığar." okur.
    extra.push(fill(d["instantQuote.dfm.too_large.fitScale"], { scale: params.fitScale }));
  }
  return [base, ...extra].join(" ");
}

const TONE: Record<DfmIssue["severity"], string> = {
  error: "border-error/40 bg-error-50 text-error-700",
  warning: "border-warning-500/40 bg-warning-50 text-ink-2",
  info: "border-border-default bg-bg-muted text-text-secondary",
};

export interface QuoteDfmListProps {
  issues: DfmIssue[];
  catalog?: PresentedCatalog;
  /** Onay gerektiren uyarıların anahtarı; null ise onay kutusu çıkmaz. */
  warningKey?: string | null;
  acknowledged?: boolean;
  onAcknowledge?: (next: boolean) => void;
  /** Konfig hatasında müşteriyi doğrudan panele götüren eylem. */
  onEditConfig?: () => void;
  disabled?: boolean;
}

export function QuoteDfmList({
  issues,
  catalog,
  warningKey = null,
  acknowledged = false,
  onAcknowledge,
  onEditConfig,
  disabled,
}: QuoteDfmListProps): JSX.Element | null {
  const d = useDictionary();
  if (issues.length === 0) return null;

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {issues.map((issue, i) => (
          <li
            key={`${issue.code}-${i}`}
            className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${TONE[issue.severity]}`}
          >
            {dfmMessage(d, issue, catalog)}
            {issue.code === "config_invalid" && onEditConfig && (
              <button
                type="button"
                onClick={onEditConfig}
                className="ml-2 font-medium underline underline-offset-2"
              >
                {d["instantQuote.part.config.edit"]}
              </button>
            )}
          </li>
        ))}
      </ul>

      {warningKey && onAcknowledge && (
        <label className="flex items-start gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            checked={acknowledged}
            disabled={disabled}
            onChange={(e) => onAcknowledge(e.target.checked)}
          />
          <span>
            <span className="font-medium text-text-primary">
              {d["instantQuote.dfm.ack"]}
            </span>{" "}
            {d["instantQuote.dfm.ackHint"]}
          </span>
        </label>
      )}
    </div>
  );
}
