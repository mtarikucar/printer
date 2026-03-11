import { z } from "zod";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n/dictionaries";

export function createAdminGiftCardSchema() {
  return z.object({
    amountTL: z.number().min(1).max(100000),
    recipientName: z.string().max(100).optional().or(z.literal("")),
    recipientEmail: z.string().email().optional().or(z.literal("")),
    note: z.string().max(500).optional().or(z.literal("")),
    expirationDays: z.number().int().min(0).max(3650).optional(), // 0 = no expiration, omitted = 365 days
    maxRedemptions: z.number().int().min(1).max(100000).optional(), // omitted = unlimited
  });
}

export function createRedeemGiftCardSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    code: z.string().min(1, d["validator.giftCard.codeRequired"]),
  });
}

export type AdminGiftCardInput = z.infer<ReturnType<typeof createAdminGiftCardSchema>>;
export type RedeemGiftCardInput = z.infer<ReturnType<typeof createRedeemGiftCardSchema>>;
