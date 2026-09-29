/**
 * Teklifin PARAYA döndüğü tek yer: `quotes` → `order_drafts` + `quote_checkouts`.
 *
 * Üç kural bütün dosyayı biçimlendirir:
 *
 * 1. **İstemcinin tutarına asla güvenilmez.** Gövdedeki `expectedTotalKurus`
 *    bir BEYANDIR, girdi değil: tahsil edilen tutar her zaman teklifin kendi
 *    snapshot'ından `computeQuote` ile yeniden hesaplanır ve beyanla
 *    uyuşmazsa istek 409 ile döner. Aynısı `expectedVersion` için geçerlidir —
 *    müşteri ödeme sayfasındayken başka bir sekmede parça eklemiş olabilir.
 * 2. **Kuralı ekran değil politika söyler.** Neyin ödenebileceğini
 *    `quotePermissions` + `checkoutBlockers` belirler; burada ikinci bir
 *    "ama şu hâlde de olur" dalı YOKTUR (ham `PartDfmResult.blocking`
 *    okunmaz — o tek parçanın hâlidir, teklifin değil).
 * 3. **Taslak `/api/orders`'ın kuyruğudur.** Tutar, onay kolonları, PayTR
 *    token'ı, havale indirimi/işleri ve attribution oradaki sırayla yazılır;
 *    webhook, dekont OCR ve `/pay` sayfası bu taslağı ayırt edemez ve
 *    etmemelidir. `/api/orders` DÜZENLENMEZ, yalnız İMPORT edilir.
 *
 * Kart taslağı için `card-expire` işi HER ZAMAN kuyruğa girer (hediye kartı
 * rezervasyonuna bağlı değildir): teklif canlı taslağı varken salt okunur
 * olduğu için, terk edilmiş bir PayTR iframe'i aksi hâlde teklifi sonsuza
 * dek kilitlerdi. Tamamı hediye kartıyla karşılanan taslak için de girer —
 * `/api/orders`ın aksine: terfi patlarsa teklifin kilidini açacak ve rezerve
 * bakiyeyi karta geri verecek tek şey o iştir (`expireDraft`).
 *
 * TAHSİLAT ARİTMETİĞİ BU DOSYADA YOKTUR: brüt tutardan tahsil edilen nakde
 * giden yolun tek uygulaması `quote-tender.ts`tir (`computeTender`). PayTR'a
 * giden tutar, havale talimatındaki tutar, analitik olayın değeri ve cevaptaki
 * `finalAmountKurus` hepsi o TEK sonuçtan okunur; ikinci bir çıkarma zinciri,
 * birinin brüt kalması (sessiz çifte tahsilat) demekti.
 *
 * `import "server-only"` YOK: teklif zinciri (sipariş köprüsü, bakım işi) bu
 * dosyanın import ettiği modülleri worker sürecinden de görebilmeli.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  giftCards,
  orderDrafts,
  quoteCheckouts,
  quoteParts,
  quotes,
  users,
  type Quote,
  type QuotePart,
  type TurkishAddress,
} from "@/lib/db/schema";
import {
  attributionColumns,
  attributionFromRequest,
} from "@/lib/analytics/attribution-server";
import { recordEvent } from "@/lib/analytics/server";
import type { Attribution } from "@/lib/analytics/types";
import {
  PRELIMINARY_INFO_VERSION,
  DISTANCE_CONTRACT_VERSION,
} from "@/lib/config/distance-contract";
import { giftCardReservationDecision } from "@/lib/config/gift-card-reservation";
import {
  CARD_DEADLINE_HOURS,
  HAVALE_DEADLINE_HOURS,
  HAVALE_REMINDER_HOURS,
  getBankDetails,
} from "@/lib/config/payment";
import { MAX_AMOUNT_KURUS, allocatePaytrBasket } from "@/lib/config/prices";
import { computeQuote } from "@/lib/config/quote-compute";
import { checkoutBlockers, quotePermissions } from "@/lib/config/quote-policy";
import {
  computeTender,
  recordedPayableKurus,
  recordedPaymentMethod,
  type RecordedPaymentMethod,
  type Tender,
} from "@/lib/config/quote-tender";
import type {
  ComputedQuote,
  DfmCode,
  FrozenQuoteAddon,
  FrozenQuotePart,
  PricingSnapshot,
} from "@/lib/config/quote-types";
import { DEFAULT_TEMPLATE_SLUG } from "@/lib/create/design-templates";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import type { Locale } from "@/lib/i18n/types";
import {
  cardExpireJobId,
  getEmailQueue,
  getPaymentDeadlineQueue,
  havaleExpireJobId,
  havaleReminderJobId,
} from "@/lib/queue/queues";
import { emitQuoteChanged } from "@/lib/realtime/emit";
import { isFlagEnabled } from "@/lib/services/flags";
import { validateGiftCard } from "@/lib/services/gift-card";
import { countLiveGiftCardUses } from "@/lib/services/gift-card-usage";
import {
  GiftCardReservationError,
  insertGiftRedemptionTx,
  reserveGiftCardTx,
} from "@/lib/services/gift-card-reservation";
import { releaseDraftGiftReservationTx } from "@/lib/services/gift-credit-return";
import {
  deriveIdempotencyKey,
  withIdempotency,
} from "@/lib/services/idempotency";
import { buildDraftReference, promoteDraftToOrder } from "@/lib/services/order-draft";
import { buildMerchantOid, createPaytrToken } from "@/lib/services/paytr";
import { toPricingInputs } from "@/lib/services/quote-present";
import { QuoteServiceError, liveDraftForQuote } from "@/lib/services/quote-service";
import { rateLimitAsync } from "@/lib/services/rate-limit";
import { parseTaxId } from "@/lib/services/tax-id";
import { getClientIpFromRequest } from "@/lib/utils/request";
import type { QuoteCheckoutInput } from "@/lib/validators/quote-checkout";

/** `/api/orders` ile AYNI cevap şekli: ekran tek bir dalı bilir. */
export interface QuoteCheckoutResult {
  reference: string;
  /** `gift_card_full` müşterinin SEÇİMİ değil, zincirin SONUCUDUR. */
  paymentMethod: RecordedPaymentMethod;
  iframeUrl?: string;
  paytrToken?: string;
  redirectUrl?: string;
  /** Tahsil edilen tutar: hediye kartı ve havale indirimi düşülmüş (`payableKurus`). */
  finalAmountKurus: number;
  /** Hediye kartından karşılanan tutar; kart yoksa 0. Ekran fişi bunu yazar. */
  giftCardAmountKurus: number;
  /** true = tutarın tamamı karttan karşılandı ve taslak siparişe döndü. */
  autoConfirmed?: boolean;
  /** `autoConfirmed` ise doğan siparişin numarası. */
  orderNumber?: string;
  /**
   * Tamamı karşılanan taslak siparişe DÖNEMEDİ (`/api/orders:874–880` ile aynı
   * şekil): istek yine başarılı, taslak `pending` ve rezervasyon DURUYOR —
   * sipariş birkaç saniye sonra ya bakım turunda doğar, ya süre dolumunda
   * bakiye karta geri döner.
   */
  error?: string;
  /** true = yeni taslak açılmadı, bekleyen ödeme geri verildi. */
  reused: boolean;
}

/** Saatte on ödeme denemesi: PayTR token'ı ve e-posta maliyetli işlerdir. */
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 3_600_000;
const IDEMPOTENCY_TTL_SECONDS = 600;

type Draft = typeof orderDrafts.$inferSelect;

interface ResolvedInvoice {
  invoiceType: "individual" | "corporate";
  companyName: string | null;
  taxId: string | null;
  taxIdType: "vkn" | "tckn" | null;
  taxOffice: string | null;
  billingAddress: TurkishAddress | null;
}

/**
 * Fatura bilgisi teklife yazılmadan ÖNCE doğrulanır.
 *
 * Kurumsal fatura e-faturaya girer: unvanı, vergi dairesi ya da doğrulama
 * basamağı tutmayan bir VKN'yi kaydetmek, faturayı kesme anında (sipariş
 * çoktan ödenmişken) patlayan bir hatadır. Bireysel faturada TCKN isteğe
 * bağlıdır ama VERİLDİYSE doğrulanır — yarısı yazılmış bir kimlik numarası
 * hiç yazılmamış olandan kötüdür.
 */
