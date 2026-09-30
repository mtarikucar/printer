/**
 * Baskı kataloğunun YÖNETİCİ tarafı: okuma, yazma, denetim izi ve simülatör.
 *
 * `quote-catalog.ts` kataloğu TEKLİF için okur (yalnız aktif satırlar, dondurulacak
 * anlık görüntü). Bu dosya kataloğu SAHİBİ için okur ve yazar: pasif satırlar da
 * görünür, her yazım denetim izi bırakır.
 *
 * Üç kural pazarlığa kapalıdır ve üçü de burada uygulanır:
 *
 *  1. **Silme yok.** `quote_parts` katalog anahtarlarına metin olarak bakar ve
 *     FK'ler `restrict`tir; bir satırı silmek geçmiş teklifleri okunamaz hale
 *     getirirdi. Satır pasifleştirilir (`active = false`), kataloğun dışında
 *     kalır, eski teklifler kendi snapshot'ıyla okunmaya devam eder.
 *  2. **Her yazım + denetim satırı AYNI işlemde.** Denetim izi işlemin dışında
 *     yazılırsa (evdeki 33 sipariş durumu değişiminde olduğu gibi) yarım kalan
 *     bir yazımda fiyat değişir ama kimin değiştirdiği kaybolur.
 *  3. **`expectedUpdatedAt` zorunlu.** İki sekmede açık bir katalog, ikinci
 *     kaydın birincisini sessizce ezmesi demektir.
 *
 * Simülatör kısmı SAFTIR ve fiyatı `computeQuote`tan alır — ikinci bir fiyat
 * yolu açmaz. Kendi kattığı tek şey MUTABAKAT satırlarıdır: `PartPriceBreakdown`
 * bilerek bilgilendiricidir (taban fiyat devreye girdiğinde kalemlerin toplamı
 * birim fiyatı vermez), oysa sahibi "bu rakam nereden çıktı" sorusuna ekrandan
 * cevap alabilmeli.
 */
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  printAddons,
  printCatalogChanges,
  printFinishes,
  printMaterials,
  printTechnologies,
  quotePricingSettings,
} from "@/lib/db/schema";
import { QuoteCatalogError } from "@/lib/services/quote-catalog";
import { computeQuote } from "@/lib/config/quote-compute";
import { findTechnology } from "@/lib/config/quote-pricing";
import type {
  CatalogEntity,
  DfmIssue,
  LeadTier,
  LeadTierKey,
  PartGeometry,
  PartPriceBreakdown,
  PricingPartInput,
  PricingSnapshot,
  QtyBreak,
  QuoteTotals,
} from "@/lib/config/quote-types";
import { LEAD_TIER_KEYS } from "@/lib/config/quote-types";
import {
  technologyConsistencyError,
  type AddonCreateInput,
  type AddonPatchInput,
  type FinishCreateInput,
  type FinishPatchInput,
  type MaterialCreateInput,
  type MaterialPatchInput,
  type PricingSettingsInput,
  type TechnologyCreateInput,
  type TechnologyPatchInput,
} from "@/lib/validators/print-catalog";

/** Rotanın olduğu gibi cevaba çevirebileceği, Türkçe cümleli katalog hatası. */
export class PrintCatalogError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "PrintCatalogError";
  }
}

/** Beklenen ret ile beklenmeyen arızayı AYIRAN sonuç. */
export type CatalogOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; error: string };

/**
 * Beklenen retleri (`404` yok, `409` bayat kayıt, `400` tutarsız alan) DEĞERE
 * çevirir; geri kalanı olduğu gibi yukarı bırakır.
 *
 * Neden değer, neden `throw` değil: rota uçlarının `catch` bloğu depo genelinde
 * taranıyor (`scripts/test-order-status-policy.ts`) ve yalnız TANINAN bir cevap
 * şekli "boş gövdeli 500 imkânsız" sayılıyor. Beklenen retler `catch` içinde
 * ayrıştırılırsa o garanti bozulur. Ev örneği de budur
 * (`order-money-edit.ts` · `{ok:false,status,error}`): `catch` YALNIZ
 * beklenmeyen arıza için kalır.
 */
