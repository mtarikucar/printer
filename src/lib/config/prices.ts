export const PRICES_KURUS: Record<string, number> = {
  kucuk: 99900,
  orta: 139900,
  buyuk: 179900,
};

export const DIGITAL_PRICE_KURUS = 19900; // ₺199

export const GIFT_CARD_DENOMINATIONS_KURUS = [
  50000, 99900, 139900, 179900,
] as const;

export const GIFT_CARD_THEMES = [
  "ramazan", "dogum_gunu", "yeni_yil", "sevgililer_gunu", "genel",
] as const;
