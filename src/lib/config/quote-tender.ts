/**
 * TEK tahsilat zinciri: brüt tutardan TAHSİL EDİLEN nakde giden yol.
 *
 * NEDEN TEK MODÜL: brüt tutarı tahsil edilecek tutara çeviren aritmetik bugün
 * `/api/orders/route.ts` içinde SATIR İÇİ yazılı (kart kilidi → `Math.min` →
 * havale indirimi → net) ve teklif ödemesi (`quote-checkout.ts`) kendi
 * kopyasını taşıyor. Üç özellik daha aynı zincire dokunacak (hediye kartı,
 * promosyon kodu, sadakat puanı); her biri kendi kopyasını düzeltirse zincir
 * yollara göre AYRIŞIR ve fark paranın içinde, sessizce ortaya çıkar: PayTR'a
 * brüt gitmesi çifte tahsilattır (webhook tutar farkını yalnız loglar,
 * `api/webhooks/paytr/route.ts`), indirimin brütten hesaplanması ise
 * `hediye + indirim > brüt` hâline yol açar ve o siparişin iadesi
 * `refundTenderBasis` tarafından KALICI olarak reddedilir
 * (`order-refund.ts` · `lineage_unknown`).
 *
 * SAF MODÜL: DB yok, `import "server-only"` yok, `node:` import'u yok — BullMQ
 * worker'ı (order-draft zinciri), Next rotaları ve istemci bileşenleri (yalnız
 * tip olarak) aynı kuralı okuyabilsin.
 *
 * DEĞİŞMEZLER (hepsi `scripts/test-quote-tender.ts` tarafından sınanır):
 *  - `amountKurus` BRÜTTÜR ve hiçbir adım onu düşürmez. Kalem/hakediş tabanı
 *    (`productionBaseKurus + paintingPriceKurus = amountKurus`) brütten türer;
 *    hediye kartı ile havale indirimini PLATFORM üstlenir, partner payını
 *    düşürmez.
 *  - `payableKurus = amountKurus − (zincirin her adımı)` ve asla negatif olamaz.
 *  - `giftCardAmountKurus + havaleDiscountKurus <= amountKurus` — iade
 *    motorunun ön koşulu; bozulursa sipariş iade EDİLEMEZ hâle gelir.
 *  - `MAX_AMOUNT_KURUS` tavanı BRÜT üzerindedir: tavan siparişin büyüklüğünü
 *    sınırlar, ödenen nakdi değil (hediye kartıyla kapatmak tavanı aşmaya izin
 *    vermez).
 *  - Fatura matrahı `amountKurus − havaleDiscountKurus`tur (`payouts.ts`):
 *    hediye kartı bir ÖDEME ARACIDIR, iskonto değil, matrahı düşürmez.
 *
 * SIRA KURALIN KENDİSİDİR (karar 6.1): her adım kendinden öncekilerin düştüğü
 * NAKİT üzerinde çalışır. Havale indirimi bu yüzden brütten değil, hediye
 * kartından sonra kalan tutardan hesaplanır — `calculateHavaleDiscount`
 * parametresinin adı (`amountAfterGiftCardKurus`) bunu zaten söylüyor.
 */
import { calculateHavaleDiscount } from "./payment";
import { MAX_AMOUNT_KURUS } from "./prices";

/** Müşterinin SEÇTİĞİ yöntem. `gift_card_full` bir seçim değil, bir SONUÇTUR. */
export type TenderPaymentMethod = "card" | "bank_transfer";

/** Taslağa/siparişe YAZILAN yöntem (`paymentMethodEnum` ile aynı küme). */
export type RecordedPaymentMethod = TenderPaymentMethod | "gift_card_full";

/**
 * Zincirin adımları, UYGULANMA SIRASIYLA. Sıra bir tercih değil, para
 * kararıdır: `havale_discount` `gift_card`tan sonra gelir, yani indirim
 * tahsil edilen nakit üzerinden hesaplanır.
 *
 * Promosyon kodu ve sadakat puanı buraya EKLENECEK; hangi sırada durdukları o
 * özelliklerin kararıdır ama kararın yeri burasıdır — ikinci bir sıra listesi
 * tutulmaz.
 */
export const TENDER_STEP_ORDER = ["gift_card", "havale_discount"] as const;
export type TenderStep = (typeof TENDER_STEP_ORDER)[number];

