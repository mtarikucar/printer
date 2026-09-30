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
 * Bu dosya SAF ve İSTEMCİ/SUNUCU ORTAK: `"use client"` yoktur, çünkü belge
 * sayfasının sunucu bileşeni `?kur=` çözümlemesini (`parseDisplayCurrency`) ve
 * kur seçimini (`displayRate`) kendisi yapmak zorunda — bunlar bir istemci
 * modülünde dursa sunucu onları çağıramazdı.
 */
import { convertKurusToMinor, isConvertibleAmount } from "@/lib/config/quote-currency";
import {
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
  type FrozenFxRate,
  type QuoteFxSnapshot,
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
