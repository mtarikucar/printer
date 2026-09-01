import { z } from "zod";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { phoneField } from "@/lib/phone";
import { SIZE_PRESET_KEYS } from "@/lib/config/sizes";
import { isValidTemplateSlug, DEFAULT_TEMPLATE_SLUG, priceKindForStyle } from "@/lib/create/design-templates";

// Finish packages are split per price-kind: character figures vs geometry
// objects. The server is the trust boundary — a finish must belong to the
// kind implied by the chosen design template, else the price dispatcher would
// silently apply a 0 surcharge to a mismatched (e.g. expensive) finish.
//
// Since 2026-08-24 a character figure is ONE product whose price already
// bundles professional hand painting, so `hand_painted` is the ONLY finish a
// NEW figure order may carry. The retired kit/raw/luxe tiers are deliberately
// gone from this set: their surcharges are all 0 (so the customer still paid
// ₺3.499) but `finishNeedsPainter("paintable_kit")` is false, which would ship
// the order straight past the painter — painter earns ₺0, their ₺1.000 share
// falls into the manufacturer's base, and the shipped-email lists paint-kit
// contents that are not in the box. Only /create's client constant was keeping
// that shut; this is the server-side gate.
//
// This narrows NEW orders only. Reading, displaying, invoicing or fulfilling an
// order written before this date is untouched — nothing re-parses stored rows
// through this schema (see prices.ts, which still resolves all four legacy
// finishes to a 0 surcharge).
const FIGURE_FINISHES = ["hand_painted"];
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

/**
 * Default finish when the client omits one. It MUST depend on the price kind:
 * a single flat default would be valid for one kind and instantly rejected by
 * the per-kind refine for the others. The figure default is `hand_painted` —
 * the finish the ₺3.499 base price actually pays for.
 */
/**
 * The finishes a given price kind may legitimately carry. Exported so the
 * NON-web order writers (the WhatsApp agent, which never runs
 * `createOrderSchema`) can enforce the same rule instead of trusting whatever
 * the model wrote — a figure with `paintable_kit` silently buries the painting
 * share in the manufacturer's base, and a flat Creative Lab item with
 * `hand_painted` charges a painter share the customer never paid.
 */
export function allowedFinishesForStyle(style: unknown): string[] {
  const slug =
    typeof style === "string" && isValidTemplateSlug(style) ? style : DEFAULT_TEMPLATE_SLUG;
  return FINISHES_BY_KIND[priceKindForStyle(slug)] ?? FIGURE_FINISHES;
}

/**
 * Coerce a (possibly untrusted) finish to one this price kind allows, falling
 * back to that kind's default. Same rule the web validator enforces.
 */
export function coerceFinishForStyle(style: unknown, finish: unknown): string {
  const allowed = allowedFinishesForStyle(style);
  return typeof finish === "string" && allowed.includes(finish) ? finish : allowed[0];
}

function defaultFinishForStyle(style: unknown): string {
  const slug = typeof style === "string" && isValidTemplateSlug(style) ? style : DEFAULT_TEMPLATE_SLUG;
  return (FINISHES_BY_KIND[priceKindForStyle(slug)] ?? FIGURE_FINISHES)[0];
}

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
  const schema = z.object({
    photoKey: z.string().min(1, d["validator.photo.required"]),
    // One sellable size (`standart`, 15 cm). A bespoke measurement is quoted by
    // hand over WhatsApp, so it never reaches this schema.
    figurineSize: z.enum(SIZE_PRESET_KEYS, {
      error: d["validator.size.invalid"],
    }),
    style: z
      .string()
      .refine(isValidTemplateSlug, "invalid template")
      .default(DEFAULT_TEMPLATE_SLUG),
    // One product, one material: 15 cm SLA resin. Filament is no longer sold.
    // Existing orders keep whatever they stored; this only gates NEW orders.
    material: z.enum(["resin"]).default("resin"),
    // The union of every finish any kind may use; the per-kind refine below is
    // what actually gates it. Omitted values are filled in by the preprocess
    // step (see `defaultFinishForStyle`), never by a `.default()` here — a
    // fixed default cannot be right for all three kinds at once.
    finish: z.enum([
      "paintable_kit",
      "hand_painted",
      "collector_raw",
      "luxe_display",
      "raw",
      "smoothed",
      "painted",
    ]),
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

  // Fill the omitted `finish` from the chosen design template's price kind
  // BEFORE validation, so the refine above sees a value that belongs to the
  // right kind. Everything else passes through untouched.
  return z.preprocess((raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const input = raw as Record<string, unknown>;
    if (input.finish != null) return raw;
    return { ...input, finish: defaultFinishForStyle(input.style) };
  }, schema);
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