function resolveInvoice(raw: QuoteCheckoutInput["invoice"]): ResolvedInvoice {
  const billingAddress = raw.billingAddress ?? null;
  const taxIdRaw = raw.taxId?.trim() ?? "";

  if (raw.type === "individual") {
    if (taxIdRaw === "") {
      return {
        invoiceType: "individual",
        companyName: null,
        taxId: null,
        taxIdType: null,
        taxOffice: null,
        billingAddress,
      };
    }
    const parsed = parseTaxId(taxIdRaw);
    if (!parsed.ok) throw invalidTaxId();
    return {
      invoiceType: "individual",
      companyName: null,
      taxId: parsed.normalized,
      taxIdType: parsed.type,
      taxOffice: null,
      billingAddress,
    };
  }

  const companyName = raw.companyName?.trim() ?? "";
  if (companyName === "") {
    throw new QuoteServiceError(
      "Kurumsal fatura için firma unvanı zorunludur.",
      400,
      "company_name_required"
    );
  }
  const taxOffice = raw.taxOffice?.trim() ?? "";
  if (taxOffice === "") {
    throw new QuoteServiceError(
      "Kurumsal fatura için vergi dairesi zorunludur.",
      400,
      "tax_office_required"
    );
  }
  const parsed = parseTaxId(taxIdRaw);
  if (!parsed.ok) throw invalidTaxId();
  return {
    invoiceType: "corporate",
    companyName,
    taxId: parsed.normalized,
    taxIdType: parsed.type,
    taxOffice,
    billingAddress,
  };
}

function invalidTaxId(): QuoteServiceError {
  // Cümle `quote-service.ts`'teki PATCH yoluyla BİREBİR aynı: müşteri aynı
  // alanı iki ekranda da düzeltiyor.
  return new QuoteServiceError(
    "VKN 10, TCKN 11 haneli olmalı ve doğrulama basamağı tutmalı.",
    400,
    "invalid_tax_id"
  );
}

/**
 * Siparişin `material` kolonu: BASKIN teknolojinin `order_material`ı.
 *
 * Atama motoru tek bir malzeme değeriyle üretici süzer (`resin` / `filament`),
 * oysa bir teklif iki teknolojiyi birden taşıyabilir. Baskınlık PARAYA göre
 * ölçülür (en büyük satır toplamı), eşitlikte adede, sonra parça sırasına
 * bakılır: siparişin ağırlığı nereye düşüyorsa atama da oraya gitmeli.
 * Karışık teklifin doğru çözümü "teknolojiye göre ayır"dır (spec §Özel
 * teklif türleri); bu yalnız ayrılmamış teklifin makul varsayılanıdır.
 */
function dominantOrderMaterial(
  snapshot: PricingSnapshot,
  parts: QuotePart[],
  computed: ComputedQuote
): "resin" | "filament" {
  const priced = new Map(computed.parts.map((p) => [p.id, p]));
  const weights = new Map<string, { kurus: number; units: number; first: number }>();
  parts.forEach((part, index) => {
    const price = priced.get(part.id)?.price;
    const row = weights.get(part.technologyKey) ?? { kurus: 0, units: 0, first: index };
    row.kurus += price?.ok ? price.lineKurus : 0;
    row.units += part.quantity;
    weights.set(part.technologyKey, row);
  });
  const winner = [...weights.entries()].sort(
    (a, b) => b[1].kurus - a[1].kurus || b[1].units - a[1].units || a[1].first - b[1].first
  )[0];
  const tech = winner
    ? snapshot.technologies.find((t) => t.key === winner[0])
    : undefined;
  // Katalogdan kalkmış bir teknoloji: reçine varsayılanı, siparişin akmasını
  // engellemez — admin sipariş ekranından değiştirebilir.
  return tech?.orderMaterial ?? "resin";
}

/**
 * Ödeme anında DONDURULAN parça tanımları.
 *
 * Üretici ve admin ekranları ile dosya bağlama işi bu satırı okur, canlı
 * `quote_parts`'ı değil: müşteri ödedikten sonra teklifini düzenleyemez ama
 * katalog ve adlar değişebilir, ve basılan şeyin tanımı ödenen tanım olmalı.
 */
function freezeParts(
  snapshot: PricingSnapshot,
  parts: QuotePart[],
  computed: ComputedQuote
): FrozenQuotePart[] {
  const priced = new Map(computed.parts.map((p) => [p.id, p]));
  return parts.map((part, index) => {
    const c = priced.get(part.id);
    if (!c || !c.price.ok || c.dfm.scaled === null) {
      // Buraya düşmek imkânsız: `checkoutBlockers` fiyatlanamayan parçayı
      // zaten durdurur. Yine de sessiz bir sıfır fiyat dondurmayalım.
      throw new QuoteServiceError(
        "Teklifin fiyatı hesaplanamadı — sayfayı yenileyip tekrar deneyin.",
        409,
        "price_unavailable"
      );
    }
    if (!part.canonicalStlKey) {
      throw new QuoteServiceError(
        "Bazı parçaların baskı dosyası henüz hazır değil — birkaç saniye sonra tekrar deneyin.",
        409,
        "canonical_missing"
      );
    }
    const tech = snapshot.technologies.find((t) => t.key === part.technologyKey);
    const material = snapshot.materials.find(
      (m) => m.key === part.materialKey && m.technologyKey === part.technologyKey
    );
    const color = material?.colors.find((c2) => c2.key === part.colorKey);
    const finish = snapshot.finishes.find(
      (f) =>
        f.key === part.finishKey &&
        (f.technologyKey === null || f.technologyKey === part.technologyKey)
    );
    const warnings: DfmCode[] = c.dfm.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.code);

    return {
      partId: part.id,
      position: index,
      name: part.name,
      fileName: part.fileName,
      sourceFormat: part.sourceFormat,
      canonicalStlKey: part.canonicalStlKey,
      thumbnailKey: part.thumbnailKey,
      drawingKey: part.drawingKey,
      drawingName: part.drawingName,
      scaleFactor: c.dfm.scaled.factor,
      technologyKey: part.technologyKey,
      // Ad çözülemezse anahtarın kendisi yazılır: boş bir hücre, üreticinin
      // neyi basacağını bilmemesi demektir.
      technologyName: tech?.name ?? part.technologyKey,
      materialKey: part.materialKey,
      materialName: material?.name ?? part.materialKey,
      colorName: color?.name ?? part.colorKey,
      colorHex: color?.hex ?? "#000000",
      finishKey: part.finishKey,
      finishName: finish?.name ?? part.finishKey,
      layerUm: part.layerUm,
      infillPct: part.infillPct,
      quantity: part.quantity,
      dimensionsMm: c.dfm.scaled.extentsMm,
      volumeCm3: c.dfm.scaled.volumeCm3,
      unitKurus: c.price.unitKurus,
      lineKurus: c.price.lineKurus,
      note: part.note,
      dfmWarnings: warnings,
    };
  });
}

/** Taslağın ödeme yöntemi; kolon teklif dışı bir değer taşırsa kart sayılır. */
function draftMethod(draft: Draft): "card" | "bank_transfer" {
  return draft.paymentMethod === "bank_transfer" ? "bank_transfer" : "card";
}

/** Bekleyen ödemenin müşteriye gösterilecek sayfası. */
function draftPaymentPath(draft: Draft): string {
  return draftMethod(draft) === "bank_transfer"
    ? `/havale/${draft.reference}`
    : `/pay/${draft.reference}`;
}

const METHOD_LABELS: Record<"card" | "bank_transfer", string> = {
  card: "kart",
  bank_transfer: "havale/EFT",
};

