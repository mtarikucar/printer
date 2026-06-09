import { z } from "zod";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { createTurkishAddressSchema } from "@/lib/validators/order";

// Faz 2/3: checkout for a customer-uploaded STL/OBJ model. uploadedModelId
// references a server-priced `uploadedModels` row (status 'ready' for the auto
// price, or a 'quoted' row for the quote-bridge); the server re-derives the
// trusted price. Shares address/payment/guest fields with the other order
// schemas so the checkout block in /api/orders is reused verbatim.
export function createUploadOrderSchema(locale: Locale = defaultLocale) {
  return z.object({
    uploadedModelId: z.string().uuid(),
    shippingAddress: createTurkishAddressSchema(locale),
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
