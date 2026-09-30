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
 * ─── GÖSTERİM TAVANI: BİR TEKLİF ÇEVRİLEMEYEBİLİR ──────────────────────────
 *
 * `MAX_AMOUNT_KURUS` (`prices.ts`) bir ÖDEME tavanıdır: tanımı gereği admin
 * elle sipariş rotasında ve müşteri ödemesinde uygulanır. TEKLİF tarafında
 * uygulanMAZ — parça adedi `quote-service.ts`te 1…100.000, elle birim fiyat
 * `quote-admin.ts`te tek başına tavana kadar, ve `computeQuote` toplam
 * `maxAutoTotalKurus`ı aşınca yalnız bir DFM satırı ekler, toplamı KIRPMAZ.
 * Yani ₺2.000.000 üstü bir teklif GÖRÜNTÜLENEBİLİR (ödemesi
 * `quote-checkout.ts`te reddedilir, ama sayfası açılır).
 *
 * Bu yüzden tavan aşımı bu modülde İKİ farklı şeydir:
 *
 * - `convertKurusToMinor` bir ARİTMETİK ilkel: tavan dışı bir çağrı bir
 *   PROGRAMLAMA hatasıdır ve `RangeError` atar (sessiz yanlış rakam yok).
 * - `convertReceipt` GÖSTERİM giriş noktası: HİÇ atmaz. Çevrilemeyen bir fişte
 *   `null` döner, yani "döviz gösterimi yok". Sebebi somut: bir sunucu
 *   bileşeninde atılan `RangeError` boş gövdeli bir 500'dür — döviz kolonu,
 *   YANINDA durduğu BAĞLAYICI ₺ okumasını da öldürürdü. Gösterim, ₺ belgesini
 *   asla riske atmaz; gerekirse KENDİSİ yok olur.
 *
 * Tavan burada kasıtlı olarak ödeme tavanıyla AYNI sayıdır: müşteriye yaklaşık
 * bir döviz rakamı yalnız gerçekten ÖDENEBİLİR bir ₺ tutarının yanında
 * gösterilir. Kapı tek yerde yazılıdır (`isConvertibleAmount`) ki seçiciyi
 * kapatan D3/D4 kodu aynı sayıyı ikinci kez yazmasın.
 *
 * `allPriced === false` iken `totalKurus` KISMİ bir toplamdır; onu gösterip
 * göstermeme kararı ₺ tarafıyla AYNI yerde verilir, bu modülün işi değildir.
 *
 * Saf modül: DB yok, `import "server-only"` YOK, `node:` import'u YOK — BullMQ
 * worker'ı ve istemci bileşenleri aynı dosyayı yükler.
 */
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import type { FrozenFxRate, FxCurrency, QuoteTotals } from "@/lib/config/quote-types";

/** 1 TRY = 1e6 mikro-TRY. Kur satırları bu ölçekte tamsayı saklanır. */
const MICRO_PER_TRY = 1_000_000;

/**
 * Bu tutar dövize çevrilebilir mi — GÖSTERİM kapısının TEK yazımı.
 *
 * Tavan ödeme tavanıyla aynı sayıdır (`MAX_AMOUNT_KURUS`, gerekçe dosya
 * başlığında) ve taşma kanıtı bu sayıya BAĞLIdır: `2e8 × 1e6 = 2e14 <
 * Number.MAX_SAFE_INTEGER = 9,007e15`. Tavan bir gün yükseltilirse kanıt da
 * yükselmelidir; `scripts/test-quote-currency.ts` bunu `MAX_AMOUNT_KURUS ×
 * 1e6`nın güvenli tamsayı kaldığını iddia ederek çiviler.
 *
 * Negatif de hariçtir: ileride bir İNDİRİM kalemi eklenirse fiş sessizce
 * yanlış çevrilmesin, döviz gösterimi hiç doğmasın (o gün bilinçli bir karar
 * gerekir — bu fonksiyonun tavanı o kararın kapısıdır).
 */
export function isConvertibleAmount(kurus: number): boolean {
  return Number.isSafeInteger(kurus) && kurus >= 0 && kurus <= MAX_AMOUNT_KURUS;
}

