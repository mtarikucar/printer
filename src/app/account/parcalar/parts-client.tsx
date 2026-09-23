"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { decimal2, fill, mm } from "@/components/quote/format";
import type { CustomerQuoteListItem, LibraryPart } from "@/lib/config/quote-types";
import { formatDate } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import { QuoteApiError, createQuote, importQuoteParts } from "@/lib/quote/client-api";

/**
 * `/account/parcalar` — parça kütüphanesi.
 *
 * Aynı dosya (sha256) tek satırdır; uç bunu böyle döner. Buradaki tek eylem
 * seçili dosyaları BİR TEKLİFE taşımaktır: ya yeni bir teklif açılır ya da
 * müşterinin açık tekliflerinden biri seçilir. Dosyalar kopyalanır ve
 * ANALİZLERİ de kopyalanır (uç `parts/import` bunu yapar) — aynı dosya ikinci
 * kez incelenmez.
 */

/** Teklife parça eklenebilecek durumlar: sipariş olmuş ya da iptal olmuş teklife eklenmez. */
function isOpenQuote(quote: CustomerQuoteListItem): boolean {
  return !quote.expired && (quote.status === "draft" || quote.status === "quoted");
}

export function PartLibraryGrid({
  items,
  selected,
  onToggle,
}: {
  items: LibraryPart[];
  selected: string[];
  onToggle: (partId: string) => void;
}): JSX.Element {
  const d = useDictionary();

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((part) => {
        const checked = selected.includes(part.partId);
        return (
          <li
            key={part.partId}
            className={`rounded-2xl border bg-bg-elevated p-4 transition-colors ${
              checked ? "border-ink" : "border-border-default"
            }`}
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(part.partId)}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-ink)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-text-primary">
                  {part.name}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-text-muted">
                  {part.fileName}
                </span>
              </span>
            </label>

            <div className="mt-3 aspect-[4/3] overflow-hidden rounded-xl bg-bg-muted">
              {part.thumbnailUrl ? (
                // Ev deseni (`components/quote/part-card`): imzalı adres süreli
                // olduğu için `next/image` iyileştirici önbelleğine girmez.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={part.thumbnailUrl}
                  alt={part.name}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="flex h-full items-center justify-center font-mono text-xs uppercase text-text-muted">
                  {part.sourceFormat}
                </span>
              )}
            </div>

            <dl className="mt-3 space-y-1 text-xs text-text-secondary">
              {part.dimensionsMm ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Ölçü</dt>
                  <dd className="font-mono tabular-nums">
                    {fill(d["instantQuote.part.dimensions"], {
                      x: mm(part.dimensionsMm.x),
                      y: mm(part.dimensionsMm.y),
                      z: mm(part.dimensionsMm.z),
                    })}
                  </dd>
                </div>
              ) : null}
              {part.volumeCm3 !== null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Hacim</dt>
                  <dd className="font-mono tabular-nums">
                    {fill(d["instantQuote.part.volume"], { cm3: decimal2(part.volumeCm3) })}
                  </dd>
                </div>
              ) : null}
              {part.lastMaterialName ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">Son malzeme</dt>
                  <dd>{part.lastMaterialName}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-text-muted">Eklenme</dt>
                <dd className="font-mono tabular-nums">{formatDate(part.createdAt, "tr")}</dd>
              </div>
            </dl>

            <p className="mt-3 border-t border-bg-subtle pt-2 text-xs text-text-muted">
              {fill(d["instantQuote.account.parts.useCount"], { count: part.useCount })} ·{" "}
              <Link
                href={`/teklif/${encodeURIComponent(part.quoteNumber)}`}
                className="underline underline-offset-2"
              >
                {part.quoteNumber}
              </Link>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function AccountPartsClient(): JSX.Element {
  const d = useDictionary();
  const router = useRouter();
  const turnstileRef = useRef<TurnstileRef>(null);

  const [items, setItems] = useState<LibraryPart[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [selected, setSelected] = useState<string[]>([]);
  const [openQuotes, setOpenQuotes] = useState<CustomerQuoteListItem[]>([]);
  const [targetQuote, setTargetQuote] = useState("");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (next: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customer/parts?page=${next}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { items: LibraryPart[]; hasNext: boolean };
      setItems((prev) => (next === 1 ? body.items : [...prev, ...body.items]));
      setHasNext(body.hasNext);
      setPage(next);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  // Açık teklifler "var olan teklife ekle" seçeneği içindir; listesi
  // gelmezse o seçenek hiç gösterilmez, sayfa çalışmaya devam eder.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/customer/quotes?page=1", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { items: CustomerQuoteListItem[] };
        setOpenQuotes(body.items.filter(isOpenQuote));
      } catch {
        setOpenQuotes([]);
      }
    })();
  }, []);

  const toggle = useCallback((partId: string) => {
    setSelected((prev) =>
      prev.includes(partId) ? prev.filter((id) => id !== partId) : [...prev, partId]
    );
  }, []);

  async function run(fn: () => Promise<string>): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      router.push(`/teklif/${encodeURIComponent(await fn())}`);
    } catch (e) {
      setActionError(e instanceof QuoteApiError ? e.message : d["common.error"]);
      setBusy(false);
    }
  }

  const addToNewQuote = () =>
    run(async () => {
      const token = (await turnstileRef.current?.getToken()) ?? "";
      const quote = await createQuote({ termsAccepted: true, turnstileToken: token });
      await importQuoteParts(quote.id, selected);
      return quote.number;
    });

  const addToExistingQuote = () =>
    run(async () => {
      const { quote } = await importQuoteParts(targetQuote, selected);
      return quote.number;
    });

  if (loading && items.length === 0) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-64 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <p className="rounded-xl bg-error-50 p-3 text-sm text-error">
        {d["instantQuote.account.parts.loadFailed"]}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border-default bg-bg-elevated p-8 text-center">
        <p className="text-text-secondary">{d["instantQuote.account.parts.empty"]}</p>
        <Link href="/3d-baski" className="btn-primary mt-5 inline-flex !px-5 !py-2.5 text-sm">
          {d["instantQuote.account.parts.emptyAction"]}
        </Link>
      </div>
    );
  }

  return (
    <>
      <PartLibraryGrid items={items} selected={selected} onToggle={toggle} />

      {hasNext ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(page + 1)}
          className="btn-secondary mt-6 !px-5 !py-2.5 text-sm"
        >
          {loading ? d["common.loading"] : "Daha fazla dosya"}
        </button>
      ) : null}

      {/* Eylem çubuğu seçim yapılınca görünür: boş bir kütüphanede ya da hiç
          seçim yokken ekranı meşgul etmesinin bir anlamı yok. */}
      {selected.length > 0 ? (
        <div className="sticky bottom-4 z-30 mt-8 rounded-2xl border border-border-default bg-bg-elevated p-4 shadow-elevated">
          <p className="text-sm font-medium text-text-primary">
            {fill(d["instantQuote.bulk.selected"], { count: selected.length })}
          </p>

          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-text-secondary">
            <input
              type="checkbox"
              checked={terms}
              onChange={(e) => setTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]"
            />
            <span>{d["instantQuote.terms.accept"]}</span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !terms}
              onClick={() => void addToNewQuote()}
              className="btn-primary !px-5 !py-2.5 text-sm"
            >
              {d["instantQuote.account.parts.addToQuote"]}
            </button>

            {openQuotes.length > 0 ? (
              <>
                <div className="w-56">
                  <select
                    value={targetQuote}
                    onChange={(e) => setTargetQuote(e.target.value)}
                    className="input-base"
                    aria-label={d["instantQuote.account.parts.addToExisting"]}
                  >
                    <option value="">{d["instantQuote.account.parts.addToExisting"]}</option>
                    {openQuotes.map((quote) => (
                      <option key={quote.id} value={quote.id}>
                        {quote.number}
                        {quote.title ? ` — ${quote.title}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={busy || targetQuote === ""}
                  onClick={() => void addToExistingQuote()}
                  className="btn-secondary !px-5 !py-2.5 text-sm"
                >
                  {d["instantQuote.account.parts.addToExisting"]}
                </button>
              </>
            ) : null}
          </div>

          {actionError ? (
            <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-xs text-error">
              {actionError}
            </p>
          ) : null}

          <Turnstile ref={turnstileRef} />
        </div>
      ) : null}
    </>
  );
}
