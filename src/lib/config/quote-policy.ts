/**
 * Teklif üzerinde NE yapılabilir ve ödemeye NE engel.
 *
 * Kural motoru saf tutulur ki aynı cevabı üç yer verebilsin: sunucu bileşeni
 * (düğmeleri çizer), API rotası (isteği reddeder) ve ödeme servisi (parayı
 * almadan önce son kez bakar). Ekranın uygulamadığı bir kuralı ucun yazması
 * (ya da tersi) buradan imkânsızdır.
 *
 * SAF MODÜL: DB yok, `server-only` yok, `node:` import'u yok.
 */
import type { ComputedQuote, PricingPartInput, QuoteStatus } from "@/lib/config/quote-types";

export const QUOTE_EXPIRED_REASON = "Teklifin süresi doldu — yeniden fiyatlayın.";
export const QUOTE_LIVE_DRAFT_REASON = "Bu teklif için bekleyen bir ödeme var.";
export const QUOTE_ORDERED_REASON = "Bu teklif siparişe dönüştü.";
export const QUOTE_CANCELLED_REASON = "Bu teklif iptal edildi.";
export const QUOTE_IN_REVIEW_REASON = "Teklifiniz ekibimizin incelemesinde.";
/**
 * Bir çerçeve anlaşmanın serbest bırakılmış partisi.
 *
 * Cümle sözlükteki `instantQuote.framework.readOnly` ile BİREBİR aynı olmak
 * zorundadır: ekran ile uç aynı sebebi söylemeli.
 */
export const QUOTE_FRAMEWORK_BATCH_REASON =
  "Bu teklif bir çerçeve anlaşmanın partisidir; düzenlenemez.";
/**
 * Bir çerçeve anlaşmanın KAYNAK teklifi (anlaşma kapanmamış).
 *
 * Anlaşma bu teklifin parçalarını `parts_snapshot`ta DONDURDU ve her parti o
 * tanımın klonudur (`cloneQuoteForFrameworkBatch` yapılandırmayı CANLI kaynak
 * parçadan okur). Kaynak düzenlenebilir kalırsa müşteri imzadan sonra
 * malzemeyi/yüzeyi/katmanı — hatta kritik toleransı — değiştirir, bir sonraki
 * parti YENİ tanımla üretilir ve ESKİ kilitli birim fiyatla faturalanır;
 * eşitlik kapısı bunu göremez, çünkü manuel anahtar yazılan konfigürasyondan
 * yeniden üretilir ve toplam yine `amount_kurus`a EŞİT çıkar. Kilitlenen şey
 * yalnız FİYAT değil TANIMDIR.
 *
 * Müşterinin çıkış yolu kapalı değil: `requote` kaynağa DOKUNMAZ (bugünün
 * kataloğuyla yeni bir teklif açar) ve anlaşma iptal/tamamlanınca kilit düşer.
 */
export const QUOTE_FRAMEWORK_SOURCE_REASON =
  "Bu teklif bir çerçeve anlaşmanın tanımıdır; anlaşma sürerken düzenlenemez.";

export interface QuotePermissions {
  canEdit: boolean;
  canCheckout: boolean;
  canRequestReview: boolean;
  blockedReason: string | null;
}

