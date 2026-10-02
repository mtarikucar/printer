/**
 * ALINTILANABİLİR ÜRÜN GERÇEKLERİ — kişiye özel figürün fiyat ve boyut
 * ETİKETİNİN tek gösterim biçimi.
 *
 * Neden ayrı bir modül: 2026-10-02 ölçümünde gerçek bir ChatGPT oturumunda
 * "figür nerede yaptırabilirim" sorusuna üç marka çıktı ve üçünün de
 * tarifinde alıntılanabilir bir RAKAM vardı ("12–20 cm", "1.099–2.499 TL").
 * Bizim rakamlarımız sitede yazılıydı ama çoğu yüzeyde yalnızca sözlük
 * cümlesinin İÇİNE elle yazılmıştı — yani fiyat bir yerde değişince cümle
 * yalan söylerdi. Artık rakamın tek kaynağı `FIGURINE_PRICE_KURUS` ve
 * `SIZE_PRESETS[0].heightMm`; bu dosya o iki sabitin MÜŞTERİYE GÖSTERİLEN
 * biçimini üretir ve dört yüzey (anasayfa, /figur, /create, sözlük
 * cümlelerinin yer tutucuları) aynı dizeyi paylaşır.
 *
 * İKİNCİ BİR PARA BİÇİMLENDİRİCİSİ DEĞİLDİR. `formatCurrency` işlemsel
 * tutarların (fiş, toplam, KDV) biçimlendiricisi olarak yerinde duruyor ve
 * kuruş çiftini ("₺3.499,00") yazmak ZORUNDA. Tanıtım cümlesi ise kuruşu hiç
 * taşımıyordu ("₺3.499 tek fiyat"); bu yüzden tam liraya oturan fiyat tam lira
 * olarak yazılır. Fiyat bir gün kuruş taşırsa (ör. ₺3.499,50) etiket SESSİZCE
 * yuvarlanmaz — o durumda `formatCurrency`ye düşer, çünkü yayımlanan rakamın
 * tahsil edilen rakamdan sapması bu sevkiyatın tam da engellemeye çalıştığı
 * şeydir.
 *
 * SAF MODÜL: `import "server-only"` YOK ve olmayacak — BullMQ worker'ı
 * order-draft.ts üzerinden `src/lib/config/**`e ulaşıyor ve `server-only`
 * standalone-Node worker'ını crash-loop'a sokar ([[worker-server-only-trap]]).
 */
import { FIGURINE_PRICE_KURUS } from "./prices";
import { SIZE_PRESETS, formatCm } from "./sizes";
import { formatCurrency } from "@/lib/i18n/format";

/**
 * Satılan TEK ölçünün etiketi — "15 cm". Kaynağı `SIZE_PRESETS[0].heightMm`,
 * yani ölçü değişince her yüzey birlikte değişir.
 */
export const FIGURINE_HEIGHT_LABEL = formatCm(SIZE_PRESETS[0].heightMm);

/**
 * Kuruş → müşteriye gösterilen fiyat etiketi.
 *
 * SAF FONKSİYON, sabitin kendisi değil: yapısal veri (V2) şemaya yazdığı
 * rakamdan sayfadaki etiketi YENİDEN ÜRETİP karşılaştırıyor, yani ayrışmayı
 * ancak değerle çağrılabilen bir fonksiyon yakalayabilir. Sabit tek bir değer
 * olduğu sürece kuruşlu dal yalnızca kaynak piniyle korunabiliyordu; artık
 * ikisi de DEĞERLE sınanıyor (`scripts/test-seo-jsonld.ts`).
 */
export function figurinePriceLabel(kurus: number): string {
  return kurus % 100 === 0
    ? `₺${(kurus / 100).toLocaleString("tr-TR")}`
    : formatCurrency(kurus, "tr");
}

/**
 * Tek fiyatın etiketi — "₺3.499". Tanıtım cümlelerinin `{price}` yer tutucusu
 * bununla doldurulur; `/create` ürün kartı da aynı dizeyi basar.
 */
