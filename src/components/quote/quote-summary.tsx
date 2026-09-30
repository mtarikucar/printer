"use client";

import Link from "next/link";
import { useSyncExternalStore, type JSX, type ReactNode } from "react";
import { Card, Textarea } from "@/components/ui";
import { KDV_RATE_BPS } from "@/lib/config/prices";
import { convertReceipt } from "@/lib/config/quote-currency";
import type {
  DisplayCurrency,
  PresentedQuote,
  QuoteTotals,
  ReviewKind,
} from "@/lib/config/quote-types";
import { formatMoneyMinor } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { QuotePatch } from "@/lib/quote/client-api";
import { AddonsPicker } from "./addons-picker";
import { DisplayCurrencyPicker } from "./display-currency";
import { displayRate, fill, money } from "./format";
import { LeadTierPicker } from "./lead-tier-picker";
import { useSyncedField } from "./synced-field";

/**
 * Teklif özeti — sağ sütunun yapışkan paneli.
 *
 * Panelin işi bir fişin işidir: müşteri "ne alıyorum, ne kadar tutuyor, neden
 * henüz ödeyemiyorum" sorularının üçünü de tek bakışta okumalı. Bu yüzden
 * engeller (blockers) gizlenmez — kapalı bir "Ödemeye geç" düğmesi sebebini
 * söylemeden durduğunda müşterinin yapabileceği tek şey destek hattını
 * aramaktır.
 *
 * **Hiçbir tutar burada hesaplanmaz.** Toplam da, KDV hariç tutar da, KDV de
 * `PresentedQuote.totals` içinde sunucudan gelir; fiyat kapısını geçmemiş
 * izleyicinin gövdesinde bu alan HİÇ YOKTUR (`presentQuote`), bu yüzden
 * ekranda gösterilecek bir rakam da yoktur.
 */

/** KDV tercihi tarayıcıda saklanır; teklifin kendisine yazılmaz. */
export const KDV_PREF_KEY = "figurunica.quote.kdvExcluded";

/**
 * Tercih bir DIŞ DEPODUR (localStorage), React durumu değil. `useState` +
 * `useEffect` ile kopyalansaydı sunucunun ürettiği işaretleme ile tarayıcınınki
 * ilk boyamada ayrışır, tutar bir an yanlış görünürdü. `useSyncExternalStore`
 * bunun için var: sunucu anlık görüntüsü "KDV dahil", tarayıcıdaki gerçek
 * değer ilk boyamadan itibaren geçerli.
 */
const prefListeners = new Set<() => void>();

function subscribeKdvPref(onChange: () => void): () => void {
  prefListeners.add(onChange);
  return () => {
    prefListeners.delete(onChange);
  };
}

/**
 * Hangi tutar gösterilecek. İki rakam da sunucudan gelir — burada bölme,
 * çarpma ya da oran YOKTUR: KDV oranı bir gün değişirse ekran yanlış rakam
 * basmakla kalmaz, sunucunun yazdığı tutardan da ayrışırdı.
 */
export function displayedTotalKurus(totals: QuoteTotals, kdvExcluded: boolean): number {
  return kdvExcluded ? totals.kdvExcludedKurus : totals.totalKurus;
}

/**
 * Tercihi okur. Gizli sekmede ve site verisi engellenmiş tarayıcıda
 * `localStorage` erişimi ATAR; bir gösterim kolaylığı yüzünden teklif ekranı
 * çökmemeli, bu yüzden her okuma/yazma kendi `try` bloğundadır.
 */
