"use client";

import { useSyncExternalStore, type JSX } from "react";
import {
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
  type PresentedFxDisplay,
} from "@/lib/config/quote-types";
import { formatDateLong } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import { fill, rateText } from "./format";

/**
 * Gösterim para biriminin TERCİH DEPOSU ve seçicisi.
 *
 * Tercih TARAYICIDA yaşar, teklifin kendisine YAZILMAZ: bir gösterim
 * kolaylığıdır, teklifin bir alanı değil. Emsali aynı sütundaki KDV tercihidir
 * (`quote-summary.tsx`) ve buradaki beş parça birebir oradan gelir — beşi de
 * ayrı bir tarayıcı hâli için var:
 *
 *  1. `DISPLAY_CURRENCY_PREF_KEY` — tek yazım yeri.
 *  2. `prefListeners` + `subscribeDisplayCurrency` — dış depo aboneliği.
 *  3. `read…`/`write…Pref`, HER BİRİ kendi `try` bloğunda.
 *  4. `browserStorage()` — `window.localStorage`a ERİŞİMİN KENDİSİ atabilir
 *     (site verisi engellenmiş tarayıcı), o yüzden o da `try` içinde.
 *  5. `cachedPref` bellek kopyası — yazma başarısız olsa bile (gizli sekme)
 *     DÜĞME ÇALIŞMALI; yalnız depoya güvenen bir seçici, yazamayan tarayıcıda
 *     basıldığında hiçbir şeyin değişmediğini gösterirdi.
 *
 * Tercih bir DIŞ DEPODUR, React durumu değil: `useState` + `useEffect` ile
 * kopyalansaydı sunucunun ürettiği işaretleme ile tarayıcınınki ilk boyamada
 * ayrışır ve tutar bir an yanlış görünürdü. Sunucu anlık görüntüsü her zaman
 * BAĞLAYICI birimdir (₺) — sunucu tarayıcının tercihini bilemez.
 *
 * GÖSTERİM, yalnız gösterim: burada bir tek para aritmetiği yoktur; seçim
 * `format.ts`in `money()` dikişine bir KUR taşır.
 */

/** Tercihin tek yazım yeri. */
export const DISPLAY_CURRENCY_PREF_KEY = "figurunica.quote.displayCurrency";

/** Bağlayıcı birim: `DISPLAY_CURRENCIES`in BAŞINDAKİ eleman. */
const BINDING_CURRENCY: DisplayCurrency = DISPLAY_CURRENCIES[0];

const prefListeners = new Set<() => void>();

function subscribeDisplayCurrency(onChange: () => void): () => void {
  prefListeners.add(onChange);
  return () => {
    prefListeners.delete(onChange);
  };
}

/**
 * Tercihi okur. Gizli sekmede ve site verisi engellenmiş tarayıcıda
 * `localStorage` erişimi ATAR; bir gösterim kolaylığı yüzünden teklif ekranı
 * çökmemeli, bu yüzden okuma kendi `try` bloğundadır.
 *
 * Depodaki değer KAPALI kümeye karşı sınanır: elle kurcalanmış ya da kümeden
 * çıkmış bir birim (ör. katalog küçülürse) bağlayıcı birime düşer.
 */
export function readDisplayCurrencyPref(storage: Storage | null): DisplayCurrency {
  try {
    const raw = storage?.getItem(DISPLAY_CURRENCY_PREF_KEY);
    return (DISPLAY_CURRENCIES as readonly string[]).includes(raw ?? "")
      ? (raw as DisplayCurrency)
      : BINDING_CURRENCY;
  } catch {
    return BINDING_CURRENCY;
  }
}