export async function catalogOutcome<T>(run: () => Promise<T>): Promise<CatalogOutcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    if (e instanceof PrintCatalogError) {
      return { ok: false, status: e.status, code: e.code, error: e.message };
    }
    // Katalog hiç okunamıyorsa (aktif teknoloji yok, ayar satırı yok) bu bir
    // ARIZA değil, yöneticinin az önce yaptığı bir düzenlemenin sonucudur.
    if (e instanceof QuoteCatalogError) {
      return { ok: false, status: 409, code: "catalog_unavailable", error: e.message };
    }
    throw e;
  }
}

type CatalogTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Katalog yazımının ORTAK kabuğu: kısa kilit zaman aşımı + tek işlem.
 *
 * `lock_timeout` olmadan, açık bir satır kilidi isteği dakikalarca bekletir ve
 * yönetici ekranda "kaydediliyor…" görür; 5 saniye sonra hata vermek, hangi
 * satırın kilitli olduğunu söyleyebilmek demektir.
 */
async function inCatalogTx<T>(fn: (tx: CatalogTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    return fn(tx);
  });
}

/** Denetim izinin jsonb gövdesi: tarihler ISO dizgiye çevrilir. */
function auditSnapshot(row: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

async function writeChange(
  tx: CatalogTx,
  entity: CatalogEntity,
  entityId: string | null,
  action: "create" | "update",
  adminEmail: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Promise<void> {
  await tx.insert(printCatalogChanges).values({
    entity,
    entityId,
    action,
    adminEmail,
    before,
    after,
  });
}

/**
 * Satır var mı ve yönetici GÜNCEL hâlini mi düzenliyor?
 *
 * Damga uyuşmuyorsa 409: yazımı "son yazan kazansın" diye geçirmek, birinin az
 * önce girdiği fiyatı sessizce silmek olurdu.
 */
function ensureFresh<T extends { updatedAt: Date }>(
  row: T | undefined,
  expectedUpdatedAt: string,
  label: string
): T {
  if (!row) throw new PrintCatalogError("not_found", `${label} bulunamadı.`, 404);
  if (row.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new PrintCatalogError(
      "stale",
      `${label} bu sırada başka bir yerden güncellendi. Sayfayı yenileyip değişikliğinizi tekrar uygulayın.`,
      409
    );
  }
  return row;
}

/** Zod `.partial()` çıktısındaki tanımsız alanları atar (drizzle `set` için). */
function definedFields<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

// ─── Okuma ──────────────────────────────────────────────────────────────────

export type AdminTechnology = typeof printTechnologies.$inferSelect;
export type AdminMaterial = typeof printMaterials.$inferSelect & { technologyKey: string };
export type AdminFinish = typeof printFinishes.$inferSelect & { technologyKey: string | null };
export type AdminAddon = typeof printAddons.$inferSelect;
export type AdminPricingSettings = typeof quotePricingSettings.$inferSelect;
export type AdminCatalogChange = typeof printCatalogChanges.$inferSelect;

export interface AdminCatalog {
  technologies: AdminTechnology[];
  materials: AdminMaterial[];
  finishes: AdminFinish[];
  addons: AdminAddon[];
  settings: AdminPricingSettings;
  /** Son değişiklikler — "her şey görünür" kuralının katalog karşılığı. */
  changes: AdminCatalogChange[];
}

const RECENT_CHANGE_LIMIT = 30;

/**
 * Katalog DİLİMLERİ ayrı ayrı okunur.
 *
 * Her dilim kendi fonksiyonudur, çünkü katalog uçları (`GET
 * /api/admin/print-catalog/technologies` ve kardeşleri) cevapta TEK bir dilim
 * döndürüyor: hepsi `listCatalogForAdmin` çağırdığında bir teknoloji listesi
 * için altı sorgu açılıyor ve otuz satırlık denetim listesi boşa okunuyordu.
 * Tam katalog (ekranın ihtiyacı) aynı dilimlerden kurulur — iki ayrı sorgu
 * metni yok, yani sıralama ve `technologyKey` eşlemesi tek yerde kalır.
 *
 * Hepsi PASİF satırları da verir: yönetici pasifleştirdiği satırı göremezse onu
 * geri açamaz (teklif tarafı yalnız aktifleri okur).
 */
export async function listTechnologiesForAdmin(): Promise<AdminTechnology[]> {
  return db
    .select()
    .from(printTechnologies)
    .orderBy(asc(printTechnologies.sortOrder), asc(printTechnologies.key));
}

export async function listMaterialsForAdmin(): Promise<AdminMaterial[]> {
  const rows = await db
    .select({ material: printMaterials, technologyKey: printTechnologies.key })
    .from(printMaterials)
    .innerJoin(printTechnologies, eq(printMaterials.technologyId, printTechnologies.id))
    .orderBy(asc(printMaterials.sortOrder), asc(printMaterials.key));
  return rows.map(({ material, technologyKey }) => ({ ...material, technologyKey }));
}

export async function listFinishesForAdmin(): Promise<AdminFinish[]> {
  const rows = await db
    .select({ finish: printFinishes, technologyKey: printTechnologies.key })
    .from(printFinishes)
    .leftJoin(printTechnologies, eq(printFinishes.technologyId, printTechnologies.id))
    .orderBy(asc(printFinishes.sortOrder), asc(printFinishes.key));
  return rows.map(({ finish, technologyKey }) => ({ ...finish, technologyKey: technologyKey ?? null }));
}

export async function listAddonsForAdmin(): Promise<AdminAddon[]> {
  return db.select().from(printAddons).orderBy(asc(printAddons.sortOrder), asc(printAddons.key));
}

/** Son katalog düzenlemeleri — "her şey görünür" kuralının katalog karşılığı. */
async function listRecentCatalogChanges(): Promise<AdminCatalogChange[]> {
  return db
    .select()
    .from(printCatalogChanges)
    .orderBy(desc(printCatalogChanges.createdAt))
    .limit(RECENT_CHANGE_LIMIT);
}

/** Yöneticinin EKRANINDA gördüğü katalog: dört dilim + ayar + denetim izi. */
export async function listCatalogForAdmin(): Promise<AdminCatalog> {
  const [technologies, materials, finishes, addons, settings, changes] = await Promise.all([
    listTechnologiesForAdmin(),
    listMaterialsForAdmin(),
    listFinishesForAdmin(),
    listAddonsForAdmin(),
    readPricingSettings(),
    listRecentCatalogChanges(),
  ]);

  return { technologies, materials, finishes, addons, settings, changes };
}

export async function readPricingSettings(): Promise<AdminPricingSettings> {
  const [row] = await db
    .select()
    .from(quotePricingSettings)
    .where(eq(quotePricingSettings.id, 1))
    .limit(1);
  if (!row) {
    throw new PrintCatalogError(
      "settings_missing",
      "Teklif fiyat ayarları satırı yok (quote_pricing_settings). Migration 0064 uygulanmamış olabilir.",
      500
    );
  }
  return row;
}

// ─── Teknoloji ──────────────────────────────────────────────────────────────

export async function createTechnology(
  input: TechnologyCreateInput,
  adminEmail: string
): Promise<AdminTechnology> {
  return inCatalogTx(async (tx) => {
    const [clash] = await tx
      .select({ id: printTechnologies.id })
      .from(printTechnologies)
      .where(eq(printTechnologies.key, input.key))
      .limit(1);
    // Anahtar çakışmasını INSERT'e bırakmak yerine ÖNCEDEN sormak ev kuralıdır:
    // drizzle 0.45 pg hatasını sarıyor ve `.code` yakalanan hatada tanımsız
    // kalıyor (bkz. memory · drizzle-error-wrapping).
    if (clash) {
      throw new PrintCatalogError(
        "duplicate_key",
        `"${input.key}" anahtarı başka bir teknolojide kullanılıyor.`,
        409
      );
    }
    const [row] = await tx
      .insert(printTechnologies)
      .values({ ...input, updatedAt: new Date() })
      .returning();
    if (!row) throw new PrintCatalogError("insert_failed", "Teknoloji eklenemedi.", 500);
    await writeChange(tx, "technology", row.id, "create", adminEmail, null, auditSnapshot(row));
    return row;
  });
}

export async function updateTechnology(
  id: string,
  patch: TechnologyPatchInput,
  adminEmail: string
): Promise<AdminTechnology> {
  const { expectedUpdatedAt, ...rest } = patch;
  const fields = definedFields(rest);
  return inCatalogTx(async (tx) => {
    const [current] = await tx
      .select()
      .from(printTechnologies)
      .where(eq(printTechnologies.id, id))
      .for("update");
    const before = ensureFresh(current, expectedUpdatedAt, "Teknoloji");
    const inconsistent = technologyConsistencyError({ ...before, ...fields });
    if (inconsistent) throw new PrintCatalogError("inconsistent", inconsistent, 400);

    const [after] = await tx
      .update(printTechnologies)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(printTechnologies.id, id))
      .returning();
    if (!after) throw new PrintCatalogError("update_failed", "Teknoloji güncellenemedi.", 500);
    await writeChange(
      tx,
      "technology",
      id,
      "update",
      adminEmail,
      auditSnapshot(before),
      auditSnapshot(after)
    );
    return after;
  });
}

// ─── Malzeme ────────────────────────────────────────────────────────────────

export async function createMaterial(
  input: MaterialCreateInput,
  adminEmail: string
): Promise<AdminMaterial> {
  return inCatalogTx(async (tx) => {
    const [technology] = await tx
      .select({ id: printTechnologies.id, key: printTechnologies.key })
      .from(printTechnologies)
      .where(eq(printTechnologies.id, input.technologyId))
      .limit(1);
    if (!technology) {
      throw new PrintCatalogError("technology_missing", "Seçilen teknoloji bulunamadı.", 404);
    }
    const [clash] = await tx
      .select({ id: printMaterials.id })
      .from(printMaterials)
      .where(
        and(eq(printMaterials.technologyId, input.technologyId), eq(printMaterials.key, input.key))
      )
      .limit(1);
    if (clash) {
      throw new PrintCatalogError(
        "duplicate_key",
        `"${input.key}" anahtarı bu teknolojide zaten kullanılıyor.`,
        409
      );
    }
    const [row] = await tx
      .insert(printMaterials)
      .values({ ...input, updatedAt: new Date() })
      .returning();
    if (!row) throw new PrintCatalogError("insert_failed", "Malzeme eklenemedi.", 500);
    await writeChange(tx, "material", row.id, "create", adminEmail, null, auditSnapshot(row));
    return { ...row, technologyKey: technology.key };
  });
}

export async function updateMaterial(
  id: string,
  patch: MaterialPatchInput,
  adminEmail: string
): Promise<AdminMaterial> {
  const { expectedUpdatedAt, ...rest } = patch;
  const fields = definedFields(rest);
  return inCatalogTx(async (tx) => {
    const [current] = await tx
      .select()
      .from(printMaterials)
      .where(eq(printMaterials.id, id))
      .for("update");
    const before = ensureFresh(current, expectedUpdatedAt, "Malzeme");

    const [after] = await tx
      .update(printMaterials)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(printMaterials.id, id))
      .returning();
    if (!after) throw new PrintCatalogError("update_failed", "Malzeme güncellenemedi.", 500);
    const [technology] = await tx
      .select({ key: printTechnologies.key })
      .from(printTechnologies)
      .where(eq(printTechnologies.id, after.technologyId))
      .limit(1);
    await writeChange(
      tx,
      "material",
      id,
      "update",
      adminEmail,
      auditSnapshot(before),
      auditSnapshot(after)
    );
    return { ...after, technologyKey: technology?.key ?? "" };
  });
}