/**
 * Bekleyen taslağı MÜŞTERİ iptal edebilir mi?
 *
 * Yalnız "hiç başlamamış" kart taslağı: `paytr_test_mode` ilk başarılı
 * token'la yazılır (`/api/pay/[reference]/paytr` yeniden basımında da), yani
 * NULL olması müşterinin PayTR ekranını hiç görmediğinin kanıtıdır. Kolonun
 * yazımı ile token'ın tarayıcıya dönüşü arasındaki AÇIK aralık da güvenli:
 * `runCheckout` o yazımı `status = 'pending'` koşuluna bağlar ve satır
 * tutmazsa 409 `draft_cancelled` atar, yani bu arada iptal edilen taslağın
 * token'ı müşteriye HİÇ ulaşmaz (aksi hâlde ödenen ama siparişe dönmeyen
 * bir taslak kalırdı). Havale
 * taslağı iptal edilmez: IBAN talimatı gönderilmiş, hatırlatma/süre işleri
 * kuyruğa girmiştir ve müşteri parayı yollamış olabilir. Terfi etmiş taslak da
 * dışarıda: siparişi olan bir ödemeyi iptal etmek iade motorunun işidir.
 *
 * HEDİYE KARTI REZERVASYONU KAPIYI KAPATMAZ (ve kapatmamalı): rezerve edilmiş
 * bakiye tam da kapının en çok gerektiği hâldir — taslak dururken teklif salt
 * okunur olduğu için müşteri ne ödeyebilir ne düzenleyebilir, üstelik parası
 * kartta kilitlidir. İptal, `releaseDraftGiftReservationTx` ile bakiyeyi AYNI
 * işlemde karta geri verir. `gift_card_full` taslağı da bu kapıdan geçer
 * (`draftMethod` onu kart sayar): tahsil edilecek nakdi olmayan ama siparişe de
 * dönememiş bir taslakta müşterinin tek çıkışı budur.
 */
function pendingDraftCancellable(draft: Draft): boolean {
  return (
    draft.status === "pending" &&
    draftMethod(draft) === "card" &&
    draft.paytrTestMode === null &&
    draft.promotedOrderId === null
  );
}

/** Bekleyen ödemenin cevabı: yeni token basılmaz, müşteri ödeme sayfasına gider. */
function reusedResult(draft: Draft): QuoteCheckoutResult {
  return {
    reference: draft.reference,
    paymentMethod: draftMethod(draft),
    // Kartta `/pay/<ref>` TAZE bir merchant oid ile yeni token basar: PayTR
    // aynı oid ile ikinci token vermez, bu yüzden burada token üretmek
    // müşteriyi çalışmayan bir iframe'e göndermek olurdu.
    redirectUrl: draftPaymentPath(draft),
    // Zincirin DONMUŞ sonucu okunur (yeniden hesaplanmaz): bu taslağın tutarları
    // ödeme anında yazıldı ve `/pay` ile `/havale` sayfaları da aynı kolonları
    // okuyor. Çıkarma zincirin kendi ters yönünden geçer — elle yazılmış bir
    // üçlü, zincire yeni bir indirim girdiği gün bayatlardı.
    finalAmountKurus: recordedPayableKurus(draft),
    giftCardAmountKurus: draft.giftCardAmountKurus,
    reused: true,
  };
}

interface FrozenCheckout {
  draft: Draft;
  quote: Quote;
  /** Taslağa YAZILAN tahsilat dökümü; tahsil edilen tutar buradan okunur. */
  tender: Tender;
  bankTransferDeadline: Date | null;
  /** Çerezlerden bir kez okunan pazarlama izi; olay kaydı da bunu kullanır. */
  attribution: Attribution;
}

/** Kartın reddi. Cümle `giftCard.error.*` sözlüğünden — `/api/orders` ile AYNI. */
type GiftCardRefusalCode =
  | "not_found"
  | "not_active"
  | "fully_used"
  | "expired"
  | "insufficient"
  | "limit_reached";

function giftCardRefusal(code: GiftCardRefusalCode, locale: Locale): QuoteServiceError {
  // İkinci bir cümle YAZILMAZ: müşteri aynı kartı `/api/orders` ödemesinde de
  // deneyebilir ve iki yolda farklı bir açıklama görmesi için hiçbir sebep yok.
  const d = getDictionary(locale);
  return new QuoteServiceError(d[`giftCard.error.${code}`], 400, `gift_card_${code}`);
}

/**
 * Kart kodunu ödeme İŞLEMİNE GİRMEDEN çözer: bayrak kapısı + `validateGiftCard`.
 *
 * Rezervasyon yapmaz, kilit almaz — kartın gerçek kapısı işlem içindeki
 * `reserveGiftCardTx`tir (kilitli bakiye). Buradaki ön kontrolün işi, kodu
 * yanlış yazan müşteriye taslak açılmadan DOĞRU cümleyi söylemek.
 *
 * Bayrak kapalıyken kod gelirse istek 400 ile döner: sessizce yok saymak,
 * müşterinin kartı uygulandı sanarak TAM tutarı ödemesi demek olurdu.
 */
async function resolveGiftCard(
  code: string | undefined,
  locale: Locale
): Promise<{ id: string } | null> {
  if (code === undefined) return null;
  return resolveGiftCardCode(code, locale);
}

/**
 * Kodu kart KİMLİĞİNE çevirir (kod VERİLMİŞ hâl).
 *
 * Ayrı durmasının sebebi ön izleme ucu: orada kod zorunludur ve `null` dönüşü
 * olmayan bir imza gerekiyor — çağıranın var olmayan bir dalı elemek için `!`
 * yazması, bir gün gerçekten null dönen bir değişiklikte sessizce çökerdi.
 */
async function resolveGiftCardCode(
  code: string,
  locale: Locale
): Promise<{ id: string }> {
  if (!(await isFlagEnabled("quote_gift_card_enabled"))) {
    throw new QuoteServiceError(
      "Hediye kartı bu ödemede kullanılamıyor.",
      400,
      "gift_card_disabled"
    );
  }
  const result = await validateGiftCard(code);
  // Kart kimliği YOKSA da reddedilir: `validateGiftCard`ın dönüşü ayırt edici
  // değil (`valid: boolean`), ve kimliksiz bir "geçerli" cevapla devam etmek
  // rezervasyonu bambaşka bir karta yazma riski demek olurdu.
  if (!result.valid || !result.card) {
    throw giftCardRefusal(result.error ?? "not_found", locale);
  }
  return { id: result.card.id };
}

/** Bir ödeme yönteminin ön izlemedeki iki rakamı. */
export interface QuoteGiftCardMethodPreview {
  havaleDiscountKurus: number;
  payableKurus: number;
}

/**
 * Ödeme ÖNCESİ hediye kartı ön izlemesi. Rezervasyon YOK, kilit YOK, yazım YOK.
 *
 * Neden sunucuda: ekranda para aritmetiği yoktur (dosya başı, kural 1'in
 * kardeşi). Müşterinin "ödeyeceğim tutar" olarak gördüğü rakam MSY m.6/2-a'nın
 * konusudur ve tahsil edilen tutarla birebir aynı olmak zorundadır — ekranda
 * yapılan bir çıkarma, zincire yeni bir indirim girdiği gün sessizce bayatlardı.
 *
 * İKİ YÖNTEM BİRDEN döner: müşteri kart ile havale arasında geçerken ikinci bir
 * istek atmak (ve o istekle ikinci bir kod denemesi harcamak) gerekmesin.
 * Hediye kartı adımı yöntem dalından ÖNCE geldiği için (`TENDER_STEP_ORDER`)
 * karşılanan tutar ile tam karşılama iki yöntemde de aynıdır; bu yüzden tek
 * kez, üst seviyede durur.
 */
export interface QuoteGiftCardPreview {
  /** Ekranın tek ayırt edicisi: red yolu 400 ile döner, bu gövde hiç gelmez. */
  valid: true;
  /** Kartın normalleştirilmiş (büyük harfli) kodu. */
  code: string;
  balanceKurus: number;
  /** Hediye kartından karşılanacak tutar; iki yöntemde de aynı. */
  giftCardAmountKurus: number;
  fullyCovered: boolean;
  card: QuoteGiftCardMethodPreview;
  bankTransfer: QuoteGiftCardMethodPreview;
}

