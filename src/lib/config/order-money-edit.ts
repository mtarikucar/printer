import { isRefunded, REFUNDED_ORDER_ERROR } from "@/lib/config/order-status-policy";

/** Ortak ekran/API kararı. Tahakkuk sonrası düzeltme ayrı deftere aittir. */
export function moneySplitEditBlock(order: {
  paymentStatus: string;
  status: string;
  manufacturerStatus: string | null;
  painterId: string | null;
  shippedAt: Date | string | null;
  workshopSessionId: string | null;
  manufacturerEarningExists: boolean;
  painterEarningExists: boolean;
}): string | null {
  if (isRefunded(order)) return REFUNDED_ORDER_ERROR;
  if (order.manufacturerEarningExists || order.painterEarningExists) {
    return "Hak ediş kaydı oluşmuş; geçmiş bölüşüm değiştirilemez. Fark, ayrı bir hak ediş düzeltmesi olarak kaydedilmelidir.";
  }
  if (order.shippedAt || order.manufacturerStatus === "shipped" || ["shipped", "delivered", "rejected"].includes(order.status)) {
    return "Sipariş kargolanmış veya kapanmış; kalem bölüşümü değiştirilemez.";
  }
  if (order.painterId) return "Sipariş boyacıya atanmış. Kalemleri değiştirmeden önce boyacı atamasını geri alın.";
  if (order.workshopSessionId) return "Atölye siparişinin kalemleri toplu teslim sözleşmesine bağlıdır; ayrı boyama payı düzenlenemez.";
  return null;
}

export function validateMoneySplit(total: number, production: number, painting: number): string | null {
  if (![total, production, painting].every(Number.isSafeInteger) || production <= 0 || painting < 0) {
    return "Üretim tutarı sıfırdan büyük, boyama tutarı sıfır veya daha büyük olmalı; en fazla iki ondalık basamak kullanın.";
  }
  if (production + painting !== total) return "Üretim ve boyama tutarlarının toplamı sipariş tutarına eşit olmalıdır.";
  return null;
}

export interface MoneySplitEditView {
  amountKurus: number;
  productionKurus: number;
  paintingKurus: number;
  blockedReason: string | null;
}
