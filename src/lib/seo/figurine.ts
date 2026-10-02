/**
 * Kişiye özel figürünün `Product` + `Offer` JSON-LD'si — amiral gemisi ürünün
 * MAKİNE OKUNUR künyesi.
 *
 * Neden ayrı bir builder: `seo/product.ts` PAZARYERİ ürününü anlatır (satıcı
 * markası, yoruma bağlı puan, 14 günlük cayma hakkı), `seo/service.ts` ise
 * anlık teklif HİZMETİNİ (fiyat aralığının alt ucu). Figürün ikisi de değil:
 * tek fiyatlı, tek ölçülü, sipariş üzerine üretilen ve kişiselleştirilmiş
 * olduğu için cayma hakkı kapsamı DIŞINDA olan bir üründür. Denetim
 * (2026-10-02): sitede `offers`/`price` taşıyan yapısal veri yalnız o iki
 * yerdeydi, yani ₺3.499'luk figürin teklif-farkında bir retrieval için
 * GÖRÜNMEZDİ.
 *
 * ŞEMADAKİ HER DEĞER SAYFADA GÖRÜNEN DEĞERİN AYNISI olmak zorunda: fiyat
 * `FIGURINE_PRICE_KURUS`tan, ölçü `SIZE_PRESETS[0].heightMm`den, teslim
 * süreleri `FIGURINE_LEAD_DAYS`ten, ad ve künye cümlesi SÖZLÜKTEN gelir.
 * Elle yazılmış ikinci bir kopya, bir gün sayfadan ayrışacak bir rakam demek
 * ve Google bunu "structured data mismatch" olarak cezalandırıyor.
 *
 * Bağlayıcı kararlar:
 *  - `@id` SAYFAYA GÖRE DEĞİŞMEZ. Aynı düğüm üç sayfada yayımlanıyor (`/figur`,
 *    `/nasil-calisir`, `/create`); farklı `@id`ler üç AYRI ürün gibi görünür.
 *    Kanonik adres `/figur`: ürünün anlatıldığı sayfa. Satın alma yüzeyi
 *    `/create` olduğu için `Offer.url` oraya bakar.
 *  - `aggregateRating` YOK. `organization.ts:11-14` bunu bilerek dışarıda
 *    bırakıyor (Google'ın kendi-kendine-yorum politikası) ve figürin için
 *    gerçek yorum verimiz YOK. Uydurma puan yazmak, sayfada görünmeyen bir
 *    iddiadır. Gerçek, doğrulanmış alıcı yorumu geldiğinde buraya
 *    `aggregateRating` + görünür yorum listesi BİRLİKTE gelir.
 *  - `hasMerchantReturnPolicy` 14 GÜN DEĞİL, `MerchantReturnNotPermitted`.
 *    Sayfanın kendi beyanı böyle: `/iade` "kişiselleştirilmiş mal
 *    niteliğindedir ve standart 14 günlük cayma hakkı kapsamı dışındadır"
 *    (Mesafeli Sözleşmeler Yönetmeliği m.15/1-(b)), `landing.faq.a7` aynısını
 *    söylüyor. Pazaryeri ürününün 14 günü figürine YAZILAMAZ — hem şema
 *    sayfayı yalanlardı hem de tüketiciye yanlış bir hak beyan ederdi.
 *    (Önizleme onaylanmadan ücretsiz iptal hakkı ayrı bir şeydir ve schema.org
 *    bunu ifade edemiyor; bu yüzden sayfadaki metin tek kaynak olarak kalıyor.)
 *  - `availability: InStock`. Sipariş üzerine üretim için dürüst terim
 *    `MadeToOrder` olurdu ama Google desteklemiyor ve desteklenmeyen değer
 *    teklifin TAMAMINI uygunsuz hâle getirir — `seo/product.ts`teki aynı
 *    karar. Gerçek üretim süresi `handlingTime`de dürüstçe duruyor.
 *  - `priceValidUntil` YUVARLANIR. Geçmişte kalan sabit bir tarih teklifi
 *    sessizce zengin sonuçlardan düşürür; bu markup'ın en sık çürüme biçimi.
 *  - `brand`/`seller` mevcut `#organization` düğümüne REFERANS verir. İkinci
 *    bir organizasyon düğümü yaratmak entity çözümlemesini böler.
 */
