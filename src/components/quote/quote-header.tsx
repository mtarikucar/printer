"use client";

import Link from "next/link";
import { useState, type JSX, type ReactNode } from "react";
import type { PresentedQuote } from "@/lib/config/quote-types";
import { formatDateLong } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { QuotePatch } from "@/lib/quote/client-api";

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
}: {
  quote: PresentedQuote;
  onPatch: (patch: QuotePatch) => void;
  actions?: ReactNode;
  /** Paylaşım izleyicisinin belge bağlantısı da token'ı taşımak zorunda. */
  shareToken?: string | null;
}): JSX.Element {
  const d = useDictionary();
  const [editing, setEditing] = useState(false);
  const canEdit = quote.viewer.canEdit;
  const showDocument =
    quote.viewer.isOwner || (quote.viewer.isShare && quote.viewer.canSeePrices);

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
              defaultValue={quote.title ?? ""}
              aria-label={d["instantQuote.workspace.titlePlaceholder"]}
              placeholder={d["instantQuote.workspace.titlePlaceholder"]}
              className="input-base mt-1 max-w-md !py-2 text-lg"
              onBlur={(e) => {
                const value = e.target.value.trim();
                setEditing(false);
                if (value !== (quote.title ?? "")) onPatch({ title: value || null });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(false);
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
                shareToken ? `?t=${encodeURIComponent(shareToken)}` : ""
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