export const FIGURINE_PRICE_LABEL = figurinePriceLabel(FIGURINE_PRICE_KURUS);

/**
 * Figürünün TESLİM SÜRESİ — üretim ve kargo, iş günü.
 *
 * Neden sabit: bu dört rakam ("5-7" ve "2-3") yayımlanan dört cümlenin
 * İÇİNDE elle yazılıydı (`create.product.included`,
 * `landing.fig.hero.stat2.v`, `landing.faq.a1`, `/nasil-calisir` adımları) ve
 * hiçbir yerde tek bir kaynağı yoktu. Yapısal veri (`Offer.shippingDetails`
 * → `handlingTime`/`transitTime`) bu rakamı MAKİNEYE söylüyor; şemaya beşinci
 * bir kopya yazmak, bir gün sayfanın söylediğinden farklı bir teslim süresi
 * yayınlamak demekti.
 *
 * Dört cümlenin METNİ bu sevkiyatta yer tutucuya ÇEVRİLMEDİ (kapsam: V2 yeni
 * metin yazmıyor); onun yerine `scripts/test-seo-jsonld.ts` her yayımlanan
 * yüzeyi bu sabite PİNLER — biri değişip diğeri kalırsa test kırmızı döner.
 */
export const FIGURINE_LEAD_DAYS = {
  /** Önizleme onayından sonra üretim: 5-7 iş günü. */
  productionMin: 5,
  productionMax: 7,
  /** Kargo: 2-3 iş günü. */
  transitMin: 2,
  transitMax: 3,
} as const;

/**
 * Katman yüksekliği etiketi — "25 µm".
 *
 * Rakamın kaynağı SÖZLÜK: `/figur` kahraman şeridi onu zaten
 * `landing.fig.hero.stat1.v` + `.u` ile yayınlıyor. İkinci bir sabit açmak
 * yerine o anahtar tek kaynak sayıldı; `/nasil-calisir` aynı değeri buradan
 * okur, böylece baskı çözünürlüğü değiştiğinde iki sayfa birlikte değişir.
 *
 * Parametre tipi bilerek YAPISAL (`Dictionary` import edilmiyor): bu dosya
 * `src/lib/config/**` altında ve sözlük modülüne bağımlı olmaması gerekiyor.
 * Bir `Dictionary` bu şekli yapısal olarak karşılar.
 */
export function layerHeightLabel(d: {
  "landing.fig.hero.stat1.v": string;
  "landing.fig.hero.stat1.u": string;
}): string {
  return `${d["landing.fig.hero.stat1.v"]} ${d["landing.fig.hero.stat1.u"]}`;
}

/**
 * Sözlük cümlelerindeki `{price}` / `{size}` yer tutucularını doldurur.
 *
 * Yer tutucu deseni evin deseni (`email.ts` `.replace("{orderNumber}", …)`,
 * teklif yüzeyinin `fill`i, `bulk.*`/`box.*` anahtarlarının `{price}`si).
 * BİLİNMEYEN yer tutucu OLDUĞU GİBİ BIRAKILIR: sessizce boşaltmak "tek fiyat"
 * gibi yarım bir cümle üretirdi, oysa yer tutucunun kendisi ekranda görünürse
 * hata testte ve gözle yakalanır.
 *
 * YALNIZCA kişiye özel figürü anlatan dört cümle için: `landing.hero.trust3`,
 * `landing.cta.subtitle`, `landing.pricing.feature1`,
 * `landing.box.figurine.desc`. `bulk.*` / `box.*` anahtarlarının `{price}`si
 * KENDİ kademe fiyatını taşır ve çağrı yerinde doldurulur; onları buradan
 * geçirmek toplu sipariş cümlesine tek figürün fiyatını yazdırırdı.
 */
export function withProductFacts(sentence: string): string {
  return sentence
    .replace(/\{price\}/g, FIGURINE_PRICE_LABEL)
    .replace(/\{size\}/g, FIGURINE_HEIGHT_LABEL);
}
