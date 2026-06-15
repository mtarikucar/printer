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
    // Nested-taxonomy category node id. Existence is validated in the API route
    // (DB lookup); a product may attach to any node (root or leaf).
    categoryId: z.string().uuid().optional(),
    leadTimeDays: z.number().int().min(1).max(90).optional().default(7),
  });
}

// ─── Product spec: bill-of-materials + assembly recipe ──────────────────────
// A free-form component line (LED, adapter, screw…). `notes` is internal
// (manufacturer/admin only); buyers see name + quantity as "box contents".
export const productComponentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(9999).default(1),
  unit: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
});

// One ordered assembly step. `imageKey` is a storage key from the step-image
// upload route (kept under product-files/).
export const productAssemblyStepSchema = z.object({
  instruction: z.string().trim().min(1).max(1000),
  imageKey: z.string().trim().max(300).optional(),
});

// Atomic replace of a product's BOM + recipe. Print files are managed
// separately (uploaded one-by-one like images).
export const updateProductSpecSchema = z.object({
  components: z.array(productComponentSchema).max(30).default([]),
  assemblySteps: z.array(productAssemblyStepSchema).max(30).default([]),
});

export type ProductComponentInput = z.infer<typeof productComponentSchema>;
export type ProductAssemblyStepInput = z.infer<typeof productAssemblyStepSchema>;

// Storefront checkout for a marketplace purchase. Shares the common checkout
// fields with createOrderSchema (address/payment/gift-card/guest), but carries
// a productId + quantity instead of photoKey/figurineSize/style.
export function createMarketplaceOrderSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    productId: z.string().uuid(d["validator.product.id.invalid"]),
    quantity: z.number().int().min(1).max(20).optional().default(1),
    // Per-product option choices (one per group) + add-ons. Validated +
    // re-priced server-side; ids that don't belong to the product are ignored.
    optionChoiceIds: z.array(z.string().uuid()).max(50).optional().default([]),
    addonIds: z.array(z.string().uuid()).max(50).optional().default([]),
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
    marketingConsent: z.boolean().optional().default(false),
  });
}

// Faz 4: multi-product cart checkout. Shares the address/payment/guest fields
// with createMarketplaceOrderSchema; carries items[] instead of one productId.
// giftCardCode/upsells are kept for type-compat with the shared `common` block
// (the cart UI does not send them in v1).
export function createCartOrderSchema(_locale: Locale = defaultLocale) {
  return z.object({
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.number().int().min(1).max(20),
          optionChoiceIds: z.array(z.string().uuid()).max(50).optional().default([]),
          addonIds: z.array(z.string().uuid()).max(50).optional().default([]),
        })
      )
      .min(1)
      .max(50),
    shippingAddress: createTurkishAddressSchema(_locale),
    giftCardCode: z.string().optional(),
    paymentMethod: z.enum(["card", "bank_transfer"]).default("card"),
    upsells: z
      .array(z.enum(["extra_paint", "gift_wrap", "rush_shipping"]))
      .optional()
      .default([]),
    guestEmail: z.string().email("Invalid email").optional(),
    guestName: z.string().min(2).max(120).optional(),
    marketingConsent: z.boolean().optional().default(false),
  });
}

export type CreateProductInput = z.infer<ReturnType<typeof createProductSchema>>;
export type CreateMarketplaceOrderInput = z.infer<
  ReturnType<typeof createMarketplaceOrderSchema>
>;
