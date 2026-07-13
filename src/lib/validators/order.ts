import { z } from "zod";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { phoneField } from "@/lib/phone";
import { isValidTemplateSlug, DEFAULT_TEMPLATE_SLUG, priceKindForStyle } from "@/lib/create/design-templates";

// Finish packages are split per price-kind: character figures vs geometry
// objects. The server is the trust boundary — a finish must belong to the
// kind implied by the chosen design template, else the price dispatcher would
// silently apply a 0 surcharge to a mismatched (e.g. expensive) finish.
const FIGURE_FINISHES = ["paintable_kit", "hand_painted", "collector_raw", "luxe_display"];
const OBJECT_FINISHES = ["raw", "smoothed", "painted"];
// Creative Lab items (keychain/magnet/lamp) are flat-priced with no finish axis,
// so only the neutral default is valid — otherwise a mismatched finish like
// "hand_painted" would validate, add 0 to the flat price, yet flag the order for
// paid professional painting (needsPainting) the customer never paid for.
const FLAT_FINISHES = ["paintable_kit"];
const FINISHES_BY_KIND: Record<string, string[]> = {
  figure: FIGURE_FINISHES,
  object: OBJECT_FINISHES,
  keychain: FLAT_FINISHES,
  fridge_magnet: FLAT_FINISHES,
  lamp: FLAT_FINISHES,
};

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
    telefon: phoneField(defaultCountryForLocale(locale), d["validator.phone.invalid"]),
  });
}

export function createOrderSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    photoKey: z.string().min(1, d["validator.photo.required"]),
    figurineSize: z.enum(["kucuk", "orta", "buyuk"], {
      error: d["validator.size.invalid"],
    }),
    style: z
      .string()
      .refine(isValidTemplateSlug, "invalid template")
      .default(DEFAULT_TEMPLATE_SLUG),
    material: z.enum(["resin", "filament"]).default("resin"),
    finish: z
      .enum([
        "paintable_kit",
        "hand_painted",
        "collector_raw",
        "luxe_display",
        "raw",
        "smoothed",
        "painted",
      ])
      .default("paintable_kit"),
    modifiers: z.array(z.enum(["pixel_art"])).optional().default([]),
    shippingAddress: createTurkishAddressSchema(locale),
    giftCardCode: z.string().optional(),
    paymentMethod: z.enum(["card", "bank_transfer"]).default("card"),
    upsells: z
      .array(z.enum(["extra_paint", "gift_wrap", "rush_shipping", "digital_files"]))
      .optional()
      .default([]),
    // Guest-checkout fields (Q6). Server reads these only when there is no
    // session cookie; logged-in customers get their identity from the JWT.
    guestEmail: z.string().email("Invalid email").optional(),
    guestName: z.string().min(2).max(120).optional(),
    // İYS opt-in captured at guest checkout (logged-in users manage it in
    // their account). Defaults false.
    marketingConsent: z.boolean().optional().default(false),
  }).refine(
    (v) => {
      const allowed = FINISHES_BY_KIND[priceKindForStyle(v.style)] ?? FIGURE_FINISHES;
      return allowed.includes(v.finish);
    },
    { message: "Seçilen tasarım deseni için geçersiz bitiş seçimi", path: ["finish"] }
  );
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
