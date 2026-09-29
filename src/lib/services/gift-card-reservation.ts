/**
 * Hediye kartı rezervasyonunun İŞLEM İÇİ uygulaması: kartı kilitler, kuralı
 * uygular, tahsilat zincirini kilitli bakiyeden kurar, bakiyeyi düşer ve
 * (taslak yazıldıktan sonra) kullanım kaydını atar.
 *
 * ÇAĞIRANIN İŞLEMİNDE ÇALIŞIR — kendi `db.transaction`ını AÇMAZ. Sebebi para:
 * bakiye düşümü ile taslak insert'i aynı işlemde commit ya da rollback olmak
 * zorunda. Ayrı işlemler, "bakiye harcandı ama taslak yok" (ya da tersi) hâlini
 * mümkün kılardı. Bu kısıt AST nöbetiyle çivilidir
 * (`scripts/test-gift-card-usage.ts` · `caller-tx`).
 *
 * SIRA `/api/orders` ile BİREBİR aynıdır ve öyle kalmalı: kart kilidi
 * (`:657`) → kilit altında kullanım sayımı (`:678`) → bakiye düşümü (`:689`) →
 * taslak insert'i → kullanım kaydı (`:822`). Kullanım kaydı taslağın kimliğine
 * ihtiyaç duyduğu için imza iki adımlıdır (`reserveGiftCardTx` +
 * `insertGiftRedemptionTx`); iki adımı tek çağrıya sıkıştırmak, taslağı
 * rezervasyondan ÖNCE yazmak demek olurdu ve o sıra yarış hâlinde limiti
 * aşmaya izin verirdi.
 *
 * Kuralın kendisi burada DEĞİL: `src/lib/config/gift-card-reservation.ts` (saf
 * karar) ve `src/lib/config/quote-tender.ts` (tahsilat zinciri). Bu dosya
 * yalnız kilit sırasını ve yazımları taşır.
 *
 * `import "server-only"` YOK: rezervasyonu geri veren zincir (`order-draft.ts`
 * → `expireDraft`) BullMQ worker'ından da geçiyor.
 */
import { eq } from "drizzle-orm";
import {
  giftCardReservationDecision,
  type GiftReservationRefusal,
} from "@/lib/config/gift-card-reservation";
import {
  computeTender,
  type Tender,
  type TenderPaymentMethod,
} from "@/lib/config/quote-tender";
import { giftCardRedemptions, giftCards } from "@/lib/db/schema";
import { countLiveGiftCardUses } from "./gift-card-usage";
import type { MoneyTx } from "./money-partner-lock";

/** Kartın reddi. Kodlar `giftCard.error.<code>` sözlük anahtarlarıyla AYNI. */
export type GiftCardReservationCode = GiftReservationRefusal | "not_found";

/**
 * Rezervasyon reddi. Çağıran kodu kendi cevabına çevirir: müşteriye dönen
 * cümle `giftCard.error.<code>` sözlüğünden gelir (`/api/orders` ile AYNI
 * cümle), bu yüzden burada ikinci bir müşteri metni YAZILMAZ — aşağıdaki
 * mesaj LOG içindir.
 */
export class GiftCardReservationError extends Error {
  constructor(readonly code: GiftCardReservationCode) {
    super(`gift card reservation refused: ${code}`);
    this.name = "GiftCardReservationError";
  }
}

export interface ReserveGiftCardArgs {
  giftCardId: string;
  /** Siparişin BRÜT tutarı; hediye kartı onu düşürmez, tahsilatı düşürür. */
  amountKurus: number;
  /** Müşterinin seçtiği yöntem; `gift_card_full` bir seçim değil, sonuçtur. */
  paymentMethod: TenderPaymentMethod;
  /** Havale indirimi bu tutarda uygulanıyor mu (teklifin donmuş katalog ayarı). */
  havaleDiscountApplies: boolean;
  now?: Date;
}

/**
 * Kartı kilitler, kuralı uygular ve bakiyeyi düşer; TAHSİLAT ZİNCİRİNİ döner.
 *
 * Zincir kartın KİLİTLİ bakiyesinden kurulur, ön izlemede görülen bakiyeden
 * değil: iki teklifi aynı kartla aynı anda ödemeye çalışan müşteride ikinci
 * istek kalanı alır ya da reddedilir, ikisi birden aynı bakiyeyi harcayamaz.
 */
export async function reserveGiftCardTx(
  tx: MoneyTx,
  args: ReserveGiftCardArgs
): Promise<Tender> {
  const now = args.now ?? new Date();
  const [card] = await tx
    .select()
    .from(giftCards)
    .where(eq(giftCards.id, args.giftCardId))
    .for("update");
  if (!card) throw new GiftCardReservationError("not_found");

  // Kullanım limiti kartın KİLİDİ altında sayılır: kilitsiz bir sayım, iki
  // eşzamanlı ödemenin limiti birlikte aşmasına izin verirdi. Aynı kural saf
  // kararda da yazılıdır (tek kaynak) ve ikisinin aynı girdide aynı cevabı
  // verdiği `scripts/test-gift-card-reservation.ts` ile sınanır; buradaki
  // satır AST nöbetinin gördüğü şeydir — bir yorum kilit taklidi yapamaz.
  let liveUses = 0;
  if (card.maxRedemptions !== null) {
    const uses = await countLiveGiftCardUses(tx, card.id);
    if (uses >= card.maxRedemptions) throw new GiftCardReservationError("limit_reached");
    liveUses = uses;
  }

  const tender = computeTender({
    amountKurus: args.amountKurus,
    paymentMethod: args.paymentMethod,
    giftCardBalanceKurus: card.balanceKurus,
    havaleDiscountApplies: args.havaleDiscountApplies,
  });
  const decision = giftCardReservationDecision({
    card,
    liveUses,
    reserveKurus: tender.giftCardAmountKurus,
    now,
  });
  if (!decision.ok) throw new GiftCardReservationError(decision.code);

  await tx
    .update(giftCards)
    .set({
      balanceKurus: decision.newBalanceKurus,
      status: decision.newStatus,
      updatedAt: new Date(),
    })
    .where(eq(giftCards.id, card.id));

  return tender;
}

/**
 * Rezervasyonun KANIT satırı; taslak yazıldıktan SONRA, aynı işlemde.
 *
 * `gift_card_redemptions_draft_id_unique` (kısmi tekil indeks: `draft_id IS NOT
 * NULL AND refunded_at IS NULL`) taslak başına tek CANLI rezervasyona izin
 * verir — ikinci bir kart ya da yinelenen bir yazım burada patlar. Terfide bu
 * satır `draft_id → order_id` taşınır (`order-draft.ts`), iadede
 * `refunded_at` damgalanır (`gift-credit-return.ts`).
 */
export async function insertGiftRedemptionTx(
  tx: MoneyTx,
  args: { giftCardId: string; draftId: string; amountKurus: number; userId: string }
): Promise<void> {
  await tx.insert(giftCardRedemptions).values({
    giftCardId: args.giftCardId,
    draftId: args.draftId,
    amountKurus: args.amountKurus,
    redeemedByUserId: args.userId,
  });
}
