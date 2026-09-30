/**
 * Teklif yüzeyinin küçük biçimleme yardımcıları + döviz gösteriminin TEK
 * RENDER DİKİŞİ (`money`).
 *
 * Sözlük cümleleri `{anahtar}` yer tutucularıyla yazılır (ev deseni:
 * `email.ts` `.replace("{orderNumber}", …)`); teklif ekranında aynı cümlede üç
 * dört yer tutucu olduğu için zincirlenmiş `replace` çağrıları yerine tek bir
 * `fill` var. BİLİNMEYEN yer tutucu OLDUĞU GİBİ BIRAKILIR: sessizce boş
 * bırakmak, eksik bir parametreyi ekranda "… mm" gibi yarım bir cümleye
 * çevirirdi; yer tutucunun kendisi görünürse hata testte ve gözle yakalanır.
 *
 * ─── DÖVİZ: TEK DİKİŞ ──────────────────────────────────────────────────────
 *
 * Teklif yüzeyindeki her tutar `money()`den geçer. On dört arayüz dosyasının
 * her biri kendi `toLocaleString`ını yazsaydı, ilk kur değişikliğinde iki
 * rakam ayrışır ve müşteri satırların toplamı tutmayan bir fiş okurdu.
 *
 * GÖSTERİM, yalnız gösterim: bağlayıcı her tutar ve tahsil edilen her kuruş
 * Türk lirasıdır (32 Sayılı Karar m.4/g + 2008-32/34 Tebliğ m.8 — gerekçenin
 * tamamı `quote-currency.ts` başlığında). `money()` ikinci bir ₺ biçimleyici
 * DEĞİLDİR: kur verilmediğinde mevcut `formatCurrency`ye düşer, yani ₺ yolu
 * bu turda tek satır bile değişmedi.
 *
 * Dikişin ÜÇ girişi var ve üçü aynı kuralı paylaşır:
 *  - `money(kurus, rate)` — tek başına duran bir tutar (birim fiyat, KDV).
 *  - `lineMoney(kurus, minor, rate)` — TOPLANAN bir kümenin satırı; değeri
 *    kümenin ara toplamına AYRILMIŞTIR (`convertPartLines`).
 *  - `fxSurface(...)` — yüzeyin TEK KAPISI: fiş çevrilemiyorsa kur, fiş ve
 *    satır kümesi birlikte yok olur, yani yarısı `€` yarısı `₺` bir ekran
 *    doğamaz.
 *
 * Bu dosya SAF ve İSTEMCİ/SUNUCU ORTAK: `"use client"` yoktur, çünkü belge
 * sayfasının sunucu bileşeni `?kur=` çözümlemesini (`parseDisplayCurrency`) ve
 * kur seçimini (`displayRate`) kendisi yapmak zorunda — bunlar bir istemci
 * modülünde dursa sunucu onları çağıramazdı.
 */
import {
  convertKurusToMinor,
  convertPartLines,
  convertReceipt,
  isConvertibleAmount,
  type ConvertedReceipt,
} from "@/lib/config/quote-currency";
import {
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
  type FrozenFxRate,
  type QuoteFxSnapshot,
  type QuoteTotals,
} from "@/lib/config/quote-types";
import { formatCurrency, formatMoneyMinor } from "@/lib/i18n/format";

/** Bağlayıcı birim: `DISPLAY_CURRENCIES`in BAŞINDAKİ eleman. */
const BINDING_CURRENCY: DisplayCurrency = DISPLAY_CURRENCIES[0];

export function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  );
}

/**
 * Ölçü sayıları: en fazla bir ondalık, gereksiz sıfır yok (120, 80.5 → "120",
 * "80,5"). Türkçe ayraç `toLocaleString` ile gelir.
 */
export function mm(value: number): string {
  return Number(value.toFixed(1)).toLocaleString("tr-TR");
}

