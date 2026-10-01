"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type JSX, type ReactNode } from "react";
import { canEditTeamQuote } from "@/lib/config/quote-team";
import type { PresentedQuote } from "@/lib/config/quote-types";
import { useDictionary } from "@/lib/i18n/locale-context";
import {
  QuoteApiError,
  repriceQuote,
  requoteQuote,
  splitQuoteByTechnology,
} from "@/lib/quote/client-api";

/**
 * Teklifin ÜSTÜNDEKİ durum bantları.
 *
 * Bir bant iki şeyi birden söyler: teklifin neden olduğu gibi davrandığını ve
 * müşterinin bu durumdan nasıl çıkacağını. Çıkışı olmayan bir uyarı (yalnız
 * cümle, eylemsiz) müşteriyi destek hattına yollar.
 *
 * **Tek DURUM bandı çizilir.** Süresi dolmuş ve aynı zamanda siparişe dönmüş
 * bir teklif ikisini birden basarsa hangisinin geçerli olduğu belirsizleşir;
 * sıralama `quotePermissions` ile AYNIDIR (sipariş → ödeme kilidi → süre
 * dolumu → inceleme / katalog). Teknoloji ayırma önerisi bundan bağımsızdır:
 * bir durum değil, bir fırsattır.
 */

type Tone = "info" | "warning" | "accent";

const TONE: Record<Tone, string> = {
  info: "border-border-default bg-bg-muted text-text-secondary",
  warning: "border-warning-500/40 bg-warning-50 text-ink-2",
  accent: "border-border-default bg-accent-soft text-text-primary",
};