/**
 * Sıra ÖNEMLİ: siparişe dönmüş/iptal bir teklif her şeyin üstündedir, sonra
 * süre dolumu, sonra bekleyen ödeme kilidi, sonra ÇERÇEVE PARTİSİ kapısı gelir.
 *
 * ─── `isFrameworkBatch` ZORUNLU, opsiyonel DEĞİL ────────────────────────────
 *
 * Emsal `quote-tender.ts`in yazılı kararıdır ("TÜM ALANLAR ZORUNLU ve bu
 * bilinçlidir… İsteğe bağlı bir alan, o yolların sessizce eski davranışta
 * kalması demekti") ve burada bedeli ÖLÇÜLEBİLİR: serbest bırakılmış bir parti
 * sıradan bir `quotes` satırıdır; müşteri onu düzenlerse `demoteQuotedToDraft`
 * (`quote-service.ts`) devreye girer, `manualPriceKey` tutmaz
 * (`quote-compute.ts`) ve KİLİTLİ FİYAT SESSİZCE CANLI KATALOG FİYATINA DÖNER
 * — müşteri anlaşmada yazandan farklı bir tutar öder. Alanı zorunlu yapmak,
 * derleyicinin dört okuma yolunu (servis, inceleme talebi, sunum, ödeme) tek
 * tek saymasını sağlar.
 *
 * PARTİ KAPISININ YERİ: `needs_review` dalından ÖNCE olmak ZORUNDA — o dal
 * `canEdit: true` döndürüyor, yani kapı ondan sonra gelse delik açık kalırdı.
 * Bekleyen ödeme kilidinden SONRA olması ise bir seçim: ikisi de aynı yetkiyi
 * (`canEdit=false`, `canCheckout=true`) veriyor, o yüzden hiçbir şey
 * gevşemiyor; söylenen cümle EYLEME dönük olanı ("ödemene devam et") kalıyor.
 *
 * `canCheckout` parti hâlinde AÇIK KALIR: kapatmak, serbest bırakılmış ve
 * müşterinin ödemesi beklenen bir partiyi tuzağa düşürmek olurdu.
 *
 * ─── `hasLiveFramework` de ZORUNLU (AYNI gerekçe, ikinci kapsam) ────────────
 *
 * `isFrameworkBatch` KLONU kapatıyor; `hasLiveFramework` anlaşmanın KAYNAK
 * teklifini kapatır (`QUOTE_FRAMEWORK_SOURCE_REASON`, gerekçesi orada). İki
 * ölçü AYRI iki satırdır (`quote_framework_batches.quote_id` ↔
 * `quote_frameworks.quote_id`) ve bir teklif ikisinden yalnız birinde olabilir.
 * Kaynakta da `canCheckout` AÇIK KALIR: anlaşma kurmak teklifin kendisini
 * ödenemez yapmaz ve kapatmak, bugün ödenebilir olan bir teklifi anlaşma
 * kuruldu diye tuzağa düşürmek olurdu (daraltmak bir ÜRÜN kararıdır, bu tur
 * onu vermiyor).
 */
export function quotePermissions(
  q: { status: QuoteStatus; expiresAt: Date; orderId: string | null },
  ctx: {
    hasLiveDraft: boolean;
    now: Date;
    isFrameworkBatch: boolean;
    hasLiveFramework: boolean;
  }
): QuotePermissions {
  const closed = { canEdit: false, canCheckout: false, canRequestReview: false };

  if (q.status === "ordered" || q.orderId !== null) {
    return { ...closed, blockedReason: QUOTE_ORDERED_REASON };
  }
  if (q.status === "cancelled") {
    return { ...closed, blockedReason: QUOTE_CANCELLED_REASON };
  }
  if (q.status === "expired" || ctx.now.getTime() > q.expiresAt.getTime()) {
    return { ...closed, blockedReason: QUOTE_EXPIRED_REASON };
  }
  if (ctx.hasLiveDraft) {
    // Ödeme akışı sürüyor: teklif salt okunur ama "Ödemeye devam et" AÇIK
    // kalmalı — ödeme rotası aynı taslağın referansını geri döndürür.
    return {
      canEdit: false,
      canCheckout: true,
      canRequestReview: false,
      blockedReason: QUOTE_LIVE_DRAFT_REASON,
    };
  }
  if (ctx.isFrameworkBatch) {
    // Anlaşmanın kilitli fiyatı bu satırın manuel fiyatında duruyor: tek bir
    // düzenleme onu düşürür. Ödeme ise AÇIK — parti tam olarak ödenmek için
    // serbest bırakıldı.
    return {
      canEdit: false,
      canCheckout: true,
      canRequestReview: false,
      blockedReason: QUOTE_FRAMEWORK_BATCH_REASON,
    };
  }
  if (ctx.hasLiveFramework) {
    // Anlaşmanın TANIMI bu satırda duruyor: bir düzenleme, sonraki partinin
    // BAŞKA bir ürünü kilitli fiyattan üretmesi demektir. Ödeme AÇIK kalır.
    return {
      canEdit: false,
      canCheckout: true,
      canRequestReview: false,
      blockedReason: QUOTE_FRAMEWORK_SOURCE_REASON,
    };
  }
  if (q.status === "needs_review") {
    // Düzenleme incelemeyi İPTAL ETMEZ; müşteri beklerken parçalarını
    // düzeltebilir, ama kendi kendine ödeyemez.
    return {
      canEdit: true,
      canCheckout: false,
      canRequestReview: false,
      blockedReason: QUOTE_IN_REVIEW_REASON,
    };
  }
  return { canEdit: true, canCheckout: true, canRequestReview: true, blockedReason: null };
}

