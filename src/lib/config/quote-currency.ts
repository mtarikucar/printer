/**
 * Döviz GÖSTERİMİNİN tek dönüşüm noktası: kuruş → hedef para biriminin MINOR
 * birimi (cent/penny).
 *
 * ─── BU DOSYANIN BİRİNCİ KURALI ────────────────────────────────────────────
 *
 * GÖSTERİM, YALNIZ GÖSTERİM. Bağlayıcı her tutar, saklanan her kolon ve tahsil
 * edilen her kuruş TÜRK LİRASIDIR. Döviz rakamı YAKLAŞIK bir ikinci kolondur
 * ve belgede bağlayıcı ₺ tutarı "≈ <döviz>" olanın YANINDA durur. Hiçbir tutar
 * döviz cinsinden tahsil edilmez, iade edilmez, faturalanmaz, karşılaştırılmaz.
 * Gerekçe bir ürün tercihi değil: 32 Sayılı Karar m.4/g + 2008-32/34 Tebliğ
 * m.8, Türkiye'de yerleşikler arası satış sözleşmesinde bedelin TL olmasını
 * ZORUNLU kılar.
 *
 * ─── TEK DÖNÜŞÜM NOKTASI ───────────────────────────────────────────────────
 *
 * Kuruştan dövize çeviren aritmetik YALNIZ burada durur. İkinci bir çevirici
 * (bir bileşende elle bölme, bir rotada "hızlı" bir çarpma) iki yerde farklı
 * yuvarlanan ve bir gün birbirini tutmayan iki rakam demek olurdu; müşteri de
 * proformada satırların toplamı tutmayan bir belge görürdü.
 *
 * ─── KAPALI İTHALATÇI KÜMESİ NEDEN VAR ─────────────────────────────────────
 *
 * Çevrilmiş bir değeri para taşıyan koda sokmak derlemeyi bozmaz: sessizce
 * yanlış bir tahsilat, hakediş ya da iade üretir. Bu yüzden bu modülü import
 * eden `src/**` dosyalarının listesi `scripts/test-quote-currency.ts`te KAPALI
 * bir küme olarak tutulur; listede yalnız sunum katmanı vardır. Fiyat motoru
 * (`quote-pricing.ts`, `quote-compute.ts`), tahsilat zinciri (`quote-tender.ts`),
 * ödeme/hakediş/iade zinciri (`prices.ts`, `payment.ts`, `finance.ts`,
 * `cost-lines.ts`, `order-refund.ts`, `partner-adjustments.ts`,
 * `dispute-resolution.ts`, `quote-checkout.ts`, `quote-order.ts`,
 * `order-money.ts`, `manufacturer-assignment.ts`) o listede YOKTUR ve biri
 * eklenirse test kırılır.
 *
 * Aynı kuralın tip tarafı: burada ihraç edilen hiçbir ad `…Kurus` ile BİTMEZ
 * (`…Minor` kullanılır), çünkü `quote-present.ts`in fiyat kapısı
 * `key.endsWith("Kurus")` ile uygulanıyor.
 *
 * Saf modül: DB yok, `import "server-only"` YOK, `node:` import'u YOK — BullMQ
 * worker'ı ve istemci bileşenleri aynı dosyayı yükler.
 */
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import type { FrozenFxRate, FxCurrency, QuoteTotals } from "@/lib/config/quote-types";

/** 1 TRY = 1e6 mikro-TRY. Kur satırları bu ölçekte tamsayı saklanır. */
const MICRO_PER_TRY = 1_000_000;

/**
 * kuruş → hedef para biriminin MINOR birimi (cent/penny). Tamsayı → tamsayı.
 *
 * TRY = kurus/100 ; yabancı = TRY / R ; minor = round(yabancı × 100)
 * R = microTryPerUnit / 1e6  ⇒  minor = round(kurus × 1e6 / microTryPerUnit)
 *
 * TAŞMA KANITI: `kurus <= MAX_AMOUNT_KURUS = 2_000_000_00 = 2e8`
 * (`prices.ts`), `2e8 × 1e6 = 2e14 < Number.MAX_SAFE_INTEGER = 9,007e15`.
 * BigInt gerekmez; tavan bu yüzden BURADA da sınanır.
 *
 * Sınır aşılırsa ya da kur satırı bozuksa `RangeError` ATAR — sessizce yanlış
 * bir rakam üretmez. (`quote-tender.ts`in `tenderKurus`/`grossKurus` emsali:
 * buraya kadar gelen geçersiz bir girdi bir PROGRAMLAMA hatasıdır, müşteriye
 * dönen bir cevap değil.)
 */