import { FIGURINE_PRICE_KURUS } from "@/lib/config/prices";
import { FIGURINE_LEAD_DAYS } from "@/lib/config/product-facts";
import { SIZE_PRESETS } from "@/lib/config/sizes";
import { getAppUrl } from "./organization";

const CURRENCY = "TRY";

/** Listelenen fiyatın kaç gün geçerli sayıldığı. Yuvarlanır, asla sabit tarih. */
const PRICE_VALID_DAYS = 90;

/**
 * Şemanın okuduğu sözlük alanları — YAPISAL tip.
 *
 * `Dictionary` import EDİLMİYOR: bu modül sözlüğün tamamına bağlı olmasın,
 * çağıran hangi dilin sözlüğünü verdiyse şema o dilde çıksın. Bir `Dictionary`
 * bu şekli yapısal olarak karşılar.
 */
export interface FigurineSchemaDict {
  /** "Kişiye Özel Figürün" */
  "create.product.title": string;
  /** "15 cm · SLA reçine · profesyonel el boyamalı" */
  "create.product.spec": string;
  /** Ücretsiz kargo + üretim/kargo süresi cümlesi. */
  "create.product.included": string;
}

function isoDateInDays(days: number, now: number): string {
  return new Date(now + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Figürün değişmez entity kimliği.
 *
 * Üç sayfanın üçü de BUNU yayınlar. Ayrı bir fonksiyon, çünkü testin ve
 * ileride eklenecek `BreadcrumbList`/`ItemPage` düğümlerinin aynı kimliğe
 * bağlanması gerekiyor.
 */
export function figurineProductId(appUrl: string = getAppUrl()): string {
  return `${appUrl}/figur#figurine`;
}

export function buildFigurineProductJsonLd(
  d: FigurineSchemaDict,
  appUrl: string = getAppUrl(),
  nowMs: number = Date.now()
): Record<string, unknown> {
  const organizationId = `${appUrl}/#organization`;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": figurineProductId(appUrl),
    name: d["create.product.title"],
    // Künye + ne dahil olduğu: ikisi de `/create`in ürün kartında ve gerçekler
    // bandında BİREBİR görünen cümleler.
    description: `${d["create.product.spec"]}. ${d["create.product.included"]}`,
    url: `${appUrl}/figur`,
    // Satılan tek ölçü. `QuantitativeValue` + UN/CEFACT birim kodu: "15 cm"
    // etiketi bu değerin insan okunur hâli.
    height: {
      "@type": "QuantitativeValue",
      value: SIZE_PRESETS[0].heightMm,
      unitCode: "MMT",
    },
    brand: { "@id": organizationId },
    offers: {
      "@type": "Offer",
      // Satın alma yüzeyi: fiyatı yayınlayan ve ödemeye giden sayfa.
      url: `${appUrl}/create`,
      priceCurrency: CURRENCY,
      // schema.org ondalık dizgi bekler, kuruş tamsayıdır.
      price: (FIGURINE_PRICE_KURUS / 100).toFixed(2),
      // Fiyat KDV DAHİL yayımlanıyor — sayfadaki "KDV dahil" beyanının
      // makine okunur hâli.
      valueAddedTaxIncluded: true,
      priceValidUntil: isoDateInDays(PRICE_VALID_DAYS, nowMs),
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@id": organizationId },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "TR",
        returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
      },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: {
          "@type": "MonetaryAmount",
          value: "0",
          currency: CURRENCY,
        },
        shippingDestination: {
          "@type": "DefinedRegion",
          addressCountry: "TR",
        },
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: {
            "@type": "QuantitativeValue",
            minValue: FIGURINE_LEAD_DAYS.productionMin,
            maxValue: FIGURINE_LEAD_DAYS.productionMax,
            unitCode: "DAY",
          },
          transitTime: {
            "@type": "QuantitativeValue",
            minValue: FIGURINE_LEAD_DAYS.transitMin,
            maxValue: FIGURINE_LEAD_DAYS.transitMax,
            unitCode: "DAY",
          },
        },
      },
    },
  };
}