/**
 * Ödemeye engel olan her şeyin Türkçe listesi. Boş dizi = teklif ödenebilir.
 *
 * Cümleler müşteriye AYNEN gösterilir; her biri "ne yapmalıyım"ı söyler.
 */
export function checkoutBlockers(
  c: ComputedQuote,
  parts: PricingPartInput[],
  q: { termsAccepted: boolean; expired: boolean; adminPriced: boolean }
): string[] {
  const blockers: string[] = [];

  if (parts.length === 0) {
    blockers.push("Teklifte parça yok — önce bir model yükleyin.");
    return blockers;
  }
  if (q.expired) blockers.push(QUOTE_EXPIRED_REASON);

  const byId = new Map(c.parts.map((p) => [p.id, p]));

  const pending = c.parts.filter((p) =>
    p.dfm.issues.some((i) => i.code === "analysis_pending")
  ).length;
  if (pending > 0) {
    blockers.push(`${pending} parçanın analizi sürüyor — birkaç saniye içinde tamamlanır.`);
  }

  const manual = c.parts.filter(
    (p) => p.dfm.blocking && !p.dfm.issues.some((i) => i.code === "analysis_pending")
  ).length;
  if (manual > 0) blockers.push(`${manual} parça manuel fiyat bekliyor.`);

  // `!allPriced` AYRI bir cümle değil YAKALAYICIDIR: fiyatın çıkmamasının sebebi
  // zaten (3) analiz ya da (4) manuel cümlesiyle anlatıldıysa müşteriye aynı şeyi
  // iki kez söylemeyiz. Kalan hâl "sebebini adlandıramadığımız fiyatsızlık"tır.
  // (spec §quote-policy, cümle 5)
  if (!c.totals.allPriced && pending === 0 && manual === 0) {
    blockers.push("Fiyat hesaplanamadı — ekibimizden teklif isteyin.");
  }

  const unacknowledged = parts.filter((part) => {
    const computed = byId.get(part.id);
    const key = computed?.dfm.warningKey ?? null;
    return key !== null && part.dfmAckKey !== key;
  }).length;
  if (unacknowledged > 0) {
    blockers.push(`${unacknowledged} parça için üretim uyarılarını onaylamanız gerekiyor.`);
  }

  // Teklif düzeyindeki `total_over_auto` (spec §quote-dfm tablosu, §quote-policy
  // cümle 7): parçaların hepsi tek tek fiyatlanabilir olsa da toplam ANLIK
  // teklif sınırını aşıyorsa ödeme AÇILMAZ — aksi hâlde ekran "ödenebilir"
  // derken uç reddederdi.
  //
  // `adminPriced` TEK muafiyet: sınır "bu tutarı bir insan görmeden otomatik
  // veremeyiz" demektir, "bu tutar tahsil edilemez" demek değil. İnsan görüp
  // fiyatladıysa (teklif `quoted`) sınırın işi bitmiştir; aksi hâlde admin
  // ₺100.000 üstü bir teklifi "Fiyatlandı" diye yollar, müşteri "hazır"
  // e-postasını alır ve ödeme sayfası onu geri çevirir — üstelik tavan
  // doğrulayıcı tavanına (`CATALOG_LIMITS.maxPriceKurus`) dayandığı için
  // panelden yükseltilemez. Gerçek ödeme tavanı `MAX_AMOUNT_KURUS`tur ve
  // ödeme servisinde ayrıca uygulanır.
  if (
    !q.adminPriced &&
    c.quoteIssues.some((i) => i.code === "qty_over_auto" && i.params?.reason === "total")
  ) {
    blockers.push("Toplam tutar anlık teklif sınırını aşıyor — ekibimizden teklif isteyin.");
  }

  if (!q.termsAccepted) {
    blockers.push("Mesafeli satış sözleşmesini ve ön bilgilendirmeyi onaylayın.");
  }

  return blockers;
}