// ─── Yüzey işlemi ───────────────────────────────────────────────────────────

export async function createFinish(
  input: FinishCreateInput,
  adminEmail: string
): Promise<AdminFinish> {
  return inCatalogTx(async (tx) => {
    let technologyKey: string | null = null;
    if (input.technologyId) {
      const [technology] = await tx
        .select({ key: printTechnologies.key })
        .from(printTechnologies)
        .where(eq(printTechnologies.id, input.technologyId))
        .limit(1);
      if (!technology) {
        throw new PrintCatalogError("technology_missing", "Seçilen teknoloji bulunamadı.", 404);
      }
      technologyKey = technology.key;
    }
    const [clash] = await tx
      .select({ id: printFinishes.id })
      .from(printFinishes)
      .where(eq(printFinishes.key, input.key))
      .limit(1);
    if (clash) {
      throw new PrintCatalogError(
        "duplicate_key",
        `"${input.key}" anahtarı başka bir yüzey işleminde kullanılıyor.`,
        409
      );
    }
    const [row] = await tx
      .insert(printFinishes)
      .values({ ...input, updatedAt: new Date() })
      .returning();
    if (!row) throw new PrintCatalogError("insert_failed", "Yüzey işlemi eklenemedi.", 500);
    await writeChange(tx, "finish", row.id, "create", adminEmail, null, auditSnapshot(row));
    return { ...row, technologyKey };
  });
}

