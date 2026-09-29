/**
 * Hediye kartı rezervasyonunun SAF kararı: bu kart şu an harcanabilir mi, ve
 * harcanırsa kartın yeni bakiyesi/durumu ne olur.
 *
 * NEDEN AYRI MODÜL: aynı kurallar bugün iki yerde yaşıyor — `/api/orders`ın
 * satır içi kilitli kart bloğu ve `validateGiftCard`ın ödeme öncesi kontrolü.
 * Teklif ödemesi üçüncü bir kopya AÇMAZ; kural buraya yazılır ve
 * `src/lib/services/gift-card-reservation.ts` onu işlem içinde uygular.
 * Kopyaların kayması "aynı kart iki yolda farklı davranır" demek olur ve fark
 * paranın içinde sessizce ortaya çıkar.
 *
 * NE YAPMAZ: rezerve edilecek TUTARI hesaplamaz. Tahsilat zincirinin TEK
 * uygulaması `src/lib/config/quote-tender.ts`tir (`computeTender`); bu modül
 * onun ürettiği tutarı bir GİRDİ olarak alır ve yalnız kartın kendi
 * defterini (bakiye, durum) kapatır. İkinci bir `min(bakiye, tutar)` burada
 * olsaydı zincir iki yere bölünürdü.
 *
 * SAF MODÜL: DB yok, `import "server-only"` yok — BullMQ worker'ı
 * (`order-draft` zinciri) ve Next rotaları aynı kuralı okuyabilmeli.
 */

/**
 * Kartın harcanmasını engelleyen iki cevap. Müşteriye dönen cümleler
 * `giftCard.error.*` sözlüğünden gelir (`/api/orders` ile AYNI cümle); bu
 * modül cümle YAZMAZ, kod döner.
 */
export type GiftReservationRefusal = "insufficient" | "limit_reached";

/**
 * Harcamayı engelleyen `gift_cards.status` değerleri — KAPALI liste.
 *
 * "Kullanılabilir olanları say" yerine "kullanılamaz olanları say" biçimi
 * bilinçli: `/api/orders:664–670` bu üçünü sayıyor ve iki yolun aynı kümeyi
 * okuduğu testle çivili (`scripts/test-gift-card-reservation.ts`). Kabul
 * tarafı yine de kapalı: bilinmeyen bir durum (yarın eklenecek bir değer)
 * `KNOWN_SPENDABLE_STATUSES` dışında kaldığı için reddedilir.
 */
export const GIFT_CARD_UNUSABLE_STATUSES = [
  "expired",
  "fully_used",
  "pending_payment",
] as const;

/**
 * Harcanabilir durumlar. `/api/orders` yalnız yukarıdaki üçünü reddettiği için
 * bugün bu iki değerden ibarettir; ayrı liste tutmanın sebebi, enum'a eklenecek
 * bir değerin (ör. `refunded`) sessizce harcanabilir doğmaması.
 */
const KNOWN_SPENDABLE_STATUSES = ["active", "partially_used"] as const;

export interface GiftCardReservationInput {
  /** Kartın KİLİTLİ satırı (`giftCards … FOR UPDATE`) — bayat bakiye değil. */
  card: {
    balanceKurus: number;
    status: string;
    expiresAt: Date;
    maxRedemptions: number | null;
  };
  /** Kartın CANLI kullanım sayısı (`countLiveGiftCardUses`), kilit altında okunmuş. */
  liveUses: number;
  /** Zincirin (`computeTender`) rezerve edilecek tutarı; burada hesaplanmaz. */
  reserveKurus: number;
  now: Date;
}

export type GiftCardReservationDecision =
  | {
      ok: true;
      /** Rezervasyondan sonraki bakiye; `gift_cards.balance_kurus`a yazılır. */
      newBalanceKurus: number;
      newStatus: "fully_used" | "partially_used";
    }
  | { ok: false; code: GiftReservationRefusal };

