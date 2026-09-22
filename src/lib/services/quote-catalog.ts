/**
 * Aktif baskı kataloğunu teklife DONDURULACAK anlık görüntüye çevirir.
 *
 * Neden anlık görüntü: açık bir teklif kendi snapshot'ıyla bağlayıcıdır
 * (spec §"Teklif yaşam döngüsü"). Yönetici bir malzemenin fiyatını
 * değiştirdiğinde dünkü teklifin tutarı değişmez; müşteriye "katalog
 * güncellendi, yeniden fiyatla" denir. Bu yüzden fiyat hesabı kataloğu
 * DB'den değil, teklifin `pricing_snapshot` kolonundan okur — bu modül
 * yalnızca snapshot'ı ÜRETİR (yeni teklif, yeniden fiyatlama, vitrin).
 *
 * NOT: `import "server-only"` YOK — worker zinciri bu modülü de yükler.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  printAddons,
  printFinishes,
  printMaterials,
  printTechnologies,
  quotePricingSettings,
} from "@/lib/db/schema";
import type {
  PricingSnapshot,
  SnapshotAddon,
  SnapshotFinish,
  SnapshotMaterial,
  SnapshotTechnology,
} from "@/lib/config/quote-types";

/**
 * Katalog satırı yoksa teklif AÇILMAZ.
 *
 * Boş bir snapshot'la teklif açmak, müşteriye seçeneksiz bir ekran ve
 * "fiyat hesaplanamadı" demektir; arızayı kurulum anında görmek yeğdir.
 */
export class QuoteCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteCatalogError";
  }
}

/**
 * Aktif katalog + tek satırlık fiyat politikası.
 *
 * Sıra `sort_order` (eşitlikte anahtar) ile SABİTTİR: yeni parçanın
 * varsayılanı listenin ilk satırından geldiği için (bkz. `defaultPartConfig`)
 * rastgele bir sıra, aynı katalogda farklı varsayılanlar üretirdi.
 *
 * Teknolojisi pasifleştirilmiş malzeme/yüzey de DIŞARIDA kalır: aktif olmayan
 * bir teknolojinin malzemesini teklife koymak, seçilemeyen bir seçenek
 * göstermek olurdu.
 */