/**
 * Ön izleme ucunun kendi oran limiti.
 *
 * Kart kodları kısa ve tahmin edilebilir; uç oturum + sahiplik arkasında olsa
 * bile jetonsuz bir ön izleme, kendi teklifini açan bir hesabın elinde kod
 * tarayıcısına dönerdi. Ödeme limitinden (`RATE_LIMIT`) ayrı bir kova: ön
 * izleme denemeleri müşterinin gerçek ödeme hakkını yemez.
 */
export const GIFT_PREVIEW_RATE_LIMIT = 20;

export async function previewQuoteGiftCard(args: {
  quoteId: string;
  userId: string;
  code: string;
  req: NextRequest;
}): Promise<QuoteGiftCardPreview> {
  const limited = await rateLimitAsync(
    `quote-gift-preview:user:${args.userId}`,
    GIFT_PREVIEW_RATE_LIMIT,
    RATE_WINDOW_MS
  );
  if (!limited.success) {
    throw new QuoteServiceError(
      "Çok fazla hediye kartı denemesi yapıldı. Lütfen bir süre sonra tekrar deneyin.",
      429,
      "rate_limited"
    );
  }

  const locale = getRequestLocale(args.req);
  const resolved = await resolveGiftCardCode(args.code, locale);

  const [quote] = await db.select().from(quotes).where(eq(quotes.id, args.quoteId)).limit(1);
  if (!quote) throw new QuoteServiceError("Teklif bulunamadı.", 404, "quote_not_found");
  // Sahiplik ucun kapısıdır; burada İKİNCİ kez sorulur çünkü fiyat sunucudan
  // çıkıyor ve bu servis (test, ileride başka bir uç) ucun dışından da çağrılabilir.
  if (quote.userId !== args.userId) {
    throw new QuoteServiceError("Bu teklif hesabınıza bağlı değil.", 403, "not_owner");
  }

  const parts = await db
    .select()
    .from(quoteParts)
    .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)))
    .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt));
  const computed = computeQuote(quote.pricingSnapshot, toPricingInputs(parts), {
    leadTier: quote.leadTier,
    addonKeys: quote.addonKeys,
  });
  const totals = computed.totals;
  // Cümleler ödeme yoluyla BİREBİR aynı: aynı hâli iki ekranda iki türlü
  // anlatmanın müşteriye faydası yok.
  if (!totals.allPriced || totals.leadDays === null) {
    throw new QuoteServiceError(
      "Teklifin fiyatı hesaplanamadı — sayfayı yenileyip tekrar deneyin.",
      409,
      "price_unavailable"
    );
  }
  const amountKurus = totals.totalKurus;
  if (amountKurus <= 0 || amountKurus > MAX_AMOUNT_KURUS) {
    throw new QuoteServiceError(
      "Sipariş tutarı geçersiz (0 ile ₺2.000.000 arasında olmalı).",
      400,
      "amount_out_of_range"
    );
  }

  // Kartın satırı KİLİTSİZ okunur: ön izleme bir söz değil, bir gösterimdir ve
  // gerçek kapı ödeme anındaki kilitli rezervasyondur. Satır yine de okunmak
  // zorunda, çünkü reddin tek yetkilisi karar modülüdür ve ona kartın kendi
  // hâli (bakiye, durum, süre, limit) girdi olarak verilir. Burada ikinci bir
  // bakiye kapısı yazmak, "aynı kart ön izlemede geçer, ödemede reddedilir"
  // hâlini açardı.
  const [card] = await db.select().from(giftCards).where(eq(giftCards.id, resolved.id)).limit(1);
  if (!card) throw giftCardRefusal("not_found", locale);

  const havaleDiscountApplies = quote.pricingSnapshot.settings.havaleDiscountApplies;
  const asCard = computeTender({
    amountKurus,
    paymentMethod: "card",
    giftCardBalanceKurus: card.balanceKurus,
    havaleDiscountApplies,
  });
  const asBankTransfer = computeTender({
    amountKurus,
    paymentMethod: "bank_transfer",
    giftCardBalanceKurus: card.balanceKurus,
    havaleDiscountApplies,
  });
  const decision = giftCardReservationDecision({
    card,
    // Limit sayımı yalnız limitli kartta okunur (`validateGiftCard` ile aynı
    // ölçü); limitsiz kartta sorgu hiç açılmaz.
    liveUses: card.maxRedemptions === null ? 0 : await countLiveGiftCardUses(db, card.id),
    reserveKurus: asCard.giftCardAmountKurus,
    now: new Date(),
  });
  if (!decision.ok) throw giftCardRefusal(decision.code, locale);

  return {
    valid: true,
    code: card.code,
    balanceKurus: card.balanceKurus,
    giftCardAmountKurus: asCard.giftCardAmountKurus,
    fullyCovered: asCard.fullyCoveredByGiftCard,
    card: {
      havaleDiscountKurus: asCard.havaleDiscountKurus,
      payableKurus: asCard.payableKurus,
    },
    bankTransfer: {
      havaleDiscountKurus: asBankTransfer.havaleDiscountKurus,
      payableKurus: asBankTransfer.payableKurus,
    },
  };
}

/**
 * Teklifi kilitler, politikayı uygular, fiyatı yeniden hesaplar ve taslağı
 * yazar. PayTR / e-posta / kuyruk işleri İŞLEM DIŞINDA kalır: bir HTTP
 * çağrısı, veritabanı işlemi açıkken beklenecek en kötü şeydir.
 */
