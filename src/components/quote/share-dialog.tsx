"use client";

import { useState, type JSX } from "react";
import { Button } from "@/components/ui";
import type { PresentedQuote } from "@/lib/config/quote-types";
import { useDictionary } from "@/lib/i18n/locale-context";
import { QuoteApiError, setQuoteShare } from "@/lib/quote/client-api";
import { QuoteModal } from "./modal-shell";

/**
 * Paylaşım bağlantısı diyaloğu.
 *
 * Üç eylem üç ayrı soruya cevap verir ve bu yüzden ayrı ayrı durur:
 *  - **oluştur**: henüz bağlantı yok,
 *  - **yenile**: bağlantı yanlış kişiye gitti, eskisi ÖLSÜN ama paylaşım sürsün,
 *  - **kapat**: kimse görmesin.
 *
 * Bağlantı `quote.shareUrl` olarak YALNIZ sahibin gövdesinde bulunur
 * (`presentQuote`); burada token'dan adres kurulmaz.
 */
export function QuoteShareDialog({
  open,
  quote,
  onClose,
  onQuoteChanged,
}: {
  open: boolean;
  quote: PresentedQuote;
  onClose: () => void;
  onQuoteChanged: (quote: PresentedQuote) => void;
}): JSX.Element | null {
  const d = useDictionary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = quote.shareUrl ?? null;

  const run = (action: "create" | "rotate" | "revoke") => {
    setBusy(true);
    setError(null);
    setCopied(false);
    void (async () => {
      try {
        onQuoteChanged(await setQuoteShare(quote.id, action));
      } catch (e) {
        setError(e instanceof QuoteApiError ? e.message : d["common.error"]);
      } finally {
        setBusy(false);
      }
    })();
  };

  const copy = () => {
    if (!shareUrl) return;
    void (async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
      } catch {
        // Pano izni yoksa bağlantı zaten seçilebilir bir kutuda duruyor;
        // müşteri elle kopyalayabilir, ekrana hata yazmaya gerek yok.
      }
    })();
  };

  return (
    <QuoteModal
      open={open}
      onClose={onClose}
      title={d["instantQuote.share.title"]}
      widthClass="max-w-lg"
    >
      <div className="space-y-4 p-5">
        <p className="text-sm text-text-secondary">{d["instantQuote.share.description"]}</p>

        {shareUrl ? (
          <>
            <input
              readOnly
              value={shareUrl}
              aria-label={d["instantQuote.share.title"]}
              onFocus={(e) => e.currentTarget.select()}
              className="input-base font-mono !text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={copy}>
                {copied ? d["instantQuote.share.copied"] : d["instantQuote.share.copy"]}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => run("rotate")}
              >
                {d["instantQuote.share.rotate"]}
              </Button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run("revoke")}
                className="rounded-lg px-3 py-2 text-xs text-text-muted hover:text-error disabled:opacity-50"
              >
                {d["instantQuote.share.revoke"]}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted">{d["instantQuote.share.none"]}</p>
            <Button type="button" size="sm" disabled={busy} onClick={() => run("create")}>
              {d["instantQuote.share.create"]}
            </Button>
          </>
        )}

        {error && <p className="text-xs text-error">{error}</p>}
      </div>
    </QuoteModal>
  );
}
