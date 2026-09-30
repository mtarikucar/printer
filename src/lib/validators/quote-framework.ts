import { z } from "zod";
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import { MAX_BATCHES_PER_FRAMEWORK } from "@/lib/config/quote-framework";
import type { TurkishAddress } from "@/lib/db/schema";
import { createTurkishAddressSchema } from "@/lib/validators/order";

/**
 * Çerçeve anlaşma uçlarının gövde şemaları (`/api/admin/frameworks/**`).
 *
 * Deseni `quote-checkout.ts` validator'ından alır ve onunla AYNI kuralı taşır:
 * **şema PARAYI DOĞRULAMAZ, yalnız ŞEKLİ tutar.**
 *
 * Bu, çerçevede sıradan bir hijyen değil, kilidin kendisidir. Parti tutarı
 * gövdeden HİÇ GELMEZ: adedi admin verir, KİLİTLİ BİRİM FİYATI anlaşmanın
 * donmuş snapshot'ı verir ve brütü `computeQuote` hesaplar (servis). Gövdeye
 * bir `amountKurus` ya da `unitKurus` alanı eklemek, admin ekranının kilitli
 * fiyatı geçersiz kılmasına kapı açardı — o kapı bu dosyada KAPALI TUTULUR.
 *
 * Tavanlar da burada YENİDEN YAZILMAZ, saf çekirdekten IMPORT EDİLİR
 * (`MAX_BATCHES_PER_FRAMEWORK`, `MAX_AMOUNT_KURUS`): iki sayının ayrışması,
 * şemanın kabul ettiği bir planın servis tarafından reddedilmesi demekti.
 */

/** `YYYY-MM-DD`, İstanbul takvimi (`business-days.ts` ile doğrulanır). */
const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı");

/** Gerekçe alt sınırı `quote-admin.ts`in `requireReason`'ıyla AYNI: on karakter. */
const reasonSchema = z.string().trim().min(10).max(2000);

const uuidSchema = z.string().uuid();

/** Parti satırı: parça + adet. FİYAT YOK (dosya başlığı). */
export interface FrameworkBatchLineBody {
  partId: string;
  quantity: number;
}

const batchLineSchema: z.ZodType<FrameworkBatchLineBody> = z.object({
  partId: uuidSchema,
  // Üst sınır `quote_framework_batch_lines_qty_chk` ile AYNI (1..100000):
  // şemanın kabul ettiği bir adet veritabanında 23514 ile düşmemeli.
  quantity: z.number().int().min(1).max(100_000),
});

export interface FrameworkBatchBody {
  plannedShipDate: string;
  lines: FrameworkBatchLineBody[];
  note?: string;
}

const batchSchema: z.ZodType<FrameworkBatchBody> = z.object({
  plannedShipDate: dateKeySchema,
  lines: z.array(batchLineSchema).min(1).max(100),
  note: z.string().trim().max(2000).optional(),
});

// ─── POST /api/admin/frameworks ─────────────────────────────────────────────

export interface FrameworkCreateInput {
  quoteId: string;
  /** `YYYY-MM-DD`; anlaşmanın fiyat kilidinin son günü. */
  priceLockedUntil: string;
  shippingAddress: TurkishAddress;
  title?: string;
  preferredManufacturerId?: string;
  customerNote?: string;
  adminNote?: string;
  reason: string;
}

export const frameworkCreateSchema: z.ZodType<FrameworkCreateInput> = z.object({
  quoteId: uuidSchema,
  priceLockedUntil: dateKeySchema,
  shippingAddress: createTurkishAddressSchema(),
  title: z.string().trim().max(200).optional(),
  preferredManufacturerId: uuidSchema.optional(),
  customerNote: z.string().trim().max(2000).optional(),
  adminNote: z.string().trim().max(2000).optional(),
  reason: reasonSchema,
});

// ─── POST /api/admin/frameworks/[id]/activate ───────────────────────────────

export interface FrameworkActivateInput {
  reason: string;
}

export const frameworkActivateSchema: z.ZodType<FrameworkActivateInput> = z.object({
  reason: reasonSchema,
});

// ─── POST /api/admin/frameworks/[id]/batches ────────────────────────────────

export interface FrameworkPlanInput {
  batches: FrameworkBatchBody[];
  reason: string;
  /**
   * `true` = YALNIZ ÖN İZLEME: hiçbir satır yazılmaz, servis tutarları ve
   * retleri döner. Ekran kendi para aritmetiğini kurmasın diye var (program
   * değişmezi: `client.tsx`te çarpma/bölme/oran YOKTUR).
   */
  dryRun?: boolean;
}

export const frameworkPlanSchema: z.ZodType<FrameworkPlanInput> = z.object({
  batches: z.array(batchSchema).min(1).max(MAX_BATCHES_PER_FRAMEWORK),
  reason: reasonSchema,
  dryRun: z.boolean().optional(),
});

// ─── POST /api/admin/frameworks/[id]/batches/[batchId]/release ──────────────

export interface FrameworkReleaseInput {
  reason: string;
  /**
   * Ekranın gördüğü kilitli tutar — bir BEYANDIR, girdi değil.
   * `quote-checkout.ts`in `expectedTotalKurus` kuralının birebir aynısı:
   * tahsil edilecek tutar hiçbir hâlde gövdeden gelmez, anlaşmanın donmuş
   * snapshot'ından yeniden hesaplanır ve beyanla uyuşmazsa istek 409 döner.
   */
  expectedAmountKurus?: number;
}

export const frameworkReleaseSchema: z.ZodType<FrameworkReleaseInput> = z.object({
  reason: reasonSchema,
  expectedAmountKurus: z.number().int().min(1).max(MAX_AMOUNT_KURUS).optional(),
});

// ─── POST .../cancel (parti ve anlaşma) ─────────────────────────────────────

export interface FrameworkCancelInput {
  reason: string;
}

export const frameworkCancelSchema: z.ZodType<FrameworkCancelInput> = z.object({
  reason: reasonSchema,
});

// ─── POST /api/admin/frameworks/[id]/extend ─────────────────────────────────

export interface FrameworkExtendInput {
  /** YENİ kilit sonu (`YYYY-MM-DD`); servis "ileri gitmeli" kuralını uygular. */
  priceLockedUntil: string;
  reason: string;
}

export const frameworkExtendSchema: z.ZodType<FrameworkExtendInput> = z.object({
  priceLockedUntil: dateKeySchema,
  reason: reasonSchema,
});
