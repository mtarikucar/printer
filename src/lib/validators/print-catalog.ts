/**
 * Baskı kataloğunun YAZMA sözleşmesi: yöneticinin girdiği her sayının sınırı.
 *
 * NEDEN ŞEMADA, FORMDA DEĞİL: bu tablodaki sayılar doğrudan müşteriye çıkan
 * fiyata girer. Yanlış bir tuşa basmak (baz puan yerine yüzde, gram yerine
 * kilogram, 100 yerine 10000) ekranda fark edilmeyen ama yayına çıkan bir fiyat
 * hatasıdır. Form kolayca atlanır (curl, ikinci bir ekran, ileride bir betik);
 * şema atlanamaz — rota gövdeyi BURADAN geçirmeden servise vermez.
 *
 * İki kural bilinçlidir ve şemanın kendisiyle uygulanır:
 *
 *  - **Anahtar (`key`) ve bağlı teknoloji yamada YOKTUR.** Açık tekliflerin
 *    parçaları (`quote_parts.technology_key` / `material_key` / `finish_key`)
 *    bu anahtarlara METİN olarak bakar; anahtarı değiştirmek, kataloğu
 *    değiştirmez, açık teklifleri öksüz bırakır. Anahtarı yanlış giren satırı
 *    pasifleştirip yenisini açar.
 *  - **`expectedUpdatedAt` her yamada ZORUNLU.** İki sekmede açık bir katalog,
 *    ikinci kaydın birincisini sessizce ezmesi demektir; damga uyuşmazlığı 409
 *    ile döner.
 *
 * SAF MODÜL: DB yok, `server-only` yok — rota, test ve (tip olarak) ekran
 * aynı dosyadan okur.
 */
import { z } from "zod";
import {
  ADDON_PRICE_TYPES,
  COST_LINE_KINDS,
  LEAD_TIER_KEYS,
} from "@/lib/config/quote-types";

/**
 * Sınırlar TEK yerde: ekran aynı sayıları ipucu olarak yazar, şema aynı
 * sayılarla reddeder. İkisi ayrı yazılsaydı, ekranın "izin verilir" dediği bir
 * değeri sunucu reddederdi.
 */
export const CATALOG_LIMITS = {
  /** Kuruş. ₺100.000 — tek bir katalog alanının makul üst sınırı. */
  maxPriceKurus: 10_000_000,
  densityGCm3: { min: 0.5, max: 3 },
  supportFactor: { min: 1, max: 3 },
  buildMm: { min: 10, max: 2000 },
  /** Adet indirimi baz puanı (%90 üstü indirim bir hata olurdu). */
  discountBps: { min: 0, max: 9000 },
  /** Teslim kademesi çarpanı: %50 – %300. */
  multiplierBps: { min: 5000, max: 30_000 },
  /** Kademenin iş günü alt sınırı. */
  minDays: { min: 1, max: 60 },
  layerUm: { min: 10, max: 1000 },
  infillPct: { min: 1, max: 100 },
  leadDaysExtra: { min: 0, max: 60 },
  sortOrder: { min: 0, max: 999 },
} as const;