async function freezeCheckout(args: {
  quoteId: string;
  userId: string;
  email: string;
  customerName: string;
  input: QuoteCheckoutInput;
  req: NextRequest;
}): Promise<FrozenCheckout | { reused: Draft }> {
  const { input } = args;
  const attribution = attributionFromRequest(args.req);
  const attrCols = attributionColumns(attribution);
  const locale = getRequestLocale(args.req);
  // `/api/orders` ile aynı ifade: bilinmiyorsa kolon NULL kalır (denetim izi
  // "0.0.0.0" gibi uydurma bir değer taşımamalı).
  const consentIp =
    args.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    args.req.headers.get("x-real-ip") ||
    null;
  const consentUserAgent = args.req.headers.get("user-agent")?.slice(0, 500) ?? null;
  // Kod İŞLEM DIŞINDA çözülür (`/api/orders:615–622` ile aynı sıra): geçersiz
  // bir kod yüzünden teklif satırını kilitlemenin ve geri almanın anlamı yok.
  const giftCard = await resolveGiftCard(input.giftCardCode, locale);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(eq(quotes.id, args.quoteId))
      .for("update");
    if (!quote) throw new QuoteServiceError("Teklif bulunamadı.", 404, "quote_not_found");
    if (quote.userId !== args.userId) {
      throw new QuoteServiceError("Bu teklif hesabınıza bağlı değil.", 403, "not_owner");
    }

    // Bekleyen ödeme AYNI referansla geri verilir: ikinci bir taslak, ikinci
    // bir tahsilat riskidir ve teklifin kilidini de ikiye bölerdi.
    const live = await liveDraftForQuote(quote.id, tx);
    if (live) {
      const [existing] = await tx
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.id, live.draftId))
        .limit(1);
      if (existing) {
        // …ama YÖNTEM aynıysa. Bekleyen kart taslağını havale isteyen bir
        // isteğe geri vermek, müşteriyi indirimsiz tutarla ve IBAN'sız bir
        // "Kart ile Öde" sayfasına yollamaktır (aynası da doğru: havale
        // taslağı + "Kart" = yalnız IBAN gösteren sayfa). Yöntemi YERİNDE
        // değiştirmek ucuz değil — havale indirimi, son tarih ve
        // hatırlatma/süre işleri yeniden kurulmalı — bu yüzden dürüst cevap
        // 409'dur; çıkış kapısı `cancelPendingQuoteCheckout`.
        if (draftMethod(existing) !== input.paymentMethod) {
          const label = METHOD_LABELS[draftMethod(existing)];
          const way = pendingDraftCancellable(existing)
            ? " Yöntemi değiştirmek için teklif sayfasından bekleyen ödemeyi iptal edin."
            : "";
          throw new QuoteServiceError(
            `Bu teklif için ${label} ile başlatılmış bekleyen bir ödeme var. ` +
              `Aynı yöntemle devam edin: ${draftPaymentPath(existing)}.${way}`,
            409,
            "pending_other_method"
          );
        }
        return { reused: existing };
      }
    }

    const now = new Date();
    const permissions = quotePermissions(
      { status: quote.status, expiresAt: quote.expiresAt, orderId: quote.orderId },
      { hasLiveDraft: false, now }
    );
    if (!permissions.canCheckout) {
      throw new QuoteServiceError(
        permissions.blockedReason ?? "Bu teklif şu anda ödenemez.",
        409,
        "checkout_blocked"
      );
    }

    const parts = await tx
      .select()
      .from(quoteParts)
      .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)))
      .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt));
    const inputs = toPricingInputs(parts);
    const computed = computeQuote(quote.pricingSnapshot, inputs, {
      leadTier: quote.leadTier,
      addonKeys: quote.addonKeys,
    });
    // Engelleri POLİTİKA sayar: ham `dfm.blocking` tek parçanın hâlidir ve
    // onaylanmamış uyarıyı, teklif düzeyindeki tavanı ya da eksik sözleşme
    // onayını görmez.
    const blockers = checkoutBlockers(computed, inputs, {
      termsAccepted: quote.termsAcceptedAt !== null,
      expired: quote.status === "expired" || now.getTime() > quote.expiresAt.getTime(),
      // Ekranla AYNI cevap (`quote-present.ts`): admin'in elle fiyatladığı
      // teklif anlık fiyat tavanından muaftır. Gerçek ödeme tavanı aşağıdaki
      // `MAX_AMOUNT_KURUS` kontrolüdür ve bu muafiyet ona dokunmaz.
      adminPriced: quote.status === "quoted",
    });
    if (blockers.length > 0) {
      throw new QuoteServiceError(blockers.join(" "), 400, "checkout_blocked");
    }

    if (input.expectedVersion !== quote.version) {
      throw new QuoteServiceError(
        "Teklif siz ödeme sayfasındayken değişti; sayfayı yenileyip tekrar deneyin.",
        409,
        "version_conflict"
      );
    }
    const totals = computed.totals;
    if (!totals.allPriced || totals.leadDays === null) {
      throw new QuoteServiceError(
        "Teklifin fiyatı hesaplanamadı — sayfayı yenileyip tekrar deneyin.",
        409,
        "price_unavailable"
      );
    }
    if (input.expectedTotalKurus !== totals.totalKurus) {
      throw new QuoteServiceError(
        "Teklif tutarı güncellendi; sayfayı yenileyip yeni tutarı onaylayın.",
        409,
        "total_mismatch"
      );
    }

    const amountKurus = totals.totalKurus;
    if (amountKurus <= 0 || amountKurus > MAX_AMOUNT_KURUS) {
      throw new QuoteServiceError(
        "Sipariş tutarı geçersiz (0 ile ₺2.000.000 arasında olmalı).",
        400,
        "amount_out_of_range"
      );
    }

    const invoice = resolveInvoice(input.invoice);
    // Fatura bilgisi ve PO teklife AYNI işlemde yazılır: fatura bir siparişin
    // değil teklifin özelliğidir (belge, e-fatura ve admin ekranı onu
    // `orders.quote_id` üzerinden okur).
    await tx
      .update(quotes)
      .set({
        invoiceType: invoice.invoiceType,
        companyName: invoice.companyName,
        taxId: invoice.taxId,
        taxIdType: invoice.taxIdType,
        taxOffice: invoice.taxOffice,
        billingAddress: invoice.billingAddress,
        ...(input.poNumber !== undefined
          ? { poNumber: input.poNumber.trim() || null }
          : {}),
        updatedAt: now,
      })
      .where(eq(quotes.id, quote.id));

    const reference = buildDraftReference();
    // TAHSİLAT ZİNCİRİ: hediye kartı → havale indirimi → tahsil edilen tutar.
    // İndirim AYARA bağlı (B2B tutarlarında %3, ortak payından değil platformun
    // payından çıkar; karar katalog ayarında ve teklifin snapshot'ında donmuş)
    // ve kartın düştüğü NAKİT üzerinden hesaplanır — brütten hesaplamak
    // `hediye + indirim > brüt` hâlini mümkün kılar ve o siparişin iadesi
    // `refundTenderBasis` tarafından KALICI olarak reddedilir.
    const havaleDiscountApplies = quote.pricingSnapshot.settings.havaleDiscountApplies;
    let tender: Tender;
    if (giftCard) {
      // Kart kilidi taslak insert'inden ÖNCE, kullanım kaydı SONRA
      // (`/api/orders` sırası): ters sıra, yarış hâlinde limiti aşmaya izin
      // verirdi. Rezervasyon ile taslak AYNI işlemde, yani bakiye ancak taslak
      // gerçekten yazıldıysa düşer.
      try {
        tender = await reserveGiftCardTx(tx, {
          giftCardId: giftCard.id,
          amountKurus,
          paymentMethod: input.paymentMethod,
          havaleDiscountApplies,
          now,
        });
      } catch (err) {
        if (err instanceof GiftCardReservationError) throw giftCardRefusal(err.code, locale);
        throw err;
      }
    } else {
      tender = computeTender({
        amountKurus,
        paymentMethod: input.paymentMethod,
        giftCardBalanceKurus: 0,
        havaleDiscountApplies,
      });
    }
    // Tamamı karttan karşılandıysa taslağa yazılan yöntem `gift_card_full`
    // olur: PayTR de havale de hiç açılmaz, taslak doğrudan siparişe terfi eder.
    const paymentMethod = recordedPaymentMethod(input.paymentMethod, tender);
    const bankTransferDeadline =
      paymentMethod === "bank_transfer"
        ? new Date(now.getTime() + HAVALE_DEADLINE_HOURS * 3600 * 1000)
        : null;

    const [draft] = await tx
      .insert(orderDrafts)
      .values({
        reference,
        userId: args.userId,
        // Teklif siparişinin modeli `uploaded_models`'ta DEĞİL, parçalarda
        // durur; bağ `quote_checkouts.draft_id` üzerinden kurulur.
        uploadedModelId: null,
        email: args.email,
        customerName: args.customerName,
        phone: input.shippingAddress.telefon,
        figurineSize: null,
        style: DEFAULT_TEMPLATE_SLUG,
        material: dominantOrderMaterial(quote.pricingSnapshot, parts, computed),
        finish: "raw",
        orderType: "upload",
        productTitleSnapshot: `Teklif ${quote.number} (${parts.length} parça)`,
        // Kalemler `quote_checkouts.parts_snapshot`ta durur. `/pay` sayfası
        // `selected_addons`ı satır satır listeler ve havale indirimi
        // uygulandığında o liste toplamı tutmazdı.
        selectedAddons: null,
        quantity: parts.reduce((sum, part) => sum + part.quantity, 0),
        shippingAddress: input.shippingAddress,
        locale,
        // BRÜT tutar: hediye kartı ve havale indirimi onu düşürmez, tahsil
        // edilen nakdi düşürür. Kalem/hakediş tabanı da brütten türer.
        amountKurus,
        giftCardId: giftCard?.id ?? null,
        giftCardAmountKurus: tender.giftCardAmountKurus,
        havaleDiscountKurus: tender.havaleDiscountKurus,
        upsells: null,
        upsellAmountKurus: 0,
        // Teklif siparişinde boyama YOKTUR: boyalı yüzey manuel fiyata gider
        // (spec §Özel teklif türleri), bu yüzden tutarın tamamı üretim payıdır.
        needsPainting: false,
        paintingPriceKurus: 0,
        productionBaseKurus: amountKurus,
        paymentMethod,
        status: "pending",
        paytrMerchantOid: paymentMethod === "card" ? buildMerchantOid(reference) : null,
        bankTransferDeadline,
        // Görsel/kişilik hakları onayı teklifte İSTENMEZ: müşteri fotoğraf
        // göndermez, kendi CAD dosyasını yükler ve tasarım hakkı onayını
        // teklifi açarken verir (`quotes.terms_accepted_at`).
        contentConsentAt: null,
        contentConsentVersion: null,
        preliminaryInfoAcceptedAt: now,
        preliminaryInfoVersion: PRELIMINARY_INFO_VERSION,
        distanceContractVersion: DISTANCE_CONTRACT_VERSION,
        consentIp,
        consentUserAgent,
        ...attrCols,
      })
      .returning();

    // Rezervasyonun KANIT satırı taslaktan SONRA: `draft_id`ye ihtiyaç duyar ve
    // kısmi tekil indeks taslak başına tek CANLI kullanıma izin verir. İade
    // yolları (`expireDraft` → `refundGiftCardForDraft`, `gift-credit-return`)
    // bakiyeyi bu satır üzerinden geri veriyor, yani satır yazılmazsa
    // rezervasyon kartta KİLİTLİ kalırdı.
    if (giftCard && tender.giftCardAmountKurus > 0) {
      await insertGiftRedemptionTx(tx, {
        giftCardId: giftCard.id,
        draftId: draft.id,
        amountKurus: tender.giftCardAmountKurus,
        userId: args.userId,
      });
    }

    const addonsSnapshot: FrozenQuoteAddon[] = totals.addonLines.map((line) => ({
      key: line.key,
      name: line.name,
      kurus: line.kurus,
    }));
    await tx.insert(quoteCheckouts).values({
      quoteId: quote.id,
      draftId: draft.id,
      quoteVersion: quote.version,
      amountKurus,
      partsSnapshot: freezeParts(quote.pricingSnapshot, parts, computed),
      addonsSnapshot,
      leadTier: quote.leadTier,
      leadDays: totals.leadDays,
    });

    return { draft, quote, tender, bankTransferDeadline, attribution };
  });
}

