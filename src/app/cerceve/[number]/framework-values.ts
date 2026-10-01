/**
 * MÜŞTERİ ÇERÇEVE EKRANININ SAF KATMANI: kova/durum ↔ SÖZLÜK ANAHTARI.
 *
 * Admin tarafının kardeşi (`src/app/admin/cerceve/[id]/framework-values.ts`)
 * ama işi farklı: orada Türkçe SABİT yazılabilir (ev precedent'i), burada her
 * cümle sözlükten gelmek zorunda (`instantQuote.*`). Bu yüzden bu dosya cümle
 * taşımaz, ANAHTAR taşır.
 *
 * ─── KAPALI KÜME: YEDİ KOVA, YEDİ ANAHTAR ──────────────────────────────────
 *
 * Eşleme `Record<ProgressSegment["key"], keyof Dictionary>` tiplidir ve bu iki
 * yönlü bir kanıttır:
 *  - saf çekirdeğe sekizinci bir kova eklenirse (`FrameworkProgress`) bu dosya
 *    DERLEME hatası verir — ekran, toplamı taahhüde ulaşmayan bir çubuk
 *    çizemez,
 *  - yazılan anahtar sözlükte yoksa `keyof Dictionary` yine DERLEME hatası
 *    verir (`en.ts` `Dictionary` tipinin kaynağıdır), yani ekrana "undefined"
 *    düşmesi imkânsızdır.
 *
 * ARİTMETİK BURADA DEĞİL: dilim genişlikleri `progressSegments` (admin'in saf
 * modülü) tarafından üretilir ve o da yalnız ADET oranı hesaplar. Bu dosyada ve
 * `client.tsx` dosyalarında tutar ÇARPILMAZ, BÖLÜNMEZ, ORANLANMAZ — her rakam
 * uçtan hazır iner (program değişmezi §5).
 *
 * SAF MODÜL: React yok, DB yok, `node:` import'u yok.
 */
import {
  progressSegments,
  type ProgressSegment,
} from "@/app/admin/cerceve/[id]/framework-values";
import type {
  FrameworkBatchStatus,
  FrameworkProgress,
  FrameworkStatus,
} from "@/lib/config/quote-framework";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/** Kova → sözlük anahtarı. Yedi kova, yedi anahtar; fazlası/eksiği derlenmez. */
export const FRAMEWORK_BUCKET_DICT_KEYS: Record<ProgressSegment["key"], keyof Dictionary> = {
  unplannedUnits: "instantQuote.framework.unplanned",
  plannedUnits: "instantQuote.framework.planned",
  awaitingPaymentUnits: "instantQuote.framework.awaitingPayment",
  inProductionUnits: "instantQuote.framework.inProduction",
  shippedUnits: "instantQuote.framework.shipped",
  deliveredUnits: "instantQuote.framework.delivered",
  cancelledOrRefundedUnits: "instantQuote.framework.cancelledOrRefunded",
};

/** Anlaşma durumu → sözlük anahtarı (beş durum, beş anahtar). */
export const FRAMEWORK_STATUS_DICT_KEYS: Record<FrameworkStatus, keyof Dictionary> = {
  draft: "instantQuote.framework.status.draft",
  active: "instantQuote.framework.status.active",
  completed: "instantQuote.framework.status.completed",
  expired: "instantQuote.framework.status.expired",
  cancelled: "instantQuote.framework.status.cancelled",
};

/** Parti durumu → sözlük anahtarı (üç durum, üç anahtar). */
export const BATCH_STATUS_DICT_KEYS: Record<FrameworkBatchStatus, keyof Dictionary> = {
  planned: "instantQuote.framework.batchStatus.planned",
  released: "instantQuote.framework.batchStatus.released",
  cancelled: "instantQuote.framework.batchStatus.cancelled",
};

export interface CustomerProgressSegment extends ProgressSegment {
  /** Sözlükten çözülmüş etiket — ekran ikinci bir cümle kurmaz. */
  label: string;
}

/**
 * Kova kırılımını MÜŞTERİ etiketleriyle çubuk dilimlerine çevirir.
 *
 * Oranı `progressSegments` üretir (tek aritmetik), etiketi sözlük verir. Admin
 * ekranının Türkçe sabitleri BURAYA KOPYALANMAZ: iki yüzey aynı cümleyi
 * paylaşmıyor, aynı SAYIYI paylaşıyor.
 */
export function customerProgressSegments(
  progress: FrameworkProgress,
  d: Dictionary
): CustomerProgressSegment[] {
  return progressSegments(progress).map((segment) => ({
    ...segment,
    label: d[FRAMEWORK_BUCKET_DICT_KEYS[segment.key]],
  }));
}