const TR = {
  key: "Anahtar yalnız küçük harf, rakam ve alt çizgi içerebilir (2–32 karakter).",
  name: "Ad en az 2 karakter olmalı.",
  money: `Tutar 0 ile ${CATALOG_LIMITS.maxPriceKurus} kuruş arasında bir tam sayı olmalı.`,
  positive: "Değer 0'dan büyük olmalı.",
  hex: "Renk kodu #RRGGBB biçiminde olmalı (örn. #1A1A1A).",
  colors: "En az bir renk tanımlanmalı.",
  colorKeys: "Renk anahtarları benzersiz olmalı.",
  holiday: "Tatil tarihleri YYYY-AA-GG biçiminde gerçek bir tarih olmalı.",
  holidaysUnique: "Aynı tatil tarihi iki kez yazılamaz.",
  qtyBreaksStart: "İlk adet kademesi 1 adetten başlamalı.",
  qtyBreaksIncreasing: "Adet kademeleri kesin artan sırada olmalı.",
  qtyBreaksEmpty: "En az bir adet kademesi olmalı.",
  leadTiers: "Teslim kademeleri ekonomik, standart ve ekspresin üçünü de içermeli.",
  priceBreaks: "Fiyat kademesi adetleri kesin artan olmalı ve 1'den başlamalı.",
  stamp: "Kaydın son güncellenme damgası (expectedUpdatedAt) gerekli.",
  layerDefault: "Varsayılan katman, katman seçenekleri arasında olmalı.",
  infillDefault: "Varsayılan doluluk, doluluk seçenekleri arasında olmalı.",
  infillSolid: "Katı basan teknolojide doluluk seçeneği ve varsayılanı boş olmalı.",
  layerOptions: "En az bir katman seçeneği olmalı.",
} as const;

// ─── Ortak parçalar ─────────────────────────────────────────────────────────

/**
 * Sayı alanlarının Türkçe cümleleri.
 *
 * Zod'un varsayılan mesajları İNGİLİZCE ("Expected number, received null") ve
 * bu ekranın tek kullanıcısı sahibidir: boş bırakılmış bir alanın cevabı,
 * anlamadığı bir dilde bir tip hatası olmamalı. `firstIssueMessage` alan adını
 * cümlenin önüne koyar, yani "buildXMm: En az 10 olabilir." gibi okunur.
 */
const numberField = () => z.number({ error: "Sayı girilmeli (boş bırakılamaz)." });

const intBetween = (min: number, max: number) =>
  numberField()
    .int("Tam sayı girilmeli.")
    .min(min, `En az ${min} olmalı.`)
    .max(max, `En çok ${max} olabilir.`);

const floatBetween = (min: number, max: number) =>
  numberField().min(min, `En az ${min} olmalı.`).max(max, `En çok ${max} olabilir.`);

/** Sıfırdan büyük ondalık (yoğunluk, debi, kalınlık). */
const positiveUpTo = (max: number) =>
  numberField().gt(0, TR.positive).max(max, `En çok ${max} olabilir.`);

const catalogKey = z.string().trim().regex(/^[a-z0-9_]{2,32}$/, TR.key);
const displayName = z.string().trim().min(2, TR.name).max(120);
const description = z.string().trim().max(600).default("");
const moneyKurus = numberField()
  .int(TR.money)
  .min(0, TR.money)
  .max(CATALOG_LIMITS.maxPriceKurus, TR.money);
const sortOrder = intBetween(CATALOG_LIMITS.sortOrder.min, CATALOG_LIMITS.sortOrder.max);
const leadDaysExtra = intBetween(
  CATALOG_LIMITS.leadDaysExtra.min,
  CATALOG_LIMITS.leadDaysExtra.max
);
const capabilityTag = z.string().trim().regex(/^[a-z0-9_]{2,40}$/, TR.key);

/**
 * Yamanın taşıdığı iyimser kilit damgası. Sunucu bunu satırın kendi
 * `updated_at` değeriyle karşılaştırır; tutmazsa 409.
 */
export const expectedUpdatedAtSchema = z
  .string()
  .trim()
  .min(1, TR.stamp)
  .refine((v) => !Number.isNaN(Date.parse(v)), TR.stamp);

/** Takvimde GERÇEKTEN var olan bir gün mü (2026-02-30 geçmez). */
function isRealIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
  );
}

const isoDate = z.string().trim().refine(isRealIsoDate, TR.holiday);

export const colorSchema = z.object({
  key: catalogKey,
  name: z.string().trim().min(1, TR.name).max(60),
  hex: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, TR.hex),
  surchargeKurus: moneyKurus,
});

const colorsSchema = z
  .array(colorSchema)
  .min(1, TR.colors)
  .max(40)
  .refine((rows) => new Set(rows.map((c) => c.key)).size === rows.length, TR.colorKeys);

