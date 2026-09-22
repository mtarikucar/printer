/**
 * Teklifin TEK serileştiricisi.
 *
 * Sayfanın RSC props'u, `GET /api/quotes/[id]`, SSE sonrası yeniden çekme,
 * belge sayfası ve e-postalar teklifi BURADAN alır. İkinci bir serileştirici
 * olsaydı fiyat kapısı iki yerde ayrı ayrı uygulanır ve biri bir gün
 * unutulurdu; fiyat gizleme bir görünüm ayarı değil güvenlik sınırıdır.
 *
 * KURAL: `viewer.canSeePrices` yanlışken çıktıda hiçbir fiyat ANAHTARI
 * bulunmaz — `null` bile değil, anahtarın kendisi yoktur. `undefined` atamak
 * yetmez, `JSON.stringify` onu atsa da RSC props'unda ve `Object.keys`'te
 * görünürdü; bu yüzden alanlar hiç EKLENMEZ.
 *
 * SAF: DB okuması yoktur. İmzalayıcı (`sign`) ve paylaşım kökü dışarıdan
 * verilir, böylece hem rota hem test aynı işlevi çağırır.
 */
import { addBusinessDays, istanbulDateKey } from "@/lib/config/business-days";
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import { checkoutBlockers, quotePermissions } from "@/lib/config/quote-policy";
import type {
  ComputedQuote,
  DfmIssue,
  LeadOption,
  PresentedCatalog,
  PresentedPart,
  PresentedQuote,
  PricingPartInput,
  PricingSnapshot,
  QuoteViewer,
  Vec3,
} from "@/lib/config/quote-types";
import { suggestUnits } from "@/lib/config/quote-units";
import type { Quote, QuotePart } from "@/lib/db/schema";
import { toPricingPartInput } from "@/lib/services/quote-cache";

/**
 * DB satırlarını fiyat çekirdeğinin girdisine çevirir ve manuel fiyatı
 * DOĞRULAR.
 *
 * Manuel fiyat tek "dışarıdan gelen para"dır: admin yazar, kolon `integer`
 * olduğu için aralık kontrolü DB'de yoktur ve yanlış bir satır (0, negatif,
 * ondalık ya da ₺2.000.000 üstü) doğrudan müşteriye gösterilen ve tahsil
 * edilen tutara dönüşürdü. Geçersiz değer SESSİZCE DÜŞER (anahtarıyla
 * birlikte): parça "manuel fiyat bekliyor" hâline geri döner, ki bu yanlış
 * bir fiyattan iyidir.
 */
export function toPricingInputs(parts: QuotePart[]): PricingPartInput[] {
  return parts.map((part) => {
    const input = toPricingPartInput(part);
    const value = input.manualUnitPriceKurus;
    const usable =
      value !== null && Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT_KURUS;
    return usable ? input : { ...input, manualUnitPriceKurus: null, manualPriceKey: null };
  });
}

/** Katalogdaki en büyük baskı zarfı — birim önerisinin üst sınırı. */
function largestBuild(snapshot: PricingSnapshot): Vec3 {
  return snapshot.technologies.reduce<Vec3>(
    (acc, t) => ({
      x: Math.max(acc.x, t.buildMm.x),
      y: Math.max(acc.y, t.buildMm.y),
      z: Math.max(acc.z, t.buildMm.z),
    }),
    { x: 0, y: 0, z: 0 }
  );
}

/**
 * DfM uyarılarının parametrelerinden kuruş taşıyanları ayıklar.
 *
 * Teklif düzeyindeki `qty_over_auto` uyarısı `maxTotalKurus` taşır: fiyat
 * kapısı kapalı bir izleyiciye gönderilseydi gövdede yine bir kuruş alanı
 * olurdu. Kural ada bakar (`…Kurus`), çünkü yarın eklenecek bir parametrenin
 * bu listeye eklenmesini beklemek sızıntıyı kaçırmanın en kolay yoludur.
 */
function publicIssue(issue: DfmIssue): DfmIssue {
  if (!issue.params) return issue;
  const kept = Object.entries(issue.params).filter(([key]) => !key.endsWith("Kurus"));
  if (kept.length === Object.keys(issue.params).length) return issue;
  if (kept.length === 0) return { code: issue.code, severity: issue.severity };
  return { code: issue.code, severity: issue.severity, params: Object.fromEntries(kept) };
}

/**
 * Kamuya açık katalog (açılış sayfası / yükleyici): hiçbir fiyat alanı yok.
 * Fiyatlar yalnız bir teklifin içinde, fiyat kapısı açık izleyiciye gider.
 */