export async function updateFinish(
  id: string,
  patch: FinishPatchInput,
  adminEmail: string
): Promise<AdminFinish> {
  const { expectedUpdatedAt, ...rest } = patch;
  const fields = definedFields(rest);
  return inCatalogTx(async (tx) => {
    const [current] = await tx
      .select()
      .from(printFinishes)
      .where(eq(printFinishes.id, id))
      .for("update");
    const before = ensureFresh(current, expectedUpdatedAt, "Yüzey işlemi");

    const [after] = await tx
      .update(printFinishes)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(printFinishes.id, id))
      .returning();
    if (!after) throw new PrintCatalogError("update_failed", "Yüzey işlemi güncellenemedi.", 500);
    let technologyKey: string | null = null;
    if (after.technologyId) {
      const [technology] = await tx
        .select({ key: printTechnologies.key })
        .from(printTechnologies)
        .where(eq(printTechnologies.id, after.technologyId))
        .limit(1);
      technologyKey = technology?.key ?? null;
    }
    await writeChange(
      tx,
      "finish",
      id,
      "update",
      adminEmail,
      auditSnapshot(before),
      auditSnapshot(after)
    );
    return { ...after, technologyKey };
  });
}

// ─── Ek hizmet ──────────────────────────────────────────────────────────────