export const materialPropertiesSchema = z.object({
  tensileMpa: floatBetween(0, 10_000).optional(),
  elongationPct: floatBetween(0, 2000).optional(),
  heatDeflectionC: floatBetween(-100, 1000).optional(),
  flexible: z.boolean().optional(),
  transparent: z.boolean().optional(),
  uses: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
});

// ─── Teknoloji ──────────────────────────────────────────────────────────────

/**
 * Teknolojinin fiyat/DfM alanları. Anahtar ve `active` ayrı eklenir: anahtar
 * yalnız oluşturmada, `active` her ikisinde de var ama oluşturmada varsayılanı
 * vardır.
 */
const technologyBody = {
  name: displayName,
  description,
  orderMaterial: z.enum(["resin", "filament"], {
    error: "Sipariş malzemesi reçine ya da filament olmalı.",
  }),
  capabilityTag,
  buildXMm: intBetween(CATALOG_LIMITS.buildMm.min, CATALOG_LIMITS.buildMm.max),
  buildYMm: intBetween(CATALOG_LIMITS.buildMm.min, CATALOG_LIMITS.buildMm.max),
  buildZMm: intBetween(CATALOG_LIMITS.buildMm.min, CATALOG_LIMITS.buildMm.max),
  minWallMm: positiveUpTo(50),
  minFeatureMm: positiveUpTo(50),
  toleranceText: z.string().trim().min(1).max(120),
  layerOptionsUm: z
    .array(intBetween(CATALOG_LIMITS.layerUm.min, CATALOG_LIMITS.layerUm.max))
    .min(1, TR.layerOptions)
    .max(12),
  defaultLayerUm: intBetween(CATALOG_LIMITS.layerUm.min, CATALOG_LIMITS.layerUm.max),
  infillOptionsPct: z
    .array(intBetween(CATALOG_LIMITS.infillPct.min, CATALOG_LIMITS.infillPct.max))
    .min(1)
    .max(12)
    .nullable(),
  defaultInfillPct: intBetween(
    CATALOG_LIMITS.infillPct.min,
    CATALOG_LIMITS.infillPct.max
  ).nullable(),
  shellMm: floatBetween(0, 50),
  setupFeeKurus: moneyKurus,
  machineRateKurusPerHour: moneyKurus,
  throughputCm3PerHour: positiveUpTo(100_000),
  heightHoursPerMm: floatBetween(0, 10),
  minUnitPriceKurus: moneyKurus,
  baseLeadDays: intBetween(1, 60),
  sortOrder,
};

/**
 * Katman/doluluk tutarlılığı — TAMAMLANMIŞ satır üzerinde.
 *
 * Listede olmayan bir varsayılan, müşterinin ekranında seçilemeyen ama fiyata
 * giren bir değer demektir; katı basan teknolojide (SLA) doluluk alanı DOLU
 * olursa `evaluatePartDfm` her parçayı `config_invalid` sayar ve katalog hiç
 * fiyat veremez.
 *
 * Yamada şema TEK BAŞINA yetmez (yalnız `defaultLayerUm` gönderilebilir), bu
 * yüzden kural satır + yama BİRLEŞTİRİLDİKTEN sonra servis tarafından da
 * çağrılır. İki yerde aynı cümle olmasın diye kural burada, tek kopya.
 */
export function technologyConsistencyError(row: {
  layerOptionsUm: number[];
  defaultLayerUm: number;
  infillOptionsPct: number[] | null;
  defaultInfillPct: number | null;
}): string | null {
  if (!row.layerOptionsUm.includes(row.defaultLayerUm)) return TR.layerDefault;
  if (row.infillOptionsPct === null) {
    return row.defaultInfillPct === null ? null : TR.infillSolid;
  }
  if (row.defaultInfillPct === null || !row.infillOptionsPct.includes(row.defaultInfillPct)) {
    return TR.infillDefault;
  }
  return null;
}

