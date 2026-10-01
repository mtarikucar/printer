"use client";

import { useEffect, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { canAttachQuote, canDetachQuote, type TeamRole } from "@/lib/config/quote-team";
import type { PresentedQuote } from "@/lib/config/quote-types";
import { fill } from "@/components/quote/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import { QuoteApiError, setQuoteTeam } from "@/lib/quote/client-api";
import { useQuoteTeamsEnabled } from "@/lib/quote/instant-quote-flag";

/**
 * Çalışma alanındaki "Takım teklifi · <ad>" rozeti + bağla/ayır (0072).
 *
 * ─── TAKIMSIZ TEKLİFTE HİÇ ÇİZİLMEZ ───────────────────────────────────────
 *
 * Birincil kısıt: takımı olmayan müşteri için bugünkü ekran BİT BİT aynı
 * kalır. İki hâl var ve ikisinin de kaynağı ayrı:
 *
 *   · Teklif BAĞLI (`quote.team` dolu, sunucudan gelir) → rozet + "ayır".
 *   · Teklif KİŞİSEL ama izleyicinin KENDİ takımı var → yalnız "bağla".
 *     "Kendi takımı" teklif gövdesinde YOKTUR ve olmamalı: teklifin takımı ile
 *     izleyicinin takımı iki ayrı gerçek, ve `PresentedQuote`a izleyicinin
 *     hesabına dair bir alan eklemek sunumu hesap sorgusuyla bağlardı. Bu
 *     yüzden yalnız o hâlde (`viewer.isOwner` + bayrak AÇIK) hesap ucu bir kez
 *     sorulur. Bayrak kapalıyken İSTEK ATILMAZ — kapalı özelliğin bedeli sıfır.
 *
 *   · Hiçbiri yoksa `null` döner: tek `<div>` bile basılmaz.
 *
 * ─── KAPILAR UCUN AYNI YÜKLEMİNİ OKUR ─────────────────────────────────────
 *
 * `canAttachQuote` / `canDetachQuote` (`src/lib/config/quote-team.ts`):
 * `member` YALNIZ kendi açtığı teklifi bağlar/ayırır, `viewer` hiçbirini.
 * Düğmeyi gizlemek bir güvenlik kararı DEĞİL — uç aynı yüklemi kendi tarafında
 * da uyguluyor (403) ve "kendi işi" kuralını SATIRDAN okuyor; gizlemenin
 * sebebi ölü düğme bırakmamaktır.
 *
 * ─── BAĞLAMA ONAY İSTER, AYIRMA İSTEMEZ ───────────────────────────────────
 *
 * `attachWarning` tek cümleyle ne olduğunu söyler: dosya ve fiyat artık
 * takımın bütün üyelerine görünür. Bu bir KVKK kararıdır (tasarım §8, KVKK 3)
 * ve sessizce yapılmaz. Görünürlüğü DARALTAN bir eylemin (ayırma) onayı ise
 * aynı şey değil.
 */

/**
 * Yüklemlere giden kimlik: "teklifi AÇAN kişi = eylemi yapan kişi".
 *
 * `canAttachQuote(role, quoteUserId, actorUserId)` için kimliğin DEĞERİ değil
 * EŞİTLİĞİ karar veriyor (`member` yalnız kendi açtığını taşır). Ekranda bu
 * eşitliğin cevabı `viewer.isOwner`dır — "kişisel sahip", yani teklifi açan
 * kişi. Gerçek uuid'yi ekrana taşımak, kararı değiştirmeyen bir kimlik alanı
 * eklemek olurdu; kararın KENDİSİ zaten uçta, satır okunarak veriliyor.
 */
const SELF = "self";

export function QuoteTeamBadge({
  quote,
  onQuoteChanged,
}: {
  quote: PresentedQuote;
  /** Taze gövde: yazma `PresentedQuote.team`i doldurur ya da boşaltır. */
  onQuoteChanged: (fresh: PresentedQuote) => void;
}): JSX.Element | null {
  const d = useDictionary();
  const router = useRouter();
  const teamsEnabled = useQuoteTeamsEnabled();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** İzleyicinin KENDİ takımındaki rolü; yalnız bağlama hâlinde sorulur. */
  const [ownRole, setOwnRole] = useState<TeamRole | null>(null);

  const team = quote.team ?? null;
  const askOwnTeam = teamsEnabled === true && team === null && quote.viewer.isOwner;

  useEffect(() => {
    if (!askOwnTeam) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/customer/team", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { role?: TeamRole | null };
        if (!cancelled && body.role) setOwnRole(body.role);
      } catch {
        // Takımı okumak bu ekranın İŞİ DEĞİL: cevapsız kalırsa yalnız "bağla"
        // düğmesi çizilmez, teklif aynen çalışır.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [askOwnTeam]);

  const canAttach = team === null && ownRole !== null && canAttachQuote(ownRole, SELF, SELF);
  const canDetach =
    team !== null && canDetachQuote(team.role, quote.viewer.isOwner ? SELF : null, SELF);

  // BAĞLI OLMAYAN teklifte rozetin tek işi "bağla" düğmesidir: yetkisi olmayan
  // bir rol (`viewer`) için kutu DA çizilmez. Aksi hâlde salt okunur bir üye,
  // kişisel teklifinin üstünde hiçbir şey yapamayacağı bir uyarı okurdu.
  if (team === null && !canAttach) return null;

  const run = (action: "attach" | "detach") => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await setQuoteTeam(quote.number, action);
        // `quote: null` = ayıran kişi teklifi kendisi AÇMAMIŞTI ve ayırma onun
        // erişimini de kapattı (gören göz yalnız üyelikti). Eski gövdeyi
        // ekranda tutmak, artık görülemeyen bir teklifi göstermek olurdu.
        if (result.quote === null) router.push("/account/takim");
        else onQuoteChanged(result.quote);
      } catch (e) {
        setError(e instanceof QuoteApiError ? e.message : d["common.error"]);
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="rounded-xl border border-border-default bg-bg-muted px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-text-secondary">
          {team !== null
            ? fill(d["instantQuote.team.quote.badge"], { team: team.name })
            : d["instantQuote.team.quote.attachWarning"]}
        </p>
        {canAttach && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(d["instantQuote.team.quote.attachWarning"])) return;
              run("attach");
            }}
            className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs disabled:opacity-50"
          >
            {d["instantQuote.team.quote.attach"]}
          </button>
        )}
        {canDetach && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run("detach")}
            className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs disabled:opacity-50"
          >
            {d["instantQuote.team.quote.detach"]}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