/**
 * Ödemeyi başlatır: taslağı yazar, sonra PayTR token'ını ya da havale
 * talimatını üretir.
 *
 * Idempotency KAPIDA durur: aynı gövdeyle iki kez tıklayan müşteri iki PayTR
 * token'ı ve iki e-posta almamalı. Oran limiti ise idempotency'nin İÇİNDE —
 * tekrar oynatılan bir cevap hiçbir maliyetli iş yapmaz, bu yüzden jeton da
 * yememeli. Domain tarafında ikinci bir koruma daha var (canlı taslak aynı
 * referansı döndürür), ama o ancak ilk işlem commit olduktan sonra görünür.
 */
export async function createQuoteCheckout(args: {
  quoteId: string;
  userId: string;
  email: string;
  input: QuoteCheckoutInput;
  req: NextRequest;
}): Promise<QuoteCheckoutResult> {
  // Anahtar HER ZAMAN türetilir; başlık yalnız bir GİRDİDİR. Başlığı anahtarın
  // KENDİSİ yapmak, hemen altındaki gerekçeyi (teklif kimliği de özete girsin)
  // paylaşılan `quotes.checkout` kapsamında iptal ederdi: aynı dizgiyi gönderen
  // iki çağıran çakışır ve ikincisine birincinin taslak referansı + PayTR
  // token'ı TEKRAR OYNATILIR.
  //
  // Türetilen anahtar TEKLİFİN KİMLİĞİNİ de özetler. `QuoteCheckoutInput`
  // hangi teklifin ödendiğini SÖYLEMEZ (sürüm, tutar, adres, yöntem, fatura);
  // yalnız gövdeyi özetlersek, başlık göndermeyen bir istemcide aynı
  // kullanıcının aynı biçimli İKİ FARKLI teklifi tek anahtara çöker ve ikinci
  // ödeme birincinin referansı + PayTR iframe'iyle TEKRAR OYNATILIR — ikinci
  // teklif hiç taslak görmeden "başarılı" görünür. `/api/orders` bu deliğe
  // düşmez, çünkü onun gövdesi ürün kimliğini taşır (route.ts:131).
  const raw = args.req.headers.get("idempotency-key");
  const header = raw && raw.length >= 8 && raw.length <= 200 ? raw : null;
  const key = deriveIdempotencyKey(
    { quoteId: args.quoteId, header, input: header ? undefined : args.input },
    args.userId
  );

  const outcome = await withIdempotency<QuoteCheckoutResult>({
    scope: "quotes.checkout",
    key,
    ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
    // Oran limiti İŞİN İÇİNDE: dürüst bir tekrar (aynı anahtar, aynı gövde)
    // hiç iş yapmadan saklı cevabı alır ve sayaçtan jeton YEMEMELİ. Dışarıda
    // dururken on tekrar, taslağı çoktan açılmış bir teklifte bir saatlik 429
    // demekti.
    run: async () => {
      const limited = await rateLimitAsync(
        `quote-checkout:user:${args.userId}`,
        RATE_LIMIT,
        RATE_WINDOW_MS
      );
      if (!limited.success) {
        throw new QuoteServiceError(
          "Çok fazla ödeme denemesi yapıldı. Lütfen bir süre sonra tekrar deneyin.",
          429,
          "rate_limited"
        );
      }
      return runCheckout(args);
    },
  });
  if (outcome.status === "in_progress") {
    throw new QuoteServiceError(
      "Bu teklif için bir ödeme isteği hâlâ işleniyor; birkaç saniye sonra tekrar deneyin.",
      409,
      "in_progress"
    );
  }
  return outcome.value;
}