function reservationInteger(value: number, label: string, min: number): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${label} en az ${min} olan bir tam sayı olmalı`);
  }
  return value;
}

/**
 * `/api/orders:657–701`in kurallarını BİREBİR taşır.
 *
 * Red SIRASI kuralın parçasıdır: bakiye → durum → süre → limit. Müşterinin
 * göreceği cümle bu sıraya bağlı olduğu için iki yolda aynı olmak zorunda
 * (hem süresi geçmiş hem limiti dolmuş kart `insufficient` der). Bu yüzden
 * çağıran kendi kapısını kurmaz: limit sayımı bile buraya GİRDİ olarak gelir
 * (`liveUses`), yoksa sıra çağıranın kodunda sessizce kayardı.
 *
 * KAPSAM: bu sıra VAR OLAN kilitli bir kartın kapılarıdır. Kartın hiç
 * bulunmaması kuralın bir dalı değil, konusunun yokluğudur; onu `not_found`
 * olarak çağıran döner (`src/lib/services/gift-card-reservation.ts`) ve
 * `/api/orders` ayrı bir kodu olmadığı için `INSUFFICIENT_BALANCE`a katıyor.
 *
 * Geçersiz bir `reserveKurus` (0, negatif, kesirli ya da bakiyeden büyük)
 * `RangeError` atar: bu bir SON SAVUNMA hattıdır, müşteriye dönen cevap değil.
 * Buraya kadar gelen böyle bir tutar, zincirin bayat bir bakiyeyle çalıştığı
 * anlamına gelir; sessizce kırpmak taslağa kartın karşılamadığı bir tutar
 * yazmak olurdu.
 */
export function giftCardReservationDecision(
  input: GiftCardReservationInput
): GiftCardReservationDecision {
  const { card } = input;
  const balanceKurus = reservationInteger(card.balanceKurus, "Kart bakiyesi", 0);

  // 1) Bakiye kapısı her şeyden ÖNCE: bitmiş bir kartta `reserveKurus` zaten
  //    anlamsızdır ve onu doğrulamak müşteriye 400 yerine 500 verdirirdi.
  if (balanceKurus <= 0) return { ok: false, code: "insufficient" };

  // 2) Durum: kullanılamaz küme `/api/orders` ile aynı, kabul kümesi kapalı.
  if ((GIFT_CARD_UNUSABLE_STATUSES as readonly string[]).includes(card.status)) {
    return { ok: false, code: "insufficient" };
  }
  if (!(KNOWN_SPENDABLE_STATUSES as readonly string[]).includes(card.status)) {
    return { ok: false, code: "insufficient" };
  }

  // 3) Süre: KATI karşılaştırma — son saniyesinde ödeyen müşterinin kartı geçer.
  if (card.expiresAt.getTime() < input.now.getTime()) {
    return { ok: false, code: "insufficient" };
  }

  // 4) Kullanım limiti. Sayımın kartın KİLİDİ altında okunmuş olması çağıranın
  //    sorumluluğu (`reserveGiftCardTx`) ve AST nöbetiyle çivili
  //    (`scripts/test-gift-card-usage.ts`).
  if (card.maxRedemptions !== null) {
    const maxRedemptions = reservationInteger(card.maxRedemptions, "Kullanım limiti", 0);
    if (reservationInteger(input.liveUses, "Kullanım sayısı", 0) >= maxRedemptions) {
      return { ok: false, code: "limit_reached" };
    }
  }

  const reserveKurus = reservationInteger(input.reserveKurus, "Rezerve edilecek tutar", 1);
  if (reserveKurus > balanceKurus) {
    throw new RangeError("Rezerve edilecek tutar kart bakiyesini aşıyor");
  }

  const newBalanceKurus = balanceKurus - reserveKurus;
  return {
    ok: true,
    newBalanceKurus,
    // `/api/orders:685–686` ile birebir: bakiye bittiyse kart kapanır, yoksa
    // "kısmen kullanıldı" olur (kart hâlâ harcanabilir).
    newStatus: newBalanceKurus === 0 ? "fully_used" : "partially_used",
  };
}