export function writeDisplayCurrencyPref(
  storage: Storage | null,
  currency: DisplayCurrency
): void {
  try {
    storage?.setItem(DISPLAY_CURRENCY_PREF_KEY, currency);
  } catch {
    // Tercih kaydedilemedi; ekran çalışmaya devam eder (bellek kopyası tutar).
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
 * Seçilen değerin bellek kopyası: yazma başarısız olsa bile anahtar
 * ÇALIŞMALIDIR.
 */
let cachedPref: DisplayCurrency | null = null;

/** Deponun anlık görüntüsü. Sunucuda daima bağlayıcı birim. */
export function displayCurrencySnapshot(): DisplayCurrency {
  if (typeof window === "undefined") return cachedPref ?? BINDING_CURRENCY;
  if (cachedPref === null) cachedPref = readDisplayCurrencyPref(browserStorage());
  return cachedPref;
}

export function setDisplayCurrency(currency: DisplayCurrency): void {
  cachedPref = currency;
  writeDisplayCurrencyPref(browserStorage(), currency);
  for (const listener of prefListeners) listener();
}

/**
 * Seçili gösterim birimi. Sunucu anlık görüntüsü BAĞLAYICI birimdir: sunucunun
 * ürettiği işaretleme her zaman ₺ okur, tarayıcıdaki gerçek değer ilk
 * boyamadan itibaren geçerlidir.
 */
export function useDisplayCurrency(): DisplayCurrency {
  return useSyncExternalStore(
    subscribeDisplayCurrency,
    displayCurrencySnapshot,
    () => BINDING_CURRENCY
  );
}

/**
 * Seçici — `display` YOKKEN hiç çizilmez.
 *
 * `display` üç sebeple yok olabilir: bayrak kapalı, kur BAYAT/eksik ya da
 * fiyat kapısı kapalı (`presentQuote` anahtarı hiç göndermez). Üçünde de
 * ekranda bir "kur alınamadı" cümlesi çıkarmak, döviz bile istemeyen müşteriye
 * anlamsız bir hata göstermek olurdu: seçici yalnız YOK olur. Karşılanamayan
 * bir seçim cümlesi (`instantQuote.fx.unavailable`) yalnız belge sayfasında,
 * müşteri `?kur=EUR` ile geldiğinde yazılır.
 */
export function DisplayCurrencyPicker({
  display,
  currency = BINDING_CURRENCY,
}: {
  display: PresentedFxDisplay | null | undefined;
  /**
   * Yüzeyin GERÇEKTEN çizdiği birim — depodan İKİNCİ bir okuma yapılmaz.
   *
   * Sebebi somut: sunucu anlık görüntüsü daima bağlayıcı birimdir, yani ikinci
   * bir okuma ilk boyamada ata bileşenden AYRI bir değer verebilirdi ve kur
   * cümlesi ekrandaki rakamlarla çelişirdi ("1 EUR = …" yazan panelde ₺
   * tutarlar). Seçim tek yerde okunur, buraya prop olarak gelir.
   */
  currency?: DisplayCurrency;
}): JSX.Element | null {
  const d = useDictionary();
  if (!display || display.currencies.length < 2) return null;

  const rate = display.snapshot.rates.find((r) => r.currency === currency) ?? null;

  return (
    <div className="space-y-1.5 border-t border-border-default pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary">
          {d["instantQuote.fx.label"]}
        </span>
        <div
          role="group"
          aria-label={d["instantQuote.fx.label"]}
          className="flex overflow-hidden rounded-lg border border-border-default"
        >
          {display.currencies.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === currency}
              onClick={() => setDisplayCurrency(option)}
              className={`px-2.5 py-1 text-xs tabular-nums ${
                option === currency
                  ? "bg-accent-soft font-medium text-text-primary"
                  : "text-text-secondary hover:bg-bg-muted"
              }`}
            >
              {option === "TRY" ? d["instantQuote.fx.try"] : option}
            </button>
          ))}
        </div>
      </div>

      {/* Kur, kaynağı ve BÜLTEN TARİHİ çevrilmiş rakamın yanında YAZILI durur:
          "bana €100 dendi" iddiasını kapatan dört azaltmadan biri (öteki üçü
          belgenin bağlayıcı ₺ kolonu, ödeme ekranındaki uyarı ve sipariş/iade
          ekranlarında dövizin hiç görünmemesi). TCMB verisi kamuya açık ve
          ücretsizdir ama ATIFLA kullanılır. */}
      {rate && (
        <p className="text-xs text-text-muted">
          {fill(d["instantQuote.fx.rateNote"], {
            currency: rate.currency,
            rate: rateText(rate),
            // Bülten tarihi OKUNUR yazılır: ham gün anahtarı ("2026-09-29")
            // kâğıtta da ekranda da bir kaçaktır (aynı kural fişte de var).
            date: formatDateLong(display.snapshot.bulletinDate, "tr"),
          })}
        </p>
      )}
      {rate && <p className="text-xs text-text-muted">{d["instantQuote.fx.indicative"]}</p>}
    </div>
  );
}
