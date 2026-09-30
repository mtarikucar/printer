/**
 * Anlık teklif motorunun ortak tip sözleşmesi.
 *
 * Şema (`schema.ts` jsonb `$type<>`), saf çekirdek (fiyat / DfM / birim / iş günü),
 * servisler, worker'lar ve arayüz AYNI isimleri bu dosyadan alır. Bir tip burada
 * değişmeden başka bir yerde "benzeri" tanımlanmaz.
 *
 * Saf modül: DB yok, `server-only` yok, `node:` import'u yok — hem BullMQ
 * worker'ı hem istemci bileşenleri (yalnız tip olarak) import eder.
 *
 * Birim kuralı: `PartGeometry` DOSYA BİRİMİNDEDİR (ölçeksiz). Milimetreye çeviri
 * yalnız `quote-units.ts` içindeki `scaledGeometry` ile yapılır; birim ya da
 * ölçek değişince worker yeniden çalışmaz.
 */

export const QUOTE_UNITS = ["mm", "cm", "in"] as const;
export type QuoteUnits = (typeof QUOTE_UNITS)[number];

export const LEAD_TIER_KEYS = ["economy", "standard", "express"] as const;
export type LeadTierKey = (typeof LEAD_TIER_KEYS)[number];

export const QUOTE_STATUSES = [
  "draft",
  "needs_review",
  "quoted",
  "ordered",
  "expired",
  "cancelled",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const REVIEW_KINDS = ["manual", "rfq", "target_price"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const ANALYSIS_STATUSES = ["queued", "analyzing", "ready", "failed"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/**
 * `quote_parts.analysis_error` kodu: kurtarma süpürmesi deneme tavanına vurduğu
 * için VAZGEÇTİ (parçanın işi hiç tamamlanamadı).
 *
 * Öteki kodlar python'un/çalıştırıcının hatalarıdır (`MeshProcessError.code`);
 * bu tek kodu süpürmenin kendisi yazar. Kolon müşteriye GİTMEZ — müşteri
 * `failed` parçanın DfM cümlesini (`instantQuote.dfm.analysis_failed`) görür,
 * admin ise bu kodun Türkçe karşılığını (`quote-admin.ts`).
 */
export const ANALYSIS_GIVE_UP_ERROR = "stuck_retry_limit";

/** `.step` ve `.stp` uzantılarının İKİSİ de bu tek anahtara düşer (eşleme: `quote-model-validation.ts`). */
export const QUOTE_SOURCE_FORMATS = ["stl", "obj", "3mf", "step"] as const;
export type QuoteSourceFormat = (typeof QUOTE_SOURCE_FORMATS)[number];

export const INVOICE_TYPES = ["individual", "corporate"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const ADDON_PRICE_TYPES = ["fixed", "per_part", "per_unit"] as const;
export type AddonPriceType = (typeof ADDON_PRICE_TYPES)[number];

export const COST_LINE_KINDS = ["production", "painting"] as const;
export type QuoteCostLineKind = (typeof COST_LINE_KINDS)[number];

export const QUOTE_ADMIN_ACTIONS = [
  "manual_price",
  "target_accept",
  "target_counter",
  "target_reject",
  "review_reject",
  "extend_expiry",
  "reopen",
] as const;
export type QuoteAdminAction = (typeof QUOTE_ADMIN_ACTIONS)[number];

export const CATALOG_ENTITIES = ["technology", "material", "finish", "addon", "settings"] as const;
export type CatalogEntity = (typeof CATALOG_ENTITIES)[number];

// ─── Geometri (worker raporu, dosya biriminde) ──────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Çekirdeğin B-rep yüzeyleri üçgen ağa çevirirken kullandığı sapma parametreleri.
 *
 * AYRI VE ADLANDIRILMIŞ bir tip, satır içi bir nesne tipi DEĞİL: python testi
 * (`scripts/test-analyze-quote-part.py` `contract_keys()`) `PartGeometry` bloğunu
 * ilk sütun-0 kapanış süslüsüne kadar regex'le okuyor; satır içi çok satırlı bir
 * nesne tipinin kapanış süslüsü yanlış girintilenirse arayüz ortadan kesilir ve
 * anahtar kümesi testi anlaşılmaz biçimde kırmızıya döner.
 *
 * Açı toleransının birimi RADYAN'dır (cascadio `tol_angular`), derece değil —
 * ölçüm: `task-s1-report.md` §3 karar 1 / defter kaydı SK-2.
 */
export interface PartTessellation {
  deflectionMm: number;
  angularRad: number;
  relative: boolean;
}

export interface PartGeometry {
  /** Kapalı hacim (dosya birimi³). Ölçülemediyse null. */
  volume: number | null;
  /** Yüzey alanı (dosya birimi²). */
  area: number;
  /** Eksen hizalı kutu boyutları (dosya birimi). */
  extents: Vec3;
  /** Ayrık gövde (kabuk) sayısı — birleştirilmez, atılmaz. */
  bodyCount: number;
  isWatertight: boolean;
  isVolume: boolean;
  /** Hacim yalnız onarılmış kopyadan tahmin edildiyse true. */
  volumeEstimated: boolean;
  faceCount: number;
  /** Duvar kalınlığı yüzdelikleri (dosya birimi); ölçülmediyse null. */
  wallP1: number | null;
  wallP5: number | null;
  /** Aşağı bakan (destek isteyen) yüzey alanı (dosya birimi²). */
  overhangArea: number;
  /**
   * 3MF `<model unit>` özniteliği; STL/OBJ için null. STEP'te DAİMA `"mm"` —
   * birim ISO 10303 gereği dosyanın kendisinde yazılıdır ve CAD çekirdeği
   * (cascadio `detectLengthUnit()`) onu uygulayarak metre çıkarır, ölçüm hattı
   * da ×1000 ile mm'ye alır. Yani STEP'te birim TAHMİN değil, OKUNMUŞ veridir.
   */
  sourceUnits: QuoteUnits | null;
  /** 3MF içindeki nesne sayısı; STL/OBJ için 1, STEP'te katı gövde sayısı. */
  objectCount: number;
  /**
   * Çekirdeğin ürettiği üçgen ağın sapma parametreleri; mesh dosyalarında
   * (STL/OBJ/3MF) null, çünkü orada üçgenler dosyanın kendisinden gelir.
   * Geometriyle BİRLİKTE saklanır: sabit (`STEP_TESSELLATION`) ileride
   * değişirse eski parçalar eski değerleriyle okunur ve hangi parçanın hangi
   * sapmayla ölçüldüğü — dolayısıyla hangi ağdan fiyatlandığı — görülebilir.
   */
  tessellation: PartTessellation | null;
  /**
   * Çekirdek raporu: STEP'in ÜRÜN yapısında kaç katı gövde vardı (assembly
   * ipucu). Mesh'ten sayılan `bodyCount` ile ayrışabilir — değen iki gövde
   * mesh'te tek bileşendir — ve ayrışma bilginin kendisidir. Mesh
   * dosyalarında null.
   */
  solidCount: number | null;
}

/** `scaledGeometry` çıktısı — milimetre cinsinden. */
export interface ScaledGeometry {
  factor: number;
  volumeMm3: number | null;
  volumeCm3: number | null;
  areaMm2: number;
  areaCm2: number;
  extentsMm: Vec3;
  /** Boyutlar küçükten büyüğe (sığma kontrolü yönden bağımsız). */
  sortedMm: [number, number, number];
  wallP1Mm: number | null;
}

// ─── Katalog anlık görüntüsü (teklif başına dondurulur) ─────────────────────

export interface SnapshotColor {
  key: string;
  name: string;
  hex: string;
  surchargeKurus: number;
}

export interface SnapshotTechnology {
  key: string;
  name: string;
  description: string;
  orderMaterial: "resin" | "filament";
  capabilityTag: string;
  buildMm: Vec3;
  minWallMm: number;
  minFeatureMm: number;
  toleranceText: string;
  layerOptionsUm: number[];
  defaultLayerUm: number;
  /** null = katı baskı (SLA); dizi = FDM doluluk seçenekleri. */
  infillOptionsPct: number[] | null;
  defaultInfillPct: number | null;
  shellMm: number;
  setupFeeKurus: number;
  machineRateKurusPerHour: number;
  throughputCm3PerHour: number;
  heightHoursPerMm: number;
  minUnitPriceKurus: number;
  baseLeadDays: number;
  sortOrder: number;
}

export interface MaterialProperties {
  tensileMpa?: number;
  elongationPct?: number;
  heatDeflectionC?: number;
  flexible?: boolean;
  transparent?: boolean;
  uses?: string[];
}

export interface SnapshotMaterial {
  key: string;
  technologyKey: string;
  name: string;
  description: string;
  properties: MaterialProperties;
  densityGCm3: number;
  priceKurusPerGram: number;
  supportFactor: number;
  capabilityTag: string | null;
  colors: SnapshotColor[];
  leadDaysExtra: number;
  sortOrder: number;
}

export interface SnapshotFinish {
  key: string;
  /** null = her teknolojiye uygun. */
  technologyKey: string | null;
  name: string;
  description: string;
  fixedKurus: number;
  perCm2Kurus: number;
  leadDaysExtra: number;
  requiresManual: boolean;
  costLineKind: QuoteCostLineKind;
  sortOrder: number;
}

export interface SnapshotAddon {
  key: string;
  name: string;
  description: string;
  priceType: AddonPriceType;
  priceKurus: number;
  leadDaysExtra: number;
  sortOrder: number;
}

export interface QtyBreak {
  minQty: number;
  discountBps: number;
}

export interface LeadTier {
  key: LeadTierKey;
  name: string;
  multiplierBps: number;
  daysDelta: number;
  minDays: number;
}

export interface PricingSettings {
  qtyBreaks: QtyBreak[];
  leadTiers: LeadTier[];
  minOrderKurus: number;
  maxAutoTotalKurus: number;
  maxAutoQtyPerPart: number;
  maxPartsPerQuote: number;
  maxFileBytes: number;
  quoteValidDays: number;
  retentionDaysAfterExpiry: number;
  priceBreakQuantities: number[];
  /** ISO tarih (YYYY-MM-DD), İstanbul takvimi. */
  holidays: string[];
  cutoffHour: number;
  havaleDiscountApplies: boolean;
}

/** Yalnız AKTİF katalog satırları. */
export interface PricingSnapshot {
  version: 1;
  takenAt: string;
  technologies: SnapshotTechnology[];
  materials: SnapshotMaterial[];
  finishes: SnapshotFinish[];
  addons: SnapshotAddon[];
  settings: PricingSettings;
}

// ─── Parça yapılandırması ve fiyat girdisi ──────────────────────────────────

export interface PartConfig {
  technologyKey: string;
  materialKey: string;
  colorKey: string;
  finishKey: string;
  layerUm: number | null;
  infillPct: number | null;
  quantity: number;
  units: QuoteUnits;
  scale: number;
  criticalTolerance: boolean;
}

export interface PricingPartInput {
  id: string;
  analysisStatus: AnalysisStatus;
  geometry: PartGeometry | null;
  sourceSha256: string | null;
  config: PartConfig;
  manualUnitPriceKurus: number | null;
  manualPriceKey: string | null;
  dfmAckKey: string | null;
}

export interface QuoteLevelInput {
  leadTier: LeadTierKey;
  addonKeys: string[];
}

// ─── DfM ────────────────────────────────────────────────────────────────────

export const DFM_CODES = [
  "analysis_pending",
  "analysis_failed",
  "no_volume",
  "not_watertight",
  "too_large",
  "too_small",
  "thin_walls",
  "multiple_bodies",
  "qty_over_auto",
  "finish_manual",
  "tolerance_manual",
  "config_invalid",
] as const;
export type DfmCode = (typeof DFM_CODES)[number];
export type DfmSeverity = "error" | "warning" | "info";

export interface DfmIssue {
  code: DfmCode;
  severity: DfmSeverity;
  params?: Record<string, string | number>;
}

export interface PartDfmResult {
  issues: DfmIssue[];
  /** error var ve geçerli manuel fiyat yok → anlık fiyat verilemez. */
  blocking: boolean;
  /** Onay gerektiren uyarıların anahtarı; uyarı yoksa null. */
  warningKey: string | null;
  scaled: ScaledGeometry | null;
}

// ─── Fiyat çıktısı ──────────────────────────────────────────────────────────

export interface PartPriceBreakdown {
  materialKurus: number;
  machineKurus: number;
  finishKurus: number;
  colorKurus: number;
  setupKurus: number;
  qtyDiscountBps: number;
  tierMultiplierBps: number;
  grams: number;
  hours: number;
  effectiveVolumeCm3: number;
}

export interface PriceBreakPoint {
  quantity: number;
  unitKurus: number;
}

export type PartPriceResult =
  | {
      ok: true;
      source: "auto" | "manual";
      unitKurus: number;
      lineKurus: number;
      breakdown: PartPriceBreakdown | null;
      priceBreaks: PriceBreakPoint[];
      leadDays: number;
    }
  | { ok: false; reason: "not_ready" | "dfm_error" | "config_invalid" };

export interface AddonLine {
  key: string;
  name: string;
  kurus: number;
}

export interface QuoteTotals {
  allPriced: boolean;
  partsKurus: number;
  addonLines: AddonLine[];
  addonsKurus: number;
  minOrderTopUpKurus: number;
  totalKurus: number;
  kdvExcludedKurus: number;
  kdvKurus: number;
  /** Seçili kademe için iş günü; herhangi bir parça fiyatlanamıyorsa null. */
  leadDays: number | null;
}

export interface LeadOption {
  key: LeadTierKey;
  name: string;
  leadDays: number | null;
  /** Fiyat kapısı kapalıysa sunucu bu alanı hiç göndermez. */
  totalKurus?: number | null;
}

export interface ComputedPart {
  id: string;
  dfm: PartDfmResult;
  price: PartPriceResult;
}

export interface ComputedQuote {
  parts: ComputedPart[];
  totals: QuoteTotals;
  leadOptions: LeadOption[];
  quoteIssues: DfmIssue[];
}

// ─── Ödeme anında dondurulan parça tanımı (üretici / admin görünümleri) ─────

export interface FrozenQuotePart {
  partId: string;
  position: number;
  name: string;
  fileName: string;
  sourceFormat: QuoteSourceFormat;
  canonicalStlKey: string;
  thumbnailKey: string | null;
  drawingKey: string | null;
  drawingName: string | null;
  scaleFactor: number;
  technologyKey: string;
  technologyName: string;
  materialKey: string;
  materialName: string;
  colorName: string;
  colorHex: string;
  finishKey: string;
  finishName: string;
  layerUm: number | null;
  infillPct: number | null;
  quantity: number;
  dimensionsMm: Vec3;
  volumeCm3: number | null;
  /**
   * Parçanın ÜÇGENLEME SAPMASI (mm); mesh parçalarında null.
   *
   * Ödeme anındaki kalıcı kayıt: bu parçanın hangi sapmayla ölçüldüğü — yani
   * hangi geometriden fiyatlandığı — sonradan değiştirilemeyecek biçimde
   * burada durur (üretici/admin görünümlerinin kaynağı). Müşteriye gösterilen
   * teklif BELGESİ bunu okumaz; onun kaynağı `PresentedPart.tessellationMm`
   * (tek türetme yeri `quote-present.ts`).
   */
  tessellationMm: number | null;
  unitKurus: number;
  lineKurus: number;
  note: string | null;
  dfmWarnings: DfmCode[];
}

export interface FrozenQuoteAddon {
  key: string;
  name: string;
  kurus: number;
}

// ─── Döviz GÖSTERİMİ (0071) ─────────────────────────────────────────────────
//
// GÖSTERİM, yalnız gösterim: bağlayıcı her tutar ve tahsil edilen her kuruş
// Türk lirasıdır (gerekçe `quote-currency.ts` dosya başlığında). Bu bloktaki
// hiçbir alan kuruş TAŞIMAZ ve hiçbir adı `…Kurus` ile BİTMEZ — `…Minor`,
// `…Micro`, `…PerUnit` kullanılır (sebebi: `quote-present.ts`in fiyat kapısı
// `key.endsWith("Kurus")` ile uygulanıyor).

export const FX_CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

/** Ekranda seçilebilen gösterimler; BAŞTAKİ eleman bağlayıcı olandır. */
export const DISPLAY_CURRENCIES = ["TRY", ...FX_CURRENCIES] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export interface FrozenFxRate {
  currency: FxCurrency;
  /** 1 birim döviz = kaç mikro-TRY (TCMB döviz alış / `Unit`, ×1e6, tamsayı). */
  microTryPerUnit: number;
}

/**
 * Teklifin DONDURDUĞU kur kümesi (`quotes.fx_snapshot`); null = döviz
 * gösterimi yok. `PricingSnapshot`ın İÇİNE girmez: o sürümlenmiş bir KATALOG
 * sözleşmesidir, kur ise bir gün sabitidir.
 */
export interface QuoteFxSnapshot {
  version: 1;
  source: "tcmb";
  /** TCMB bülteninin KENDİ tarihi, YYYY-MM-DD (İstanbul) — müşteriye AYNEN gösterilir. */
  bulletinDate: string;
  takenAt: string;
  rates: FrozenFxRate[];
}

/** `PresentedQuote.display` — yalnız `canSeePrices` && bayrak açık iken VAR. */
export interface PresentedFxDisplay {
  snapshot: QuoteFxSnapshot;
  currencies: DisplayCurrency[];
}

// ─── Görünüm (tek serileştirici `presentQuote` çıktısı) ─────────────────────

export interface QuoteViewer {
  canSeePrices: boolean;
  canEdit: boolean;
  isOwner: boolean;
  isShare: boolean;
  isAdmin: boolean;
}

export interface PresentedPartPrice {
  unitKurus: number;
  lineKurus: number;
  source: "auto" | "manual";
  priceBreaks: PriceBreakPoint[];
}

export interface PresentedPart {
  id: string;
  position: number;
  name: string;
  fileName: string;
  sourceFormat: QuoteSourceFormat;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  thumbnailUrl: string | null;
  /** Paylaşım görünümünde her zaman null. */
  previewGlbUrl: string | null;
  dimensionsMm: Vec3 | null;
  volumeCm3: number | null;
  areaCm2: number | null;
  bodyCount: number | null;
  /**
   * Üçgenleme sapması (mm); üçgenleri dosyadan gelen parçalarda (STL/OBJ/3MF)
   * null. `PartGeometry.tessellation.deflectionMm`den türer.
   *
   * Bir FİYAT değil, ürün NİTELİĞİdir: bu yüzden fiyat kapısından bağımsız,
   * fiyatsız izleyiciye de gider (ad `…Kurus` ile bitmediği için `publicIssue`
   * süzgecine de takılmaz). Çalışma alanı ve teklif belgesi bunu okur —
   * anlaşmazlık savunması sapmanın YAZILI olmasına bağlı (tasarım §3).
   */
  tessellationMm: number | null;
  suggestedUnits: QuoteUnits | null;
  config: PartConfig;
  note: string | null;
  drawingName: string | null;
  targetUnitPriceKurus?: number | null;
  dfm: DfmIssue[];
  dfmWarningKey: string | null;
  dfmAcknowledged: boolean;
  needsManualPrice: boolean;
  leadDays: number | null;
  /** YALNIZ `viewer.canSeePrices` iken var. */
  price?: PresentedPartPrice | null;
}

/** Arayüzün seçenek listeleri — fiyat alanları yalnız `canSeePrices` iken. */
export interface PresentedCatalog {
  technologies: Array<{
    key: string;
    name: string;
    description: string;
    buildMm: Vec3;
    minWallMm: number;
    toleranceText: string;
    layerOptionsUm: number[];
    defaultLayerUm: number;
    infillOptionsPct: number[] | null;
    defaultInfillPct: number | null;
    baseLeadDays: number;
  }>;
  materials: Array<{
    key: string;
    technologyKey: string;
    name: string;
    description: string;
    properties: MaterialProperties;
    colors: Array<{ key: string; name: string; hex: string }>;
  }>;
  finishes: Array<{
    key: string;
    technologyKey: string | null;
    name: string;
    description: string;
    requiresManual: boolean;
  }>;
  addons: Array<{
    key: string;
    name: string;
    description: string;
    leadDaysExtra: number;
    priceKurus?: number;
    priceType?: AddonPriceType;
  }>;
  leadTiers: Array<{ key: LeadTierKey; name: string }>;
  maxPartsPerQuote: number;
  maxFileBytes: number;
  /**
   * Müşteriye NE seçtirileceğini bu liste söyler (dropzone `accept` + istemci
   * doğrulaması). `quote_step_enabled` KAPALIYKEN `"step"` bu listede YOKTUR.
   *
   * Bu bir KOLAYLIKTIR, güvenlik sınırı değil: kural sunucuda, parçayı yazan
   * tek yerde durur (`addPartFromUpload`). Liste `QUOTE_SOURCE_FORMATS`ten
   * türetilir, elle yazılmaz.
   */
  acceptedFormats: QuoteSourceFormat[];
}

export interface PresentedQuote {
  id: string;
  number: string;
  status: QuoteStatus;
  reviewKind: ReviewKind | null;
  reviewNote: string | null;
  title: string | null;
  leadTier: LeadTierKey;
  addonKeys: string[];
  customerNote: string | null;
  poNumber: string | null;
  /** Yalnız sahip görür. */
  invoice?: {
    type: InvoiceType;
    companyName: string | null;
    taxId: string | null;
    taxIdType: "vkn" | "tckn" | null;
    taxOffice: string | null;
  } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  expired: boolean;
  catalogChangedSinceSnapshot: boolean;
  termsAccepted: boolean;
  locked: boolean;
  liveDraftReference: string | null;
  orderNumber: string | null;
  shareUrl?: string | null;
  viewer: QuoteViewer;
  catalog: PresentedCatalog;
  parts: PresentedPart[];
  partCount: number;
  unitCount: number;
  quoteIssues: DfmIssue[];
  leadOptions: LeadOption[];
  /** Sipariş için beklenen teslim (kargoya teslim) tarihi, ISO. */
  shipByDate: string | null;
  readiness: { canCheckout: boolean; blockers: string[] };
  /** YALNIZ `viewer.canSeePrices` iken var. */
  totals?: QuoteTotals | null;
  /**
   * Döviz GÖSTERİMİ: YALNIZ `viewer.canSeePrices` VE bayrak
   * (`quote_fx_display_enabled`) açık iken var. Kur bir fiyattır — fiyat
   * kapısının arkasında durur.
   */
  display?: PresentedFxDisplay | null;
}

// ─── Müşteri listeleri (hesap sayfaları) ────────────────────────────────────

/** `/account/teklifler` satırı. Fiyat kolonları yalnız giriş yapmış sahibe gider. */
export interface CustomerQuoteListItem {
  id: string;
  number: string;
  status: QuoteStatus;
  title: string | null;
  partCount: number;
  unitCount: number;
  /** Fiyatlanamayan teklifte null (önbellek kolonu). */
  totalKurus: number | null;
  leadDays: number | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  expired: boolean;
  orderNumber: string | null;
  /**
   * Teklifin KENDİ dondurduğu kur kümesi; `null` = yalnız ₺ gösterilir (kur
   * yok, bayat ya da döviz gösterimi bayrağı KAPALI). Listedeki tutarın teklif
   * sayfasındaki rakamla birebir aynı okunması için bugünün bülteni DEĞİL,
   * teklifin donmuş kuru kullanılır.
   */
  fxSnapshot: QuoteFxSnapshot | null;
}

/** `/account/parcalar` satırı: aynı dosya (sha256) tek kez listelenir. */
export interface LibraryPart {
  /** En son yüklenen kopyanın parça kimliği — yeni teklife o kopyalanır. */
  partId: string;
  name: string;
  fileName: string;
  sourceFormat: QuoteSourceFormat;
  sha256: string;
  thumbnailUrl: string | null;
  dimensionsMm: Vec3 | null;
  volumeCm3: number | null;
  /**
   * Bu dosyanın EN SON hangi malzemeyle fiyatlandığı — o teklifin kendi
   * anlık görüntüsünden okunur (katalogdan değil): malzeme sonradan
   * kaldırılmış olsa bile müşterinin gördüğü ad değişmez. Ad çözülemezse null.
   */
  lastMaterialName: string | null;
  quoteId: string;
  quoteNumber: string;
  createdAt: string;
  /** Bu dosyanın müşterinin tekliflerinde kaç kez kullanıldığı. */
  useCount: number;
}

// ─── Admin teklif kuyruğu ───────────────────────────────────────────────────

/**
 * `/admin/teklifler` satırı.
 *
 * Admin fiyatı HER ZAMAN görür (fiyat kapısı müşteri tarafının kuralıdır), bu
 * yüzden tutar alanları koşulsuzdur; `null` "fiyatlanamadı" demektir.
 */
export interface AdminQuoteListItem {
  id: string;
  number: string;
  status: QuoteStatus;
  /**
   * Müşterinin NE istediği. `status !== "needs_review"` iken BAYAT olabilir:
   * `repriceQuote` durumu `draft`a çeker ama bu kolonu temizlemez, bu yüzden
   * kuyruk sekmeleri DURUMA bakar, bu alana değil.
   */
  reviewKind: ReviewKind | null;
  /** Yukarıdaki bayatlık ekranda da görünsün diye hesaplanır. */
  staleReviewKind: boolean;
  title: string | null;
  customerName: string | null;
  customerEmail: string | null;
  /** Girişsiz ziyaretçinin teklifi: e-postası yok, bildirim gönderilemez. */
  anonymous: boolean;
  partCount: number;
  unitCount: number;
  totalKurus: number | null;
  leadDays: number | null;
  reviewRequestedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  expired: boolean;
  orderNumber: string | null;
}

/**
 * Admin YAZIM sonucu (manuel fiyat, hedef fiyat kararı, süre uzatma, inceleme
 * kapatma, yeniden açma). Rotalar (`outcomeResponse`) ve karar ekranı
 * (`successNotice`) bu şekli okur.
 *
 * `quoted` NEDEN AYRI BİR ALAN: "durum `quoted` olur" MUTLU YOLDUR ve her
 * parçası fiyatlanabilen teklifte aynen öyle olur. Fiyatlanamayan bir parça
 * kaldığında durum `quoted` OLMAZ, çünkü `recomputeQuoteCache` `total_kurus`u
 * ancak HER parça fiyatlıyken yazar: koşulsuz bir `quoted`, "Teklifiniz hazır"
 * e-postasıyla birlikte tutarsız (`status = quoted`, `total_kurus = NULL`) ve
 * ÖDENEMEYEN bir teklif bırakırdı (`checkoutBlockers` ödemeyi kapalı tutar).
 * O yüzden yazım yine kaydedilir, `quoted:false` döner ve `blockers` hangi
 * parçanın neden fiyatsız kaldığını AYNEN müşteriye gösterilebilecek cümleyle
 * söyler.
 */
export interface AdminQuoteWriteResult {
  ok: true;
  quoted: boolean;
  blockers: string[];
}

/** Beklenen ret: rota bunu olduğu gibi gövdeye çevirir (`{error, code}`). */
export interface AdminQuoteRefusal {
  ok: false;
  status: number;
  code: string;
  error: string;
}

export type AdminQuoteOutcome = AdminQuoteWriteResult | AdminQuoteRefusal;
