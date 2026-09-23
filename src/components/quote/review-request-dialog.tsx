"use client";

import { useState, type JSX } from "react";
import { Button, Textarea } from "@/components/ui";
import type { PresentedQuote, ReviewKind } from "@/lib/config/quote-types";
import { formatCurrency } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import { QuoteApiError, requestQuoteReview, type ReviewRequest } from "@/lib/quote/client-api";
import { fill } from "./format";
import { QuoteModal } from "./modal-shell";

/**
 * İnceleme talebi diyaloğu — üç talebin de TEK yüzeyi.
 *
 * Manuel teklif, yüksek hacim (RFQ) ve hedef fiyat aynı uca (`POST …/review`)
 * aynı gövdeyle gider; ayrı üç diyalog yazmak aynı formu üç kez bakıma
 * mahkûm ederdi. Aralarındaki tek fark başlık, açıklama ve hedef fiyat
 * alanlarının varlığıdır.
 *
 * `generate_lead` olayı BURADA atılmaz: ölçüm sunucuda, ucun kendisinde
 * yapılır (tarayıcı yenilemesi huniyi şişirmesin — bkz. `test-quote-ui`).
 */

/** Sunucudaki alt sınırın aynısı (`parseReviewRequest`). */
const MIN_NOTE = 10;

/**
 * Müşterinin yazdığı tutarı kuruşa çevirir. `null` = kullanılabilir bir sayı yok.
 *
 * Türkçe klavyede tutar "1.250,00" diye yazılır, sayısal klavyede "1250.00"
 * diye. İkisi de kabul edilir. **Belirsiz yazım reddedilir**: "1.250" hem bin
 * iki yüz elli hem bir lira yirmi beş kuruş okunabilir, ve yanlış tahmin
 * müşterinin teklifine bin kat yanlış bir hedef yazardı.
 */
export function parseMoneyInput(text: string): number | null {
  const raw = text.trim();
  if (raw === "") return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const kurus = Math.round(Number(normalized) * 100);
  return kurus > 0 ? kurus : null;
}

export function QuoteReviewDialog({
  open,
  kind,
  quote,
  shareToken,
  onClose,
  onQuoteChanged,
}: {
  open: boolean;
  kind: ReviewKind;
  quote: PresentedQuote;
  shareToken: string | null;
  onClose: () => void;
  onQuoteChanged: (quote: PresentedQuote) => void;
}): JSX.Element | null {
  const d = useDictionary();
  const [note, setNote] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const title =
    kind === "rfq"
      ? d["instantQuote.workspace.rfq.title"]
      : kind === "target_price"
        ? d["instantQuote.workspace.target.title"]
        : d["instantQuote.workspace.review.title"];

  const hint =
    kind === "rfq"
      ? d["instantQuote.workspace.rfq.hint"]
      : kind === "target_price"
        ? d["instantQuote.workspace.target.hint"]
        : null;

  const parsedTargets = quote.parts.flatMap((part) => {
    const unitKurus = parseMoneyInput(targets[part.id] ?? "");
    return unitKurus === null ? [] : [{ partId: part.id, unitKurus }];
  });

  const noteReady = note.trim().length >= MIN_NOTE;
  const targetsReady = kind !== "target_price" || parsedTargets.length > 0;

  const submit = () => {
    if (!noteReady || !targetsReady) return;
    const body: ReviewRequest = {
      kind,
      note: note.trim(),
      ...(kind === "target_price" ? { targets: parsedTargets } : {}),
    };
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        onQuoteChanged(await requestQuoteReview(quote.id, body, { shareToken }));
        setSent(true);
      } catch (e) {
        setError(e instanceof QuoteApiError ? e.message : d["common.error"]);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <QuoteModal open={open} onClose={onClose} title={title} widthClass="max-w-xl">
      {sent ? (
        <div className="space-y-4 p-5">
          <p className="text-sm text-text-primary">{d["instantQuote.workspace.review.sent"]}</p>
          <Button type="button" size="sm" onClick={onClose}>
            {d["common.close"]}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 p-5">
          {hint && <p className="text-sm text-text-secondary">{hint}</p>}

          {kind === "target_price" && (
            <div className="overflow-hidden rounded-xl border border-border-default">
              <div className="flex items-center justify-between gap-3 border-b border-border-default bg-bg-muted px-3 py-2 text-xs font-medium text-text-secondary">
                <span>{d["instantQuote.document.column.part"]}</span>
                <span>{d["instantQuote.workspace.target.unit"]}</span>
              </div>
              <ul className="divide-y divide-border-default">
                {quote.parts.map((part) => (
                  <li key={part.id} className="flex items-center gap-3 px-3 py-2">
                    <label
                      htmlFor={`target-${part.id}`}
                      className="min-w-0 flex-1 truncate text-sm text-text-primary"
                    >
                      {part.name}
                      {/* Şu anki birim fiyat, hedefin neye göre konulduğunu
                          söyler; fiyat kapısı kapalıysa gövdede hiç yoktur. */}
                      {part.price && (
                        <span className="ml-2 text-xs text-text-muted">
                          {formatCurrency(part.price.unitKurus, "tr")}
                        </span>
                      )}
                    </label>
                    <input
                      id={`target-${part.id}`}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={targets[part.id] ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        setTargets((prev) => ({ ...prev, [part.id]: e.target.value }))
                      }
                      className="input-base !w-28 !py-1.5 text-right !text-sm tabular-nums"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-text-primary">
              {d["instantQuote.workspace.review.note"]}
            </span>
            <Textarea
              rows={4}
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {note.trim().length > 0 && !noteReady && (
            <p className="text-xs text-text-muted">
              {fill(d["instantQuote.workspace.review.noteTooShort"], { min: MIN_NOTE })}
            </p>
          )}

          {error && <p className="text-sm text-error">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !noteReady || !targetsReady}
              onClick={submit}
            >
              {busy
                ? d["instantQuote.checkout.submitting"]
                : d["instantQuote.workspace.review.submit"]}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              {d["common.cancel"]}
            </Button>
          </div>
        </div>
      )}
    </QuoteModal>
  );
}
