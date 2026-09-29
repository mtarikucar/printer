import { z } from "zod";
import type { InvoiceType } from "@/lib/config/quote-types";
import { INVOICE_TYPES } from "@/lib/config/quote-types";
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import type { TurkishAddress } from "@/lib/db/schema";
import { createTurkishAddressSchema } from "@/lib/validators/order";

/**
 * `POST /api/quotes/[id]/checkout` gövdesi.
 *
 * Şema PARAYI DOĞRULAMAZ, yalnız SORAR: `expectedVersion` ve
 * `expectedTotalKurus` istemcinin "ben şunu gördüm" beyanıdır; tutarı
 * snapshot'tan yeniden hesaplayıp bu beyanla karşılaştıran yer
 * `quote-checkout.ts`'tir (uyuşmazlık = 409). Bu yüzden buradaki tek iş
 * ŞEKLİ tutmaktır.
 *
 * Adres `createTurkishAddressSchema` ile alınır: telefon aynı dönüşümle
 * E.164'e çevrilir — ikinci bir telefon normalleştirmesi, sipariş
 * tablolarında iki ayrı biçim demek olurdu.
 *
 * Ek satışlar (`upsells`) BİLEREK YOKTUR: teklif ödemesi kalemleri teklifin
 * kendisinden alır.
 *
 * `giftCardCode` yalnız bir KODDUR; kartın harcanabilirliğine ve rezerve
 * edilecek tutara sunucu karar verir (`gift-card-reservation.ts` +
 * `quote-tender.ts`). Bayrak (`quote_gift_card_enabled`) kapalıyken kod gelirse
 * istek 400 ile döner — sessizce yok saymak, müşterinin kartı uygulandı sanarak
 * tam tutarı ödemesi demek olurdu.
 */

/**
 * Kart kodunun ŞEKLİ. Ödeme gövdesi ile ön izleme ucu AYNI sınırı okur: iki
 * ayrı sınır, ön izlemede kabul edilip ödemede reddedilen (ya da tersi) bir kod
 * demek olurdu.
 */
const giftCardCodeSchema = z.string().trim().min(3).max(30);

export interface QuoteCheckoutInvoice {
  type: InvoiceType;
  /** Kurumsal faturada ZORUNLU (servis doğrular). */
  companyName?: string;
  /** VKN (10) / TCKN (11); kurumsalda zorunlu, bireyselde isteğe bağlı. */
  taxId?: string;
  /** Kurumsal faturada ZORUNLU. */
  taxOffice?: string;
  /** Verilmezse fatura adresi teslimat adresidir. */
  billingAddress?: TurkishAddress;
}

export interface QuoteCheckoutInput {
  /** Ekranın gördüğü `quotes.version`; uyuşmazsa 409. */
  expectedVersion: number;
  /** Ekranın gösterdiği KDV dâhil toplam (kuruş); uyuşmazsa 409. */
  expectedTotalKurus: number;
  shippingAddress: TurkishAddress;
  paymentMethod: "card" | "bank_transfer";
  /** MSY m.6/2-a: ödeme yükümlülüğünden önce alınır, ZORUNLU. */
  distanceContractConsent: true;
  /**
   * Ön Bilgilendirme Formu onayı. Ekranda tek kutu iki metni birden onaylar
   * (`DistanceContractConsent`), bu yüzden isteğe bağlıdır; damga her hâlde
   * yazılır (`preliminary_info_accepted_at`).
   */
  preliminaryInfoConsent?: true;
  invoice: QuoteCheckoutInvoice;
  /** Müşterinin satın alma emri numarası; teklife yazılır. */
  poNumber?: string;
  /** Hediye kartı kodu (`GC-XXXX-XXXX`); bayrak kapalıysa 400. */
  giftCardCode?: string;
  /**
   * Tarayıcı pikselinin ürettiği olay kimliği. Sunucudaki `add_payment_info`
   * olayı AYNI kimlikle kaydedilir ki Meta/TikTok iki kaydı tekilleştirsin
   * (`/api/orders` ile birebir aynı kural).
   */
  analyticsEventId?: string;
}

const invoiceSchema = z.object({
  type: z.enum(INVOICE_TYPES),
  companyName: z.string().trim().min(1).max(200).optional(),
  taxId: z.string().trim().min(1).max(32).optional(),
  taxOffice: z.string().trim().min(1).max(120).optional(),
  billingAddress: createTurkishAddressSchema().optional(),
});

export const quoteCheckoutSchema: z.ZodType<QuoteCheckoutInput> = z.object({
  expectedVersion: z.number().int().min(1),
  expectedTotalKurus: z.number().int().min(1).max(MAX_AMOUNT_KURUS),
  shippingAddress: createTurkishAddressSchema(),
  paymentMethod: z.enum(["card", "bank_transfer"]),
  distanceContractConsent: z.literal(true),
  preliminaryInfoConsent: z.literal(true).optional(),
  invoice: invoiceSchema,
  poNumber: z.string().trim().max(64).optional(),
  giftCardCode: giftCardCodeSchema.optional(),
  analyticsEventId: z.string().max(120).optional(),
});

/**
 * `POST /api/quotes/[id]/gift-card` gövdesi — ödeme ÖNCESİ ön izleme.
 *
 * Tek alan: kod. Tutarı ekran GÖNDERMEZ, sunucu teklifin kendi snapshot'ından
 * hesaplar; ön izlemeye bir tutar girdisi eklemek, ekranın söylediği rakamı
 * cevaba geri yazdırmak olurdu.
 */
export interface QuoteGiftCardPreviewInput {
  code: string;
}

export const quoteGiftCardPreviewSchema: z.ZodType<QuoteGiftCardPreviewInput> = z.object({
  code: giftCardCodeSchema,
});