async function runCheckout(args: {
  quoteId: string;
  userId: string;
  email: string;
  input: QuoteCheckoutInput;
  req: NextRequest;
}): Promise<QuoteCheckoutResult> {
  const [user] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  if (!user) {
    throw new QuoteServiceError(
      "Hesabınız bulunamadı; çıkış yapıp yeniden giriş yapın.",
      401,
      "user_not_found"
    );
  }

  const frozen = await freezeCheckout({ ...args, customerName: user.fullName });
  if ("reused" in frozen) {
    // Tamamı karttan karşılanmış ama siparişe DÖNEMEMİŞ taslak: tahsil edilecek
    // nakit yok, yani müşteriyi 0 TL'lik bir "kart ile öde" sayfasına yollamak
    // (`draftMethod` `gift_card_full`ü kart sayar) hem anlamsız hem PayTR'da
    // sıfır tutarlı bir token denemesi olurdu. Doğru davranış terfiyi YENİDEN
    // denemek: `promoteDraftToOrder` idempotenttir, bakım turu da aynı işi
    // yapar ve müşteri onu beklemek zorunda değil.
    if (frozen.reused.paymentMethod === "gift_card_full") {
      return promoteGiftCoveredDraft(frozen.reused, { reused: true });
    }
    return reusedResult(frozen.reused);
  }

  const { draft, quote, tender, bankTransferDeadline, attribution } = frozen;

  // Teklif artık kilitli (canlı taslak): açık duran sekmeler bunu görmeli.
  emitQuoteChanged({ quoteId: quote.id, userId: quote.userId });

  // Tutarın TAMAMI hediye kartından karşılandı: ne PayTR ne havale: taslak
  // doğrudan siparişe döner (`/api/orders:866–880` ile aynı şekil). Ödeme
  // başlatılmadığı için `add_payment_info` da YAZILMAZ — satın alma olayını
  // terfi kaydeder (`promoteDraftToOrder` → `recordPurchase`).
  if (tender.fullyCoveredByGiftCard) {
    return promoteGiftCoveredDraft(draft, { reused: false });
  }

  // Sunucu gerçeği "ödeme başlatıldı". Tarayıcının verdiği kimlik varsa aynı
  // kimlikle kaydedilir ki piksel ile bu kayıt Meta/TikTok'ta tekilleşsin.
  //
  // Tutar müşterinin GERÇEKTEN ödeyeceği tutardır (hediye kartı ve havale
  // indirimi düşülmüş): tarayıcı `add_payment_info`'yu zaten bu değerle
  // yolluyor ve platformlar aynı kimlikli iki kayıttan birini atıyor — brüt
  // yazmak, havale dönüşümlerinin rastgele %3 sapmasına yol açıyordu.
  const finalAmountKurus = tender.payableKurus;
  void recordEvent({
    name: "add_payment_info",
    eventId: args.input.analyticsEventId ?? `payinit:${draft.reference}`,
    source: "server",
    reference: draft.reference,
    valueKurus: finalAmountKurus,
    userId: args.userId,
    attribution,
    consent: attribution.consent ?? null,
    visitorId: attribution.visitorId ?? null,
    sessionId: attribution.sessionId ?? null,
    user: { email: args.email, phone: args.input.shippingAddress.telefon },
  }).catch(() => {});

  if (draft.paymentMethod === "bank_transfer") {
    const bank = getBankDetails();
    const paymentQueue = getPaymentDeadlineQueue();
    await paymentQueue.add(
      "havale-reminder",
      { draftId: draft.id, reference: draft.reference, type: "havale_reminder" },
      { jobId: havaleReminderJobId(draft.id), delay: HAVALE_REMINDER_HOURS * 3600 * 1000 }
    );
    await paymentQueue.add(
      "havale-expire",
      { draftId: draft.id, reference: draft.reference, type: "havale_expire" },
      { jobId: havaleExpireJobId(draft.id), delay: HAVALE_DEADLINE_HOURS * 3600 * 1000 }
    );
    await getEmailQueue().add("send-email", {
      type: "bank_transfer_instructions",
      to: args.email,
      orderNumber: draft.reference,
      customerName: draft.customerName,
      bankName: bank.bankName,
      bankAccountHolder: bank.accountHolder,
      bankIban: bank.iban,
      bankBranch: bank.branch,
      paymentAmountKurus: finalAmountKurus,
      paymentDeadline: bankTransferDeadline?.toISOString(),
      locale: draft.locale,
    });
    return {
      reference: draft.reference,
      paymentMethod: "bank_transfer",
      redirectUrl: `/havale/${draft.reference}`,
      finalAmountKurus,
      giftCardAmountKurus: tender.giftCardAmountKurus,
      reused: false,
    };
  }

  // HER kart taslağı için son tarih işi (plan düzeltmesi): teklif canlı
  // taslağı varken salt okunurdur, yani terk edilmiş bir iframe teklifi
  // sonsuza dek kilitler ve müşteri havaleye de geçemezdi. `/api/orders` bu
  // işi yalnız hediye kartı rezervasyonunda kuyruğa alır.
  //
  // Token'dan ÖNCE kuyruğa alınır: PayTR reddederse taslak `pending` kalıyor
  // ve kilidi açacak tek şey bu iş oluyor — token'dan sonra sıraya koymak,
  // tam da kurtarmayı en çok gereken hâlde onu atlardı.
  await getPaymentDeadlineQueue().add(
    "card-expire",
    { draftId: draft.id, reference: draft.reference, type: "card_expire" },
    { jobId: cardExpireJobId(draft.id), delay: CARD_DEADLINE_HOURS * 3600 * 1000 }
  );

  const address = draft.shippingAddress;
  // `try` YALNIZ token çağrısını sarar: altındaki koşullu yazım da buraya
  // girseydi, onun 409'u (aşağıda) `catch` tarafından yutulup "PayTR
  // başarısız" diye 502'ye çevrilirdi.
  let paytr: Awaited<ReturnType<typeof createPaytrToken>>;
  try {
    paytr = await createPaytrToken({
      orderNumber: draft.reference,
      email: args.email,
      // TAHSİL EDİLEN tutar: brüt geçmek sessiz çifte tahsilattır — webhook
      // tutar farkını yalnız LOGLAR, reddetmez.
      amountKurus: finalAmountKurus,
      userName: draft.customerName,
      userAddress: `${address.mahalle ? address.mahalle + ", " : ""}${address.adres}, ${address.ilce}/${address.il}`,
      userPhone: address.telefon,
      userIp: getClientIpFromRequest(args.req),
      // Sepet TEK satır: teklif kalemleri `parts_snapshot`ta durur ve
      // PayTR ekranında yirmi satırlık bir döküm göstermenin müşteriye
      // faydası yok (spec §Ödeme → sipariş, adım 5).
      basket: allocatePaytrBasket({
        paymentAmountKurus: finalAmountKurus,
        figurineName: `Teklif ${quote.number}`,
        upsellAmountKurus: 0,
        upsellKeys: [],
        upsellLabel: (k) => k,
      }),
      locale: draft.locale,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    console.error("PayTR token creation failed for quote draft", draft.reference, err);
    // Taslak `pending` KALIR: müşteri `/pay/<ref>` üzerinden tekrar
    // deneyebilsin (orada taze bir merchant oid ile yeni token basılır).
    // Koşul, arada iptal edilmiş taslağın iptal notunu ezmemek için.
    await db
      .update(orderDrafts)
      .set({ paytrFailureReason: `PayTR token error: ${reason}`, updatedAt: new Date() })
      .where(and(eq(orderDrafts.id, draft.id), eq(orderDrafts.status, "pending")));
    throw new QuoteServiceError(
      "Ödeme başlatılamadı. Teklif sayfasındaki bekleyen ödeme bağlantısından tekrar deneyebilirsiniz.",
      502,
      "paytr_failed"
    );
  }

  // KOŞULLU yazım: token basılırken taslak hâlâ bekliyor muydu?
  //
  // İki sekme: A kartla ödemeyi başlatır; PayTR cevaplarken B bekleyen
  // taslağı iptal eder — o an `paytr_test_mode` henüz NULL olduğu için
  // `pendingDraftCancellable` iptali geçirir. Koşulsuz yazım, iptal edilmiş
  // taslağın üstüne CANLI bir token yazar ve tarayıcıya iframe'i verirdi:
  // müşteri öder, webhook `promoteDraftToOrder`dan `DRAFT_NOT_PROMOTABLE`
  // alır ve tasarım gereği 200'le onaylar (`api/webhooks/paytr/route.ts`) —
  // para tahsil edilir, sipariş doğmaz, müşteriye hiçbir hata görünmez.
  // Satır tutmazsa token tarayıcıya HİÇ ulaşmaz; PayTR'daki oid ödenmeden
  // zaman aşımına uğrar.
  const [kept] = await db
    .update(orderDrafts)
    .set({
      paytrMerchantOid: paytr.merchantOid,
      paytrTestMode: paytr.testMode,
      updatedAt: new Date(),
    })
    .where(and(eq(orderDrafts.id, draft.id), eq(orderDrafts.status, "pending")))
    .returning({ id: orderDrafts.id });
  if (!kept) {
    throw new QuoteServiceError(
      "Bu ödeme iptal edildi; ödemeyi yeniden başlatın.",
      409,
      "draft_cancelled"
    );
  }

  return {
    reference: draft.reference,
    paymentMethod: "card",
    iframeUrl: paytr.iframeUrl,
    paytrToken: paytr.token,
    finalAmountKurus,
    giftCardAmountKurus: tender.giftCardAmountKurus,
    reused: false,
  };
}

/**
 * Tamamı hediye kartıyla karşılanan taslağı ANINDA siparişe çevirir.
 *
 * Tahsil edilecek nakit yok, yani bekleyecek bir ödeme de yok: taslağı `pending`
 * bırakmak, müşteriyi bakiyesi düşmüş ama siparişi olmayan bir teklifle baş başa
 * bırakmak olurdu.
 *
 * ÜÇ KAT KORUMA (tasarım §5.4), çünkü bu tek yerde para taslağa yazıldıktan
 * SONRA sipariş doğuyor:
 *  1. Terfi hemen denenir; patlarsa cevap `{autoConfirmed: false, error}` olur
 *     (istek yine başarılı). Taslak `pending` KALIR ve rezervasyon DURUR —
 *     serbest bırakmak yanlış olurdu, sipariş birkaç saniye sonra doğabilir.
 *  2. `card-expire` işi bu taslak için de kuyruğa girer (`/api/orders` ALMAZ):
 *     `CARD_DEADLINE_HOURS` sonunda `expireDraft` bakiyeyi karta geri yükler ve
 *     teklifin kilidini açar. İş, terfi denemesinden ÖNCE kuyruğa alınır — tam
 *     da kurtarmayı en çok gereken hâlde (terfi patladı) atlanmasın diye.
 *  3. Bakım turu terfi edemeyen `gift_card_full` taslağı yeniden dener
 *     (`quote-maintenance.ts`); `promoteDraftToOrder` idempotenttir.
 */
async function promoteGiftCoveredDraft(
  draft: Draft,
  opts: { reused: boolean }
): Promise<QuoteCheckoutResult> {
  // Aynı `jobId` ile ikinci bir ekleme BullMQ'da sessiz bir no-op'tur, yani
  // terfiyi yeniden denerken son tarih işi ikizlenmez.
  //
  // EN İYİ ÇABA: bakiye bu noktada ÇOKTAN düşmüş (rezervasyon commit oldu).
  // Kuyruk erişilemezken isteği patlatmak, müşteriye hem hata gösterip hem
  // siparişini yazmamak olurdu; oysa terfi buradan bağımsız çalışabilir.
  // Kalan ağ üçüncü korumadır (bakım turu terfi edemeyen taslağı bulur).
  try {
    await getPaymentDeadlineQueue().add(
      "card-expire",
      { draftId: draft.id, reference: draft.reference, type: "card_expire" },
      { jobId: cardExpireJobId(draft.id), delay: CARD_DEADLINE_HOURS * 3600 * 1000 }
    );
  } catch (err) {
    console.error(
      "Hediye kartıyla karşılanan taslak için son tarih işi kuyruğa alınamadı",
      draft.reference,
      err
    );
  }

  const base = {
    reference: draft.reference,
    paymentMethod: "gift_card_full" as const,
    // Taslağa YAZILAN dökümden okunur: hem taze rezervasyonda hem de terfiyi
    // yeniden denerken tek kaynak o satırdır.
    finalAmountKurus: recordedPayableKurus(draft),
    giftCardAmountKurus: draft.giftCardAmountKurus,
    reused: opts.reused,
  };
  try {
    const promoted = await promoteDraftToOrder(draft.id);
    return { ...base, autoConfirmed: true, orderNumber: promoted.orderNumber };
  } catch (err) {
    console.error(
      "Hediye kartıyla karşılanan teklif taslağı siparişe dönemedi",
      draft.reference,
      err
    );
    return {
      ...base,
      autoConfirmed: false,
      error:
        "Hediye kartınız kullanıldı ama sipariş kaydı tamamlanamadı. " +
        "Sipariş birkaç dakika içinde otomatik oluşturulacak; olmazsa bakiye " +
        "kartınıza geri yüklenir.",
    };
  }
}

/** Teklifin bekleyen ödemesi — ödeme sayfasının "ne yapabilirim"i. */
export interface PendingQuoteCheckout {
  reference: string;
  paymentMethod: "card" | "bank_transfer";
  /** Müşterinin ödemeye devam edeceği sayfa (`/pay/…` ya da `/havale/…`). */
  paymentUrl: string;
  /** Taslak iptal edilip başka bir yöntemle yeniden başlanabilir mi? */
  cancellable: boolean;
  /**
   * Bu bekleyen ödemede REZERVE edilmiş hediye kartı tutarı; kart yoksa 0.
   *
   * Ekran bunu "iptal ederseniz ₺X bakiyeniz kartınıza geri yüklenir" demek
   * için okur. Rakam taslağın DONMUŞ satırından gelir, ekranda hesaplanmaz.
   */
  giftCardAmountKurus: number;
}

/**
 * Bekleyen ödemeyi ÖZETLER (yazmaz).
 *
 * `/teklif/<n>/odeme` bunu okur: bekleyen bir ödeme varken koşulsuz
 * `/pay/<ref>`e yollamak, havale taslağını kart sayfasına düşürüyordu ve
 * yöntemini değiştirmek isteyen müşteriye hiçbir kapı bırakmıyordu.
 */
export async function pendingQuoteCheckout(
  quoteId: string
): Promise<PendingQuoteCheckout | null> {
  const live = await liveDraftForQuote(quoteId);
  if (!live) return null;
  const [draft] = await db
    .select()
    .from(orderDrafts)
    .where(eq(orderDrafts.id, live.draftId))
    .limit(1);
  if (!draft) return null;
  return {
    reference: draft.reference,
    paymentMethod: draftMethod(draft),
    paymentUrl: draftPaymentPath(draft),
    cancellable: pendingDraftCancellable(draft),
    giftCardAmountKurus: draft.giftCardAmountKurus,
  };
}

/**
 * Hiç başlamamış kart taslağını İPTAL eder ve teklifin kilidini açar.
 *
 * Yöntem değiştirmenin TEK çıkış kapısı budur: bekleyen taslak dururken teklif
 * salt okunurdur ve `createQuoteCheckout` farklı yöntemli isteği 409 ile
 * reddeder (`pending_other_method`), yani kapı olmasaydı müşteri
 * `CARD_DEADLINE_HOURS` boyunca karta kilitli kalırdı. Kapının dar tutulması
 * bilinçli: `pendingDraftCancellable` yalnız PayTR ekranını hiç görmemiş kart
 * taslağını geçirir.
 */
export async function cancelPendingQuoteCheckout(args: {
  quoteId: string;
  userId: string;
}): Promise<{ reference: string }> {
  const reference = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    // Kilit sırası `freezeCheckout` ile AYNI: önce teklif, sonra taslak.
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(eq(quotes.id, args.quoteId))
      .for("update");
    if (!quote) throw new QuoteServiceError("Teklif bulunamadı.", 404, "quote_not_found");
    if (quote.userId !== args.userId) {
      throw new QuoteServiceError("Bu teklif hesabınıza bağlı değil.", 403, "not_owner");
    }

    const live = await liveDraftForQuote(quote.id, tx);
    if (!live) {
      throw new QuoteServiceError(
        "Bu teklif için bekleyen bir ödeme yok.",
        409,
        "no_pending_draft"
      );
    }
    const [draft] = await tx
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, live.draftId))
      .for("update");
    if (!draft || !pendingDraftCancellable(draft)) {
      throw new QuoteServiceError(
        "Bu ödeme iptal edilemez; ödeme sayfasından devam edin.",
        409,
        "draft_not_cancellable"
      );
    }

    // Rezervasyon taslak HÂLÂ `pending` iken geri verilir (tasarım §5.3, adım 4):
    // `restoreGiftCreditTx` taslak kapsamında `status ∈ (pending,
    // awaiting_review)` ve `promoted_order_id IS NULL` arar, yani aşağıdaki
    // iptal yazımından SONRA çağırmak bakiyeyi kartta KİLİTLİ bırakırdı — ve
    // müşteri hem ödeyemez hem düzenleyemez hâlde, parası tutulmuş olurdu.
    // Kilit sırası da korunur: teklif → taslak → kart (`lockGiftRedemptionsTx`
    // kartları id sırasıyla kilitler), `freezeCheckout` ile aynı yön.
    // Rezervasyonu olmayan taslakta hiçbir şey yapmaz.
    await releaseDraftGiftReservationTx(tx, draft.id);

    // Koşullu yazım: son tarih işçisi ya da webhook araya girdiyse satır
    // tutmaz ve iptal SESSİZCE başarılı görünmez.
    const [cancelled] = await tx
      .update(orderDrafts)
      .set({
        status: "cancelled",
        paytrFailureReason: "Müşteri iptali: ödeme başlatılmadan vazgeçildi.",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orderDrafts.id, draft.id),
          eq(orderDrafts.status, "pending"),
          isNull(orderDrafts.promotedOrderId)
        )
      )
      .returning({ reference: orderDrafts.reference });
    if (!cancelled) {
      throw new QuoteServiceError(
        "Bu ödeme artık iptal edilemez; sayfayı yenileyin.",
        409,
        "draft_not_cancellable"
      );
    }
    return cancelled.reference;
  });

  // Teklif yeniden düzenlenebilir: açık duran sekmeler bunu görmeli.
  emitQuoteChanged({ quoteId: args.quoteId, userId: args.userId });
  return { reference };
}