export function readKdvExcludedPref(storage: Storage | null): boolean {
  try {
    return storage?.getItem(KDV_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeKdvExcludedPref(storage: Storage | null, excluded: boolean): void {
  try {
    storage?.setItem(KDV_PREF_KEY, excluded ? "1" : "0");
  } catch {
    // Tercih kaydedilemedi; ekran çalışmaya devam eder.
  }
}

/** `window.localStorage`'a erişimin KENDİSİ atabilir (engellenmiş site verisi). */
function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Seçilen değer bellekte de tutulur: yazma başarısız olsa bile (gizli sekme)
 * anahtar ÇALIŞMALIDIR. Yalnız depoya güvenseydik, yazamayan tarayıcıda
 * düğmeye basan müşteri hiçbir şeyin değişmediğini görürdü.
 */
let cachedPref: boolean | null = null;

function getKdvPref(): boolean {
  if (typeof window === "undefined") return false;
  if (cachedPref === null) cachedPref = readKdvExcludedPref(browserStorage());
  return cachedPref;
}

function setKdvPref(excluded: boolean): void {
  cachedPref = excluded;
  writeKdvExcludedPref(browserStorage(), excluded);
  for (const listener of prefListeners) listener();
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="text-sm tabular-nums text-text-secondary">{children}</dd>
    </div>
  );
}

export interface QuoteSummaryProps {
  quote: PresentedQuote;
  /**
   * Seçili gösterim birimi. Tercih çalışma alanında okunur ve buraya PROP
   * olarak gelir: seçiciyi bu panel çiziyor ama kuru bütün alt bileşenlere
   * (parça kartı, kademe seçici, ek hizmetler) çalışma alanı dağıtıyor, yani
   * seçim tek yerde okunmalı.
   */
  currency?: DisplayCurrency;
  busy?: boolean;
  onPatch: (patch: QuotePatch) => void;
  /**
   * İnceleme diyaloğunu AÇAR, kendisi çizmez: bütün modallar çalışma alanının
   * kökünde durur (bkz. `workspace-client.tsx`). Bir `position: fixed` diyalog
   * dönüşüm uygulanmış bir atanın içinde kalırsa ekranın ortasına değil kartın
   * içine yapışır; kökte duran modal bu tuzağı hiç göremez.
   */
  onRequestReview: (kind: ReviewKind) => void;
  onRequestPrices: () => void;
}

export function QuoteSummary({
  quote,
  currency = "TRY",
  busy,
  onPatch,
  onRequestReview,
  onRequestPrices,
}: QuoteSummaryProps): JSX.Element {
  const d = useDictionary();
  // Sunucu anlık görüntüsü her zaman "KDV dahil": tercih yalnız tarayıcıda
  // yaşar ve sunucu onu bilemez.
  const kdvExcluded = useSyncExternalStore(subscribeKdvPref, getKdvPref, () => false);
  // Kontrollü alanlar: not ve satın alma emri numarası teklif başına tektir ve
  // iki sekmede açıkken birbirini geri alıyordu (bkz. `synced-field.ts`).
  const customerNote = useSyncedField(quote.customerNote ?? "");
  const poNumber = useSyncedField(quote.poNumber ?? "");

  const { viewer, totals, readiness } = quote;
  // Seçim → teklifin KENDİ dondurduğu kur. `display` yoksa (bayrak kapalı, kur
  // bayat ya da fiyat kapısı kapalı) `null` döner ve panel ₺ kalır.
  const rate = displayRate(quote.display?.snapshot, currency);
  // YUVARLAMA: her satır ayrı yuvarlandığı için satırların toplamı çevrilmiş
  // toplamdan sapabilir. Bir fişte "toplamı tutmayan satırlar" hatadır, o
  // yüzden fark GÖRÜNEN bir satır olur. Çevrilemeyen fişte `null` döner ve
  // satır hiç doğmaz (`quote-currency.ts` hiç ATMAZ).
  const receipt = rate && totals ? convertReceipt(totals, rate) : null;
  // `viewer.canEdit` ERİŞİM hakkıdır (sahip mi, paylaşım mı); `locked` ise
  // teklifin DURUMUDUR (siparişe dönmüş, süresi dolmuş, ödeme sürüyor).
  // Yazan her denetim ikisini birden sormak zorunda.
  const editable = viewer.canEdit && !quote.locked;
  const canRequestReview = editable && quote.status !== "needs_review" && quote.parts.length > 0;
  // Yüksek hacim uyarısı İKİ katmanda doğar ve ikisi birlikte sorulmak
  // zorundadır: cap üstü adetli bir parça fiyatlanamadığı için `partsKurus`a
  // hiç girmez, dolayısıyla TEKLİF düzeyindeki `qty_over_auto` hiç tetiklenmez.
  // Yalnız teklif düzeyine bakan denetim, parça kartı "yüksek hacim teklifi
  // isteyin" derken RFQ düğmesini saklardı; talep de yanlış sekmeye (manuel)
  // düşerdi.
  const showRfq =
    canRequestReview &&
    (quote.quoteIssues.some((issue) => issue.code === "qty_over_auto") ||
      quote.parts.some((part) => part.dfm.some((issue) => issue.code === "qty_over_auto")));

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="border-b border-border-default px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">
          {d["instantQuote.summary.title"]}
        </h2>
      </div>

      <div className="space-y-5 px-4 py-4">
        <LeadTierPicker
          options={quote.leadOptions}
          value={quote.leadTier}
          shipByDate={quote.shipByDate}
          disabled={!editable || busy}
          rate={rate}
          onChange={(leadTier) => onPatch({ leadTier })}
        />

        <AddonsPicker
          addons={quote.catalog.addons}
          selected={quote.addonKeys}
          disabled={!editable || busy}
          rate={rate}
          onChange={(addonKeys) => onPatch({ addonKeys })}
        />

        {/* ── Fiş ───────────────────────────────────────────────────────── */}
        <div className="space-y-2 border-t border-border-default pt-4">
          <p className="text-xs text-text-muted">
            {fill(d["instantQuote.summary.parts"], {
              parts: quote.partCount,
              units: quote.unitCount,
            })}
          </p>

          <dl className="space-y-1.5">
            <Row label={d["instantQuote.summary.partsSubtotal"]}>
              {totals ? (
                money(totals.partsKurus, rate)
              ) : (
                <span className="font-mono text-text-muted">{d["instantQuote.price.hidden"]}</span>
              )}
            </Row>

            {totals?.addonLines.map((line) => (
              <Row key={line.key} label={line.name}>
                {money(line.kurus, rate)}
              </Row>
            ))}

            {totals && totals.minOrderTopUpKurus > 0 && (
              <Row label={d["instantQuote.summary.minOrderTopUp"]}>
                {money(totals.minOrderTopUpKurus, rate)}
              </Row>
            )}

            {/* Fark YALNIZ ≠ 0 iken çizilir; sıfır farkta satır gürültüdür.
                "KDV hariç" anahtarı açıkken de çizilmez: o hâlde gösterilen
                toplam zaten satırların toplamı DEĞİL (bir alttaki
                `kdvLineNote` bunu söylüyor) ve ikinci bir açıklama satırı
                müşteriyi iki kez şaşırtırdı. */}
            {receipt && receipt.roundingMinor !== 0 && !kdvExcluded && (
              <Row label={d["instantQuote.fx.rounding"]}>
                {formatMoneyMinor(receipt.roundingMinor, receipt.currency, "tr")}
              </Row>
            )}
          </dl>

          <p className="text-xs text-text-muted">{d["instantQuote.summary.freeShipping"]}</p>

          {/* Anahtar YALNIZ toplamı çevirir; satır tutarları KDV dahil kalır.
              Bu cümle olmazsa "KDV hariç" diyen müşteri toplamdan BÜYÜK
              satırlar okur ve ikisini tek toplam sanar. */}
          {kdvExcluded && (
            <p className="text-xs text-text-muted">{d["instantQuote.summary.kdvLineNote"]}</p>
          )}
        </div>

        {/* ── Toplam ────────────────────────────────────────────────────── */}
        <div className="border-t border-border-default pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-text-primary">
              {d["instantQuote.summary.total"]}
            </span>
            <span className="text-xl font-semibold tabular-nums text-text-primary">
              {totals ? (
                money(displayedTotalKurus(totals, kdvExcluded), rate)
              ) : (
                <span className="font-mono text-text-muted">{d["instantQuote.price.hidden"]}</span>
              )}
            </span>
          </div>

          {totals ? (
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs text-text-muted">
                {kdvExcluded
                  ? d["instantQuote.summary.kdvExcluded"]
                  : d["instantQuote.summary.kdvIncluded"]}
                {" · "}
                {fill(d["instantQuote.summary.kdv"], { rate: KDV_RATE_BPS / 100 })}{" "}
                <span className="tabular-nums">{money(totals.kdvKurus, rate)}</span>
              </span>
              <button
                type="button"
                onClick={() => setKdvPref(!kdvExcluded)}
                className="text-xs text-text-secondary underline underline-offset-2 hover:text-text-primary"
              >
                {kdvExcluded
                  ? d["instantQuote.summary.kdvToggleIncluded"]
                  : d["instantQuote.summary.kdvToggleExcluded"]}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-text-muted">
              {d["instantQuote.summary.priceHidden"]}
            </p>
          )}
        </div>

        {/* ── Gösterim para birimi ─────────────────────────────────────── */}
        {/* Seçici `display` YOKKEN hiç çizilmez; kararı bileşenin kendisi
            verir (bkz. `display-currency.tsx`). */}
        <DisplayCurrencyPicker display={quote.display} currency={currency} />

        {/* ── Engeller ──────────────────────────────────────────────────── */}
        {readiness.blockers.length > 0 && (
          <div className="rounded-xl border border-border-default bg-bg-muted px-3 py-2.5">
            <p className="text-xs font-medium text-text-secondary">
              {d["instantQuote.summary.checkoutBlocked"]}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-text-secondary">
              {readiness.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Ödeme ─────────────────────────────────────────────────────── */}
        {/* `readiness.canCheckout` teklifin DURUMUDUR, izleyicinin hakkı değil:
            `quotePermissions` de `checkoutBlockers` de izleyiciyi hiç sormaz.
            Ödeme sayfası ise paylaşım token'ını BİLEREK okumaz, yani oraya
            giden paylaşım izleyicisi çıplak bir 404'e çarpar (uygulamada
            `not-found.tsx` de yok). Giriş yapmış paylaşım izleyicisinin fiyatı
            GÖRMESİ ile ÖDEYEBİLMESİ bu yüzden ayrı iki denetimdir. */}
        <div className="space-y-1.5">
          {!viewer.canSeePrices ? (
            // Kapı kapalıyken düğme ödemeye değil kapıya götürür: müşteri önce
            // ne ödeyeceğini görmeli.
            <button type="button" onClick={onRequestPrices} className="btn-primary w-full">
              {d["instantQuote.summary.checkout"]}
            </button>
          ) : readiness.canCheckout && viewer.isOwner ? (
            <Link
              href={`/teklif/${encodeURIComponent(quote.number)}/odeme`}
              className="btn-primary block w-full text-center"
            >
              {d["instantQuote.summary.checkout"]}
            </Link>
          ) : (
            <button type="button" disabled className="btn-primary w-full opacity-50">
              {d["instantQuote.summary.checkout"]}
            </button>
          )}

          {/* Sebepsiz kapalı düğme müşteriye yapacak tek şey bırakır: telefon
              etmek. Engeller listesi teklifin kendi sebeplerini zaten yazıyor;
              burada yazılan izleyiciye özgü olanı. */}
          {viewer.canSeePrices && !viewer.isOwner && (
            <p className="text-center text-xs text-text-muted">
              {d["instantQuote.summary.ownerOnlyCheckout"]}
            </p>
          )}
        </div>

        {/* ── İnceleme talepleri ────────────────────────────────────────── */}
        {canRequestReview && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            <button
              type="button"
              onClick={() => onRequestReview("manual")}
              className="text-text-secondary underline underline-offset-2 hover:text-text-primary"
            >
              {d["instantQuote.summary.requestManual"]}
            </button>
            <button
              type="button"
              onClick={() => onRequestReview("target_price")}
              className="text-text-secondary underline underline-offset-2 hover:text-text-primary"
            >
              {d["instantQuote.summary.targetPrice"]}
            </button>
            {showRfq && (
              <button
                type="button"
                onClick={() => onRequestReview("rfq")}
                className="text-text-secondary underline underline-offset-2 hover:text-text-primary"
              >
                {d["instantQuote.summary.rfq"]}
              </button>
            )}
          </div>
        )}

        {/* ── Not ve satın alma emri ────────────────────────────────────── */}
        {editable && (
          <div className="space-y-3 border-t border-border-default pt-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">
                {d["instantQuote.summary.note"]}
              </span>
              <Textarea
                rows={3}
                value={customerNote.value}
                placeholder={d["instantQuote.summary.notePlaceholder"]}
                disabled={busy}
                onChange={(e) => customerNote.edit(e.target.value)}
                onBlur={() => {
                  const value = customerNote.value.trim();
                  customerNote.commit(value);
                  if (value !== (quote.customerNote ?? "")) {
                    onPatch({ customerNote: value || null });
                  }
                }}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-secondary">
                {d["instantQuote.summary.poNumber"]}
              </span>
              <input
                type="text"
                value={poNumber.value}
                disabled={busy}
                className="input-base !py-2 !text-sm"
                onChange={(e) => poNumber.edit(e.target.value)}
                onBlur={() => {
                  const value = poNumber.value.trim();
                  poNumber.commit(value);
                  if (value !== (quote.poNumber ?? "")) onPatch({ poNumber: value || null });
                }}
              />
            </label>
          </div>
        )}
      </div>
    </Card>
  );
}