export async function createAddon(
  input: AddonCreateInput,
  adminEmail: string
): Promise<AdminAddon> {
  return inCatalogTx(async (tx) => {
    const [clash] = await tx
      .select({ id: printAddons.id })
      .from(printAddons)
      .where(eq(printAddons.key, input.key))
      .limit(1);
    if (clash) {
      throw new PrintCatalogError(
        "duplicate_key",
        `"${input.key}" anahtarı başka bir ek hizmette kullanılıyor.`,
        409
      );
    }
    const [row] = await tx
      .insert(printAddons)
      .values({ ...input, updatedAt: new Date() })
      .returning();
    if (!row) throw new PrintCatalogError("insert_failed", "Ek hizmet eklenemedi.", 500);
    await writeChange(tx, "addon", row.id, "create", adminEmail, null, auditSnapshot(row));
    return row;
  });
}

export async function updateAddon(
  id: string,
  patch: AddonPatchInput,
  adminEmail: string
): Promise<AdminAddon> {
  const { expectedUpdatedAt, ...rest } = patch;
  const fields = definedFields(rest);
  return inCatalogTx(async (tx) => {
    const [current] = await tx
      .select()
      .from(printAddons)
      .where(eq(printAddons.id, id))
      .for("update");
    const before = ensureFresh(current, expectedUpdatedAt, "Ek hizmet");

    const [after] = await tx
      .update(printAddons)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(printAddons.id, id))
      .returning();
    if (!after) throw new PrintCatalogError("update_failed", "Ek hizmet güncellenemedi.", 500);
    await writeChange(
      tx,
      "addon",
      id,
      "update",
      adminEmail,
      auditSnapshot(before),
      auditSnapshot(after)
    );
    return after;
  });
}

