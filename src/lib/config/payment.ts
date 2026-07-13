export const HAVALE_DISCOUNT_RATE = 0.03;
export const HAVALE_DEADLINE_HOURS = 72;
export const HAVALE_REMINDER_HOURS = 24;

// Backstop window after which an unpaid CARD draft is expired to release any
// reserved gift-card balance. Set to the havale window: long enough that a
// customer retrying the PayTR payment from the track page is never cut off (and
// well beyond any window in which a PayTR success callback could still arrive),
// finite so an abandoned checkout doesn't hold the gift-card credit forever.
export const CARD_DEADLINE_HOURS = 72;

// Receipt upload limits (havale dekontu)
export const RECEIPT_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const RECEIPT_ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function calculateHavaleDiscount(amountAfterGiftCardKurus: number): number {
  if (amountAfterGiftCardKurus <= 0) return 0;
  return Math.floor(amountAfterGiftCardKurus * HAVALE_DISCOUNT_RATE);
}

export interface BankDetails {
  bankName: string;
  accountHolder: string;
  iban: string;
  branch: string;
}

export function getBankDetails(): BankDetails {
  return {
    bankName: process.env.BANK_NAME ?? "",
    accountHolder: process.env.BANK_ACCOUNT_HOLDER ?? "",
    iban: process.env.BANK_IBAN ?? "",
    branch: process.env.BANK_BRANCH ?? "",
  };
}