/**
 * Kur satırı kullanılabilir mi. Tamsayı şartı bir yazım hatasını yakalar:
 * mikro yerine ₺ cinsinden bir kur (ör. 47.32) geçilirse rakam 1e6 katı büyük
 * çıkardı. `fx_rates` tablosunda aynı kural CHECK olarak var, ama
 * `quotes.fx_snapshot` jsonb'dir ve CHECK'i yoktur: donmuş bozuk bir satır
 * gösterime buradan geçemez.
 */
function isUsableRate(microTryPerUnit: number): boolean {
  return Number.isSafeInteger(microTryPerUnit) && microTryPerUnit > 0;
}

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
 *
 * Bu ATAN sözleşme bir ARİTMETİK ilkelin sözleşmesidir. Müşteriye dönen yolun
 * girişi `convertReceipt`tir ve o ASLA atmaz: tavanı aşan bir teklifte `null`
 * döner (dosya başlığı "GÖSTERİM TAVANI"). Yani bu `RangeError`a ancak kapıyı
 * ATLAYAN bir çağrı düşer.
 */
export function convertKurusToMinor(kurus: number, microTryPerUnit: number): number {
  if (!isConvertibleAmount(kurus)) {
    throw new RangeError("Çevrilecek tutar 0 ile MAX_AMOUNT_KURUS arasında tam kuruş olmalı");
  }
  if (!isUsableRate(microTryPerUnit)) {
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
 * Teklif fişinin dövize çevrilmiş hâli, ya da çevrilemiyorsa `null` (= "döviz
 * gösterimi yok"). `totals`ı yalnız OKUR ve HİÇ ATMAZ.
 *
 * `null` dönen üç hâl — hepsi "₺ belgesi sağlam kalsın" kuralının sonucu
 * (dosya başlığı "GÖSTERİM TAVANI"):
 *
 * 1. Bir tutar gösterim tavanının dışında (`isConvertibleAmount`): teklif
 *    ₺2.000.000 üstü olabilir, çünkü tavan bir ÖDEME tavanıdır ve teklif
 *    tarafında uygulanmaz. Böyle bir teklifte ₺ okunmaya devam eder, yalnız
 *    döviz kolonu doğmaz.
 * 2. Kur satırı bozuk (`isUsableRate`): `quotes.fx_snapshot` jsonb'dir, CHECK'i
 *    yoktur; donmuş bozuk bir kur ekrana `Infinity` ya da ₺0 basmaz.
 * 3. Satırlar toplamı `totalKurus`u vermiyor: `computeQuote` daima
 *    `parts + addons + topUp = total` üretir, tutmayan bir girdi bir
 *    PROGRAMLAMA hatasıdır — ama müşteriye dönen yüzeyde cezası "döviz yok"tur,
 *    boş gövdeli bir 500 değil. (Kapının atmasını isteyen çağıran, ilkel
 *    `convertKurusToMinor`ı kullanır.)
 *
 * `null` dönüşü BİLEREK tipe yazılıdır: `ConvertedReceipt | null`, D3/D4'ün
 * çevrilemeyen fişi ele almasını derleyici zoruyla sağlar.
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
 * değişmezini bozardı; ekranda gerekince `convertKurusToMinor` ile çevrilir —
 * fiş çevrildiyse ikisi de toplamın altında kaldığı için tavan içindedir.
 */
export function convertReceipt(totals: QuoteTotals, rate: FrozenFxRate): ConvertedReceipt | null {
  if (!isUsableRate(rate.microTryPerUnit)) return null;
  const amounts: Array<{ key: string; kurus: number }> = [
    { key: PARTS_LINE_KEY, kurus: totals.partsKurus },
    ...totals.addonLines.map((line) => ({ key: addonReceiptKey(line.key), kurus: line.kurus })),
    { key: MIN_ORDER_LINE_KEY, kurus: totals.minOrderTopUpKurus },
  ];
  // Toplam önce KURUŞ üzerinde sınanır: çevrilmiş satırların toplamı
  // (yuvarlama yüzünden) bunu kanıtlayamaz.
  const summedKurus = amounts.reduce((sum, item) => sum + item.kurus, 0);
  if (summedKurus !== totals.totalKurus) return null;
  // Her satır AYRI AYRI sınanır: negatif bir satır varsa bir başkası toplamı
  // aşabilir, yani tek başına toplamı sınamak yetmez.
  if (!isConvertibleAmount(totals.totalKurus)) return null;
  if (amounts.some((item) => !isConvertibleAmount(item.kurus))) return null;
  // Sıfır kuruşluk satır ekranda gürültüdür: fişte hiç doğmaz.
  const lines = amounts
    .filter((item) => item.kurus !== 0)
    .map((item) => ({
      key: item.key,
      minor: convertKurusToMinor(item.kurus, rate.microTryPerUnit),
    }));
  const totalMinor = convertKurusToMinor(totals.totalKurus, rate.microTryPerUnit);
  const summedMinor = lines.reduce((sum, line) => sum + line.minor, 0);
  return {
    currency: rate.currency,
    lines,
    totalMinor,
    roundingMinor: totalMinor - summedMinor,
  };
}

/**
 * Parça satırlarının çevrilmiş hâli — toplamı ÇEVRİLMİŞ ARA TOPLAMA (`≈
 * partsKurus`) BİREBİR eşit. Çevrilemeyen kümede `null`.
 *
 * NEDEN AYRI BİR FONKSİYON: `convertReceipt` parçaları TEK toplu satır sayar
 * (`partsKurus`), ama belge ve ödeme fişi parçaları SATIR SATIR basar. Her
 * satırı bağımsız yuvarlarsak (`convertKurusToMinor` doğrudan) o satırların
 * toplamı, hemen altlarında duran "≈ ara toplam" rakamını tutmaz: 10.000 kr +
 * 4.800 kr, EUR 48,7412 → 205 + 98 = 303 ama ara toplam 304. Bir proformada
 * "toplamı tutmayan satırlar" hatadır (dosya başlığı + tasarım §3.2 R5) ve bu
 * fark `convertReceipt`in "Yuvarlama" satırının KAPSAMADIĞI ikinci bir
 * düzeydir — çünkü o satır ara toplam ile TOPLAM arasındaki farkı anlatır.
 *
 * YÖNTEM — kümülatif yuvarlama: satır i, çevrilmiş KÜMÜLATİF toplamların
 * farkıdır. Küme bittiğinde kümülatif toplam tam olarak
 * `convertKurusToMinor(partsKurus)`tır, yani Σ satır = ara toplam KANITLI; her
 * satır da kendi bağımsız çevriminden en çok 1 minor birim sapar ve hiçbir
 * satır negatife düşmez (çevrim monoton, satırlar >= 0).
 *
 * `allocatePaytrBasket` (`prices.ts:174`) emsalinden bilinçli AYRILMA: orada
 * fark ARTAN TEK satırda soğurulur, çünkü PayTR sepetini müşteri okumaz.
 * Burada okur — tek satıra yığılan fark, az tutarlı satırların çoğunda "€0,00"
 * ve sonunda şişmiş bir satır demek olurdu. Kümülatif yöntem farkı satırlara
 * en çok 1 minor olarak dağıtır.
 *
 * `roundingMinor` emsalinden AYRILMA: ara toplam ile satırlar arasındaki fark
 * GÖRÜNEN bir satır YAPILMAZ, çünkü belgede zaten iki satır düzeyi var (parça
 * satırları → ara toplam → toplam) ve ikinci bir "Yuvarlama" satırı kâğıdı
 * okunamaz kılardı. Toplam düzeyindeki fark ise GÖRÜNÜR kalır.
 */
export function convertPartLines(
  lineKurusList: readonly number[],
  partsKurusSum: number,
  rate: FrozenFxRate
): number[] | null {
  if (!isUsableRate(rate.microTryPerUnit)) return null;
  if (!isConvertibleAmount(partsKurusSum)) return null;
  if (lineKurusList.some((kurus) => !isConvertibleAmount(kurus))) return null;
  // Küme ara toplamı VERMİYORSA çevirmek yanlış bir kâğıt üretirdi: fiyatsız
  // parça satır tutarı taşımaz, dolayısıyla çağıran yalnız FİYATLI satırları
  // geçmek zorundadır (`computeQuote`: `partsKurus = Σ fiyatlı lineKurus`).
  const summedKurus = lineKurusList.reduce((sum, kurus) => sum + kurus, 0);
  if (summedKurus !== partsKurusSum) return null;
  const minors: number[] = [];
  let runningKurus = 0;
  let runningMinor = 0;
  for (const kurus of lineKurusList) {
    runningKurus += kurus;
    const cumulativeMinor = convertKurusToMinor(runningKurus, rate.microTryPerUnit);
    minors.push(cumulativeMinor - runningMinor);
    runningMinor = cumulativeMinor;
  }
  return minors;
}
