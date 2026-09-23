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

/**
 * Ekrana çıkacak CÜMLELER. Tek kullanıcısı sahibidir ve paneli Türkçedir:
 * zod'un kendi İngilizce cümlesinin ("Too small: expected string to have >=1
 * characters") sızdığı TEK bir kısıt bile, yanlış bir fiyatı düzeltmeye çalışan
 * yöneticiye anlamadığı bir dilde tip hatası göstermek demektir. Bu yüzden
 * DOSYADAKİ HER kısıtın mesajı buradan gelir — üst sınırlar dahil.
 */
const TR = {
  key: "Anahtar yalnız küçük harf, rakam ve alt çizgi içerebilir (2–32 karakter).",
  capability: "Yetenek etiketi yalnız küçük harf, rakam ve alt çizgi içerebilir (2–40 karakter).",
  name: "Ad en az 2 karakter olmalı.",
  nameLong: "Ad en çok 120 karakter olabilir.",
  descriptionLong: "Açıklama en çok 600 karakter olabilir.",
  tolerance: "Tolerans metni yazılmalı (örn. ±0,5 mm).",
  toleranceLong: "Tolerans metni en çok 120 karakter olabilir.",
  money: `Tutar 0 ile ${CATALOG_LIMITS.maxPriceKurus} kuruş arasında bir tam sayı olmalı.`,
  positive: "Değer 0'dan büyük olmalı.",
  hex: "Renk kodu #RRGGBB biçiminde olmalı (örn. #1A1A1A).",
  colors: "En az bir renk tanımlanmalı.",
  colorsMax: "En çok 40 renk tanımlanabilir.",
  colorName: "Renk adı boş olamaz.",
  colorNameLong: "Renk adı en çok 60 karakter olabilir.",
  colorKeys: "Renk anahtarları benzersiz olmalı.",
  tierName: "Kademe adı en az 2 karakter olmalı.",
  tierNameLong: "Kademe adı en çok 60 karakter olabilir.",
  holiday: "Tatil tarihleri YYYY-AA-GG biçiminde gerçek bir tarih olmalı.",
  holidaysUnique: "Aynı tatil tarihi iki kez yazılamaz.",
  holidaysMax: "En çok 400 tatil tarihi tanımlanabilir.",
  qtyBreaksStart: "İlk adet kademesi 1 adetten başlamalı.",
  qtyBreaksIncreasing: "Adet kademeleri kesin artan sırada olmalı.",
  qtyBreaksEmpty: "En az bir adet kademesi olmalı.",
  qtyBreaksMax: "En çok 12 adet kademesi tanımlanabilir.",
  leadTiers: "Teslim kademeleri ekonomik, standart ve ekspresin üçünü de içermeli.",
  priceBreaks: "Fiyat kademesi adetleri kesin artan olmalı ve 1'den başlamalı.",
  priceBreaksMax: "En çok 10 fiyat kademesi gösterilebilir.",
  stamp: "Kaydın son güncellenme damgası (expectedUpdatedAt) gerekli.",
  layerDefault: "Varsayılan katman, katman seçenekleri arasında olmalı.",
  infillDefault: "Varsayılan doluluk, doluluk seçenekleri arasında olmalı.",
  infillSolid: "Katı basan teknolojide doluluk seçeneği ve varsayılanı boş olmalı.",
  layerOptions: "En az bir katman seçeneği olmalı.",
  layerOptionsMax: "En çok 12 katman seçeneği olabilir.",
  infillOptions: "Doluluk listesi boş olamaz; katı baskı için alanı tamamen boş bırakın.",
  infillOptionsMax: "En çok 12 doluluk seçeneği olabilir.",
  useItem: "Kullanım alanı boş olamaz.",
  useItemLong: "Her kullanım alanı en çok 60 karakter olabilir.",
  usesMax: "En çok 10 kullanım alanı yazılabilir.",
  technologyPick: "Teknoloji geçersiz; listeden seçin.",
  technologyPickOrAll: "Teknoloji geçersiz; listeden seçin ya da boş bırakın (tüm teknolojiler).",
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

/**
 * Metin / evet-hayır / liste / nesne alanlarının TİP cümlesi de Türkçe olmalı:
 * panelden gelmeyen bir gövde (curl, ileride bir betik) yanlış türde bir değer
 * yollarsa cevap yine okunabilir kalsın.
 */
const textField = (error = "Metin girilmeli.") => z.string({ error });
const boolField = () => z.boolean({ error: "Evet/hayır (true/false) değeri girilmeli." });
/** Gövdenin kendisi nesne değilse. */
const BODY_OBJECT = { error: "Geçerli bir istek gövdesi (JSON nesnesi) gönderilmeli." } as const;

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

const catalogKey = textField(TR.key).trim().regex(/^[a-z0-9_]{2,32}$/, TR.key);
const displayName = textField(TR.name).trim().min(2, TR.name).max(120, TR.nameLong);
const description = textField(TR.descriptionLong).trim().max(600, TR.descriptionLong).default("");
const moneyKurus = numberField()
  .int(TR.money)
  .min(0, TR.money)
  .max(CATALOG_LIMITS.maxPriceKurus, TR.money);
const sortOrder = intBetween(CATALOG_LIMITS.sortOrder.min, CATALOG_LIMITS.sortOrder.max);
const leadDaysExtra = intBetween(
  CATALOG_LIMITS.leadDaysExtra.min,
  CATALOG_LIMITS.leadDaysExtra.max
);
const capabilityTag = textField(TR.capability).trim().regex(/^[a-z0-9_]{2,40}$/, TR.capability);

/**
 * Yamanın taşıdığı iyimser kilit damgası. Sunucu bunu satırın kendi
 * `updated_at` değeriyle karşılaştırır; tutmazsa 409.
 */
export const expectedUpdatedAtSchema = textField(TR.stamp)
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

const isoDate = textField(TR.holiday).trim().refine(isRealIsoDate, TR.holiday);

export const colorSchema = z.object(
  {
    key: catalogKey,
    name: textField(TR.colorName).trim().min(1, TR.colorName).max(60, TR.colorNameLong),
    hex: textField(TR.hex).trim().regex(/^#[0-9A-Fa-f]{6}$/, TR.hex),
    surchargeKurus: moneyKurus,
  },
  { error: "Renk satırı eksik ya da hatalı." }
);

const colorsSchema = z
  .array(colorSchema, { error: TR.colors })
  .min(1, TR.colors)
  .max(40, TR.colorsMax)
  .refine((rows) => new Set(rows.map((c) => c.key)).size === rows.length, TR.colorKeys);

export const materialPropertiesSchema = z.object(
  {
    tensileMpa: floatBetween(0, 10_000).optional(),
    elongationPct: floatBetween(0, 2000).optional(),
    heatDeflectionC: floatBetween(-100, 1000).optional(),
    flexible: boolField().optional(),
    transparent: boolField().optional(),
    uses: z
      .array(textField(TR.useItem).trim().min(1, TR.useItem).max(60, TR.useItemLong), {
        error: TR.usesMax,
      })
      .max(10, TR.usesMax)
      .optional(),
  },
  { error: "Teknik özellikler hatalı." }
);

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
  toleranceText: textField(TR.tolerance).trim().min(1, TR.tolerance).max(120, TR.toleranceLong),
  layerOptionsUm: z
    .array(intBetween(CATALOG_LIMITS.layerUm.min, CATALOG_LIMITS.layerUm.max), {
      error: TR.layerOptions,
    })
    .min(1, TR.layerOptions)
    .max(12, TR.layerOptionsMax),
  defaultLayerUm: intBetween(CATALOG_LIMITS.layerUm.min, CATALOG_LIMITS.layerUm.max),
  infillOptionsPct: z
    .array(intBetween(CATALOG_LIMITS.infillPct.min, CATALOG_LIMITS.infillPct.max), {
      error: TR.infillOptions,
    })
    .min(1, TR.infillOptions)
    .max(12, TR.infillOptionsMax)
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
  .object({ key: catalogKey, ...technologyBody, active: boolField().default(true) }, BODY_OBJECT)
  .superRefine((value, ctx) => {
    const message = technologyConsistencyError(value);
    if (message) ctx.addIssue({ code: "custom", message, path: ["defaultLayerUm"] });
  });

export const technologyPatchSchema = z
  .object({ ...technologyBody, active: boolField() }, BODY_OBJECT)
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

export const materialCreateSchema = z.object(
  {
    technologyId: z.uuid(TR.technologyPick),
    key: catalogKey,
    ...materialBody,
    active: boolField().default(true),
  },
  BODY_OBJECT
);

export const materialPatchSchema = z
  .object({ ...materialBody, active: boolField() }, BODY_OBJECT)
  .partial()
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });

// ─── Yüzey işlemi ───────────────────────────────────────────────────────────

const finishBody = {
  name: displayName,
  description,
  fixedKurus: moneyKurus,
  perCm2Kurus: moneyKurus,
  leadDaysExtra,
  requiresManual: boolField(),
  costLineKind: z.enum(COST_LINE_KINDS, {
    error: "Maliyet kalemi üretim ya da boyama olmalı.",
  }),
  sortOrder,
};

export const finishCreateSchema = z.object(
  {
    /** null = her teknolojiye uygun. */
    technologyId: z.uuid(TR.technologyPickOrAll).nullable().default(null),
    key: catalogKey,
    ...finishBody,
    active: boolField().default(true),
  },
  BODY_OBJECT
);

export const finishPatchSchema = z
  .object({ ...finishBody, active: boolField() }, BODY_OBJECT)
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

export const addonCreateSchema = z.object(
  {
    key: catalogKey,
    ...addonBody,
    active: boolField().default(true),
  },
  BODY_OBJECT
);

export const addonPatchSchema = z
  .object({ ...addonBody, active: boolField() }, BODY_OBJECT)
  .partial()
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });

// ─── Fiyat ayarları (tek satır) ─────────────────────────────────────────────

const qtyBreakSchema = z.object(
  {
    minQty: intBetween(1, 100_000),
    discountBps: intBetween(CATALOG_LIMITS.discountBps.min, CATALOG_LIMITS.discountBps.max),
  },
  { error: "Adet kademesi satırı eksik ya da hatalı." }
);