// ─── Fiyat ayarları ─────────────────────────────────────────────────────────

/**
 * Listeleri KANONİK sıraya koyar.
 *
 * Sıra görsel bir tercih değil, davranıştır: `qtyDiscountBps` kademeleri
 * tarayarak en yükseğini bulur, `leadOptions` kademeleri snapshot sırasında
 * gösterir, tatil listesi ikili aramaya değil ama okunabilirliğe muhtaçtır.
 * Girdi sırası korunsaydı, aynı ayar iki farklı ekranda farklı sırada görünürdü.
 */
function canonicalSettings(settings: PricingSettingsInput): PricingSettingsInput {
  const qtyBreaks: QtyBreak[] = [...settings.qtyBreaks].sort((a, b) => a.minQty - b.minQty);
  const leadTiers: LeadTier[] = LEAD_TIER_KEYS.flatMap((key) => {
    const tier = settings.leadTiers.find((t) => t.key === key);
    return tier ? [tier] : [];
  });
  return {
    ...settings,
    qtyBreaks,
    leadTiers,
    priceBreakQuantities: [...settings.priceBreakQuantities].sort((a, b) => a - b),
    holidays: [...new Set(settings.holidays)].sort(),
  };
}

export async function updatePricingSettings(
  settings: PricingSettingsInput,
  expectedUpdatedAt: string,
  adminEmail: string
): Promise<AdminPricingSettings> {
  const canonical = canonicalSettings(settings);
  return inCatalogTx(async (tx) => {
    const [current] = await tx
      .select()
      .from(quotePricingSettings)
      .where(eq(quotePricingSettings.id, 1))
      .for("update");
    const before = ensureFresh(current, expectedUpdatedAt, "Fiyat ayarları");

    const [after] = await tx
      .update(quotePricingSettings)
      .set({ ...canonical, updatedAt: new Date(), updatedBy: adminEmail })
      .where(eq(quotePricingSettings.id, 1))
      .returning();
    if (!after) throw new PrintCatalogError("update_failed", "Fiyat ayarları güncellenemedi.", 500);
    await writeChange(
      tx,
      "settings",
      null,
      "update",
      adminEmail,
      auditSnapshot(before),
      auditSnapshot(after)
    );
    return after;
  });
}

/**
 * Pasifleştirilmek istenen teknolojinin hâlâ aktif malzemesi var mı?
 *
 * Aktif bir malzemeyi pasif bir teknolojiye bağlı bırakmak `loadActiveSnapshot`
 * tarafından sessizce elenir; yöneticinin ekranında malzeme "açık" görünmeye
 * devam eder ama müşteri onu asla göremez. Uyarı, yazımı ENGELLEMEZ — yalnız
 * rotanın cevabına konur.
 */
export async function activeMaterialCount(technologyId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(printMaterials)
    .where(and(eq(printMaterials.technologyId, technologyId), eq(printMaterials.active, true)));
  return row?.count ?? 0;
}

/** Bu teknoloji dışında aktif başka bir teknoloji var mı (katalog boş kalmasın)? */
export async function otherActiveTechnologyCount(technologyId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(printTechnologies)
    .where(and(ne(printTechnologies.id, technologyId), eq(printTechnologies.active, true)));
  return row?.count ?? 0;
}

// ─── Fiyat simülatörü (SAF) ─────────────────────────────────────────────────

export interface QuoteSimulationInput {
  technologyKey: string;
  materialKey: string;
  colorKey: string;
  finishKey: string;
  layerUm: number | null;
  infillPct: number | null;
  quantity: number;
  leadTier: LeadTierKey;
  /** Yöneticinin elle girdiği ölçüler; milimetre / cm² / cm³. */
  geometry: { volumeCm3: number; areaCm2: number; x: number; y: number; z: number };
}

