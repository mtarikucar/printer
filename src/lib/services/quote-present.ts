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
import { checkoutBlockers, quotePermissions } from "@/lib/config/quote-policy";
import { canSeeOwnerFields } from "@/lib/config/quote-team";
import { DISPLAY_CURRENCIES, QUOTE_SOURCE_FORMATS } from "@/lib/config/quote-types";
import type {
  ComputedQuote,
  DfmIssue,
  LeadOption,
  PresentedCatalog,
  PresentedPart,
  PresentedQuote,
  PricingPartInput,
  PricingSnapshot,
  QuoteAccessTeam,
  QuoteSourceFormat,
  QuoteViewer,
  Vec3,
} from "@/lib/config/quote-types";
import { suggestUnits } from "@/lib/config/quote-units";
import type { Quote, QuotePart } from "@/lib/db/schema";
import { toPricingPartInput } from "@/lib/services/quote-cache";

/**
 * DB satırlarını fiyat çekirdeğinin girdisine çevirir.
 *
 * Manuel fiyatın aralık doğrulaması ORTAK ÇEVİRİCİDEDİR
 * (`toPricingPartInput`, `quote-cache.ts`): teklif önbelleği o işlevi doğrudan
 * çağırır ve buradan geçmez, yani kapının burada durması önbellekteki toplamı
 * ödemede tahsil edilenden ayırırdı. Burada yalnız eşleme kalır.
 */
