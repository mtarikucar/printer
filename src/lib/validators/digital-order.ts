import { z } from "zod";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { getDictionary } from "@/lib/i18n/dictionaries";

export function createDigitalOrderSchema(locale: Locale = defaultLocale) {
  const d = getDictionary(locale);
  return z.object({
    sourceOrderId: z.string().uuid(d["validator.digital.sourceOrderRequired"]),
    giftCardCode: z.string().optional(),
  });
}

export type CreateDigitalOrderInput = z.infer<ReturnType<typeof createDigitalOrderSchema>>;