/** Mutabakat satırı: işaretli kuruş, birim fiyat üzerinde. */
export interface QuoteSimulationLine {
  key: string;
  label: string;
  kurus: number;
}

export type QuoteSimulationResult =
  | {
      ok: true;
      unitKurus: number;
      lineKurus: number;
      leadDays: number;
      breakdown: PartPriceBreakdown;
      /** Toplamı BİREBİR `unitKurus` eden kalemler. */
      unitLines: QuoteSimulationLine[];
      floorApplied: boolean;
      minUnitPriceKurus: number;
      setupPerUnitKurus: number;
      totals: QuoteTotals;
      dfm: DfmIssue[];
    }
  | { ok: false; reason: "not_ready" | "dfm_error" | "config_invalid"; dfm: DfmIssue[] };

/** Yöneticinin girdiği ölçülerden, analizi bitmiş gibi davranan bir parça. */
function simulationPart(input: QuoteSimulationInput): PricingPartInput {
  const geometry: PartGeometry = {
    volume: input.geometry.volumeCm3 * 1000,
    area: input.geometry.areaCm2 * 100,
    extents: { x: input.geometry.x, y: input.geometry.y, z: input.geometry.z },
    bodyCount: 1,
    isWatertight: true,
    isVolume: true,
    volumeEstimated: false,
    faceCount: 12,
    // Duvar kalınlığı ÖLÇÜLMEZ: simülatörde dosya yok. `null`, ince duvar
    // uyarısını "bilinmiyor" diye atlatır — uydurulmuş bir kalınlıkla yanlış
    // uyarı vermekten iyidir.
    wallP1: null,
    wallP5: null,
    overhangArea: 0,
    sourceUnits: null,
    objectCount: 1,
    // Simülatörde dosya da çevrim de yok: üçgen ağ parametresi ölçülmemiştir.
    tessellation: null,
    solidCount: null,
  };
  return {
    id: "simulation",
    analysisStatus: "ready",
    geometry,
    sourceSha256: null,
    manualUnitPriceKurus: null,
    manualPriceKey: null,
    dfmAckKey: null,
    config: {
      technologyKey: input.technologyKey,
      materialKey: input.materialKey,
      colorKey: input.colorKey,
      finishKey: input.finishKey,
      layerUm: input.layerUm,
      infillPct: input.infillPct,
      quantity: input.quantity,
      units: "mm",
      scale: 1,
      criticalTolerance: false,
    },
  };
}

const BPS_SCALE = 10_000;