export function convertKurusToMinor(kurus: number, microTryPerUnit: number): number {
  if (!Number.isSafeInteger(kurus) || kurus < 0 || kurus > MAX_AMOUNT_KURUS) {
    throw new RangeError("Çevrilecek tutar 0 ile MAX_AMOUNT_KURUS arasında tam kuruş olmalı");
  }
  // Tamsayı şartı bir yazım hatasını yakalar: mikro yerine ₺ cinsinden bir kur
  // (ör. 47.32) geçilirse rakam 1e6 katı büyük çıkardı.
  if (!Number.isSafeInteger(microTryPerUnit) || microTryPerUnit <= 0) {
    throw new RangeError("Kur (microTryPerUnit) pozitif bir tamsayı olmalı");
  }
  return Math.round((kurus * MICRO_PER_TRY) / microTryPerUnit);
}

/** Fişteki parça satırlarının toplamı. */
const PARTS_LINE_KEY = "parts";
/** Asgari sipariş tutarına tamamlama; yalnız > 0 iken satır olur. */
const MIN_ORDER_LINE_KEY = "minOrderTopUp";

/** Ek hizmet satırının fiş anahtarı — katalog anahtarıyla çakışmayan tek yazım. */
export function addonReceiptKey(addonKey: string): string {
  return `addon:${addonKey}`;
}

export interface ConvertedReceipt {
  currency: FxCurrency;
  lines: Array<{ key: string; minor: number }>;
  totalMinor: number;
  /** totalMinor − Σ lines. Ekranda YALNIZ ≠ 0 iken "Yuvarlama" satırı çizilir. */
  roundingMinor: number;
}

/**
 * Teklif fişinin dövize çevrilmiş hâli. `totals`ı yalnız OKUR.
 *
 * YUVARLAMA DEĞİŞMEZİ: her satır bağımsız yuvarlandığı için satırların toplamı
 * çevrilmiş toplamdan ±(satır sayısı) minor birim sapabilir. Bir proformada
 * "toplamı tutmayan satırlar" hatadır, o yüzden fark GÖRÜNEN bir satır olur:
 * `Σ lines.minor + roundingMinor === totalMinor` ve
 * `|roundingMinor| <= lines.length`.
 *
 * Emsalden bilinçli AYRILMA: `allocatePaytrBasket` (`prices.ts`) aynı farkı
 * artan tek satırda GİZLİCE soğurur. Orada doğru (PayTR sepeti toplamı tutmak
 * zorunda ve müşteri satırı okumaz), burada değil (müşteri belgeyi okur ve
 * satırları toplar).
 *
 * KDV fişin satırlarına GİRMEZ: `kdvExcludedKurus`/`kdvKurus` toplamın
 * BÖLÜNMESİdir, ona eklenen bir kalem değil. İkisini `lines`a koymak toplam
 * değişmezini bozardı; ekranda gerekince `convertKurusToMinor` ile çevrilir.
 */
export function convertReceipt(totals: QuoteTotals, rate: FrozenFxRate): ConvertedReceipt {
  const addonsKurus = totals.addonLines.reduce((sum, line) => sum + line.kurus, 0);
  const componentsKurus = totals.partsKurus + addonsKurus + totals.minOrderTopUpKurus;
  if (componentsKurus !== totals.totalKurus) {
    // `computeQuote` daima `parts + addons + topUp = total` üretir. Tutmayan bir
    // girdiyle çizilen fiş, satırları toplamı vermeyen bir proforma olurdu.
    throw new RangeError("Fişin satırları toplamı totalKurus'a eşit değil");
  }
  const lines: Array<{ key: string; minor: number }> = [];
  const push = (key: string, kurus: number) => {
    // Sıfır kuruşluk satır ekranda gürültüdür: fişte hiç doğmaz.
    if (kurus !== 0) lines.push({ key, minor: convertKurusToMinor(kurus, rate.microTryPerUnit) });
  };
  push(PARTS_LINE_KEY, totals.partsKurus);
  for (const line of totals.addonLines) push(addonReceiptKey(line.key), line.kurus);
  push(MIN_ORDER_LINE_KEY, totals.minOrderTopUpKurus);
  const totalMinor = convertKurusToMinor(totals.totalKurus, rate.microTryPerUnit);
  const summedMinor = lines.reduce((sum, line) => sum + line.minor, 0);
  return {
    currency: rate.currency,
    lines,
    totalMinor,
    roundingMinor: totalMinor - summedMinor,
  };
}