export function toPricingInputs(parts: QuotePart[]): PricingPartInput[] {
  return parts.map(toPricingPartInput);
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
export function presentPublicCatalog(
  snapshot: PricingSnapshot,
  stepEnabled: boolean
): PresentedCatalog {
  return presentCatalog(snapshot, false, stepEnabled);
}

/**
 * Müşteriye SEÇTİRİLECEK biçimler — bayrak → liste kuralının TEK yeri.
 *
 * Liste `QUOTE_SOURCE_FORMATS`ten türer, elle yazılmaz: beşinci bir biçim
 * geldiğinde kopyalanmış bir liste sessizce eksik kalırdı. Hem teklif
 * kataloğu (`PresentedCatalog.acceptedFormats`) hem açılış sayfasının
 * yükleyicisi buradan besleniyor — ikisi ayrışırsa açılış sayfası müşteriye
 * `.step` seçtirip uç 400 verirdi.
 *
 * Bir KOLAYLIK üretir, güvenlik sınırı değil: kural sunucuda, parçayı yazan
 * tek yerde durur (`addPartFromUpload`).
 */
export function quoteAcceptedFormats(stepEnabled: boolean): QuoteSourceFormat[] {
  return stepEnabled
    ? [...QUOTE_SOURCE_FORMATS]
    : QUOTE_SOURCE_FORMATS.filter((format) => format !== "step");
}

/**
 * `stepEnabled` BİR PARAMETREDİR, burada okunmaz.
 *
 * `isFlagEnabled` async'tir ve DB'ye gider; bu dosya ise SAF ve SENKRON —
 * sayfanın RSC props'u, uç, e-posta ve belge aynı işlevden geçer. Bayrağı
 * içeride okumak sunum katmanına bir veritabanı sokmak ve her serileştirmeye
 * bir okuma eklemek olurdu. Bayrağı çağıran okur (`stepUploadsEnabled`,
 * `quote-access.ts`) — o TEK okuma noktası hem bu listeyi hem sunucu kapısını
 * besler, yani dropzone'un seçtirdiği biçim ile ucun kabul ettiği biçim
 * ayrışamaz.
 */
function presentCatalog(
  snapshot: PricingSnapshot,
  canSeePrices: boolean,
  stepEnabled: boolean
): PresentedCatalog {
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
    acceptedFormats: quoteAcceptedFormats(stepEnabled),
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
  /**
   * `quote_step_enabled` bu izleyici için açık mı (`stepUploadsEnabled`).
   * Yalnız `catalog.acceptedFormats`i belirler; parçanın kendisi bayraktan
   * BAĞIMSIZ gösterilir — bayrak kapandığında YÜKLENMİŞ STEP parçaları
   * çalışmaya devam eder (tasarım §5 geri dönüş planı).
   */
  stepEnabled: boolean;
  /**
   * `quote_fx_display_enabled` açık mı — döviz GÖSTERİMİ bayrağı.
   *
   * ZORUNLU bir alan, `optional` DEĞİL. Sebebi `stepEnabled` ile aynı: bu
   * dosya SAF ve SENKRONDUR, `isFlagEnabled` ise async'tir ve DB'ye gider;
   * bayrağı içeride okumak sunum katmanına bir veritabanı sokmak olurdu.
   * Zorunluluk ise bilinçli: `presentQuote`un üç çağrı yeri var ve her birinin
   * niyetini BEYAN etmesi bedava. `optional` bırakmak, testlerin sessizce eski
   * davranışta kalması demekti.
   */
  fxDisplayEnabled: boolean;
  /**
   * Bu teklif bir çerçeve anlaşmanın serbest bırakılmış PARTİSİ mi
   * (`quoteIsFrameworkBatch`, `quote-service.ts`).
   *
   * ZORUNLU bir alan, `optional` DEĞİL — gerekçe `fxDisplayEnabled` ile aynı
   * (bu dosya SAF ve SENKRONDUR, sorguyu kendisi yapamaz) ve bedeli daha
   * ağır: opsiyonel bir alan, ekranın parti klonunu DÜZENLENEBİLİR göstermesi
   * demekti. Müşteri düzenlerse `demoteQuotedToDraft` koşar ve anlaşmanın
   * kilitli fiyatı canlı katalog fiyatına döner (tasarım R1).
   */
  isFrameworkBatch: boolean;
  /**
   * Bu teklif, KAPANMAMIŞ bir çerçeve anlaşmanın KAYNAK teklifi mi
   * (`quoteHasLiveFramework`, `quote-service.ts`).
   *
   * ZORUNLU, gerekçe `isFrameworkBatch` ile aynı: opsiyonel bırakmak, ekranın
   * anlaşmanın TANIMINI düzenlenebilir göstermesi demekti. Müşteri düzenlerse
   * sonraki parti BAŞKA bir ürünü kilitli fiyattan üretir
   * (`QUOTE_FRAMEWORK_SOURCE_REASON`).
   */
  hasLiveFramework: boolean;
  /**
   * Teklifin takımı (0072); `null` = kişisel teklif ya da bayrak kapalı.
   *
   * ZORUNLU bir alan, `optional` DEĞİL — gerekçe `fxDisplayEnabled` ile aynı:
   * bu dosya SAF ve SENKRONDUR, üyelik satırını kendisi okuyamaz. Okuyan yer
   * erişim kabuğu (`resolveQuoteTeam` → `QuoteAccess.team`) ve `optional`
   * bırakmak, testlerin sessizce eski davranışta kalması demekti.
   */
  team: QuoteAccessTeam | null;
}

export function presentQuote(input: PresentQuoteInput): PresentedQuote {
  const { quote, parts, snapshot, computed, viewer, now } = input;
  const canSeePrices = viewer.canSeePrices;
  const expired = quote.status === "expired" || now.getTime() > quote.expiresAt.getTime();
  const permissions = quotePermissions(
    { status: quote.status, expiresAt: quote.expiresAt, orderId: quote.orderId },
    {
      hasLiveDraft: input.liveDraftReference !== null,
      now,
      isFrameworkBatch: input.isFrameworkBatch,
      hasLiveFramework: input.hasLiveFramework,
    }
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
      // Sapmanın TEK türetme yeri: çalışma alanı da teklif belgesi de bu alanı
      // okur (belge `parts_snapshot`a bakmaz). Ölçüm parametreleri geometriyle
      // birlikte donduğu için eski parçalar eski sapmalarıyla okunmaya devam
      // eder — `STEP_TESSELLATION_VERSION` artsa bile.
      tessellationMm: part.geometry?.tessellation?.deflectionMm ?? null,
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
    // `quoted` TEK YERDE yazılır: `finishPricing`, `allPriced` kapısının
    // arkasında (`quote-admin.ts`). Fiyatı etkileyen her müşteri düzenlemesi
    // `demoteQuotedToDraft` ile taslağa geri düşürür, yani muafiyet otomatik
    // fiyatlamaya sızamaz. `reviewedAt` bunu yapamazdı: hem `repriceQuote` hem
    // de iki ret yolu `reviewedAt`i bırakıp durumu `draft`a çeviriyor.
    adminPriced: quote.status === "quoted",
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
    // İkisi de KAMUYA AÇIK, oturumsuz sayfaların anahtarıdır: `/pay/<ref>`
    // ödeme sayfası tam tutarı ve kartla öde düğmesini, `/track/<no>` sipariş
    // takibini hiçbir oturum kontrolü olmadan gösterir. Paylaşım bağlantısını
    // alan kişiye bunları vermek hem sahipliği hem fiyat kapısını dolanmak
    // olurdu — bu yüzden `invoice`/`shareUrl` ile aynı kapıdan geçerler.
    // `locked` alanı zaten bekleyen ödemeyi (referans vermeden) anlatıyor.
    //
    // Kapı `canSeeOwnerFields` (`src/lib/config/quote-team.ts`) ve T-4 o
    // yüklemin takım dalını AÇTI: takım üyesi de bekleyen ödemenin referansını
    // ve siparişin numarasını görür (meslektaşının başlattığı ödemeyi
    // bilmeden ne ödeyebilir ne düzenleyebilir). Bu dosya o gün ikinci kez
    // AÇILMADI — kapının tek yerde adlandırılmış olması tam bunun içindi.
    liveDraftReference: canSeeOwnerFields(viewer) ? input.liveDraftReference : null,
    orderNumber: canSeeOwnerFields(viewer) ? input.orderNumber : null,
    viewer,
    catalog: presentCatalog(snapshot, canSeePrices, input.stepEnabled),
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
  // kimliği, diğeri "bu teklifi herkese açabilirim" yetkisidir. Kurumsal fatura
  // bilgisi (firma adı / VKN) ise TAKIMIN bilgisidir ve üyesinden saklanmasının
  // bir anlamı yok — kapı o yüzden `canSeeOwnerFields` adını taşıyor ve T-4'te
  // takım dalı AÇILDI (tasarım §4: "fatura bilgisi TAKIMIN bilgisidir").
  // Paylaşım izleyicisi iki alanın HİÇBİRİNİ almaya devam ediyor.
  if (canSeeOwnerFields(viewer)) {
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

  // Takım: ADI ve ödeme anahtarı, teklifi takım üzerinden GÖREN üyeye ve kişisel
  // sahibine gider. Paylaşım izleyicisine GİTMEZ — hangi firmanın teklifi olduğu
  // bağlantıyı eline geçiren herkesin bilgisi değil. `id` gövdeye GİRMEZ:
  // kimlik erişim kabuğunun (`QuoteAccessTeam`) işi.
  //
  // Anahtar, teklif gerçekten bir takıma bağlı DEĞİLSE hiç eklenmez — `null`
  // bile değil (dosyanın açılış kuralı). Kapı `canSeeOwnerFields`: T-2'de bu
  // ifade elle yazılıydı (`isTeam || isOwner`), T-4 yüklemin takım dalını
  // açınca ikisi AYNI şey oldu ve kopya düştü — matrisin ikinci bir kopyası
  // tam olarak ayrışan şeydir.
  if (input.team !== null && canSeeOwnerFields(viewer)) {
    view.team = {
      name: input.team.name,
      role: input.team.role,
      memberCanCheckout: input.team.memberCanCheckout,
    };
  }

  // Döviz GÖSTERİMİ: kur bir FİYATTIR ve fiyat kapısının ARKASINDA durur
  // (tasarım R7). Üç kapı birden aranır ve biri kapalıysa `display` anahtarı
  // HİÇ EKLENMEZ — `undefined` bile değil, `null` bile değil, anahtarın
  // kendisi yoktur (dosyanın açılış KURALI: `undefined` atamak `JSON.stringify`
  // için yetse de RSC props'unda ve `Object.keys`te görünür).
  //
  // `quote.fxSnapshot === null` BOZULMUŞ YOL DEĞİL, normal bir hâldir: kur
  // hiç çekilememiş ya da BAYAT olabilir (`loadActiveFxSnapshot` o hâlde
  // `null` döner). Sayfa o zaman düşmez, yalnız ₺ gösterir.
  //
  // `currencies` donmuş snapshot'ın KENDİ satırlarından türer, `FX_CURRENCIES`
  // sabitinden değil: katalog yarın büyürse eski bir snapshot yeni birimi
  // taşımaz ve seçici müşteriye çevrilemeyen bir birim seçtirmemeli. Baştaki
  // eleman daima bağlayıcı olandır.
  if (canSeePrices && input.fxDisplayEnabled && quote.fxSnapshot) {
    view.display = {
      snapshot: quote.fxSnapshot,
      currencies: [
        DISPLAY_CURRENCIES[0],
        ...quote.fxSnapshot.rates.map((r) => r.currency),
      ],
    };
  }

  return view;
}