function bpsLabel(bps: number): string {
  return (bps / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

/**
 * Birim fiyatın MUTABAKATI.
 *
 * `priceUnitAuto` dökümü kalemleri ham maliyet olarak verir ve taban fiyat
 * (`minUnitPriceKurus`) devreye girdiğinde toplamları birim fiyatı TUTMAZ;
 * kurulum ücretinin adede bölünmesi, adet indirimi ve kademe çarpanı da
 * dökümde sayı olarak değil, baz puan olarak durur. Sahibi ekranda
 * "malzeme + makine + … = birim fiyat" görmüyorsa, döküm bir açıklama değil
 * ikinci bir bilinmeyendir.
 *
 * Bu yüzden satırlar İŞARETLİ kuruş olarak üretilir ve son satır (yuvarlama)
 * artığı emer: toplam, `computeQuote`un verdiği `unitKurus`a BİREBİR eşittir.
 * Bağlayıcı olan hâlâ `unitKurus`tur; burada yeni bir fiyat hesaplanmaz.
 */
function reconcileUnitPrice(args: {
  breakdown: PartPriceBreakdown;
  unitKurus: number;
  quantity: number;
  minUnitPriceKurus: number;
}): {
  unitLines: QuoteSimulationLine[];
  floorApplied: boolean;
  setupPerUnitKurus: number;
} {
  const { breakdown, unitKurus, quantity, minUnitPriceKurus } = args;

  const lines: QuoteSimulationLine[] = [
    { key: "material", label: "Malzeme (destek dahil)", kurus: breakdown.materialKurus },
    { key: "machine", label: "Makine zamanı", kurus: breakdown.machineKurus },
    { key: "finish", label: "Yüzey işlemi", kurus: breakdown.finishKurus },
    { key: "color", label: "Renk ek ücreti", kurus: breakdown.colorKurus },
  ];

  const costSum = lines.reduce((sum, line) => sum + line.kurus, 0);
  const floorKurus = Math.max(0, minUnitPriceKurus - costSum);
  if (floorKurus > 0) {
    lines.push({
      key: "floor",
      label: "Taban fiyat farkı (birim alt sınırı)",
      kurus: floorKurus,
    });
  }
  const base = costSum + floorKurus;

  const discountKurus = -Math.round((base * breakdown.qtyDiscountBps) / BPS_SCALE);
  if (discountKurus !== 0) {
    lines.push({
      key: "qty_discount",
      label: `Adet indirimi (%${bpsLabel(breakdown.qtyDiscountBps)})`,
      kurus: discountKurus,
    });
  }

  const setupPerUnitKurus = Math.round(breakdown.setupKurus / quantity);
  if (setupPerUnitKurus !== 0) {
    lines.push({
      key: "setup",
      label: `Kurulum ücretinin birim payı (${breakdown.setupKurus} kuruş ÷ ${quantity})`,
      kurus: setupPerUnitKurus,
    });
  }

  const preTier = base + discountKurus + setupPerUnitKurus;
  const tierKurus = Math.round((preTier * (breakdown.tierMultiplierBps - BPS_SCALE)) / BPS_SCALE);
  if (tierKurus !== 0) {
    lines.push({
      key: "tier",
      label: `Teslim kademesi farkı (×${(breakdown.tierMultiplierBps / BPS_SCALE).toLocaleString("tr-TR", { maximumFractionDigits: 4 })})`,
      kurus: tierKurus,
    });
  }

  const rounding = unitKurus - (preTier + tierKurus);
  if (rounding !== 0) {
    lines.push({ key: "rounding", label: "Yuvarlama ve kuruş farkı", kurus: rounding });
  }

  return { unitLines: lines, floorApplied: floorKurus > 0, setupPerUnitKurus };
}

/**
 * Simülatörün cevabı. Fiyat `computeQuote`tan gelir — bu fonksiyon İKİNCİ BİR
 * FİYAT YOLU DEĞİLDİR, yalnız girdiyi bir parçaya çevirir ve dökümü mutabık
 * satırlara açar.
 */
export function simulateQuotePrice(
  snapshot: PricingSnapshot,
  input: QuoteSimulationInput
): QuoteSimulationResult {
  const part = simulationPart(input);
  const computed = computeQuote(snapshot, [part], {
    leadTier: input.leadTier,
    addonKeys: [],
  });
  const only = computed.parts[0];
  if (!only) return { ok: false, reason: "config_invalid", dfm: [] };
  if (!only.price.ok) return { ok: false, reason: only.price.reason, dfm: only.dfm.issues };
  const breakdown = only.price.breakdown;
  if (!breakdown) {
    // Simülatörde manuel fiyat yoktur, yani döküm DAİMA gelir. Yine de sessizce
    // mutabakatsız bir ekran göstermeyelim.
    return { ok: false, reason: "not_ready", dfm: only.dfm.issues };
  }

  const minUnitPriceKurus = findTechnology(snapshot, input.technologyKey)?.minUnitPriceKurus ?? 0;
  const reconciled = reconcileUnitPrice({
    breakdown,
    unitKurus: only.price.unitKurus,
    quantity: input.quantity,
    minUnitPriceKurus,
  });

  return {
    ok: true,
    unitKurus: only.price.unitKurus,
    lineKurus: only.price.lineKurus,
    leadDays: only.price.leadDays,
    breakdown,
    minUnitPriceKurus,
    totals: computed.totals,
    dfm: only.dfm.issues,
    ...reconciled,
  };
}
