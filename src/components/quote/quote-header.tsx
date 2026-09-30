"use client";

import Link from "next/link";
import { useState, type JSX, type ReactNode } from "react";
import type { DisplayCurrency, PresentedQuote } from "@/lib/config/quote-types";
import { formatDateLong } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { QuotePatch } from "@/lib/quote/client-api";
import { displayRate } from "./format";
import { useSyncedField } from "./synced-field";

/**
 * Çalışma alanının başlığı: teklif numarası, proje adı, durum ve tarihler.
 *
 * Numara MONOSPACE yazılır ve seçilebilir durur: müşteri bunu e-postaya,
 * telefona ve satın alma emrine kopyalar; teklifin kimliği odur.
 *
 * `actions` yuvası 3.2b'nindir (paylaşım diyaloğu, teklif sohbeti); başlık
 * onların içeriğini bilmez, yalnız yerini ayırır.
 */
export function QuoteHeader({
  quote,
  onPatch,
  actions,
  shareToken,
  currency = "TRY",
}: {
  quote: PresentedQuote;
  onPatch: (patch: QuotePatch) => void;
  actions?: ReactNode;
  /** Paylaşım izleyicisinin belge bağlantısı da token'ı taşımak zorunda. */
  shareToken?: string | null;
  /**
   * Seçili gösterim birimi — belge bağlantısına `?kur=` olarak girer.
   *
   * Belge AYRI bir sunucu render'ıdır ve tarayıcıdaki tercihi okuyamaz: seçim
   * adreste taşınmazsa müşteri çalışma alanında € okuyup kâğıtta yalnız ₺
   * görürdü. Ödeme ekranı bu köprüye ihtiyaç duymaz, çünkü aynı tercih
   * deposunu okuyan bir istemci bileşenidir.
   */
  currency?: DisplayCurrency;
}): JSX.Element {
  const d = useDictionary();
  const [editing, setEditing] = useState(false);
  // Kontrollü alan: teklif başka bir sekmede yeniden adlandırılırsa yeni ad
  // buraya da gelir, ama müşteri yazarken üzerine yazılmaz.
  const title = useSyncedField(quote.title ?? "");
  const canEdit = quote.viewer.canEdit;
  const showDocument =
    quote.viewer.isOwner || (quote.viewer.isShare && quote.viewer.canSeePrices);
  // Ölü bir `?kur=` yazılmaz: seçim ancak teklifin donmuş kuru onu
  // karşılıyorsa adrese girer.
  const documentQuery = [
    shareToken ? `t=${encodeURIComponent(shareToken)}` : null,
    displayRate(quote.display?.snapshot, currency) ? `kur=${currency}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <header className="border-b border-border-default bg-bg-base">
      <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-4 px-4 py-5 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-sm text-text-secondary">{quote.number}</span>
            <span className="rounded-full bg-bg-muted px-2.5 py-0.5 text-[11px] font-medium text-text-secondary">
              {d[`instantQuote.status.${quote.status}` as const]}
            </span>
          </div>

          {editing ? (
            <input
              autoFocus
              value={title.value}
              aria-label={d["instantQuote.workspace.titlePlaceholder"]}
              placeholder={d["instantQuote.workspace.titlePlaceholder"]}
              className="input-base mt-1 max-w-md !py-2 text-lg"
              onChange={(e) => title.edit(e.target.value)}
              onBlur={() => {
                const value = title.value.trim();
                setEditing(false);
                title.commit(value);
                if (value !== (quote.title ?? "")) onPatch({ title: value || null });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  title.discard();
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => setEditing(true)}
              className="mt-0.5 block max-w-full truncate text-left text-2xl font-semibold tracking-tight text-text-primary underline-offset-4 hover:underline disabled:no-underline"
            >
              {quote.title ?? d["instantQuote.workspace.titlePlaceholder"]}
            </button>
          )}

          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
            <div className="flex gap-1.5">
              <dt>{d["instantQuote.workspace.createdAt"]}</dt>
              <dd className="text-text-secondary">{formatDateLong(quote.createdAt, "tr")}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>{d["instantQuote.workspace.expiresAt"]}</dt>
              <dd className={quote.expired ? "text-error" : "text-text-secondary"}>
                {formatDateLong(quote.expiresAt, "tr")}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {showDocument && (
            <Link
              href={`/teklif/${quote.number}/belge${
                documentQuery.length > 0 ? `?${documentQuery.join("&")}` : ""
              }`}
              className="btn-secondary !px-4 !py-2 text-xs"
            >
              {d["instantQuote.workspace.document"]}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