/**
 * Zincirin BRÜTTEN İNDİRDİĞİ kalemler.
 *
 * Yeni bir indirim (promosyon, sadakat puanı) tam olarak buraya girer ve üç
 * şeyi birden zorunlu kılar: alanın adı, `TENDER_STEP_ORDER` içindeki yeri ve
 * `TENDER_STEP_FIELD` satırı. Üçünü birden yazmayı zorunlu kılan şey
 * aşağıdaki İKİ YÖNLÜ tip kapısıdır (`TENDER_STEPS_COVER_ALL_DEDUCTIONS`), tek
 * başına bir test değil: alanı ekleyip adımını yazmamak DERLEME hatasıdır.
 */
export interface TenderDeductions {
  /** Hediye kartından karşılanan tutar; brütü DEĞİL tahsilatı düşürür. */
  giftCardAmountKurus: number;
  /** Havale/EFT indirimi; kalan NAKİT üzerinden hesaplanır. */
  havaleDiscountKurus: number;
}

/** Adımın çıktıdaki tutar alanı. Yeni bir adım, satırını yazmadan eklenemez. */
export const TENDER_STEP_FIELD = {
  gift_card: "giftCardAmountKurus",
  havale_discount: "havaleDiscountKurus",
} as const satisfies Record<TenderStep, keyof TenderDeductions>;

/**
 * İKİ YÖNLÜ tükenmişlik kapısı — para güvenliğinin taşıyıcısı.
 *
 * `satisfies Record<TenderStep, keyof TenderDeductions>` (yukarıda) YALNIZ bir
 * yönü kapatır: her ADIMIN bir alanı olmasını. Ters yön açıktı ve tam o yön
 * paraya dokunuyor: `TenderDeductions`a üçüncü bir alan (`promoDiscountKurus`)
 * eklemek, `TENDER_STEP_ORDER`a dokunmadan DERLENİRDİ — yani indirim kaydedilir
 * ama `computeTender`ın topladığı adımlara girmediği için tahsilattan
 * DÜŞMEZDİ. Sonuç: müşteriden fazla tahsilat, yeşil bir `test:unit` ile.
 *
 * Bu satır o yönü kapatır: alanı ekleyip adımını yazmayan bir değişiklik
 * `Exclude<...>`i boş olmayan bir birleşim yapar ve atama
 * `Type 'true' is not assignable to type 'never'` ile PATLAR (`npm run
 * typecheck`). Çalışma zamanı değeri yalnız bu kapının varlığını görünür
 * kılmak içindir (`scripts/test-quote-tender.ts` onu da okur).
 */
export const TENDER_STEPS_COVER_ALL_DEDUCTIONS: Exclude<
  keyof TenderDeductions,
  (typeof TENDER_STEP_FIELD)[TenderStep]
> extends never
  ? true
  : never = true;

/**
 * Zincirin girdisi. TÜM ALANLAR ZORUNLU ve bu bilinçlidir: yeni bir alan
 * (promosyon kodu indirimi, harcanan puan) eklendiği gün her çağrı yeri
 * DERLEME HATASI verir, yani zincire dokunan her ödeme yolu tek tek gözden
 * geçirilmiş olur. İsteğe bağlı bir alan, o yolların sessizce eski davranışta
 * kalması demekti.
 */
export interface TenderInput {
  /** Teklifin/siparişin BRÜT tutarı: kalemler + ek hizmetler + asgari tamamlama. */
  amountKurus: number;
  /** Müşterinin seçtiği ödeme yöntemi. */
  paymentMethod: TenderPaymentMethod;
  /** Hediye kartının kullanılabilir bakiyesi; kart yoksa 0. */
  giftCardBalanceKurus: number;
  /**
   * Havale indirimi bu tutarda uygulanıyor mu. Figür siparişinde daima açıktır;
   * teklif tarafında katalog ayarıdır (`PricingSettings.havaleDiscountApplies`)
   * ve teklifin snapshot'ında donar — B2B tutarlarında %3 platformun payından
   * çıktığı için açık/kapalı olması bir FİYAT kararıdır.
   */
  havaleDiscountApplies: boolean;
}

/** Zincirin çıktısı: ne kadarı nereden karşılanıyor. */
export interface Tender extends TenderDeductions {
  /** TAHSİL EDİLEN nakit: PayTR'a giden ve havale talimatında yazan tutar. */
  payableKurus: number;
  /** Brütün tamamı karşılandı mı (kart/havale adımı hiç açılmaz). */
  fullyCoveredByGiftCard: boolean;
}

