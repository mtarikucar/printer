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
 * REZERVASYON COMMIT OLDUKTAN SONRAKİ hiçbir arıza isteği düşürmez: o noktadan
 * itibaren kuyruk eklemelerinin hepsi `enqueueAfterCommit` üzerinden geçer
 * (bakiye düşmüşken müşteriye hata göstermek en kötü sonuçtur) ve kaybolan son
 * tarih işinin ağı bakım turunun `expireStrandedQuoteDrafts` aşamasıdır. Tek
 * istisna havale talimat MEKTUBUDUR: o ayrı bir kuyruğa (`email`) gider, bakım
 * turu onu yeniden göndermez; yerine geçen şey müşteriye dönen
 * `/havale/<ref>` yolu ve referanslı günlük satırıdır (çağrı yerinde yazılı).
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
  giftCardRedemptions,
  giftCards,
  orderDrafts,
  quoteCheckouts,
  quoteFrameworkBatches,
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
import {
  FRAMEWORK_PRICE_DRIFT_ERROR,
  frameworkBatchDriftCode,
} from "@/lib/config/quote-framework";
import { checkoutBlockers, quotePermissions } from "@/lib/config/quote-policy";
import {
  teamRoleCanCancelCheckout,
  teamRoleCanCheckout,
  type TeamRole,
} from "@/lib/config/quote-team";
import {
  computeTender,
  recordedPayableKurus,
  recordedPaymentMethod,
  type RecordedPaymentMethod,
  type Tender,
  type TenderInput,
  type TenderView,
  type TenderViews,
} from "@/lib/config/quote-tender";
import type {
  ComputedQuote,
  FrozenQuoteAddon,
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
// `freezeParts` BURADAN TAŞINDI (`quote-service.ts`): anlaşmanın
// `parts_snapshot`ı da o diziyi kullanıyor ve çerçeve servisi bu dosyayı
// IMPORT EDEMEZ (`attribution-server.ts` → `server-only`, standalone Node
// worker'ını crash-loop'a sokar). Gövde BİREBİR taşındı; ikinci bir dondurma
// yolu, kilitli fiyatın sürüklenmesinin en kısa yoludur.
import {
  QuoteServiceError,
  freezeParts,
  liveDraftForQuote,
  quoteHasLiveFramework,
} from "@/lib/services/quote-service";
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

/**
 * PARA KAPISININ TAKIM BAĞLAMI (0072) — çağıranın ÇÖZÜP geçirdiği yetki.
 *
 * Bu dosya `viewer` GÖRMEZ: erişim matrisi bir istek nesnesine ve oturuma
 * bakar, servis ise betikten, testten ve (yarın) ikinci bir uçtan da
 * çağrılabilir. Bu yüzden kimlik + ROL buraya parametre olarak gelir ve kararı
 * yine SAF yüklem verir (`teamRoleCanCheckout`). Bir `authorized: boolean`
 * geçmek, kararın NEREDE verildiğini kaybetmek olurdu: kapı o gün çağıranın
 * dikkatine kalırdı.
 *
 * `undefined` = takım bağlamı YOK → kapı yalnız KİŞİSEL sahipliğe açılır, yani
 * BUGÜNKÜ ifade. Fail-closed olması bilinçli: bağlamı geçirmeyi unutan bir
 * çağıran üyeye 403 verir (özellik çalışmaz), asla fazladan hak VERMEZ.
 */
export interface QuoteCheckoutActor {
  /** Ödeyenin BU TEKLİFİN takımındaki rolü; `null` = takım dalından gelmiyor. */
  role: TeamRole | null;
  /** Takımın `member_can_checkout` anahtarı (`QuoteAccess.team`den). */
  memberCanCheckout: boolean;
}

/**
 * Teklifi ÖDEME yetkisi — iki para kapısının (ön izleme + dondurma) TEK
 * ifadesi.
 *
 * Kişisel sahiplik ölçüsü BUGÜNKÜNÜN BİREBİR KENDİSİDİR (`quote.userId ===
 * args.userId`) ve takım dalından ÖNCE sorulur: takımı olmayan her teklifte
 * ifade bugünkü cevabı verir ve tek bir rol okuması bile yapılmaz.
 */
function actorMayCheckout(
  quote: { userId: string | null },
  args: { userId: string; actor?: QuoteCheckoutActor }
): boolean {
  if (quote.userId !== null && quote.userId === args.userId) return true;
  if (args.actor === undefined || args.actor.role === null) return false;
  return teamRoleCanCheckout(args.actor.role, {
    memberCanCheckout: args.actor.memberCanCheckout,
  });
}

/** Ödeme kapısının TEK ret cümlesi: iki yüzeyde iki farklı açıklama olmasın. */
function notAuthorizedToPay(): QuoteServiceError {
  return new QuoteServiceError("Bu teklifi ödeme yetkiniz yok.", 403, "not_owner");
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

/** Taslağın ödeme yöntemi; kolon teklif dışı bir değer taşırsa kart sayılır. */
function draftMethod(draft: Draft): "card" | "bank_transfer" {
  return draft.paymentMethod === "bank_transfer" ? "bank_transfer" : "card";
}

/**
 * Bekleyen ödemenin SUNUM yöntemi — `draftMethod` ile aynı şey DEĞİL.
 *
 * `draftMethod` 409 yöntem karşılaştırmasının ölçüsüdür ve `gift_card_full`ü
 * kart sayması DOĞRUdur: o taslak dururken müşteri ne kartla ne havaleyle yeni
 * bir ödeme başlatabilir. Ama EKRANDA aynı taslak "kart ile ödeme bekliyor"
 * değildir — tahsil edilecek nakit yok, `/pay/<ref>` ₺0 için PayTR token'ı
 * deneyip patlar. O yüzden üçüncü değer yalnız burada, sunum katmanında türer;
 * kolon da karşılaştırma da yerinde kalır.
 */
function pendingMethod(draft: Draft): RecordedPaymentMethod {
  return draft.paymentMethod === "gift_card_full" ? "gift_card_full" : draftMethod(draft);
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
      // Sözlükteki `instantQuote.checkout.giftCard.disabled` ile BİREBİR aynı
      // (form alanı kapalı bayrakta aynı cümleyi kendi yazar); `test-quote-ui.ts`
      // ikisini çiviliyor — birini değiştiren ötekini de değiştirmek zorunda.
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

/**
 * Bir ödeme yönteminin ön izlemedeki iki rakamı — zincirin kendi tipi.
 *
 * Ayrı bir şekil DEĞİL, `TenderView`ın adı: ön izleme cevabı, ödeme sayfasının
 * kartsız TABAN prop'u ve ekranın gösterdiği rakam aynı sözleşmeyi taşımak
 * zorunda; ikinci bir arayüz tanımı ikisinin ayrışabileceği bir yer açardı.
 */
export type QuoteGiftCardMethodPreview = TenderView;

/**
 * İki yöntemin görünümünü SUNUCUDA kurar; ödeme sayfası ve ön izleme ucu aynı
 * çağrıyı yapar.
 *
 * `giftCardBalanceKurus: 0` ile çağrıldığında sonuç kartsız TABANDIR — ödeme
 * sayfası bunu prop olarak indirir ve ekran "ödenecek tutar"ı kendi çıkarmasıyla
 * bulmak zorunda kalmaz (MSY m.6/2-a'nın konusu olan rakam, tahsil edilenle
 * birebir aynı zincirden çıkar).
 */
export function quoteTenderViews(args: TenderChainArgs): TenderViews {
  return toTenderViews(quoteTenderPair(args));
}

/** Zincirin YÖNTEMSİZ girdisi: iki dal aynı tutar ve aynı bakiyeyle koşar. */
type TenderChainArgs = Omit<TenderInput, "paymentMethod">;

function quoteTenderPair(args: TenderChainArgs): { card: Tender; bankTransfer: Tender } {
  return {
    card: computeTender({ ...args, paymentMethod: "card" }),
    bankTransfer: computeTender({ ...args, paymentMethod: "bank_transfer" }),
  };
}

function toTenderViews(pair: { card: Tender; bankTransfer: Tender }): TenderViews {
  const view = (tender: Tender): TenderView => ({
    havaleDiscountKurus: tender.havaleDiscountKurus,
    payableKurus: tender.payableKurus,
  });
  return { card: view(pair.card), bankTransfer: view(pair.bankTransfer) };
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
export interface QuoteGiftCardPreview extends TenderViews {
  /** Ekranın tek ayırt edicisi: red yolu 400 ile döner, bu gövde hiç gelmez. */
  valid: true;
  /** Kartın normalleştirilmiş (büyük harfli) kodu. */
  code: string;
  balanceKurus: number;
  /** Hediye kartından karşılanacak tutar; iki yöntemde de aynı. */
  giftCardAmountKurus: number;
  fullyCovered: boolean;
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
  /** Takım bağlamı (0072); yoksa kapı yalnız kişisel sahibe açıktır. */
  actor?: QuoteCheckoutActor;
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
  // ÖDEME YETKİSİ ucun kapısıdır; burada İKİNCİ kez sorulur çünkü fiyat
  // sunucudan çıkıyor ve bu servis (test, ileride başka bir uç) ucun dışından
  // da çağrılabilir.
  //
  // KAPI "ÖDEYEBİLEN" İLE AYNI, "GÖREBİLEN" İLE DEĞİL (tasarım §4, T-4 kararı):
  // bu uç `computeQuote` sonucunu döndürüyor — kart bakiyesi, karşılanan tutar,
  // havale indirimi — yani bir FİYAT yüzeyidir. Ödeme yetkisi olmayan bir üyeye
  // (ör. `member_can_checkout` kapalı) kart ön izlemesi göstermenin işlevi yok:
  // göstereceği tek şey, basamayacağı düğmenin arkasındaki rakamlar olurdu.
  if (!actorMayCheckout(quote, args)) throw notAuthorizedToPay();

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

  const pair = quoteTenderPair({
    amountKurus,
    giftCardBalanceKurus: card.balanceKurus,
    havaleDiscountApplies: quote.pricingSnapshot.settings.havaleDiscountApplies,
  });
  const decision = giftCardReservationDecision({
    card,
    // Limit sayımı yalnız limitli kartta okunur (`validateGiftCard` ile aynı
    // ölçü); limitsiz kartta sorgu hiç açılmaz.
    liveUses: card.maxRedemptions === null ? 0 : await countLiveGiftCardUses(db, card.id),
    reserveKurus: pair.card.giftCardAmountKurus,
    now: new Date(),
  });
  if (!decision.ok) throw giftCardRefusal(decision.code, locale);

  return {
    valid: true,
    code: card.code,
    balanceKurus: card.balanceKurus,
    // Karşılanan tutar ve tam karşılama yöntemden BAĞIMSIZ (hediye kartı adımı
    // yöntem dalından önce gelir), o yüzden kart dalından okunur.
    giftCardAmountKurus: pair.card.giftCardAmountKurus,
    fullyCovered: pair.card.fullyCoveredByGiftCard,
    ...toTenderViews(pair),
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
  actor?: QuoteCheckoutActor;
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
    // Teklif KİLİTLİ okundu (`FOR UPDATE`), yetki ondan SONRA sorulur: aynı
    // teklifte iki üyenin ödemesi bu kilitle SIRALANIR (tasarım §5.2) ve
    // ikincisi aşağıdaki `liveDraftForQuote` dalında birincinin taslağını
    // görüp `reused` alır — ikinci bir taslak, ikinci bir tahsilat riski
    // YAZILMAZ.
    if (!actorMayCheckout(quote, args)) throw notAuthorizedToPay();

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
        // …ve GÖNDERİLEN KART KODU bu taslağa çoktan uygulanmış olmalı.
        //
        // Ön doğrulama işlem DIŞINDA koştuğu için (gerekçe çağrı yerinde) kod
        // buraya kadar geçerli gelir, ama bekleyen taslağın tahsilat dökümü
        // ödeme anında DONDURULDU: karta sonradan yer açmak havale indirimini,
        // son tarihi ve rezervasyonu yeniden kurmak demek. Dalı sessizce
        // sürdürmek müşteriye kartı uygulanmış GÖSTERİRDİ (cevapta taslağın
        // kendi tutarları döner) — bayrak kapalıyken aynı istek 400 alırken
        // (§5.1: sessiz yok sayma yasak) açıkken sessiz kalmak tutarsızdı.
        //
        // AYNI kart istisnadır ve gerçek dünyanın hâlidir: form anahtarının
        // idempotency penceresi kapandıktan sonra gelen dürüst tekrar, kodu
        // uygulanmış ön izlemeden yine gönderir. O kod düşmüyor — taslakta
        // duruyor — ve müşteriyi rezervasyonu doğru kurulmuş bir ödemeyi iptal
        // etmeye zorlamanın hiçbir faydası yok.
        if (giftCard) {
          const [reserved] = await tx
            .select({ id: giftCardRedemptions.id })
            .from(giftCardRedemptions)
            .where(
              and(
                eq(giftCardRedemptions.draftId, existing.id),
                eq(giftCardRedemptions.giftCardId, giftCard.id),
                isNull(giftCardRedemptions.refundedAt)
              )
            )
            .limit(1);
          if (!reserved) {
            const way = pendingDraftCancellable(existing)
              ? " Kartı kullanmak için bekleyen ödemeyi iptal edip ödemeyi yeniden başlatın."
              : "";
            throw new QuoteServiceError(
              "Bu teklif için bekleyen bir ödeme var; hediye kartı o ödemeye sonradan eklenemez." +
                way,
              409,
              "pending_gift_card"
            );
          }
        }
        return { reused: existing };
      }
    }

    const now = new Date();
    // ÇERÇEVE PARTİSİ Mİ: aynı satır iki kapıya birden hizmet ediyor —
    // `quotePermissions`ın parti kapısı (düzenleme kapalı, ödeme AÇIK) ve
    // aşağıdaki EŞİTLİK KAPISI. Tek okuma, çünkü ikinci bir sorgu iki kapının
    // farklı bir gerçek görmesine izin verirdi.
    //
    // OKUMA BEKLEYEN ÖDEME DALINDAN SONRA: o dal taslağı AYNEN geri veriyor ve
    // taslağın tutarı ödeme anında ZATEN dondurulmuş (o an bu kapıdan geçti).
    // Kapıyı tekrar koşturmak, müşteriyi hediye kartı rezervasyonu duran kendi
    // bekleyen ödemesinden dışarı kilitleyebilirdi — oysa düzeltilecek şey
    // taslak değil, klonun sonradan bozulan satırıdır.
    const [frameworkBatch] = await tx
      .select({
        id: quoteFrameworkBatches.id,
        frameworkId: quoteFrameworkBatches.frameworkId,
        position: quoteFrameworkBatches.position,
        amountKurus: quoteFrameworkBatches.amountKurus,
      })
      .from(quoteFrameworkBatches)
      .where(eq(quoteFrameworkBatches.quoteId, quote.id))
      .limit(1);
    const permissions = quotePermissions(
      { status: quote.status, expiresAt: quote.expiresAt, orderId: quote.orderId },
      {
        hasLiveDraft: false,
        now,
        isFrameworkBatch: frameworkBatch !== undefined,
        // Anlaşmanın KAYNAK teklifi ödenebilir kalır (kural motorunun kararı);
        // ölçü yine de BEYAN edilir, çünkü alan zorunlu ve `false` yazmak bir
        // yalan olurdu — kural motoru yarın kaynağı daraltırsa bu yol da
        // kendiliğinden doğru davranır.
        hasLiveFramework: await quoteHasLiveFramework(quote.id, tx),
      }
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

    // ─── EŞİTLİK KAPISI (çerçeve partisi) ────────────────────────────────
    //
    // Klon parti teklifi sıradan bir `quotes` satırıdır. Bir yolla manuel
    // fiyatı düşerse (`manualPriceKey` tutmaz, `quote-compute.ts`) tutar canlı
    // katalog fiyatına döner ve müşteri ANLAŞMADA YAZMAYAN bir tutar öder.
    // Kapı, tahsilat başlamadan önce o sapmayı yakalar.
    //
    // KARŞILAŞTIRMA BRÜT ÜZERİNDEDİR: `totals.totalKurus` ↔
    // `quote_framework_batches.amount_kurus`. `payableKurus` ile
    // karşılaştırmak, hediye kartı kullanan HER partide yanlış alarm verir ve
    // müşteriyi ödeyemez hâle sokardı — kart brütü düşürmez, tahsil edilen
    // nakdi düşürür (`quote-tender.ts`: "`amountKurus` BRÜTTÜR ve hiçbir adım
    // onu düşürmez"). Tahsilat zinciri de bu satırdan SONRA koşuyor, yani
    // burada `payableKurus` henüz YOKTUR.
    if (
      frameworkBatch &&
      frameworkBatchDriftCode(totals.totalKurus, frameworkBatch.amountKurus) !== null
    ) {
      // Admin uyarısı: sapma bir arızadır ve sessizce müşteriye 409 dönmek,
      // kimsenin bakmadığı bir para hatası bırakmak olurdu.
      console.error(
        `[quote-framework] fiyat sapması: parti ${frameworkBatch.id} ` +
          `(anlaşma kimliği ${frameworkBatch.frameworkId}, sıra ${frameworkBatch.position}) ` +
          `kilitli ${frameworkBatch.amountKurus} kuruş, teklif ${quote.number} ` +
          `bugün ${totals.totalKurus} kuruş hesapladı — ödeme reddedildi`
      );
      throw new QuoteServiceError(FRAMEWORK_PRICE_DRIFT_ERROR, 409, "framework_price_drift");
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
        // ÖDEYEN KİM İSE SİPARİŞ ONUN (0072 değişmez 3): teklifi açan A,
        // ödeyen takım üyesi B ise taslak — ve ondan doğacak `orders` satırı —
        // B'nin. İade (`order-refund.ts`), anlaşmazlık (`dispute-resolution.ts`)
        // ve hediye kredisi iadesi (`gift-credit-return.ts`,
        // `redeemedByUserId === order.userId`) BU SATIRA bağlı; `quote.userId`e
        // çevirmek üçünü birden sessizce yanlışlardı.
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
        // Kullanan = ÖDEYEN (değişmez 3). `gift-credit-return.ts` iadeyi
        // `redeemedByUserId === order.userId` eşlemesiyle veriyor: takım
        // teklifinde bu satırı teklifin sahibine yazmak, kartı kullanan üyeye
        // iade edilemeyen bir bakiye bırakırdı.
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

    // ÇERÇEVE KÖPRÜSÜNÜN İLK YARISI: partinin taslağı. Köprüyü YAZAN yer
    // taslağın DOĞDUĞU yerdir; okuyan yer (`loadFrameworkDetail`) ikinci bir
    // gerçek üretemez. `orders`/`order_drafts` tanımlarına kolon EKLENMEDİ
    // (o dosyalar başka bir oturumun elinde) — bağ partinin kendi satırında
    // durur. Üzerine yazılır, boşaltılmaz: taslak süresi dolup müşteri
    // yeniden ödemeye başladığında parti YENİ taslağa bağlanır (tekil indeks
    // `draft_id` üzerinde, yani bir taslak en fazla bir partiye ait).
    if (frameworkBatch) {
      await tx
        .update(quoteFrameworkBatches)
        .set({ draftId: draft.id, updatedAt: now })
        .where(eq(quoteFrameworkBatches.id, frameworkBatch.id));
    }

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
  /**
   * Takım bağlamı (0072). Idempotency anahtarına GİRMEZ: anahtar `args.userId`i
   * zaten özetliyor ve rol o kullanıcının üyeliğinden TÜRER — anahtarın içine
   * koymak, rolü değişen bir üyenin dürüst tekrarını yeni bir ödeme denemesine
   * çevirirdi.
   */
  actor?: QuoteCheckoutActor;
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

/**
 * Taslak işlemi COMMIT olduktan SONRA kuyruğa atılan iş: hata isteği DÜŞÜRMEZ.
 *
 * Gerekçe tek cümlede: o commit'te hediye kartı bakiyesi ÇOKTAN düşmüştür
 * (`freezeCheckout` rezervasyonu taslakla aynı işlemde yazar). Redis o
 * pencerede erişilemezken fırlatmak, müşteriye hem bir hata hem de gitmiş bir
 * bakiye göstermek olurdu — elimizdeki en kötü sonuç. Ödemenin kendisi bu
 * işlerin hiçbirine bağlı değil: `/pay` ve `/havale` sayfaları taslaktan okur.
 *
 * KAYBOLAN SON TARİH İŞİNİN AĞI, bakım turunun `expireStrandedQuoteDrafts`
 * aşamasıdır: son tarih işi hiç kuyruğa girmemiş bir taslağı süresi geçtiğinde
 * kapatır ve rezervasyonu karta geri verir (`quote-maintenance.ts`). Havale
 * talimat mektubunun ağı BAŞKADIR (o aşama mektup göndermez) — çağrı yerinde
 * yazılı.
 *
 * YUTMA DEĞİL: satır taslağın REFERANSINI taşır, yoksa kuyruğu düşmüş bir
 * ortamda hangi taslakların ağa kaldığı hiçbir yerde görünmezdi.
 */
async function enqueueAfterCommit(
  what: string,
  reference: string,
  add: () => Promise<unknown>
): Promise<void> {
  try {
    await add();
  } catch (err) {
    console.error(
      `[quote-checkout] ${what} işi kuyruğa alınamadı (taslak ${reference}); ` +
        "rezervasyon duruyor, bakım turu telafi edecek",
      err
    );
  }
}

async function runCheckout(args: {
  quoteId: string;
  userId: string;
  email: string;
  input: QuoteCheckoutInput;
  req: NextRequest;
  actor?: QuoteCheckoutActor;
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
    // Olayın kullanıcısı da ÖDEYEN (değişmez 3): dönüşüm, parayı başlatan
    // hesaba yazılır — takım teklifinde teklifi açan meslektaşa değil.
    userId: args.userId,
    attribution,
    consent: attribution.consent ?? null,
    visitorId: attribution.visitorId ?? null,
    sessionId: attribution.sessionId ?? null,
    user: { email: args.email, phone: args.input.shippingAddress.telefon },
  }).catch(() => {});

  if (draft.paymentMethod === "bank_transfer") {
    const bank = getBankDetails();
    await enqueueAfterCommit("havale-reminder", draft.reference, () =>
      getPaymentDeadlineQueue().add(
        "havale-reminder",
        { draftId: draft.id, reference: draft.reference, type: "havale_reminder" },
        { jobId: havaleReminderJobId(draft.id), delay: HAVALE_REMINDER_HOURS * 3600 * 1000 }
      )
    );
    await enqueueAfterCommit("havale-expire", draft.reference, () =>
      getPaymentDeadlineQueue().add(
        "havale-expire",
        { draftId: draft.id, reference: draft.reference, type: "havale_expire" },
        { jobId: havaleExpireJobId(draft.id), delay: HAVALE_DEADLINE_HOURS * 3600 * 1000 }
      )
    );
    // Talimat mektubu da EN İYİ ÇABADIR: müşteri `/havale/<ref>` sayfasında
    // aynı IBAN'ı, tutarı ve son tarihi zaten görüyor, ama kaybolan bir mektup
    // için isteği patlatmak yukarıdaki gerekçenin (bakiye düşmüş) tam olarak
    // aynısına çarpar. Üstündeki iki eklemeden AYRI bir kuyruk (`email`) ve
    // ayrı bir arıza: son tarih işleri girmişken mektup tek başına
    // patlayabilir, o hâlde telafi edilecek eksik iş bile yoktur — sarılmamış
    // hâli yalnız 500 + düşmüş bakiye üretirdi (`test-quote-checkout-db.ts`,
    // "YALNIZ e-posta kuyruğu düşse de havale ödemesi BAŞARILI döner").
    //
    // TELAFİSİ ÖTEKİLERDEN FARKLI: bakım turu (`expireStrandedQuoteDrafts`)
    // mektubu YENİDEN GÖNDERMEZ, taslağı süresinde kapatır. Mektubun yerine
    // geçen şey müşteri için dönen `redirectUrl` (`/havale/<ref>`), operatör
    // için de aşağıdaki referanslı günlük satırıdır. Gerçek bir yeniden
    // gönderim "mektup gitti mi" durumunu bilmek ister; o kolon bu sevkiyatta
    // yok (migration yok), borç kayıt defterine yazıldı.
    await enqueueAfterCommit("bank_transfer_instructions", draft.reference, () =>
      getEmailQueue().add("send-email", {
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
      })
    );
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
  await enqueueAfterCommit("card-expire", draft.reference, () =>
    getPaymentDeadlineQueue().add(
      "card-expire",
      { draftId: draft.id, reference: draft.reference, type: "card_expire" },
      { jobId: cardExpireJobId(draft.id), delay: CARD_DEADLINE_HOURS * 3600 * 1000 }
    )
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
  // terfiyi yeniden denerken son tarih işi ikizlenmez. Ekleme EN İYİ ÇABADIR
  // (gerekçe: `enqueueAfterCommit`) — kuyruk erişilemezken isteği patlatmak,
  // müşteriye hem hata gösterip hem siparişini yazmamak olurdu; oysa terfi
  // buradan bağımsız çalışabilir.
  await enqueueAfterCommit("card-expire", draft.reference, () =>
    getPaymentDeadlineQueue().add(
      "card-expire",
      { draftId: draft.id, reference: draft.reference, type: "card_expire" },
      { jobId: cardExpireJobId(draft.id), delay: CARD_DEADLINE_HOURS * 3600 * 1000 }
    )
  );

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
      // AYNI CÜMLE sözlükte de var (`instantQuote.checkout.giftCard.fullyCoveredRetry`):
      // bekleyen ödeme ekranı bu hâli kendi başına da anlatabilmeli, servisler ise
      // bu depoda sözlük OKUMUYOR (worker grafı + `server-only` tuzağı). İkisi
      // `test-quote-ui.ts`te birbirine çivili — birini değiştiren ÖTEKİNİ de
      // değiştirmek zorunda.
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
  /**
   * SUNUM yöntemi (`pendingMethod`): `gift_card_full` = tahsil edilecek nakit
   * yok, taslak yalnız siparişe dönmeyi bekliyor. 409 karşılaştırması bunu
   * kullanmaz (orada `gift_card_full` KARTtır, gerekçe `pendingMethod`).
   */
  paymentMethod: RecordedPaymentMethod;
  /**
   * Müşterinin ödemeye devam edeceği sayfa (`/pay/…` ya da `/havale/…`).
   *
   * `gift_card_full` iken **null**: ödenecek nakit olmadığı için gidilecek bir
   * ödeme sayfası da yoktur. Tipin null kabul etmesi ŞART — `string` kalsa boş
   * bir dizgi yazmak ekranda sessizce çalışmayan bir bağlantı üretirdi.
   */
  paymentUrl: string | null;
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
  const method = pendingMethod(draft);
  return {
    reference: draft.reference,
    paymentMethod: method,
    paymentUrl: method === "gift_card_full" ? null : draftPaymentPath(draft),
    // `gift_card_full` taslağında da TRUE kalır: rezervasyon duruyor, sipariş
    // doğmadı ve müşterinin tek çıkışı iptal (gerekçe `pendingDraftCancellable`).
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
  /**
   * İptal edenin takımdaki ROLÜ (0072); `null`/yok = takım dalından gelmiyor.
   *
   * Takımın ÖDEME AYARI (`member_can_checkout`) BURADA İSTENMEZ ve bu bir
   * eksiklik değil: `teamRoleCanCancelCheckout` o ayarı hiç sormuyor (gerekçe
   * orada — ayarı sonradan kapatılan takımda üye kendi taslağını iptal
   * edemezse hem ödeyemez hem düzenleyemez hâlde kalır).
   */
  actorRole?: TeamRole | null;
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
    // YETKİ İKİ AŞAMALI ve sıra BUGÜNKÜ cevapları korumak için böyle:
    //
    //   1. KİŞİSEL SAHİP taslaktan ÖNCE geçer — ifade bugünkünün birebir
    //      kendisi, yani kişisel tekliflerde ret sırası da (403 → "bekleyen
    //      ödeme yok" 409) hiç kaymaz.
    //   2. Takım dalında karar taslağın SAHİBİNE bağlı (`member` yalnız kendi
    //      başlattığını iptal eder), o yüzden taslak satırı okunduktan SONRA
    //      verilir. Uç katmanı taslağı okumaz: aynı satırı işlem DIŞINDA bir
    //      kez daha okumak, iki okuma arasında kapanan bir taslakta yarışırdı.
    const personalOwner = quote.userId !== null && quote.userId === args.userId;
    const actorRole = args.actorRole ?? null;
    if (!personalOwner && actorRole === null) {
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
    const notCancellable = () =>
      new QuoteServiceError(
        "Bu ödeme iptal edilemez; ödeme sayfasından devam edin.",
        409,
        "draft_not_cancellable"
      );
    if (!draft) throw notCancellable();
    // Aşama 2: takım dalının kesin kararı. `draft.userId` taslağı BAŞLATAN
    // kişidir (değişmez 3) — `member` yalnız onu kendisi başlattıysa geçer.
    //
    // YETKİ, "iptal edilebilir mi" ÖLÇÜSÜNDEN ÖNCE: yetkisi olmayan birine
    // taslağın hangi aşamada olduğunu (PayTR ekranı görülmüş mü) söylemenin
    // gereği yok. Kişisel sahipte SIRA DEĞİŞMEDİ — onun yetkisi taslak
    // okunmadan, yukarıda belli olmuştu.
    if (
      !personalOwner &&
      actorRole !== null &&
      !teamRoleCanCancelCheckout(actorRole, draft.userId, args.userId)
    ) {
      throw new QuoteServiceError(
        "Bu bekleyen ödemeyi iptal etme yetkiniz yok.",
        403,
        "not_owner"
      );
    }
    if (!pendingDraftCancellable(draft)) throw notCancellable();

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
