import { z } from "zod";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { createTurkishAddressSchema } from "@/lib/validators/order";

// Curated product categories. Keep in sync with the `shop.category.*` and
// `product.category.*` dictionary keys used for the storefront filter + labels.
export const PRODUCT_CATEGORIES = [
  "figurine",
  "home_decor",
  "toy",
  "jewelry",
  "gadget",
  "other",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// Seller/admin product create + edit. priceKurus is the final KDV-inclusive
// price in kuruş (the client multiplies the TRY input by 100 before posting).
export function createProductSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    title: z
      .string()
      .min(3, d["validator.product.title.required"])
      .max(120, d["validator.product.title.tooLong"]),
    description: z
      .string()
      .min(10, d["validator.product.description.required"])
      .max(4000, d["validator.product.description.tooLong"]),
    // ₺1 (100 kuruş) minimum, ₺1,000,000 ceiling as a sanity bound.
    priceKurus: z
      .number()
      .int(d["validator.product.price.invalid"])
      .min(100, d["validator.product.price.tooLow"])
      .max(100_000_000, d["validator.product.price.tooHigh"]),
    material: z.enum(["resin", "filament"]).optional(),
    category: z.enum(PRODUCT_CATEGORIES).optional(),
    leadTimeDays: z.number().int().min(1).max(90).optional().default(7),
  });
}

// Storefront checkout for a marketplace purchase. Shares the common checkout
// fields with createOrderSchema (address/payment/gift-card/guest), but carries
// a productId + quantity instead of photoKey/figurineSize/style.
export function createMarketplaceOrderSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    productId: z.string().uuid(d["validator.product.id.invalid"]),
    quantity: z.number().int().min(1).max(20).optional().default(1),
    shippingAddress: createTurkishAddressSchema(locale),
    giftCardCode: z.string().optional(),
    paymentMethod: z.enum(["card", "bank_transfer"]).default("card"),
    upsells: z
      .array(z.enum(["extra_paint", "gift_wrap", "rush_shipping"]))
      .optional()
      .default([]),
    // Guest-checkout fields (mirror createOrderSchema). Read server-side only
    // when there is no session cookie.
    guestEmail: z.string().email("Invalid email").optional(),
    guestName: z.string().min(2).max(120).optional(),
  });
}

export type CreateProductInput = z.infer<ReturnType<typeof createProductSchema>>;
export type CreateMarketplaceOrderInput = z.infer<
  ReturnType<typeof createMarketplaceOrderSchema>
>;