/**
 * Bir yöntemin EKRANDA gösterilen iki rakamı. İkisi de sunucu hesabıdır; ekran
 * onları yalnız YAZAR (ödeme sayfasının "bu dosyada çarpma, bölme, oran yoktur"
 * kuralı).
 */
export interface TenderView {
  havaleDiscountKurus: number;
  payableKurus: number;
}

/**
 * İKİ yöntemin birden görünümü.
 *
 * Neden ikisi birden: müşteri kart ile havale arasında geçerken ekranın ikinci
 * bir istek atması (ve o istekle ikinci bir hediye kartı kodu denemesi
 * harcaması) gerekmesin. Hediye kartı adımı yöntem dalından ÖNCE geldiği için
 * (`TENDER_STEP_ORDER`) karşılanan tutar iki yöntemde de aynıdır; yöntemden
 * yöntemde değişen yalnız havale indirimi ve ondan türeyen nakittir.
 *
 * Anahtarlar JSON uç sözleşmesidir (`POST /api/quotes/[id]/gift-card`), bu
 * yüzden `bank_transfer` değil `bankTransfer`.
 */
export interface TenderViews {
  card: TenderView;
  bankTransfer: TenderView;
}

/**
 * Seçili yöntemin rakamları. SEÇİMDİR, hesap DEĞİL — ve tek bir yerde durması
 * bilinçli: hem form hem ödeme fişi aynı rakamı göstermek zorunda, iki ayrı
 * ternary bir gün ayrışırdı.
 */
export function tenderViewFor(views: TenderViews, paymentMethod: TenderPaymentMethod): TenderView {
  return paymentMethod === "bank_transfer" ? views.bankTransfer : views.card;
}