export function presentPublicCatalog(snapshot: PricingSnapshot): PresentedCatalog {
  return presentCatalog(snapshot, false);
}

function presentCatalog(snapshot: PricingSnapshot, canSeePrices: boolean): PresentedCatalog {
  return {
    technologies: snapshot.technologies.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      buildMm: t.buildMm,
      minWallMm: t.minWallMm,
      toleranceText: t.toleranceText,
      layerOptionsUm: t.layerOptionsUm,
      defaultLayerUm: t.defaultLayerUm,
      infillOptionsPct: t.infillOptionsPct,
      defaultInfillPct: t.defaultInfillPct,
      baseLeadDays: t.baseLeadDays,
    })),
    materials: snapshot.materials.map((m) => ({
      key: m.key,
      technologyKey: m.technologyKey,
      name: m.name,
      description: m.description,
      properties: m.properties,
      // Renk farkı (`surchargeKurus`) HİÇBİR izleyiciye gitmez: fiyatı zaten
      // parçanın birim fiyatı taşır, ayrı bir kalem olarak göstermek fiyat
      // kapısına ikinci bir delik açardı.
      colors: m.colors.map((c) => ({ key: c.key, name: c.name, hex: c.hex })),
    })),
    finishes: snapshot.finishes.map((f) => ({
      key: f.key,
      technologyKey: f.technologyKey,
      name: f.name,
      description: f.description,
      requiresManual: f.requiresManual,
    })),
    addons: snapshot.addons.map((a) => {
      const addon: PresentedCatalog["addons"][number] = {
        key: a.key,
        name: a.name,
        description: a.description,
        leadDaysExtra: a.leadDaysExtra,
      };
      if (canSeePrices) {
        addon.priceKurus = a.priceKurus;
        addon.priceType = a.priceType;
      }
      return addon;
    }),
    leadTiers: snapshot.settings.leadTiers.map((t) => ({ key: t.key, name: t.name })),
    maxPartsPerQuote: snapshot.settings.maxPartsPerQuote,
    maxFileBytes: snapshot.settings.maxFileBytes,
  };
}

export interface PresentQuoteInput {
  quote: Quote;
  /** Silinmemiş parçalar, `sort_order` sırasıyla. */
  parts: QuotePart[];
  snapshot: PricingSnapshot;
  computed: ComputedQuote;
  viewer: QuoteViewer;
  /** Bekleyen ödeme taslağının referansı; yoksa null. */
  liveDraftReference: string | null;
  orderNumber: string | null;
  catalogChanged: boolean;
  now: Date;
  /** Depolama anahtarını imzalı URL'ye çevirir (`getPublicUrl`). */
  sign: (key: string) => string;
  /** Paylaşım bağlantısının kökü: `<app>/teklif/T-000123`. */
  shareBaseUrl: string;
}

