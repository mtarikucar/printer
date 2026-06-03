import { z } from "zod";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { phoneField } from "@/lib/phone";

function defaultCountryForLocale(_locale: Locale) {
  // Shipping is Turkey-only today; default the parser to TR regardless of UI locale.
  return "TR" as const;
}

export function createTurkishAddressSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    adres: z.string().min(1, d["validator.address.required"]),
    mahalle: z.string().min(1, d["validator.neighborhood.required"]),
    ilce: z.string().min(1, d["validator.district.required"]),
    il: z.string().min(1, d["validator.city.required"]),
    postaKodu: z
      .string()
      .min(1, d["validator.postalCode.required"])
      .regex(/^\d{5}$/, d["validator.postalCode.invalid"]),
    telefon: phoneField(defaultCountryForLocale(locale), d["validator.phone.min"]),
  });
}

export function createOrderSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    photoKey: z.string().min(1, d["validator.photo.required"]),
    figurineSize: z.enum(["kucuk", "orta", "buyuk"], {
      error: d["validator.size.invalid"],
    }),
    style: z.enum(["realistic", "disney", "anime", "chibi", "object"]).default("disney"),
    material: z.enum(["resin", "filament"]).default("resin"),
    modifiers: z.array(z.enum(["pixel_art"])).optional().default([]),
    shippingAddress: createTurkishAddressSchema(locale),
    giftCardCode: z.string().optional(),
    paymentMethod: z.enum(["card", "bank_transfer"]).default("card"),
    upsells: z
      .array(z.enum(["extra_paint", "gift_wrap", "rush_shipping"]))
      .optional()
      .default([]),
    // Guest-checkout fields (Q6). Server reads these only when there is no
    // session cookie; logged-in customers get their identity from the JWT.
    guestEmail: z.string().email("Invalid email").optional(),
    guestName: z.string().min(2).max(120).optional(),
  });
}

export function createShipOrderSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    trackingNumber: z.string().min(1, d["validator.tracking.required"]),
    carrier: z
      .enum(["yurtici", "aras", "mng", "ptt", "surat", "other"])
      .optional(),
  });
}

// Default schemas for backward compatibility
export const turkishAddressSchema = createTurkishAddressSchema();
export const shipOrderSchema = createShipOrderSchema();

export type CreateOrderInput = z.infer<ReturnType<typeof createOrderSchema>>;
export type TurkishAddressInput = z.infer<ReturnType<typeof createTurkishAddressSchema>>;