export const technologyCreateSchema = z
  .object({ key: catalogKey, ...technologyBody, active: z.boolean().default(true) })
  .superRefine((value, ctx) => {
    const message = technologyConsistencyError(value);
    if (message) ctx.addIssue({ code: "custom", message, path: ["defaultLayerUm"] });
  });

export const technologyPatchSchema = z
  .object({ ...technologyBody, active: z.boolean() })
  .partial()
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });

// ─── Malzeme ────────────────────────────────────────────────────────────────

const materialBody = {
  name: displayName,
  description,
  properties: materialPropertiesSchema.default({}),
  densityGCm3: floatBetween(CATALOG_LIMITS.densityGCm3.min, CATALOG_LIMITS.densityGCm3.max),
  priceKurusPerGram: moneyKurus,
  supportFactor: floatBetween(
    CATALOG_LIMITS.supportFactor.min,
    CATALOG_LIMITS.supportFactor.max
  ),
  capabilityTag: capabilityTag.nullable(),
  colors: colorsSchema,
  leadDaysExtra,
  sortOrder,
};

export const materialCreateSchema = z.object({
  technologyId: z.uuid("Teknoloji seçilmeli."),
  key: catalogKey,
  ...materialBody,
  active: z.boolean().default(true),
});

export const materialPatchSchema = z
  .object({ ...materialBody, active: z.boolean() })
  .partial()
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });

// ─── Yüzey işlemi ───────────────────────────────────────────────────────────

const finishBody = {
  name: displayName,
  description,
  fixedKurus: moneyKurus,
  perCm2Kurus: moneyKurus,
  leadDaysExtra,
  requiresManual: z.boolean(),
  costLineKind: z.enum(COST_LINE_KINDS, {
    error: "Maliyet kalemi üretim ya da boyama olmalı.",
  }),
  sortOrder,
};

export const finishCreateSchema = z.object({
  /** null = her teknolojiye uygun. */
  technologyId: z.uuid().nullable().default(null),
  key: catalogKey,
  ...finishBody,
  active: z.boolean().default(true),
});

export const finishPatchSchema = z
  .object({ ...finishBody, active: z.boolean() })
  .partial()
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });

// ─── Ek hizmet ──────────────────────────────────────────────────────────────

const addonBody = {
  name: displayName,
  description,
  priceType: z.enum(ADDON_PRICE_TYPES, {
    error: "Fiyat türü sabit, parça başı ya da adet başı olmalı.",
  }),
  priceKurus: moneyKurus,
  leadDaysExtra,
  sortOrder,
};

export const addonCreateSchema = z.object({
  key: catalogKey,
  ...addonBody,
  active: z.boolean().default(true),
});

export const addonPatchSchema = z
  .object({ ...addonBody, active: z.boolean() })
  .partial()
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });

// ─── Fiyat ayarları (tek satır) ─────────────────────────────────────────────

const qtyBreakSchema = z.object({
  minQty: intBetween(1, 100_000),
  discountBps: intBetween(CATALOG_LIMITS.discountBps.min, CATALOG_LIMITS.discountBps.max),
});

const leadTierSchema = z.object({
  key: z.enum(LEAD_TIER_KEYS, { error: TR.leadTiers }),
  name: z.string().trim().min(2, TR.name).max(60),
  multiplierBps: intBetween(
    CATALOG_LIMITS.multiplierBps.min,
    CATALOG_LIMITS.multiplierBps.max
  ),
  daysDelta: intBetween(-30, 30),
  minDays: intBetween(CATALOG_LIMITS.minDays.min, CATALOG_LIMITS.minDays.max),
});

