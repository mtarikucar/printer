import { z } from "zod";
import type { Locale } from "@/lib/i18n/types";
import { defaultLocale } from "@/lib/i18n/types";
import { createTurkishAddressSchema } from "@/lib/validators/order";
import { WORKSHOP_SESSION_STATUSES } from "@/lib/config/workshop";

/**
 * Mekan yaratma/güncelleme. Adres, SİPARİŞ adresiyle aynı şemadan geçer —
 * seans siparişlerine birebir kopyalanacağı için posta kodu dâhil eksiksiz
 * olmak zorunda. Başvuru formu posta kodu toplamıyor; admin burada tamamlar.
 */
export function createVenueSchema(locale: Locale = defaultLocale) {
  return z.object({
    name: z.string().trim().min(2, "Mekan adı en az 2 karakter").max(120),
    contactName: z.string().trim().min(2).max(120),
    contactEmail: z.string().trim().email("Geçerli bir e-posta girin").max(200),
    contactPhone: z.string().trim().min(1).max(40),
    address: createTurkishAddressSchema(locale),
    notes: z.string().trim().max(2000).optional(),
  });
}

export const updateVenueStatusSchema = z.object({
  status: z.enum(["active", "paused", "archived"]),
});

/**
 * Seans yaratma. `startsAt` ISO string; kapanış ve teslim tarihleri
 * config/workshop.ts'ten TÜRETİLİR, istemciden alınmaz.
 */
export const createSessionSchema = z.object({
  venueId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(30).max(600).default(120),
  capacity: z.number().int().min(1).max(200),
  pricePerSeatKurus: z.number().int().min(100).max(100_000_00),
  manufacturerId: z.string().uuid().optional(),
  adminNotes: z.string().trim().max(2000).optional(),
});

export const updateSessionSchema = z.object({
  status: z.enum(WORKSHOP_SESSION_STATUSES).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  manufacturerId: z.string().uuid().nullable().optional(),
  joinClosesAt: z.string().datetime({ offset: true }).optional(),
  adminNotes: z.string().trim().max(2000).optional(),
});

/** Public katılım formu. Fotoğraf ayrı /api/upload ile yüklenir, key gelir. */
export const joinSessionSchema = z.object({
  fullName: z.string().trim().min(2, "Adınızı girin").max(120),
  email: z.string().trim().email("Geçerli bir e-posta girin").max(200),
  phone: z.string().trim().min(1, "Telefon girin").max(40),
  photoKey: z.string().trim().min(1).max(300),
  kvkkConsent: z.literal(true, {
    message: "Devam etmek için KVKK aydınlatma metnini onaylamalısınız.",
  }),
  contentConsent: z.literal(true, {
    message: "Fotoğraf kullanım haklarına ilişkin onayı vermelisiniz.",
  }),
});

export const batchShipSchema = z.object({
  carrier: z.enum(["yurtici", "aras", "mng", "ptt", "surat", "other", "elden"]),
  trackingNumber: z.string().trim().max(60).optional(),
});