const leadTierSchema = z.object(
  {
    key: z.enum(LEAD_TIER_KEYS, { error: TR.leadTiers }),
    name: textField(TR.tierName).trim().min(2, TR.tierName).max(60, TR.tierNameLong),
    multiplierBps: intBetween(
      CATALOG_LIMITS.multiplierBps.min,
      CATALOG_LIMITS.multiplierBps.max
    ),
    daysDelta: intBetween(-30, 30),
    minDays: intBetween(CATALOG_LIMITS.minDays.min, CATALOG_LIMITS.minDays.max),
  },
  { error: TR.leadTiers }
);

export const pricingSettingsSchema = z.object({
  qtyBreaks: z
    .array(qtyBreakSchema, { error: TR.qtyBreaksEmpty })
    .min(1, TR.qtyBreaksEmpty)
    .max(12, TR.qtyBreaksMax)
    .refine((rows) => rows[0]?.minQty === 1, TR.qtyBreaksStart)
    .refine(
      (rows) => rows.every((row, i) => i === 0 || row.minQty > (rows[i - 1] as { minQty: number }).minQty),
      TR.qtyBreaksIncreasing
    ),
  leadTiers: z
    .array(leadTierSchema, { error: TR.leadTiers })
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
    .array(intBetween(1, 100_000), { error: TR.priceBreaks })
    .min(1, TR.priceBreaks)
    .max(10, TR.priceBreaksMax)
    .refine((rows) => rows[0] === 1, TR.priceBreaks)
    .refine(
      (rows) => rows.every((qty, i) => i === 0 || qty > (rows[i - 1] as number)),
      TR.priceBreaks
    ),
  holidays: z
    .array(isoDate, { error: TR.holiday })
    .max(400, TR.holidaysMax)
    .refine((rows) => new Set(rows).size === rows.length, TR.holidaysUnique),
  cutoffHour: intBetween(0, 23),
  havaleDiscountApplies: boolField(),
}, BODY_OBJECT);

export const pricingSettingsUpdateSchema = z.object(
  {
    expectedUpdatedAt: expectedUpdatedAtSchema,
    settings: pricingSettingsSchema,
  },
  BODY_OBJECT
);

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
  geometry: z.object(
    {
      volumeCm3: positiveUpTo(1_000_000),
      areaCm2: positiveUpTo(1_000_000),
      x: positiveUpTo(5000),
      y: positiveUpTo(5000),
      z: positiveUpTo(5000),
    },
    { error: "Geometri ölçüleri eksik ya da hatalı." }
  ),
}, BODY_OBJECT);

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
