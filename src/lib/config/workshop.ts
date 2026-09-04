/**
 * Atölye seansları — saf çekirdek.
 *
 * DB yok, `server-only` yok: bu modülü admin arayüzü, public katılım sayfası,
 * API route'ları ve BullMQ worker'ları birlikte import eder. Bir `server-only`
 * importu standalone Node worker'ını crash-loop'a sokar (bkz. order-draft
 * zinciri).
 */

/**
 * Boyanmamış kişiye özel atölye figürü. Boyama işi seansın KENDİSİDİR ve
 * mekanda yapılır; bu yüzden boyacı partneri bu akışa hiç girmez ve siparişin
 * boyama kalemi sıfırdır.
 */
export const WORKSHOP_FIGURE_PRICE_KURUS = 135000;

/** Katılım linki seanstan kaç gün önce kapanır. */
export const WORKSHOP_JOIN_CLOSES_DAYS_BEFORE = 5;

/** Parti mekana seanstan kaç gün önce teslim edilir. */
export const WORKSHOP_DELIVER_DAYS_BEFORE = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Üretici payı hacimle düşer: 20 figürü tek plakada basmak, birini basmaktan
 * birim başına çok daha ucuzdur.
 *
 * Merdiven KONTENJANA DEĞİL, gerçekleşen ödenmiş sipariş adedine bağlıdır.
 * Kapasiteye bağlansaydı 50 kişilik seanstaki 10 sipariş ile 20 kişilik
 * seanstaki 10 sipariş — üretici için aynı iş — farklı ücret alırdı.
 *
 * `commissionRateBps` PLATFORMUN payıdır; üreticinin net payı `10000 - bps`.
 * Doğrusal formül yerine merdiven, çünkü sözleşmede tek cümleyle anlatılabiliyor
 * ve üretici kabul etmeden önce net payını kesin görebiliyor. Aynı zihinsel
 * model `productPriceTiers` (minQuantity → fiyat) ile tutarlı.
 */
export const WORKSHOP_COMMISSION_TIERS: ReadonlyArray<{
  minOrders: number;
  commissionRateBps: number;
}> = [
  { minOrders: 1, commissionRateBps: 4000 }, // üretici %60
  { minOrders: 3, commissionRateBps: 4500 }, // %55
  { minOrders: 6, commissionRateBps: 5000 }, // %50
  { minOrders: 11, commissionRateBps: 5500 }, // %45
  { minOrders: 16, commissionRateBps: 6000 }, // %40
] as const;

/**
 * Bir seansın ödenmiş sipariş adedine düşen platform komisyonu (bps).
 * Sipariş yoksa merdivenin ilk basamağı döner — boş parti üreticiyi cezalandırmaz.
 */
export function workshopCommissionRateBps(paidOrderCount: number): number {
  const n = Math.max(0, Math.trunc(paidOrderCount) || 0);
  let rate = WORKSHOP_COMMISSION_TIERS[0].commissionRateBps;
  for (const tier of WORKSHOP_COMMISSION_TIERS) {
    if (n >= tier.minOrders) rate = tier.commissionRateBps;
    else break;
  }
  return rate;
}

/**
 * Seansın başlangıcından katılım kapanışı ve teslim tarihini türetir.
 * Sonuç DB'ye YAZILIR, her okumada yeniden türetilmez: admin tek bir seansta
 * kaydırabilmeli ve geçmiş seansların kuralı sonradan değişen bir sabitle
 * bozulmamalı.
 */
export function deriveSessionDates(startsAt: Date): {
  joinClosesAt: Date;
  deliverBy: Date;
} {
  const t = startsAt.getTime();
  return {
    joinClosesAt: new Date(t - WORKSHOP_JOIN_CLOSES_DAYS_BEFORE * DAY_MS),
    deliverBy: new Date(t - WORKSHOP_DELIVER_DAYS_BEFORE * DAY_MS),
  };
}

export const WORKSHOP_SESSION_STATUSES = [
  "draft",
  "open",
  "closed",
  "in_production",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
] as const;
export type WorkshopSessionStatus = (typeof WORKSHOP_SESSION_STATUSES)[number];

export const WORKSHOP_SESSION_STATUS_LABELS: Record<WorkshopSessionStatus, string> = {
  draft: "Taslak",
  open: "Katılıma açık",
  closed: "Katılım kapandı",
  in_production: "Üretimde",
  shipped: "Mekana yolda",
  delivered: "Mekana teslim edildi",
  completed: "Tamamlandı",
  cancelled: "İptal edildi",
};

export const WORKSHOP_PARTICIPANT_STATUSES = [
  "pending_payment",
  "paid",
  "model_ready",
  "in_production",
  "delivered",
  "cancelled",
] as const;
export type WorkshopParticipantStatus =
  (typeof WORKSHOP_PARTICIPANT_STATUSES)[number];

export const WORKSHOP_PARTICIPANT_STATUS_LABELS: Record<
  WorkshopParticipantStatus,
  string
> = {
  pending_payment: "Ödeme bekleniyor",
  paid: "Ödendi",
  model_ready: "Modeli hazır",
  in_production: "Üretimde",
  delivered: "Teslim edildi",
  cancelled: "İptal",
};