function Banner({
  tone,
  message,
  action,
}: {
  tone: Tone;
  message: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${TONE[tone]}`}
    >
      <p className="min-w-0">{message}</p>
      {action}
    </div>
  );
}

/**
 * Bölme sonucu: yeni teklif numaraları TIKLANABİLİR olmalı — müşteri az önce
 * iki teklifi birden açtı ve ikincisini adres çubuğuna elle yazmamalı. Cümle
 * sözlükte `{numbers}` yer tutucusuyla durduğu için metin yer tutucudan ikiye
 * bölünür; başka bir dilde numaralar cümlenin ortasında da kalabilir.
 */
function SplitResultLine({ numbers }: { numbers: string[] }): JSX.Element {
  const d = useDictionary();
  const [before, after = ""] = d["instantQuote.workspace.split.done"].split("{numbers}");
  return (
    <p className="rounded-xl border border-border-default bg-bg-muted px-4 py-3 text-sm text-text-secondary">
      {before}
      {numbers.map((number, i) => (
        <span key={number}>
          {i > 0 && ", "}
          <Link
            href={`/teklif/${encodeURIComponent(number)}`}
            className="font-mono font-medium text-text-primary underline underline-offset-2"
          >
            {number}
          </Link>
        </span>
      ))}
      {after}
    </p>
  );
}

export function QuoteBanners({
  quote,
  shareToken,
  onQuoteChanged,
}: {
  quote: PresentedQuote;
  shareToken: string | null;
  onQuoteChanged: (quote: PresentedQuote) => void;
}): JSX.Element | null {
  const d = useDictionary();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitNumbers, setSplitNumbers] = useState<string[]>([]);

  const run = (fn: () => Promise<PresentedQuote>) => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        onQuoteChanged(await fn());
      } catch (e) {
        setError(e instanceof QuoteApiError ? e.message : d["common.error"]);
      } finally {
        setBusy(false);
      }
    })();
  };

  const actionButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs disabled:opacity-50"
    >
      {label}
    </button>
  );

  const actionLink = (label: string, href: string) => (
    <Link href={href} className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs">
      {label}
    </Link>
  );

  const reprice = () =>
    actionButton(d["instantQuote.workspace.reprice"], () =>
      run(() => repriceQuote(quote.id, { shareToken }))
    );

  /**
   * "Yeniden teklif al": AYNI parçalarla YENİ bir teklif açar; kaynak teklife
   * dokunulmaz. `reprice`ten farkı budur — siparişe dönmüş bir teklif yeniden
   * fiyatlanamaz (uç 409 verir), süresi dolanda ise müşteri eski teklifi
   * olduğu gibi (ör. karşı tarafa gönderdiği hâliyle) saklamak isteyebilir.
   * Uç yalnız SAHİBE açıktır (admin 403, paylaşım izleyicisi 404).
   */
  const requote = () =>
    actionButton(d["instantQuote.workspace.requote"], () => {
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const { number } = await requoteQuote(quote.id, { shareToken });
          // Yeni teklife GİDİLİR: müşteri numarayı adres çubuğuna yazmamalı.
          // `busy` bilerek açık bırakılır — gezinme sırasında düğme kapalı kalır.
          router.push(`/teklif/${encodeURIComponent(number)}`);
        } catch (e) {
          setError(e instanceof QuoteApiError ? e.message : d["common.error"]);
          setBusy(false);
        }
      })();
    });

  /** Bir bantta birden fazla eylem: tek düğme gibi hizalanır. */
  const actionRow = (...nodes: Array<JSX.Element | null>) => {
    const kept = nodes.filter((n): n is JSX.Element => n !== null);
    if (kept.length === 0) return undefined;
    return <div className="flex shrink-0 flex-wrap items-center gap-2">{kept}</div>;
  };

  const banners: JSX.Element[] = [];

  // ── Durum bandı (en fazla bir tane) ──────────────────────────────────────
  if (quote.status === "ordered") {
    banners.push(
      <Banner
        key="ordered"
        tone="accent"
        message={d["instantQuote.workspace.banner.ordered"]}
        // `orderNumber` yalnız `canSeeOwnerFields` geçen izleyicinin
        // gövdesinde vardır; paylaşım izleyicisi takip sayfasına (oturumsuz
        // açılır) götürülmez.
        //
        // "Yeniden teklif al" bir DÜZENLEMEDİR (`canEditTeamQuote`, uçla aynı
        // yüklem): takımda düzenleyebilen üç rol görür, salt okunur `viewer`
        // rolü görmez — servis onu 403 ile reddediyor.
        action={actionRow(
          quote.orderNumber
            ? actionLink(
                d["instantQuote.workspace.banner.orderedAction"],
                `/track/${encodeURIComponent(quote.orderNumber)}`
              )
            : null,
          canEditTeamQuote(quote.viewer) ? requote() : null
        )}
      />
    );
  } else if (quote.locked && quote.liveDraftReference) {
    banners.push(
      <Banner
        key="locked"
        tone="warning"
        message={d["instantQuote.workspace.banner.locked"]}
        action={actionLink(
          d["instantQuote.workspace.banner.lockedAction"],
          `/pay/${encodeURIComponent(quote.liveDraftReference)}`
        )}
      />
    );
  } else if (quote.expired) {
    banners.push(
      <Banner
        key="expired"
        tone="warning"
        message={d["instantQuote.workspace.banner.expired"]}
        action={actionRow(
          quote.viewer.canEdit ? reprice() : null,
          canEditTeamQuote(quote.viewer) ? requote() : null
        )}
      />
    );
  } else {
    if (quote.status === "needs_review") {
      banners.push(
        <Banner key="review" tone="info" message={d["instantQuote.workspace.banner.review"]} />
      );
    }
    if (quote.catalogChangedSinceSnapshot) {
      banners.push(
        <Banner
          key="catalog"
          tone="info"
          message={d["instantQuote.workspace.banner.catalogChanged"]}
          action={quote.viewer.canEdit ? reprice() : undefined}
        />
      );
    }
  }

  // ── Teknoloji ayırma (durumdan bağımsız öneri) ───────────────────────────
  const technologies = new Set(quote.parts.map((p) => p.config.technologyKey));
  if (technologies.size > 1 && quote.viewer.canEdit && !quote.locked) {
    banners.push(
      <Banner
        key="split"
        tone="info"
        message={d["instantQuote.workspace.banner.mixedTechnologies"]}
        action={actionButton(d["instantQuote.summary.splitByTechnology"], () =>
          run(async () => {
            const result = await splitQuoteByTechnology(quote.id, { shareToken });
            setSplitNumbers(result.newQuoteNumbers);
            return result.quote;
          })
        )}
      />
    );
  }

  if (banners.length === 0 && !error && splitNumbers.length === 0) return null;

  return (
    <div className="space-y-2">
      {banners}
      {splitNumbers.length > 0 && <SplitResultLine numbers={splitNumbers} />}
      {error && (
        <p className="rounded-xl border border-error/40 bg-error-50 px-4 py-3 text-sm text-error-700">
          {error}
        </p>
      )}
    </div>
  );
}