/** Hacim/alan gibi iki ondalıklı ölçüler. */
export function decimal2(value: number): string {
  return Number(value.toFixed(2)).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

/**
 * Bir tutarın ekranda görünen hâli. `rate` yoksa (ya da bağlayıcı birim
 * seçiliyse) mevcut `formatCurrency` — yani ₺ yolu değişmedi.
 *
 * ÇEVRİLEMEYEN tutar da ₺'ye DÜŞER, atmaz: `convertKurusToMinor` bir aritmetik
 * ilkeldir ve tavan dışında `RangeError` atar (`quote-currency.ts`), ama bir
 * sunucu bileşeninde atılan `RangeError` boş gövdeli bir 500'dür — döviz
 * kolonu, YANINDA durduğu bağlayıcı ₺ okumasını da öldürürdü. Gösterim ₺
 * belgesini asla riske atmaz; gerekirse KENDİSİ yok olur.
 *
 * Bu düşüş bir AĞ, kapı değil: müşteri onu hiç görmez, çünkü yüzeyin kapısı
 * (`fxSurface`) çevrilemeyen bir fişte kuru KOMPLE düşürür. Tek tutarlık düşüş
 * yalnız yüzey kapısını atlayan (ör. `/account/teklifler` satırı) bir çağrıda
 * ya da bir programlama hatasında devreye girer.
 */
export function money(kurus: number, rate?: FrozenFxRate | null): string {
  if (!rate || rate.currency === BINDING_CURRENCY) return formatCurrency(kurus, "tr");
  if (!isConvertibleAmount(kurus)) return formatCurrency(kurus, "tr");
  return formatMoneyMinor(
    convertKurusToMinor(kurus, rate.microTryPerUnit),
    rate.currency,
    "tr"
  );
}

/**
 * ÇEVRİLMİŞ BİR KÜMENİN bir satırı: `minor` o kümeye AYRILMIŞ değerdir
 * (`convertPartLines`), yani satırların toplamı ekranda duran ara toplamı
 * BİREBİR tutar. `minor` yoksa tek tutarlık yola (`money`) düşer.
 *
 * İkinci bir biçimleyici DEĞİL, aynı dikişin ikinci girişi: `money` tek başına
 * duran bir tutarı (birim fiyat, KDV, tavan cümlesi) biçimler; `lineMoney`
 * TOPLANAN bir kümenin satırını. Ayrımın gerekçesi `convertPartLines`
 * başlığında: bağımsız yuvarlanan satırlar ara toplamı tutmaz ve bir
 * proformada bu bir hatadır.
 */
export function lineMoney(
  kurus: number,
  minor: number | null | undefined,
  rate: FrozenFxRate | null
): string {
  if (!rate || minor === null || minor === undefined) return money(kurus, rate);
  return formatMoneyMinor(minor, rate.currency, "tr");
}

/** `fxSurface`in okuduğu tek şey: parçanın kimliği ve (varsa) satır tutarı. */
export interface FxSurfacePart {
  id: string;
  price?: { lineKurus: number } | null;
}

/**
 * Bir YÜZEYİN döviz gösterimi — tek kapı.
 *
 * `rate`, `receipt` ve satır tutarları BİRLİKTE doğar ya da HİÇBİRİ doğmaz:
 * gösterim tavanını aşan (`MAX_AMOUNT_KURUS`; teklif tarafında tavan
 * UYGULANMAZ, bkz. `quote-currency.ts` başlığı) ya da bozuk kurlu bir teklifte
 * `convertReceipt` `null` döner ve yüzeyin TAMAMI ₺ kalır.
 *
 * Kapı neden TUTAR BAŞINA değil YÜZEY BAŞINA: `money()` çevrilemeyen tek bir
 * tutarı ₺'ye düşürür (atmamak için), ama bu tek başına bırakıldığında
 * kalemleri `€…` toplamı `₺…` basan bir fiş üretirdi — okuyucunun topladığı
 * sayılar ile toplam farklı para biriminde olurdu. Tasarımın bu hâl için sözü
 * "gösterim KENDİSİ yok olur", yarısı değil.
 */
export interface FxSurface {
  /** Yüzeyin gösterim kuru; `null` = yalnız ₺. */
  rate: FrozenFxRate | null;
  /** `rate` varken DAİMA dolu: fiş satırları + GÖRÜNEN yuvarlama farkı. */
  receipt: ConvertedReceipt | null;
  /** parça id → satır tutarının AYRILMIŞ döviz değeri (`lineMoney`). */
  partLineMinor: ReadonlyMap<string, number>;
}

const NO_PART_LINES: ReadonlyMap<string, number> = new Map();
const FX_OFF: FxSurface = { rate: null, receipt: null, partLineMinor: NO_PART_LINES };

export function fxSurface(
  snapshot: QuoteFxSnapshot | null | undefined,
  currency: DisplayCurrency,
  totals: QuoteTotals | null | undefined,
  parts: readonly FxSurfacePart[]
): FxSurface {
  const rate = displayRate(snapshot, currency);
  // `totals` yoksa fiyat kapısı kapalıdır (`presentQuote` alanı hiç
  // göndermiyor): kur ekranda, fiyat kapısının ARKASINDA değil (R7).
  if (!rate || !totals) return FX_OFF;
  const receipt = convertReceipt(totals, rate);
  if (!receipt) return FX_OFF;
  const priced = parts.filter(
    (part): part is FxSurfacePart & { price: { lineKurus: number } } => Boolean(part.price)
  );
  const minors = convertPartLines(
    priced.map((part) => part.price.lineKurus),
    totals.partsKurus,
    rate
  );
  if (!minors) return FX_OFF;
  return {
    rate,
    receipt,
    partLineMinor: new Map(priced.map((part, index) => [part.id, minors[index]])),
  };
}

/**
 * Bu teklifte döviz gösterimi MÜMKÜN mü — seçicinin çizilme kapısı.
 *
 * `display`in varlığı yetmez: gösterim tavanını aşan bir teklifte hiçbir birim
 * çevrilemez (`fxSurface`), yani seçici HİÇBİR ŞEY yapmayan ölü bir düğme
 * kümesi olurdu. Kapı seçilmiş birimden BAĞIMSIZ sorulur (₺ seçiliyken de
 * seçici durmalı), o yüzden katalogdaki yabancı birimlerin HERHANGİ BİRİ
 * çevrilebiliyorsa `true`.
 */
export function fxDisplayPossible(
  display: { snapshot: QuoteFxSnapshot; currencies: readonly DisplayCurrency[] } | null | undefined,
  totals: QuoteTotals | null | undefined,
  parts: readonly FxSurfacePart[]
): boolean {
  if (!display) return false;
  return display.currencies.some(
    (currency) =>
      currency !== BINDING_CURRENCY &&
      fxSurface(display.snapshot, currency, totals, parts).rate !== null
  );
}

/**
 * Seçilen gösterim biriminin, TEKLİFİN KENDİ DONDURDUĞU kuru — ya da `null` =
 * "₺ göster".
 *
 * Kur teklifin snapshot'ından okunur, bugünün bülteninden DEĞİL: müşteri
 * teklifi açtığı gün gördüğü rakamı görmeye devam etmeli (aynı gerekçe
 * `splitByTechnology`in snapshot'ı KOPYALAMASININ da sebebi).
 *
 * Snapshot'ta o birim YOKSA sessizce `null`: yarım bir küme göstermek, bir
 * birimin ekranda sessizce kaybolması ya da daha kötüsü yanlış bir kurla
 * çevrilmesi demek olurdu.
 */
export function displayRate(
  snapshot: QuoteFxSnapshot | null | undefined,
  currency: DisplayCurrency
): FrozenFxRate | null {
  if (!snapshot || currency === BINDING_CURRENCY) return null;
  return snapshot.rates.find((r) => r.currency === currency) ?? null;
}

/**
 * `?kur=` okuması — GEÇERSİZ/bilinmeyen her değer sessizce bağlayıcı birime
 * düşer. Adres çubuğuna yazılan bir dizgi yüzünden belge sayfası 404/500
 * vermemeli: müşterinin proformaya ulaşması bir gösterim tercihinden önemlidir.
 */
export function parseDisplayCurrency(raw: unknown): DisplayCurrency {
  if (typeof raw !== "string") return BINDING_CURRENCY;
  const wanted = raw.trim().toUpperCase();
  return (DISPLAY_CURRENCIES as readonly string[]).includes(wanted)
    ? (wanted as DisplayCurrency)
    : BINDING_CURRENCY;
}

/**
 * Donmuş kurun okunur hâli: 48_741_200 mikro-TRY → "48,7412".
 *
 * PARA aritmetiği DEĞİL, kurun kendi ölçek değişimidir (mikro → birim) ve tek
 * yerde yazılıdır ki ekranda iki farklı hanede iki kur görünmesin. Dört hane
 * TCMB bülteninin kendi hassasiyetidir.
 */
export function rateText(rate: FrozenFxRate): string {
  return (rate.microTryPerUnit / 1_000_000).toLocaleString("tr-TR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}