export function presentQuote(input: PresentQuoteInput): PresentedQuote {
  const { quote, parts, snapshot, computed, viewer, now } = input;
  const canSeePrices = viewer.canSeePrices;
  const expired = quote.status === "expired" || now.getTime() > quote.expiresAt.getTime();
  const permissions = quotePermissions(
    { status: quote.status, expiresAt: quote.expiresAt, orderId: quote.orderId },
    { hasLiveDraft: input.liveDraftReference !== null, now }
  );

  const computedById = new Map(computed.parts.map((p) => [p.id, p]));
  const maxBuild = largestBuild(snapshot);

  const presentedParts: PresentedPart[] = parts.map((part, index) => {
    const c = computedById.get(part.id) ?? null;
    const scaled = c?.dfm.scaled ?? null;
    const warningKey = c?.dfm.warningKey ?? null;
    const issues = c?.dfm.issues ?? [];
    const analysisPending = issues.some((i) => i.code === "analysis_pending");

    const presented: PresentedPart = {
      id: part.id,
      position: index,
      name: part.name,
      fileName: part.fileName,
      sourceFormat: part.sourceFormat,
      analysisStatus: part.analysisStatus,
      analysisError: part.analysisError,
      thumbnailUrl: part.thumbnailKey ? input.sign(part.thumbnailKey) : null,
      // Paylaşım görünümünde imzalı 3B dosya YOKTUR: imzalı URL saatlerce
      // geçerli bir taşıyıcı bilettir, bağlantıyı alan herkes modeli indirirdi.
      previewGlbUrl:
        viewer.isShare || !part.previewGlbKey ? null : input.sign(part.previewGlbKey),
      dimensionsMm: scaled?.extentsMm ?? null,
      volumeCm3: scaled?.volumeCm3 ?? null,
      areaCm2: scaled?.areaCm2 ?? null,
      bodyCount: part.geometry?.bodyCount ?? null,
      suggestedUnits: part.geometry ? suggestUnits(part.geometry, maxBuild) : null,
      config: {
        technologyKey: part.technologyKey,
        materialKey: part.materialKey,
        colorKey: part.colorKey,
        finishKey: part.finishKey,
        layerUm: part.layerUm,
        infillPct: part.infillPct,
        quantity: part.quantity,
        units: part.units,
        scale: part.scale,
        criticalTolerance: part.criticalTolerance,
      },
      note: part.note,
      drawingName: part.drawingName,
      dfm: canSeePrices ? issues : issues.map(publicIssue),
      dfmWarningKey: warningKey,
      dfmAcknowledged: warningKey !== null && part.dfmAckKey === warningKey,
      // "Analizi sürüyor" GEÇİCİDİR; manuel fiyat beklemek değildir.
      needsManualPrice: (c?.dfm.blocking ?? false) && !analysisPending,
      leadDays: c?.price.ok ? c.price.leadDays : null,
    };

    if (canSeePrices) {
      presented.targetUnitPriceKurus = part.targetUnitPriceKurus;
      presented.price = c?.price.ok
        ? {
            unitKurus: c.price.unitKurus,
            lineKurus: c.price.lineKurus,
            source: c.price.source,
            priceBreaks: c.price.priceBreaks,
          }
        : null;
    }
    return presented;
  });

  const leadOptions: LeadOption[] = computed.leadOptions.map((option) =>
    canSeePrices
      ? option
      : { key: option.key, name: option.name, leadDays: option.leadDays }
  );

  const blockers = checkoutBlockers(computed, toPricingInputs(parts), {
    termsAccepted: quote.termsAcceptedAt !== null,
    expired,
  });
  // Politika engeli (sipariş olmuş / iptal / incelemede) ödemeyi kapatıyorsa
  // müşteri SEBEBİNİ de görmeli. Bekleyen ödemede `canCheckout` açıktır —
  // "Ödemeye devam et" düğmesi aynı taslağa gider — ve engel yazılmaz.
  if (!permissions.canCheckout && permissions.blockedReason) {
    if (!blockers.includes(permissions.blockedReason)) blockers.push(permissions.blockedReason);
  }

  const leadDays = computed.totals.leadDays;
  const shipByDate =
    leadDays === null
      ? null
      : istanbulDateKey(
          addBusinessDays(
            now,
            leadDays,
            snapshot.settings.holidays,
            snapshot.settings.cutoffHour
          )
        );

  const view: PresentedQuote = {
    id: quote.id,
    number: quote.number,
    status: quote.status,
    reviewKind: quote.reviewKind,
    reviewNote: quote.reviewNote,
    title: quote.title,
    leadTier: quote.leadTier,
    addonKeys: quote.addonKeys,
    // Paylaşım bağlantısını alan kişi müşterinin kendi notunu ve satın alma
    // emri numarasını görmemeli: ikisi de yalnız iki taraf arasındadır.
    customerNote: viewer.isShare ? null : quote.customerNote,
    poNumber: viewer.isShare ? null : quote.poNumber,
    version: quote.version,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
    expired,
    catalogChangedSinceSnapshot: input.catalogChanged,
    termsAccepted: quote.termsAcceptedAt !== null,
    locked: !permissions.canEdit,
    liveDraftReference: input.liveDraftReference,
    orderNumber: input.orderNumber,
    viewer,
    catalog: presentCatalog(snapshot, canSeePrices),
    parts: presentedParts,
    partCount: parts.length,
    unitCount: parts.reduce((sum, p) => sum + p.quantity, 0),
    quoteIssues: canSeePrices ? computed.quoteIssues : computed.quoteIssues.map(publicIssue),
    leadOptions,
    shipByDate,
    readiness: {
      canCheckout: permissions.canCheckout && blockers.length === 0,
      blockers,
    },
  };

  // Fatura bilgisi ve paylaşım bağlantısı YALNIZ sahibe: biri müşterinin vergi
  // kimliği, diğeri "bu teklifi herkese açabilirim" yetkisidir.
  if (viewer.isOwner) {
    view.invoice = {
      type: quote.invoiceType,
      companyName: quote.companyName,
      taxId: quote.taxId,
      taxIdType: quote.taxIdType,
      taxOffice: quote.taxOffice,
    };
    view.shareUrl = quote.shareToken
      ? `${input.shareBaseUrl}?t=${quote.shareToken}`
      : null;
  }
  if (canSeePrices) view.totals = computed.totals;

  return view;
}