export const pricingSettingsSchema = z.object({
  qtyBreaks: z
    .array(qtyBreakSchema)
    .min(1, TR.qtyBreaksEmpty)
    .max(12)
    .refine((rows) => rows[0]?.minQty === 1, TR.qtyBreaksStart)
    .refine(
      (rows) => rows.every((row, i) => i === 0 || row.minQty > (rows[i - 1] as { minQty: number }).minQty),
      TR.qtyBreaksIncreasing
    ),
  leadTiers: z
    .array(leadTierSchema)
    .length(LEAD_TIER_KEYS.length, TR.leadTiers)
    .refine(
      (rows) => new Set(rows.map((t) => t.key)).size === LEAD_TIER_KEYS.length,
      TR.leadTiers
    ),
  minOrderKurus: moneyKurus,
  maxAutoTotalKurus: moneyKurus,
  maxAutoQtyPerPart: intBetween(1, 100_000),
  maxPartsPerQuote: intBetween(1, 100),
  /** 1 MB – 500 MB. Altında hiçbir gerçek model yüklenemez, üstünde nginx keser. */
  maxFileBytes: intBetween(1_048_576, 524_288_000),
  quoteValidDays: intBetween(1, 365),
  retentionDaysAfterExpiry: intBetween(1, 3650),
  priceBreakQuantities: z
    .array(intBetween(1, 100_000))
    .min(1, TR.priceBreaks)
    .max(10)
    .refine((rows) => rows[0] === 1, TR.priceBreaks)
    .refine(
      (rows) => rows.every((qty, i) => i === 0 || qty > (rows[i - 1] as number)),
      TR.priceBreaks
    ),
  holidays: z
    .array(isoDate)
    .max(400)
    .refine((rows) => new Set(rows).size === rows.length, TR.holidaysUnique),
  cutoffHour: intBetween(0, 23),
  havaleDiscountApplies: z.boolean(),
});

export const pricingSettingsUpdateSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  settings: pricingSettingsSchema,
});

// ─── Simülatör ──────────────────────────────────────────────────────────────

/**
 * Simülatörün geometrisi ölçülmüş bir dosya DEĞİL, yöneticinin elle girdiği
 * ölçülerdir; bu yüzden milimetre/santimetreküp olarak alınır ve ölçek/birim
 * alanı yoktur (çevrim `quote-units.ts`'in işi ve burada yapılacak bir şey
 * kalmaz).
 */
export const simulateSchema = z.object({
  technologyKey: catalogKey,
  materialKey: catalogKey,
  colorKey: catalogKey,
  finishKey: catalogKey,
  layerUm: intBetween(CATALOG_LIMITS.layerUm.min, CATALOG_LIMITS.layerUm.max)
    .nullable()
    .default(null),
  infillPct: intBetween(CATALOG_LIMITS.infillPct.min, CATALOG_LIMITS.infillPct.max)
    .nullable()
    .default(null),
  quantity: intBetween(1, 100_000),
  leadTier: z.enum(LEAD_TIER_KEYS, { error: "Teslim kademesi geçersiz." }),
  geometry: z.object({
    volumeCm3: positiveUpTo(1_000_000),
    areaCm2: positiveUpTo(1_000_000),
    x: positiveUpTo(5000),
    y: positiveUpTo(5000),
    z: positiveUpTo(5000),
  }),
});

export type TechnologyCreateInput = z.infer<typeof technologyCreateSchema>;
export type TechnologyPatchInput = z.infer<typeof technologyPatchSchema>;
export type MaterialCreateInput = z.infer<typeof materialCreateSchema>;
export type MaterialPatchInput = z.infer<typeof materialPatchSchema>;
export type FinishCreateInput = z.infer<typeof finishCreateSchema>;
export type FinishPatchInput = z.infer<typeof finishPatchSchema>;
export type AddonCreateInput = z.infer<typeof addonCreateSchema>;
export type AddonPatchInput = z.infer<typeof addonPatchSchema>;
export type PricingSettingsInput = z.infer<typeof pricingSettingsSchema>;
export type SimulateInput = z.infer<typeof simulateSchema>;

/** Şema hatasının ekrana yazılacak TEK cümlesi (alan adıyla birlikte). */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Geçersiz veri.";
  const path = issue.path.filter((p) => typeof p === "string").join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