function tenderKurus(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} negatif olmayan bir tam kuruş tutarı olmalı`);
  }
  return value;
}

/**
 * Brüt tutarın kapısı. Tavan BURADA da sınanır, çünkü zincir tavanı aşan bir
 * tutarı hediye kartıyla "tahsil edilebilir" hâle getirebilirdi.
 *
 * NOT: bu bir SON SAVUNMA hattıdır, müşteriye dönen cevap değil. Çağıranlar
 * tutarı kendileri sınayıp 400 döner (`quote-checkout.ts`, `/api/orders`);
 * buraya kadar gelen geçersiz bir tutar bir programlama hatasıdır ve 500
 * olmalıdır — sessizce düzeltilmiş bir para değil.
 */
function grossKurus(value: number): number {
  const amountKurus = tenderKurus(value, "Brüt tutar");
  if (amountKurus <= 0 || amountKurus > MAX_AMOUNT_KURUS) {
    throw new RangeError("Brüt tutar tavan dışında (0 < tutar <= MAX_AMOUNT_KURUS)");
  }
  return amountKurus;
}

/**
 * Tahsilat zincirinin TEK uygulaması.
 *
 * Adımlar `TENDER_STEP_ORDER` sırasıyla, her biri kalan nakit üzerinde.
 */
export function computeTender(input: TenderInput): Tender {
  const amountKurus = grossKurus(input.amountKurus);
  const balanceKurus = tenderKurus(input.giftCardBalanceKurus, "Hediye kartı bakiyesi");

  // 1) Hediye kartı: kartın bakiyesi kadar, ama tutarın ötesine geçmeden.
  const giftCardAmountKurus = Math.min(balanceKurus, amountKurus);

  // 2) Havale indirimi: tahsil edilecek NAKDE verilen teşvik, o yüzden kartın
  //    düştüğü tutar üzerinden. Nakit sıfırsa (kart brütü tamamen kapattı)
  //    indirim de sıfırdır — indirim tahsilata verilir, hediye kartına prim
  //    olarak değil.
  const cashAfterGiftCardKurus = amountKurus - giftCardAmountKurus;
  const havaleDiscountKurus =
    input.paymentMethod === "bank_transfer" && input.havaleDiscountApplies
      ? calculateHavaleDiscount(cashAfterGiftCardKurus)
      : 0;

  const deductions: TenderDeductions = { giftCardAmountKurus, havaleDiscountKurus };

  // Tahsil edilen tutar, adım listesinden TÜRETİLİR: yeni bir indirim
  // `TenderDeductions`a ve `TENDER_STEP_ORDER`a girdiği anda tahsilattan da
  // düşer. Elle yazılmış bir çıkarma zinciri, alanı ekleyip tahsilattan
  // düşmeyi unutmanın (yani müşteriden fazla tahsil etmenin) açık kapısıydı.
  // "Alanı ekleyip adımı yazmamak" kapısını kapatan şey bu toplam DEĞİL,
  // `TENDER_STEPS_COVER_ALL_DEDUCTIONS` tip kapısıdır: bu toplam, listede
  // OLMAYAN bir alanı tanımı gereği görmez.
  const deductedKurus = TENDER_STEP_ORDER.reduce(
    (sum, step) => sum + deductions[TENDER_STEP_FIELD[step]],
    0
  );

  // Zincirin çıkış kapısı. Bugünkü iki adımla ULAŞILAMAZ (ikisi de kalan
  // nakitle sınırlı) ve tam bu yüzden yazılıdır: eklenecek üçüncü indirim
  // (promosyon, puan) tavanlanmayı unutursa burada PATLAR — sessizce iade
  // EDİLEMEZ bir sipariş yazmak yerine (iade motoru `indirim + hediye <= brüt`
  // istiyor, `order-refund.ts` · refundTenderBasis).
  if (deductedKurus < 0 || deductedKurus > amountKurus) {
    throw new RangeError("Tahsilat zinciri brüt tutarı aştı");
  }

  return {
    ...deductions,
    payableKurus: amountKurus - deductedKurus,
    // `/api/orders`ın `isCovered` ölçüsüyle birebir: kartın karşıladığı tutar
    // brütün tamamına yetti mi.
    fullyCoveredByGiftCard: giftCardAmountKurus >= amountKurus,
  };
}

/**
 * DONMUŞ bir tahsilatın tahsil edilen tutarı: taslak/sipariş satırından okunur.
 *
 * Zincir ileri yönde ödeme anında koşar ve sonucunu kolonlara yazar; o satırı
 * sonradan okuyan yerler (bekleyen ödeme cevabı, `/pay` ve `/havale` sayfaları,
 * iade motoru) aynı çıkarmayı ELLE yapmak zorunda kalmasın diye ters yön de
 * burada durur. Elle yazılmış bir `amount − gift − discount` üçlüsü, zincire
 * üçüncü bir indirim (promosyon, sadakat puanı) eklendiği gün BAYATLAR: yeni
 * kolon toplamdan düşmez ve satır, tahsil edilenden FAZLA bir "ödenecek tutar"
 * gösterir. Toplam bu yüzden `TENDER_STEP_ORDER` üzerinden yürür.
 *
 * Girdi `TenderDeductions`ın TAMAMINI ister, yani yeni bir indirim kolonu
 * eklendiğinde bu fonksiyonu çağıran her yer DERLEME hatası verir.
 */
export function recordedPayableKurus(
  row: { amountKurus: number } & TenderDeductions
): number {
  const amountKurus = grossKurus(row.amountKurus);
  const deductedKurus = TENDER_STEP_ORDER.reduce(
    (sum, step) => sum + tenderKurus(row[TENDER_STEP_FIELD[step]], "Kayıtlı indirim"),
    0
  );
  // Bozuk satırda SESSİZ kalmak yanlış: `hediye + indirim > brüt` olan bir
  // sipariş zaten iade EDİLEMEZ hâldedir (`order-refund.ts` · refundTenderBasis
  // `lineage_unknown`), ve negatif bir "ödenecek tutar" göstermek o hatayı
  // müşterinin ekranına taşımak olurdu.
  if (deductedKurus > amountKurus) {
    throw new RangeError("Kayıtlı tahsilat dökümü brüt tutarı aşıyor");
  }
  return amountKurus - deductedKurus;
}

/**
 * Taslağa/siparişe YAZILACAK ödeme yöntemi.
 *
 * Zincirin parçasıdır ve bu yüzden burada durur: tam karşılanan bir ödemede
 * PayTR de havale de hiç açılmaz, taslak doğrudan siparişe terfi eder. Kararı
 * çağıranların kendi üçlü koşullarına bırakmak, "hangi yöntem yazıldı"
 * sorusunun iki yolda farklı cevaplanması demekti.
 */
export function recordedPaymentMethod(
  requested: TenderPaymentMethod,
  tender: Pick<Tender, "fullyCoveredByGiftCard">
): RecordedPaymentMethod {
  return tender.fullyCoveredByGiftCard ? "gift_card_full" : requested;
}
