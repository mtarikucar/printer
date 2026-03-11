import { z } from "zod";
import { GIFT_CARD_DENOMINATIONS_KURUS, GIFT_CARD_THEMES } from "@/lib/config/prices";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n/dictionaries";

export function createPurchaseGiftCardSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    theme: z.enum(GIFT_CARD_THEMES as unknown as [string, ...string[]], {
      error: d["validator.giftCard.themeInvalid"],
    }),
    amountKurus: z
      .number()
      .refine(
        (val) => (GIFT_CARD_DENOMINATIONS_KURUS as readonly number[]).includes(val),
        d["validator.giftCard.amountInvalid"]
      ),
    recipientEmail: z.string().email(d["api.auth.emailInvalid"]).optional().or(z.literal("")),
    recipientName: z.string().max(100).optional().or(z.literal("")),
    recipientMessage: z.string().max(500).optional().or(z.literal("")),
  });
}

export function createRedeemGiftCardSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    code: z.string().min(1, d["validator.giftCard.codeRequired"]),
  });
}

export type PurchaseGiftCardInput = z.infer<ReturnType<typeof createPurchaseGiftCardSchema>>;
export type RedeemGiftCardInput = z.infer<ReturnType<typeof createRedeemGiftCardSchema>>;