export async function loadActiveSnapshot(): Promise<PricingSnapshot> {
  const [technologyRows, materialRows, finishRows, addonRows, settingsRows] = await Promise.all([
    db
      .select()
      .from(printTechnologies)
      .where(eq(printTechnologies.active, true))
      .orderBy(asc(printTechnologies.sortOrder), asc(printTechnologies.key)),
    db
      .select({ material: printMaterials, technologyKey: printTechnologies.key })
      .from(printMaterials)
      .innerJoin(printTechnologies, eq(printMaterials.technologyId, printTechnologies.id))
      .where(and(eq(printMaterials.active, true), eq(printTechnologies.active, true)))
      .orderBy(asc(printMaterials.sortOrder), asc(printMaterials.key)),
    db
      .select({ finish: printFinishes, technologyKey: printTechnologies.key })
      .from(printFinishes)
      .leftJoin(printTechnologies, eq(printFinishes.technologyId, printTechnologies.id))
      .where(
        and(
          eq(printFinishes.active, true),
          sql`${printFinishes.technologyId} IS NULL OR ${printTechnologies.active} = true`
        )
      )
      .orderBy(asc(printFinishes.sortOrder), asc(printFinishes.key)),
    db
      .select()
      .from(printAddons)
      .where(eq(printAddons.active, true))
      .orderBy(asc(printAddons.sortOrder), asc(printAddons.key)),
    db.select().from(quotePricingSettings).where(eq(quotePricingSettings.id, 1)).limit(1),
  ]);

  const settings = settingsRows[0];
  if (!settings) {
    throw new QuoteCatalogError("Teklif fiyat ayarları bulunamadı (quote_pricing_settings).");
  }
  if (technologyRows.length === 0) {
    throw new QuoteCatalogError("Aktif baskı teknolojisi yok; katalog boş.");
  }

  const technologies: SnapshotTechnology[] = technologyRows.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    orderMaterial: t.orderMaterial,
    capabilityTag: t.capabilityTag,
    buildMm: { x: t.buildXMm, y: t.buildYMm, z: t.buildZMm },
    minWallMm: t.minWallMm,
    minFeatureMm: t.minFeatureMm,
    toleranceText: t.toleranceText,
    layerOptionsUm: t.layerOptionsUm,
    defaultLayerUm: t.defaultLayerUm,
    infillOptionsPct: t.infillOptionsPct,
    defaultInfillPct: t.defaultInfillPct,
    shellMm: t.shellMm,
    setupFeeKurus: t.setupFeeKurus,
    machineRateKurusPerHour: t.machineRateKurusPerHour,
    throughputCm3PerHour: t.throughputCm3PerHour,
    heightHoursPerMm: t.heightHoursPerMm,
    minUnitPriceKurus: t.minUnitPriceKurus,
    baseLeadDays: t.baseLeadDays,
    sortOrder: t.sortOrder,
  }));

  const materials: SnapshotMaterial[] = materialRows.map(({ material, technologyKey }) => ({
    key: material.key,
    technologyKey,
    name: material.name,
    description: material.description,
    properties: material.properties,
    densityGCm3: material.densityGCm3,
    priceKurusPerGram: material.priceKurusPerGram,
    supportFactor: material.supportFactor,
    capabilityTag: material.capabilityTag,
    colors: material.colors,
    leadDaysExtra: material.leadDaysExtra,
    sortOrder: material.sortOrder,
  }));

  const finishes: SnapshotFinish[] = finishRows.map(({ finish, technologyKey }) => ({
    key: finish.key,
    technologyKey: technologyKey ?? null,
    name: finish.name,
    description: finish.description,
    fixedKurus: finish.fixedKurus,
    perCm2Kurus: finish.perCm2Kurus,
    leadDaysExtra: finish.leadDaysExtra,
    requiresManual: finish.requiresManual,
    costLineKind: finish.costLineKind,
    sortOrder: finish.sortOrder,
  }));

  const addons: SnapshotAddon[] = addonRows.map((a) => ({
    key: a.key,
    name: a.name,
    description: a.description,
    priceType: a.priceType,
    priceKurus: a.priceKurus,
    leadDaysExtra: a.leadDaysExtra,
    sortOrder: a.sortOrder,
  }));

  return {
    version: 1,
    takenAt: new Date().toISOString(),
    technologies,
    materials,
    finishes,
    addons,
    settings: {
      qtyBreaks: settings.qtyBreaks,
      leadTiers: settings.leadTiers,
      minOrderKurus: settings.minOrderKurus,
      maxAutoTotalKurus: settings.maxAutoTotalKurus,
      maxAutoQtyPerPart: settings.maxAutoQtyPerPart,
      maxPartsPerQuote: settings.maxPartsPerQuote,
      maxFileBytes: settings.maxFileBytes,
      quoteValidDays: settings.quoteValidDays,
      retentionDaysAfterExpiry: settings.retentionDaysAfterExpiry,
      priceBreakQuantities: settings.priceBreakQuantities,
      holidays: settings.holidays,
      cutoffHour: settings.cutoffHour,
      havaleDiscountApplies: settings.havaleDiscountApplies,
    },
  };
}

/**
 * Kataloğun (ve ayarların) son değişme anı.
 *
 * Teklifin `snapshot_taken_at` değeriyle karşılaştırılır: daha yeniyse çalışma
 * alanında "Katalog güncellendi — yeniden fiyatla" bandı çıkar. PASİF satırlar
 * da sayılır, çünkü bir malzemenin kapatılması da müşterinin bilmesi gereken
 * bir değişikliktir.
 *
 * Hiç satır yoksa epoch döner: "hiçbir şey değişmedi" demek, uydurma bir
 * "şimdi" ile her teklife yanlışlıkla bant göstermekten iyidir.
 */
export async function catalogUpdatedAt(): Promise<Date> {
  const result = await db.execute<{ updated_at: Date | null }>(sql`
    SELECT greatest(
      coalesce((SELECT max(${printTechnologies.updatedAt}) FROM ${printTechnologies}), 'epoch'),
      coalesce((SELECT max(${printMaterials.updatedAt}) FROM ${printMaterials}), 'epoch'),
      coalesce((SELECT max(${printFinishes.updatedAt}) FROM ${printFinishes}), 'epoch'),
      coalesce((SELECT max(${printAddons.updatedAt}) FROM ${printAddons}), 'epoch'),
      coalesce((SELECT max(${quotePricingSettings.updatedAt}) FROM ${quotePricingSettings}), 'epoch')
    ) AS updated_at
  `);
  const value = result.rows[0]?.updated_at;
  return value ? new Date(value) : new Date(0);
}
