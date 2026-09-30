/**
 * Anlık teklif motorunun MÜŞTERİ YÜZEYİ testleri.
 *
 * Buradaki sınav "bir şey render oluyor mu" değil, ekranın müşteriye DOĞRU
 * ŞEYİ söyleyip söylemediğidir: sözlük her DfM kodunu Türkçe bir cümleye
 * çeviriyor mu, başarısız analiz ile manuel fiyat bekleyen parça birbirinden
 * ayrılıyor mu, fiyat kapısı kapalıyken rakam sızıyor mu.
 *
 * Faz 3'ün sonraki görevleri (3.2 / 3.3) bu dosyayı GENİŞLETİR.
 *
 * Çalıştırma: npx tsx scripts/test-quote-ui.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LocaleProvider } from "../src/lib/i18n/locale-context";
import { PriceGateModal } from "../src/components/quote/price-gate-modal";
import { QuotePartCard } from "../src/components/quote/part-card";
import { QuoteBulkBar } from "../src/components/quote/bulk-bar";
import { dfmMessage } from "../src/components/quote/dfm-list";
import { acceptedAccept, validateQuoteFiles } from "../src/components/quote/dropzone";
import { QuoteBanners } from "../src/components/quote/quote-banners";
import { QuoteChatPanel } from "../src/components/quote/quote-chat-panel";
import {
  QuoteSummary,
  displayedTotalKurus,
  readKdvExcludedPref,
  writeKdvExcludedPref,
} from "../src/components/quote/quote-summary";
import { QuoteReviewDialog, parseMoneyInput } from "../src/components/quote/review-request-dialog";
import {
  commitField,
  editField,
  syncFromServer,
  syncedFieldState,
  syncedFieldValue,
} from "../src/components/quote/synced-field";
import { QuoteShareDialog } from "../src/components/quote/share-dialog";
import {
  QuoteCheckoutForm,
  checkoutNavigation,
  isGiftCardRefusal,
  type QuoteCheckoutFormProps,
} from "../src/components/quote/quote-checkout-form";
import {
  QuoteCheckoutClient,
  QuoteCheckoutReceipt,
  type QuoteCheckoutClientProps,
} from "../src/app/teklif/[number]/odeme/checkout-client";
import { QuotePendingPaymentClient } from "../src/app/teklif/[number]/odeme/pending-payment-client";
import { QuoteDocument } from "../src/app/teklif/[number]/belge/quote-document";
import { QuoteDocumentPrintButton } from "../src/app/teklif/[number]/belge/print-button";
import {
  QuoteWorkspaceClient,
  createResponseOrder,
  groupPartsByTechnology,
  isOwnershipConflict,
} from "../src/app/teklif/[number]/workspace-client";
import { QuoteApiError } from "../src/lib/quote/client-api";
import {
  ComingSoonNote,
  MaterialLibrary,
  PrintServiceLanding,
  landingFaq,
} from "../src/app/3d-baski/sections";
import {
  anchorSentence,
  catalogAnchorKurus,
  formatAnchorPrice,
  materialAnchorKurus,
  minOrderSentence,
  technologyAnchorKurus,
} from "../src/app/3d-baski/pricing-anchors";
import { QuoteListTable } from "../src/app/account/teklifler/quotes-client";
import { PartLibraryGrid } from "../src/app/account/parcalar/parts-client";
import { fill } from "../src/components/quote/format";
import { formatCurrency } from "../src/lib/i18n/format";
import type { TenderViews } from "../src/lib/config/quote-tender";
import type {
  PendingQuoteCheckout,
  QuoteGiftCardPreview,
} from "../src/lib/services/quote-checkout";
import en from "../src/lib/i18n/dictionaries/en";
import tr from "../src/lib/i18n/dictionaries/tr";
import { SEED_SNAPSHOT } from "../src/lib/config/quote-seed";
import { STEP_MAX_BYTES, STEP_TESSELLATION } from "../src/lib/config/quote-step";
import {
  DFM_CODES,
  QUOTE_SOURCE_FORMATS,
  QUOTE_STATUSES,
  type CustomerQuoteListItem,
  type LibraryPart,
  type PresentedCatalog,
  type PresentedPart,
  type PresentedQuote,
  type PricingSnapshot,
  type QuoteTotals,
  type QuoteViewer,
} from "../src/lib/config/quote-types";
import {
  buildTrackedHref,
  buildTrackedUrl,
  hasUntrackedParams,
  track,
} from "../src/lib/analytics/client";
import { hasGTM } from "../src/lib/analytics/config";
import { EVENTS, isEventName } from "../src/lib/analytics/events";
import { serializeJsonLd } from "../src/lib/seo/jsonld";
import { isNoindexPath } from "../src/lib/seo/policy";
import { buildPrintServiceJsonLd } from "../src/lib/seo/service";
import robots from "../src/app/robots";

const PREFIX = "instantQuote.";
const trKeys = Object.keys(tr).filter((k) => k.startsWith(PREFIX));
const enKeys = Object.keys(en).filter((k) => k.startsWith(PREFIX));

// ─── Sözlük bloğu ───────────────────────────────────────────────────────────

test("instantQuote bloğu iki sözlükte de aynı anahtarları taşır", () => {
  assert.ok(trKeys.length > 100, `instantQuote bloğu çok küçük: ${trKeys.length}`);
  assert.deepEqual(new Set(trKeys), new Set(enKeys));
  for (const key of trKeys) {
    assert.ok(
      (tr as Record<string, string>)[key].trim().length > 0,
      `${key} Türkçe karşılığı boş`
    );
  }
});

test("instantQuote bloğu tek parça hâlinde ve dosyanın ORTASINDA duruyor", () => {
  // Blok bölünürse sonraki görevler (3.2 / 3.3) anahtarı nereye ekleyeceğini
  // bilemez; dosyanın SONUNA taşınırsa diğer oturumun eklemeleriyle çakışır.
  for (const name of ["tr.ts", "en.ts"]) {
    const lines = fs
      .readFileSync(path.resolve("src/lib/i18n/dictionaries", name), "utf8")
      .split("\n");
    const hits = lines.flatMap((line, i) => (line.includes(`"${PREFIX}`) ? [i] : []));
    assert.ok(hits.length > 100, `${name}: instantQuote anahtarı bulunamadı`);
    const [first, last] = [hits[0], hits[hits.length - 1]];
    for (let i = first; i <= last; i++) {
      const line = lines[i].trim();
      const inBlock =
        line.startsWith(`"${PREFIX}`) || line.startsWith("//") || line === "" ||
        // çok satırlı bir değerin devamı (anahtar bir üst satırda)
        line.startsWith('"') || line.startsWith("'");
      assert.ok(inBlock, `${name}:${i + 1} blok yabancı bir satırla bölünmüş: ${line}`);
    }
    assert.ok(last < lines.length - 40, `${name}: blok dosyanın sonuna yapışmış`);
    assert.ok(first > 40, `${name}: blok dosyanın başına yapışmış`);
  }
});

// ─── DfM mesajları ──────────────────────────────────────────────────────────

test("her DfM kodunun Türkçe bir cümlesi var", () => {
  for (const code of DFM_CODES) {
    const key = `${PREFIX}dfm.${code}`;
    assert.ok(trKeys.includes(key), `${key} eksik`);
  }
});

test("okunamayan dosya, manuel fiyat bekleyen parçadan AYRI anlatılır", () => {
  const t = tr as Record<string, string>;
  // Taşıma notu (c): analizi ÇÖKEN parçanın çözümü yeniden yüklemek, elle
  // fiyatlanacak parçanınki beklemek. Aynı cümle ikisini birden anlatamaz.
  assert.equal(t[`${PREFIX}dfm.analysis_failed`], "Dosya okunamadı — lütfen yeniden yükleyin.");
  assert.doesNotMatch(t[`${PREFIX}dfm.analysis_failed`], /manuel|elle/i);
  assert.match(t[`${PREFIX}part.badge.manualPrice`], /manuel/i);
  assert.notEqual(t[`${PREFIX}dfm.analysis_failed`], t[`${PREFIX}part.badge.manualPrice`]);
});

test("katalogdan düşen malzeme müşteriyi malzeme seçimine yönlendirir", () => {
  // 2.4a: yeniden fiyatlama sonrası malzemesi kalkan parçada uç, geçerli bir
  // malzeme seçilmeden HİÇBİR alanı güncellemiyor. Ekran bunu söylemezse
  // müşteri adet kutusunu döndürüp durur.
  const t = tr as Record<string, string>;
  assert.equal(t[`${PREFIX}part.config.materialPlaceholder`], "Malzeme seçin");
  assert.match(t[`${PREFIX}dfm.config_invalid`], /malzeme/i);
});

test("parametreli DfM cümleleri yer tutucularını kaybetmemiş", () => {
  const t = tr as Record<string, string>;
  const expected: Record<string, string[]> = {
    "dfm.too_large": ["{maxX}", "{maxY}", "{maxZ}"],
    "dfm.too_large.fitScale": ["{scale}"],
    "dfm.too_large.fitsTechnology": ["{technology}"],
    "dfm.too_small": ["{largestMm}", "{minMm}"],
    "dfm.thin_walls": ["{wallMm}", "{minMm}"],
    "dfm.multiple_bodies": ["{count}"],
    "dfm.qty_over_auto": ["{quantity}", "{maxQuantity}"],
    "dfm.qty_over_auto.total": ["{maxTotal}"],
  };
  for (const [suffix, params] of Object.entries(expected)) {
    const value = t[PREFIX + suffix];
    assert.ok(value, `${PREFIX}${suffix} eksik`);
    for (const p of params) {
      assert.ok(value.includes(p), `${PREFIX}${suffix} içinde ${p} yok`);
    }
  }
});

test("STEP cümleleri İKİ sözlükte de var ve yer tutucuları ayrışmamış", () => {
  // `en.ts` `Dictionary` tipinin kaynağı, yani eksik anahtar `tsc`yi kırar —
  // ama YER TUTUCU ayrışması kırmaz: bir dilde `{mm}` cümlede olduğu gibi
  // kalır. Nöbetçi bu yüzden değerleri de karşılaştırır.
  const stepKeys: Record<string, string[]> = {
    "upload.stepTooLarge": ["{file}", "{maxMb}"],
    "part.stepUnitsLocked": [],
    "part.stepTessellation": ["{mm}"],
    "document.stepTessellation": ["{mm}"],
  };
  for (const [suffix, params] of Object.entries(stepKeys)) {
    const key = PREFIX + suffix;
    for (const [name, dict] of [
      ["tr", tr as Record<string, string>],
      ["en", en as Record<string, string>],
    ] as const) {
      const value = dict[key];
      assert.ok(value, `${key} ${name}.ts içinde yok`);
      for (const p of params) {
        assert.ok(value.includes(p), `${key} (${name}) içinde ${p} yok`);
      }
    }
  }
  const placeholders = (value: string) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
  for (const key of trKeys) {
    assert.deepEqual(
      placeholders((tr as Record<string, string>)[key]),
      placeholders((en as Record<string, string>)[key]),
      `${key}: yer tutucular iki sözlükte ayrışmış`
    );
  }
});

test("STEP için yeni müşteri hata KODU açılmadı", () => {
  // Tasarım §6 kararı: `step_too_complex` / `step_unreadable` müşteriye
  // bugünkü `analysis_failed` cümlesiyle gider. DfM kod kümesini büyütmek
  // sahadaki her uyarı onayını (`dfmWarningKey`) ve admin süzgeçlerini
  // etkilerdi; ayrım müşteriye GİTMEYEN metinde (admin) yapılır.
  assert.deepEqual(
    DFM_CODES.filter((code) => code.startsWith("step")),
    []
  );
  assert.ok(trKeys.includes(`${PREFIX}dfm.analysis_failed`));
});

test("her teklif durumunun bir rozeti var ve fiyat kapısı yer tutucusu rakamsız", () => {
  for (const status of QUOTE_STATUSES) {
    assert.ok(trKeys.includes(`${PREFIX}status.${status}`), `status.${status} eksik`);
  }
  const hidden = (tr as Record<string, string>)[`${PREFIX}price.hidden`];
  assert.equal(hidden, "–₺–,––");
  assert.doesNotMatch(hidden, /\d/);
});

// ─── Analitik ───────────────────────────────────────────────────────────────

test("teklif hunisinin olayları kataloğa kayıtlı", () => {
  // /api/analytics/collect tanımadığı adı SESSİZCE düşürür; kayıtlı olmayan
  // olay hiç ölçülmez.
  for (const name of ["quote_upload", "sign_up", "generate_lead"] as const) {
    assert.ok(isEventName(name), `${name} EventName değil`);
    assert.ok(EVENTS[name], `${name} EVENTS içinde yok`);
  }
  assert.equal(EVENTS.quote_upload.client.ga4, "quote_upload");
  assert.equal(EVENTS.quote_upload.server.ga4, null);
  assert.equal(EVENTS.sign_up.client.ga4, "sign_up");
  assert.equal(EVENTS.sign_up.client.meta, "CompleteRegistration");
  // generate_lead'in doğrusu SUNUCUDA: manuel teklif / hedef fiyat isteği uç
  // tarafında kaydedilir, tarayıcı yenilemesi şişiremez.
  assert.equal(EVENTS.generate_lead.server.ga4, "generate_lead");
  assert.equal(EVENTS.generate_lead.client.ga4, null);
});

// ─── SEO ────────────────────────────────────────────────────────────────────

test("çalışma alanı noindex, açılış sayfası indexlenebilir", () => {
  assert.ok(isNoindexPath("/teklif"));
  assert.ok(isNoindexPath("/teklif/T-000001"));
  assert.ok(isNoindexPath("/teklif/T-000001/belge"));
  assert.ok(!isNoindexPath("/3d-baski"));
  assert.ok(!isNoindexPath("/3d-baski/malzemeler"));
});

// ─── Fiyat kapısı modalı ────────────────────────────────────────────────────

const noop = () => {};
const router = {
  back: noop, forward: noop, push: noop, replace: noop,
  refresh: noop, prefetch: noop, hmrRefresh: noop,
};

// `LocaleProvider` çocuklarını ZORUNLU bir prop olarak yazar; createElement'in
// üçüncü argümanı çalışma zamanında aynı şeyi yapar ama imza bunu bilmez.
const Locale = LocaleProvider as unknown as FunctionComponent<{ locale: "tr" }>;

function renderModal(
  props: Partial<Parameters<typeof PriceGateModal>[0]> = {}
): string {
  const full = {
    open: true,
    onClose: noop,
    onAuthenticated: noop,
    redirectPath: "/teklif/T-000001",
    ...props,
  };
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(Locale, { locale: "tr" }, createElement(PriceGateModal, full))
    )
  );
}

test("kapalı modal hiçbir şey çizmez", () => {
  assert.equal(renderModal({ open: false }), "");
});

test("modal neden açıldığını söyler ve iki yolu birden sunar", () => {
  const html = renderModal();
  assert.match(html, /Teklifinizi görmek için/);
  assert.match(html, /Kayıt ol/);
  assert.match(html, /Giriş yap/);
  // Kaydolmanın bedeli görünür olmalı: ad, e-posta, telefon, şifre.
  for (const label of ["Ad soyad", "E-posta", "Telefon", "Şifre"]) {
    assert.ok(html.includes(label), `${label} alanı yok`);
  }
  // İzin ve aydınlatma bağlantıları (İYS + KVKK) formun içinde.
  assert.match(html, /href="\/ticari-ileti"/);
  assert.match(html, /href="\/privacy"/);
  // Ticari ileti onayı VARSAYILAN OLARAK KAPALI olmalı.
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
});

test("Google düğmesi kullanıcıyı teklifin kendisine geri getirir", () => {
  assert.match(
    renderModal(),
    /href="\/api\/auth\/google\?redirect=%2Fteklif%2FT-000001"/
  );
});

test("giriş sekmesiyle açılan modal kayıt alanlarını göstermez", () => {
  const html = renderModal({ initialTab: "login" });
  assert.match(html, /Teklifinizi görmek için giriş yapın/);
  assert.ok(!html.includes("Ad soyad"), "giriş sekmesinde ad alanı var");
  assert.match(html, /href="\/forgot-password"/);
});

test("modal fiyat göstermez — kapının arkasında rakam sızmaz", () => {
  assert.doesNotMatch(renderModal(), /₺\s?\d/);
});

test("robots teklif çalışma alanını kapatır, açılış sayfasına dokunmaz", () => {
  const rules = robots().rules;
  const list = Array.isArray(rules) ? rules : [rules];
  const all = list.find((r) => r.userAgent === "*");
  assert.ok(all, "* kuralı yok");
  const disallow = Array.isArray(all.disallow) ? all.disallow : [all.disallow ?? ""];
  assert.ok(disallow.includes("/teklif/"), "/teklif/ engellenmemiş");
  for (const path of disallow) {
    assert.ok(!"/3d-baski".startsWith(path), `açılış sayfası ${path} ile engellenmiş`);
  }
});

// ─── Çalışma alanı: /teklif/[number] (Görev 3.2a) ───────────────────────────

const catalogFixture: PresentedCatalog = {
  technologies: [
    {
      key: "fdm",
      name: "FDM",
      description: "Filament baskı",
      buildMm: { x: 250, y: 210, z: 210 },
      minWallMm: 1,
      toleranceText: "±%0,5 (en az ±0,5 mm)",
      layerOptionsUm: [100, 200, 300],
      defaultLayerUm: 200,
      infillOptionsPct: [15, 20, 30],
      defaultInfillPct: 20,
      baseLeadDays: 3,
    },
    {
      key: "sla",
      name: "SLA",
      description: "Reçine baskı",
      buildMm: { x: 145, y: 145, z: 175 },
      minWallMm: 0.8,
      toleranceText: "±%0,3",
      layerOptionsUm: [50, 100],
      defaultLayerUm: 50,
      infillOptionsPct: null,
      defaultInfillPct: null,
      baseLeadDays: 4,
    },
  ],
  materials: [
    {
      key: "pla",
      technologyKey: "fdm",
      name: "PLA",
      description: "Genel amaçlı",
      properties: { tensileMpa: 50 },
      colors: [
        { key: "black", name: "Siyah", hex: "#111111" },
        { key: "white", name: "Beyaz", hex: "#FFFFFF" },
      ],
    },
    {
      key: "std_resin",
      technologyKey: "sla",
      name: "Standart reçine",
      description: "İnce detay",
      properties: {},
      colors: [{ key: "grey", name: "Gri", hex: "#888888" }],
    },
  ],
  finishes: [
    {
      key: "raw",
      technologyKey: null,
      name: "Ham (destek alınmış)",
      description: "",
      requiresManual: false,
    },
    { key: "painted", technologyKey: null, name: "Boyalı", description: "", requiresManual: true },
  ],
  addons: [{ key: "cert", name: "Uygunluk sertifikası", description: "", leadDaysExtra: 1 }],
  leadTiers: [
    { key: "economy", name: "Ekonomik" },
    { key: "standard", name: "Standart" },
    { key: "express", name: "Ekspres" },
  ],
  maxPartsPerQuote: 20,
  maxFileBytes: 100 * 1024 * 1024,
  // Bayrak KAPALI hâl: arayüz fikstürü müşteriye `.step` seçtirmez. Dropzone'un
  // bu listeden `accept` üretmesi S5'in işi; burada yalnız sözleşme taşınır.
  acceptedFormats: ["stl", "obj", "3mf"],
};

function partFixture(over: Partial<PresentedPart> = {}): PresentedPart {
  return {
    id: "p1",
    position: 0,
    name: "Braket",
    fileName: "braket.stl",
    sourceFormat: "stl",
    analysisStatus: "ready",
    analysisError: null,
    thumbnailUrl: "/api/files/thumb.webp",
    previewGlbUrl: "/api/files/preview.glb",
    dimensionsMm: { x: 120, y: 80, z: 40 },
    volumeCm3: 42.5,
    areaCm2: 180,
    bodyCount: 1,
    suggestedUnits: null,
    // Mesh parçası: üçgenler dosyadan geldi, çevrilen bir B-rep yok.
    tessellationMm: null,
    config: {
      technologyKey: "fdm",
      materialKey: "pla",
      colorKey: "black",
      finishKey: "raw",
      layerUm: 200,
      infillPct: 20,
      quantity: 2,
      units: "mm",
      scale: 1,
      criticalTolerance: false,
    },
    note: null,
    drawingName: null,
    dfm: [],
    dfmWarningKey: null,
    dfmAcknowledged: false,
    needsManualPrice: false,
    leadDays: 5,
    ...over,
  };
}

const OWNER_NO_PRICES: QuoteViewer = {
  canSeePrices: false,
  canEdit: true,
  isOwner: true,
  isShare: false,
  isAdmin: false,
};

function quoteFixture(over: Partial<PresentedQuote> = {}): PresentedQuote {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    number: "T-000123",
    status: "draft",
    reviewKind: null,
    reviewNote: null,
    title: null,
    leadTier: "standard",
    addonKeys: [],
    customerNote: null,
    poNumber: null,
    version: 1,
    createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-09-20T09:00:00.000Z",
    expiresAt: "2026-10-20T09:00:00.000Z",
    expired: false,
    catalogChangedSinceSnapshot: false,
    termsAccepted: true,
    locked: false,
    liveDraftReference: null,
    orderNumber: null,
    viewer: OWNER_NO_PRICES,
    catalog: catalogFixture,
    parts: [partFixture()],
    partCount: 1,
    unitCount: 2,
    quoteIssues: [],
    leadOptions: [
      { key: "economy", name: "Ekonomik", leadDays: 8 },
      { key: "standard", name: "Standart", leadDays: 5 },
      { key: "express", name: "Ekspres", leadDays: 3 },
    ],
    shipByDate: "2026-09-27",
    readiness: { canCheckout: false, blockers: [] },
    ...over,
  };
}

function inLocale(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(Locale, { locale: "tr" }, node)
    )
  );
}

function renderWorkspace(quote: PresentedQuote, shareToken: string | null = null): string {
  return inLocale(createElement(QuoteWorkspaceClient, { initialQuote: quote, shareToken }));
}

function renderPartCard(part: PresentedPart, quote: PresentedQuote): string {
  return inLocale(
    createElement(QuotePartCard, {
      part,
      catalog: quote.catalog,
      viewer: quote.viewer,
      selected: false,
      onSelectChange: noop,
      onPatch: noop,
      onDuplicate: noop,
      onDelete: noop,
      onOpenViewer: noop,
      onEditConfig: noop,
      onRequestPrices: noop,
    })
  );
}

test("girişsiz çalışma alanı fiyat yerine yer tutucu basar", () => {
  const html = renderWorkspace(quoteFixture());
  assert.match(html, /–₺–,––/, "fiyat yer tutucusu yok");
  assert.doesNotMatch(html, /₺\s?\d/, "fiyat kapısının arkasından rakam sızdı");
  assert.match(html, /Fiyatı gör/);
});

test("giriş yapmış sahibe biçimlenmiş fiyat gösterilir", () => {
  const html = renderWorkspace(
    quoteFixture({
      viewer: { ...OWNER_NO_PRICES, canSeePrices: true },
      parts: [
        partFixture({
          price: {
            unitKurus: 7400,
            lineKurus: 14800,
            source: "auto",
            priceBreaks: [
              { quantity: 1, unitKurus: 8000 },
              { quantity: 5, unitKurus: 7000 },
            ],
          },
        }),
      ],
      totals: {
        allPriced: true,
        partsKurus: 14800,
        addonLines: [],
        addonsKurus: 0,
        minOrderTopUpKurus: 0,
        totalKurus: 14800,
        kdvExcludedKurus: 12333,
        kdvKurus: 2467,
        leadDays: 5,
      },
    })
  );
  assert.match(html, /74,00/, "birim fiyat biçimlenmemiş");
  assert.match(html, /148,00/, "satır toplamı yok");
  assert.doesNotMatch(html, /–₺–,––/, "fiyat görünürken yer tutucu basılmış");
});

test("paylaşım görünümü salt okunur ve bağlantıları token'ı taşır", () => {
  const html = renderWorkspace(
    quoteFixture({
      viewer: {
        canSeePrices: true,
        canEdit: false,
        isOwner: false,
        isShare: true,
        isAdmin: false,
      },
    }),
    "tok123"
  );
  // Belge bağlantısı token'sız verilirse paylaşım izleyicisi kendi açtığı
  // teklifin belgesinde 404 görür.
  assert.match(html, /href="\/teklif\/T-000123\/belge\?t=tok123"/);
  assert.ok(!html.includes("Teklife parça ekle"), "salt okunur görünümde yükleme alanı var");
  assert.ok(!html.includes("Hepsini seç"), "salt okunur görünümde toplu seçim var");
});

test("uyarısı olan parça kartı onay kutusu gösterir", () => {
  const part = partFixture({
    dfm: [{ code: "multiple_bodies", severity: "warning", params: { count: 3 } }],
    dfmWarningKey: "w-multiple_bodies",
    dfmAcknowledged: false,
  });
  const html = renderPartCard(part, quoteFixture({ parts: [part] }));
  assert.match(html, /Uyarıları okudum/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /3 ayrı gövdeden/, "DfM parametresi cümleye girmemiş");
});

test("analizi çöken parça yeniden yüklemeye yönlendirir, manuel fiyat demez", () => {
  // Taşıma notu (c): çöken analiz ile manuel fiyat bekleyen parça AYRI hâllerdir;
  // birinin çözümü dosyayı yeniden yüklemek, diğerininki beklemek.
  const part = partFixture({
    analysisStatus: "failed",
    analysisError: "mesh okunamadı",
    dimensionsMm: null,
    volumeCm3: null,
    dfm: [{ code: "analysis_failed", severity: "error" }],
    needsManualPrice: true,
  });
  // Fiyatı GÖREBİLEN izleyici: "manuel fiyat bekliyor" rozetinin çıkabileceği
  // tek hâl bu; kapı kapalıyken rozet zaten hiç çizilmiyor ve test bir şey
  // kanıtlamazdı.
  const html = renderPartCard(
    part,
    quoteFixture({ viewer: { ...OWNER_NO_PRICES, canSeePrices: true }, parts: [part] })
  );
  assert.match(html, /yeniden yükleyin/);
  assert.doesNotMatch(html, /Manuel fiyat bekliyor/);
});

test("katalogdan düşen malzeme parçayı malzeme seçimine yönlendirir", () => {
  const part = partFixture({
    config: { ...partFixture().config, materialKey: "kaldirilmis" },
    dfm: [{ code: "config_invalid", severity: "error" }],
    needsManualPrice: true,
  });
  const html = renderPartCard(part, quoteFixture({ parts: [part] }));
  assert.match(html, /malzeme seçin/i);
  assert.match(html, /Özellikleri düzenle/);
});

test("dosya elemesi uzantıyı, boyutu ve parça tavanını Türkçe anlatır", () => {
  // Tarayıcı kontrolü bir KOLAYLIK (uç aynı kuralları yeniden uygular); işi
  // müşteriye saniyesinde söylemek. Sığan dosyalar elenenlerden etkilenmez.
  const { accepted, errors } = validateQuoteFiles(
    [
      fakeFile("govde.stl", 1_000),
      fakeFile("cizim.step", 1_000),
      fakeFile("dev.obj", 200 * 1024 * 1024),
      fakeFile("kapak.3mf", 2_000),
      fakeFile("taban.stl", 3_000),
    ],
    {
      maxFileBytes: 100 * 1024 * 1024,
      maxParts: 2,
      currentCount: 0,
      // Bayrak KAPALI: `.step` müşteriye seçtirilmediği gibi, elle bırakılsa
      // da burada düşer.
      acceptedFormats: MESH_FORMATS,
      d: tr,
    }
  );
  assert.deepEqual(
    accepted.map((f) => f.name),
    ["govde.stl", "kapak.3mf"]
  );
  assert.deepEqual(errors, [
    "cizim.step: yalnız STL, OBJ, 3MF ve STEP dosyaları yüklenebilir.",
    "dev.obj: dosya 100 MB sınırını aşıyor.",
    "Bir teklifte en fazla 2 parça olabilir.",
  ]);
});

// ─── STEP: istemci kapısı, birim kilidi, sapma (S5) ─────────────────────────

/** Bayrak kapalı / açık hâlin biçim listeleri — ikisi de TEK kaynaktan türer. */
const MESH_FORMATS = QUOTE_SOURCE_FORMATS.filter((f) => f !== "step");
const ALL_FORMATS = [...QUOTE_SOURCE_FORMATS];

function fakeFile(name: string, size: number): File {
  return { name, size } as unknown as File;
}

/**
 * STEP parçası: birimi dosyadan OKUNMUŞ (mm), sapması ölçülmüş.
 *
 * `suggestedUnits` bilerek `"mm"`: `suggestUnits` (`quote-units.ts`) ilk satırda
 * `g.sourceUnits`i döndürüyor ve STEP'te o daima `"mm"`. Yani çipin susması
 * "öneri üretilmedi" değil, "öneri seçili birimin AYNISI" demek.
 */
function stepPartFixture(over: Partial<PresentedPart> = {}): PresentedPart {
  return partFixture({
    id: "step-1",
    name: "Gövde",
    fileName: "govde.step",
    sourceFormat: "step",
    suggestedUnits: "mm",
    tessellationMm: 0.01,
    ...over,
  });
}

/** Markup'taki İLK `re` etiketini verir — nitelikler etiket bazında sınanmalı. */
function tagOf(html: string, re: RegExp): string {
  const match = html.match(re);
  assert.ok(match, `etiket bulunamadı: ${re}`);
  return match[0];
}

test("bayrak KAPALIYKEN dosya seçicisi .step'i HİÇ göstermez", () => {
  // Müşteriye seçtirip sonra uçta 400 vermek en kötü hâl olurdu: `accept`
  // dizesi bu yüzden kataloğun `acceptedFormats`ından türer, sabit değildir.
  assert.equal(acceptedAccept(MESH_FORMATS), ".stl,.obj,.3mf");
  assert.equal(acceptedAccept(ALL_FORMATS), ".stl,.obj,.3mf,.step,.stp");

  const closed = renderWorkspace(quoteFixture());
  assert.match(tagOf(closed, /<input type="file"[^>]*>/), /accept="\.stl,\.obj,\.3mf"/);
  assert.ok(!closed.includes(".step"), "bayrak kapalıyken .step seçilebilir görünüyor");

  const open = renderWorkspace(
    quoteFixture({ catalog: { ...catalogFixture, acceptedFormats: ALL_FORMATS } })
  );
  assert.match(
    tagOf(open, /<input type="file"[^>]*>/),
    /accept="\.stl,\.obj,\.3mf,\.step,\.stp"/
  );
});

test("istemci kapısı bayrağa bağlı: STEP listedeyken .step kabul edilir", () => {
  const files = [fakeFile("govde.step", 1_000), fakeFile("kapak.STP", 1_000)];
  const opts = { maxFileBytes: 100 * 1024 * 1024, maxParts: 5, currentCount: 0, d: tr };

  const closed = validateQuoteFiles(files, { ...opts, acceptedFormats: MESH_FORMATS });
  assert.deepEqual(closed.accepted, []);
  assert.deepEqual(closed.errors, [
    fill(tr["instantQuote.upload.invalidFormat"], { file: "govde.step" }),
    fill(tr["instantQuote.upload.invalidFormat"], { file: "kapak.STP" }),
  ]);

  const open = validateQuoteFiles(files, { ...opts, acceptedFormats: ALL_FORMATS });
  assert.deepEqual(
    open.accepted.map((f) => f.name),
    ["govde.step", "kapak.STP"],
    "iki uzantı TEK biçimdir: .stp de kabul edilmeli"
  );
  assert.deepEqual(open.errors, []);
});

test("STEP'in kendi tavanı istemcide de AYRI: aynı boyuttaki STL geçer", () => {
  // Genel tavan bir katalog AYARI, STEP'in tavanı bir DAĞITIM kararı: aynı
  // bayt sayısı STEP'te mesh'ten kat kat fazla geometri taşır.
  const size = STEP_MAX_BYTES + 1;
  const { accepted, errors } = validateQuoteFiles(
    [fakeFile("dev.step", size), fakeFile("dev.stl", size)],
    {
      maxFileBytes: 100 * 1024 * 1024,
      maxParts: 5,
      currentCount: 0,
      acceptedFormats: ALL_FORMATS,
      d: tr,
    }
  );
  assert.deepEqual(
    accepted.map((f) => f.name),
    ["dev.stl"],
    "genel tavanın altındaki STL, STEP tavanı yüzünden düşmüş"
  );
  assert.deepEqual(errors, [
    fill(tr["instantQuote.upload.stepTooLarge"], { file: "dev.step", maxMb: 16 }),
  ]);
});

test("STEP parçasında birim seçimi KİLİTLİ, mesh parçasında etkin", () => {
  const step = stepPartFixture();
  const stepHtml = renderPartCard(step, quoteFixture({ parts: [step] }));
  assert.match(tagOf(stepHtml, /<select[^>]*>/), /disabled/);
  assert.ok(
    stepHtml.includes(tr["instantQuote.part.stepUnitsLocked"]),
    "kilidin SEBEBİ yazılmamış"
  );

  const mesh = partFixture();
  const meshHtml = renderPartCard(mesh, quoteFixture({ parts: [mesh] }));
  assert.doesNotMatch(tagOf(meshHtml, /<select[^>]*>/), /disabled/);
  assert.ok(
    !meshHtml.includes(tr["instantQuote.part.stepUnitsLocked"]),
    "mesh parçasına STEP birim notu düşmüş"
  );
});

test("STEP parçasında ölçek girişi ETKİN kalır ve sığdırma önerisi okunur", () => {
  // Birim kilidi ölçeği KAPATMAZ: baskı hacmine sığmayan parçanın çözümü
  // `fitScale`dir ve o yol STEP'te de aynen çalışır.
  const step = stepPartFixture({
    dfm: [
      {
        code: "too_large",
        severity: "error",
        params: { maxX: 250, maxY: 210, maxZ: 210, fitScale: 0.75 },
      },
    ],
  });
  const html = renderPartCard(step, quoteFixture({ parts: [step] }));
  assert.doesNotMatch(tagOf(html, /<input type="number"[^>]*>/), /disabled/);
  assert.match(html, /Ölçeği 0,75 yaparsanız sığar\./);
});

test("STEP parçasında birim ÖNERİSİ çipi çizilmez", () => {
  const step = stepPartFixture();
  const html = renderPartCard(step, quoteFixture({ parts: [step] }));
  assert.ok(
    !html.includes("Bu dosya"),
    "beyan edilmiş birime rağmen birim önerisi çipi çizilmiş"
  );
  // Aynı çip mesh parçasında ÇALIŞMAYA devam eder (sessizlik STEP'e özel).
  const mesh = partFixture({ suggestedUnits: "in" });
  assert.match(
    renderPartCard(mesh, quoteFixture({ parts: [mesh] })),
    /Bu dosya in olabilir/
  );
});

test("sapma notu değere bağlıdır: STEP parçasında var, mesh parçasında yok", () => {
  const step = stepPartFixture();
  assert.ok(
    renderPartCard(step, quoteFixture({ parts: [step] })).includes(
      fill(tr["instantQuote.part.stepTessellation"], { mm: "0,01" })
    ),
    "sapma cümlesi kartta yok"
  );
  const mesh = partFixture();
  assert.ok(
    !renderPartCard(mesh, quoteFixture({ parts: [mesh] })).includes("sapma"),
    "mesh parçasına sapma notu düşmüş"
  );
});

test("baskı hacmine sığmayan parça çözümü rakamla söyler", () => {
  // `quote-dfm.ts` parametreyi `fitScale` / `fitsTechnology` adıyla üretiyor,
  // sözlük cümleleri `{scale}` / `{technology}` bekliyor: eşleme kopunca
  // müşteri ekranda yer tutucunun kendisini okur.
  const message = dfmMessage(
    tr,
    {
      code: "too_large",
      severity: "error",
      params: { maxX: 250, maxY: 210, maxZ: 210, fitScale: 0.75, fitsTechnology: "sla" },
    },
    catalogFixture
  );
  assert.match(message, /250 × 210 × 210 mm/);
  assert.match(message, /Ölçeği 0,75 yaparsanız sığar\./);
  assert.match(message, /SLA ile basılabilir\./, "teknoloji ANAHTARI adına çevrilmemiş");
  assert.doesNotMatch(message, /\{\w+\}/, "cümlede doldurulmamış yer tutucu kaldı");
});

test("teklif toplamı sınırı aşınca fiyatsız izleyiciye yer tutucu kalmaz", () => {
  // Fiyat kapısı kapalıyken `maxTotalKurus` gövdeye HİÇ girmiyor; cümle
  // tutarı anmadan kurulmalı.
  const gated = dfmMessage(tr, {
    code: "qty_over_auto",
    severity: "error",
    params: { reason: "total" },
  });
  assert.doesNotMatch(gated, /\{maxTotal\}/);
  assert.doesNotMatch(gated, /₺/);
  const open = dfmMessage(tr, {
    code: "qty_over_auto",
    severity: "error",
    params: { reason: "total", maxTotalKurus: 5000000 },
  });
  assert.match(open, /50\.000,00/);
});

test("parçalar teknolojiye göre katalog sırasıyla gruplanır", () => {
  const base = partFixture().config;
  const parts = [
    partFixture({
      id: "a",
      config: { ...base, technologyKey: "sla", materialKey: "std_resin", colorKey: "grey" },
    }),
    partFixture({ id: "b" }),
    partFixture({ id: "c", config: { ...base, technologyKey: "bilinmeyen" } }),
  ];
  assert.deepEqual(
    groupPartsByTechnology(parts, catalogFixture).map((g) => [
      g.key,
      g.name,
      g.parts.map((p) => p.id),
    ]),
    [
      ["fdm", "FDM", ["b"]],
      ["sla", "SLA", ["a"]],
      ["bilinmeyen", "bilinmeyen", ["c"]],
    ]
  );
});

test("toplu işlem çubuğu seçim varken çıkar, yokken hiç çizilmez", () => {
  const bar = (ids: string[]) =>
    inLocale(
      createElement(QuoteBulkBar, {
        selectedIds: ids,
        catalog: catalogFixture,
        onApply: noop,
        onDelete: noop,
        onClear: noop,
      })
    );
  assert.equal(bar([]), "");
  const html = bar(["p1", "p2"]);
  assert.match(html, /2 parça seçildi/);
  assert.match(html, /Seçilenlere uygula/);
  assert.match(html, /Seçilenleri sil/);
});

// ─── Çalışma alanı: cevap sırası ve sahiplenme hatası ───────────────────────

test("sahiplenme hatasında yalnız 404 'bu teklif başkasının' demektir", () => {
  // Salt okunur uyarısı ("Bu teklif başka bir hesaba bağlı") teklifin
  // SAHİPLİĞİ hakkında bir iddiadır; onu yalnız ucun 404'ü kurabilir. Ağ
  // kopması (status 0), 401, hız sınırı ve 5xx, az önce giriş yapmış GERÇEK
  // sahibi kendi çalışma alanından etmemeli.
  assert.equal(isOwnershipConflict(new QuoteApiError("Teklif bulunamadı.", 404)), true);
  for (const status of [0, 401, 403, 429, 500, 502, 504]) {
    assert.equal(
      isOwnershipConflict(new QuoteApiError("geçici", status)),
      false,
      `status ${status} sahiplik çakışması sayıldı`
    );
  }
  assert.equal(isOwnershipConflict(new Error("boom")), false);
  assert.equal(isOwnershipConflict(null), false);
});

test("geç kalan yoklama, az önce eklenen parçayı ekrandan silemez", () => {
  const order = createResponseOrder();
  // T0 — analiz sürerken 3 sn'lik yoklama yola çıkar.
  const stalePoll = order.next();
  // T1 — ikinci dosyanın `POST /parts` cevabı gelir ve uygulanır.
  order.claimLatest();
  // T2 — T0'daki yoklama şimdi döner; gövdesinde yeni parça YOKTUR.
  assert.equal(order.accept(stalePoll), false, "eski yoklama taze gövdenin üstüne yazdı");
  // Yazımdan SONRA yola çıkan yoklama elbette uygulanır.
  assert.equal(order.accept(order.next()), true);
});

test("sırayla dönen okumalar uygulanır, uçuşta yazım varken yoklama beklenir", () => {
  const order = createResponseOrder();
  const first = order.next();
  const second = order.next();
  assert.equal(order.accept(first), true);
  assert.equal(order.accept(second), true);

  assert.equal(order.isWriting(), false);
  order.beginWrite();
  order.beginWrite(); // çok dosyalı bırakma: iki yükleme iç içe
  assert.equal(order.isWriting(), true);
  order.endWrite();
  assert.equal(order.isWriting(), true, "yazımlardan biri bitince kapı erken açıldı");
  order.endWrite();
  assert.equal(order.isWriting(), false);
  order.endWrite(); // fazladan bitiş sayacı eksiye düşürmemeli
  assert.equal(order.isWriting(), false);
  order.beginWrite();
  assert.equal(order.isWriting(), true, "sayaç eksiye düşmüş: yoklama yazımın üstüne biner");
});

// ─── Özet paneli, bantlar, diyaloglar ve belge (Görev 3.2b) ────────────────

const PRICED: QuoteViewer = { ...OWNER_NO_PRICES, canSeePrices: true };

const TOTALS_FIXTURE: QuoteTotals = {
  allPriced: true,
  partsKurus: 14800,
  addonLines: [],
  addonsKurus: 0,
  minOrderTopUpKurus: 0,
  totalKurus: 14800,
  // Bu iki rakam BİLEREK %20'lik bir bölmeyle tutarsız (14800/1,2 = 12333'tür).
  // Uydurma olmaları testin amacı: ekran KDV'yi kendisi hesaplarsa 12333
  // basar ve test kırmızıya döner — gerçek hayatta tutarı `computeKdv`
  // belirler ve arayüz onu sorgulamadan yazmak zorundadır.
  kdvExcludedKurus: 12000,
  kdvKurus: 2800,
  leadDays: 5,
};

function pricedQuote(over: Partial<PresentedQuote> = {}): PresentedQuote {
  return quoteFixture({
    viewer: PRICED,
    parts: [
      partFixture({
        price: { unitKurus: 7400, lineKurus: 14800, source: "auto", priceBreaks: [] },
      }),
    ],
    totals: TOTALS_FIXTURE,
    leadOptions: [
      { key: "economy", name: "Ekonomik", leadDays: 8, totalKurus: 14000 },
      { key: "standard", name: "Standart", leadDays: 5, totalKurus: 14800 },
      { key: "express", name: "Ekspres", leadDays: 3, totalKurus: 19800 },
    ],
    ...over,
  });
}

function renderSummary(quote: PresentedQuote): string {
  return inLocale(
    createElement(QuoteSummary, {
      quote,
      onPatch: noop,
      onRequestReview: noop,
      onRequestPrices: noop,
    })
  );
}

function renderBanners(quote: PresentedQuote): string {
  return inLocale(
    createElement(QuoteBanners, { quote, shareToken: null, onQuoteChanged: noop })
  );
}

test("özet, fiyat kapısı kapalıyken tek bir rakam bile basmaz", () => {
  const html = renderSummary(quoteFixture());
  assert.match(html, /Fiyatları görmek için giriş yapın/);
  assert.doesNotMatch(html, /₺\s?\d/, "kapının arkasından özete rakam sızdı");
  assert.match(html, /Ödemeye geç/, "ödeme düğmesi kapıyı açmak için de durmalı");
});

test("özet toplamı KDV dahil yazar ve hariç göstermeyi önerir", () => {
  const html = renderSummary(pricedQuote());
  assert.match(html, /148,00/, "toplam yok");
  assert.match(html, /KDV dahil/);
  assert.match(html, /KDV hariç göster/, "KDV anahtarı yok");
  assert.match(html, /1 parça \(2 adet\)/);
  assert.match(html, /Kargo: Ücretsiz/);
});

test("özet KDV hariç tutarı HESAPLAMAZ, sunucunun verdiğini basar", () => {
  assert.equal(displayedTotalKurus(TOTALS_FIXTURE, false), 14800);
  // 14800/1,2 = 12333; fikstür 12000 diyor. Gösterilen rakam sunucununkidir.
  assert.equal(displayedTotalKurus(TOTALS_FIXTURE, true), 12000);
});

test("KDV tercihi okunamayan depoda ekranı çökertmez", () => {
  // Gizli sekmede `localStorage` erişimi ATAR; tercih bir kolaylıktır, teklifi
  // görüntülemenin şartı değil.
  const throwing = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("SecurityError");
    },
  } as unknown as Storage;
  assert.equal(readKdvExcludedPref(throwing), false);
  assert.doesNotThrow(() => writeKdvExcludedPref(throwing, true));
  assert.equal(readKdvExcludedPref(null), false);

  const store = new Map<string, string>();
  const ok = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as unknown as Storage;
  writeKdvExcludedPref(ok, true);
  assert.equal(readKdvExcludedPref(ok), true);
  writeKdvExcludedPref(ok, false);
  assert.equal(readKdvExcludedPref(ok), false);
});

test("teslim kademeleri süresiyle ve tutarıyla listelenir", () => {
  const html = renderSummary(pricedQuote());
  for (const name of ["Ekonomik", "Standart", "Ekspres"]) {
    assert.ok(html.includes(name), `${name} kademesi yok`);
  }
  assert.match(html, /8 iş günü/);
  assert.match(html, /140,00/, "kademe başına tutar yok");
  // Kargoya teslim tarihi YALNIZ seçili kademede: diğer kademelerin tarihini
  // sunucu hesaplamadı, istemci de iş günü sayamaz.
  assert.match(html, /tarihinde kargoda/);
});

test("ek hizmet ücreti hangi birime ait olduğunu söyler", () => {
  const quote = pricedQuote({
    catalog: {
      ...catalogFixture,
      addons: [
        {
          key: "cert",
          name: "Uygunluk sertifikası",
          description: "",
          leadDaysExtra: 1,
          priceKurus: 5000,
          priceType: "per_unit",
        },
      ],
    },
  });
  const html = renderSummary(quote);
  assert.match(html, /Uygunluk sertifikası/);
  assert.match(html, /50,00/);
  assert.match(html, /adet başına/, "birim fiyatın neye göre işlediği yazmıyor");
  assert.match(html, /\+1 iş günü/);
});

test("ödemeye geçilemiyorsa sebep yazılır ve düğme kapalı durur", () => {
  const html = renderSummary(
    pricedQuote({
      readiness: {
        canCheckout: false,
        blockers: ["2 parçanın analizi sürüyor — birkaç saniye içinde tamamlanır."],
      },
    })
  );
  assert.match(html, /Ödemeye geçmeden önce:/);
  assert.match(html, /2 parçanın analizi sürüyor/);
  assert.match(html, /disabled/, "engelli teklifte ödeme düğmesi açık kalmış");
  assert.doesNotMatch(html, /href="\/teklif\/T-000123\/odeme"/, "kapalı düğme bağlantı vermiş");
});

test("ödemeye hazır teklif doğrudan ödeme sayfasına bağlanır", () => {
  const html = renderSummary(pricedQuote({ readiness: { canCheckout: true, blockers: [] } }));
  assert.match(html, /href="\/teklif\/T-000123\/odeme"/);
});

test("paylaşım izleyicisine ödeme bağlantısı VERİLMEZ, sebebi yazılır", () => {
  // Ödeme sayfası paylaşım token'ını BİLEREK okumaz (`odeme/page.tsx`): oraya
  // giden paylaşım izleyicisi çıplak bir 404 görür. Giriş yapmış paylaşım
  // izleyicisinin fiyatı görmesi (`canSeePrices`) ile ödeyebilmesi ayrı
  // şeylerdir; düğme bunu ayırmazsa açık bir bağlantı boşluğa götürür.
  const html = plain(
    renderSummary(
      pricedQuote({
        viewer: {
          canSeePrices: true,
          canEdit: false,
          isOwner: false,
          isShare: true,
          isAdmin: false,
        },
        readiness: { canCheckout: true, blockers: [] },
      })
    )
  );
  assert.doesNotMatch(html, /href="\/teklif\/T-000123\/odeme"/, "paylaşıma ödeme bağlantısı verilmiş");
  assert.match(html, /disabled/, "paylaşım izleyicisinde ödeme düğmesi açık kalmış");
  assert.ok(
    html.includes(tr["instantQuote.summary.ownerOnlyCheckout"]),
    "kapalı düğmenin sebebi yazılmamış"
  );
});

test("RFQ düğmesi yalnız yüksek hacim uyarısı varken çıkar", () => {
  const rfq = "Yüksek hacim teklifi";
  assert.ok(!renderSummary(pricedQuote()).includes(rfq), "uyarı yokken RFQ önerilmiş");
  assert.ok(
    renderSummary(
      pricedQuote({
        quoteIssues: [{ code: "qty_over_auto", severity: "error", params: { reason: "total" } }],
      })
    ).includes(rfq),
    "qty_over_auto varken RFQ önerilmemiş"
  );
});

test("PARÇA düzeyindeki yüksek hacim uyarısı da RFQ düğmesini açar", () => {
  // Cap üstü adetli parça fiyatlanamaz, bu yüzden `partsKurus` küçük kalır ve
  // TEKLİF düzeyinde `qty_over_auto` hiç doğmaz. Parça kartı "yüksek hacim
  // teklifi isteyin" derken özetin o düğmeyi saklaması, talebi yanlış sekmeye
  // (manuel) düşürürdü.
  const html = renderSummary(
    pricedQuote({
      quoteIssues: [],
      parts: [
        partFixture({
          dfm: [
            {
              code: "qty_over_auto",
              severity: "error",
              params: { quantity: 1500, maxQuantity: 1000 },
            },
          ],
        }),
      ],
    })
  );
  assert.ok(html.includes("Yüksek hacim teklifi"), "parça uyarısı RFQ düğmesini açmadı");
});

test("KDV hariç görünüm satır tutarlarının KDV DAHİL olduğunu söyler", () => {
  // Anahtar yalnız TOPLAMI değiştirir; satır tutarları KDV dahil kalır. Bu
  // cümle olmazsa kurumsal müşteri toplamdan BÜYÜK satırlar okur ve ikisini
  // tek toplam sanır. (`useSyncExternalStore`un sunucu anlık görüntüsü her
  // zaman "KDV dahil" olduğu için tercih SSR'da çizilemez; iddia bu yüzden
  // kaynağın kendisine bakar.)
  const source = fs.readFileSync(
    path.resolve("src/components/quote/quote-summary.tsx"),
    "utf8"
  );
  assert.match(
    source,
    /\{kdvExcluded && \([\s\S]{0,240}instantQuote\.summary\.kdvLineNote/,
    "KDV hariç görünümde satır tutarı açıklaması yok"
  );
  assert.match(tr["instantQuote.summary.kdvLineNote"], /KDV dahil/);
});

test("paylaşım izleyicisi özet üzerinden teklifi değiştiremez", () => {
  const html = renderSummary(
    pricedQuote({
      viewer: { canSeePrices: true, canEdit: false, isOwner: false, isShare: true, isAdmin: false },
      customerNote: null,
      poNumber: null,
    })
  );
  assert.match(html, /148,00/, "paylaşım izleyicisi toplamı görmeli");
  assert.ok(!html.includes("Manuel teklif iste"), "salt okunur görünümde talep düğmesi var");
  assert.ok(!html.includes("PO numarası"), "salt okunur görünümde PO alanı var");
});

test("katalog değişen ve süresi dolan teklif yeniden fiyatlamaya çağırır", () => {
  const changed = renderBanners(pricedQuote({ catalogChangedSinceSnapshot: true }));
  assert.match(changed, /Katalog güncellendi/);
  assert.match(changed, /Yeniden fiyatla/);

  const expired = renderBanners(pricedQuote({ status: "expired", expired: true, locked: true }));
  assert.match(expired, /süresi doldu/);
  assert.match(expired, /Yeniden fiyatla/);
});

test("kapanmış teklifin çıkışı var: sahibine 'Yeniden teklif al'", () => {
  // Uç (POST /api/quotes/[id]/requote) ve servisi yazılıydı, düğmesi yoktu:
  // siparişe dönmüş bir teklif yeniden fiyatlanamaz (409), yani aynı parçaları
  // tekrar sipariş etmenin ekranda HİÇBİR yolu yoktu.
  const ordered = renderBanners(
    pricedQuote({ status: "ordered", locked: true, orderNumber: "FG-2026-0042" })
  );
  assert.match(ordered, /Yeniden teklif al/);
  assert.match(ordered, /href="\/track\/FG-2026-0042"/, "takip bağlantısı kayboldu");

  const expired = renderBanners(pricedQuote({ status: "expired", expired: true, locked: true }));
  assert.match(expired, /Yeniden teklif al/);
  assert.match(expired, /Yeniden fiyatla/, "süresi dolanda asıl eylem yeniden fiyatlamadır");

  // Uç yalnız SAHİBE açık: paylaşım bağlantısıyla gelen 404, admin 403 alır —
  // düğme onlara gösterilseydi tıklayan kişiye hata penceresi açardı.
  const shared = renderBanners(
    pricedQuote({
      status: "ordered",
      locked: true,
      orderNumber: null,
      viewer: { ...PRICED, isOwner: false, isShare: true, canEdit: false },
    })
  );
  assert.ok(!shared.includes("Yeniden teklif al"), "paylaşım izleyicisine düğme çizildi");
});

test("kilitli teklif ödemeye, siparişe dönen teklif takibe bağlanır", () => {
  const locked = renderBanners(pricedQuote({ locked: true, liveDraftReference: "FG-DRAFT-7" }));
  assert.match(locked, /bekleyen bir ödeme/);
  assert.match(locked, /href="\/pay\/FG-DRAFT-7"/);

  const ordered = renderBanners(
    pricedQuote({ status: "ordered", locked: true, orderNumber: "FG-2026-0042" })
  );
  assert.match(ordered, /siparişe dönüştü/);
  assert.match(ordered, /href="\/track\/FG-2026-0042"/);
  // Siparişe dönmüş teklif yeniden fiyatlanamaz: uç 409 verir, düğme yalan olur.
  assert.ok(!ordered.includes("Yeniden fiyatla"), "siparişe dönen teklife yeniden fiyatla denmiş");
});

test("teknolojiye göre ayırma yalnız karışık teklifte önerilir", () => {
  const single = renderBanners(pricedQuote());
  assert.ok(!single.includes("Teknolojiye göre ayır"), "tek teknolojide ayırma önerilmiş");

  const base = partFixture().config;
  const mixed = renderBanners(
    pricedQuote({
      parts: [
        partFixture({ id: "a" }),
        partFixture({
          id: "b",
          config: { ...base, technologyKey: "sla", materialKey: "std_resin", colorKey: "grey" },
        }),
      ],
    })
  );
  assert.match(mixed, /Teknolojiye göre ayır/);
});

test("paylaşım diyaloğu bağlantı yokken oluşturur, varken kopyalatır", () => {
  const dialog = (quote: PresentedQuote) =>
    inLocale(
      createElement(QuoteShareDialog, { open: true, quote, onClose: noop, onQuoteChanged: noop })
    );

  const none = dialog(pricedQuote({ shareUrl: null }));
  assert.match(none, /Paylaşım bağlantısı oluştur/);
  assert.ok(!none.includes("Paylaşımı kapat"), "bağlantı yokken iptal düğmesi var");

  const live = dialog(pricedQuote({ shareUrl: "https://ornek.test/teklif/T-000123?t=tok123" }));
  assert.match(live, /tok123/);
  assert.match(live, /Kopyala/);
  assert.match(live, /Bağlantıyı yenile/);
  assert.match(live, /Paylaşımı kapat/);
});

test("hedef fiyat diyaloğu her parça için bir birim fiyat alanı açar", () => {
  const quote = pricedQuote({
    parts: [partFixture({ id: "a", name: "Braket" }), partFixture({ id: "b", name: "Kapak" })],
  });
  const html = inLocale(
    createElement(QuoteReviewDialog, {
      open: true,
      kind: "target_price",
      quote,
      shareToken: null,
      onClose: noop,
      onQuoteChanged: noop,
    })
  );
  assert.match(html, /Hedef fiyat öner/);
  assert.match(html, /Braket/);
  assert.match(html, /Kapak/);
  // Başlık bir kez (sütun başlığı), alan parça başına bir kez. Her alanın
  // erişilebilir adı parçanın kendi adıdır (`label for`), yoksa ekran okuyucu
  // iki özdeş "Hedef birim fiyat" alanı okurdu.
  assert.equal((html.match(/Hedef birim fiyat/g) ?? []).length, 1);
  assert.match(html, /id="target-a"/);
  assert.match(html, /id="target-b"/);
  assert.match(html, /for="target-a"/);
});

test("hedef fiyat alanı Türkçe yazılan tutarı kuruşa çevirir", () => {
  assert.equal(parseMoneyInput("74,50"), 7450);
  assert.equal(parseMoneyInput("74.50"), 7450);
  assert.equal(parseMoneyInput(" 1.250,00 "), 125000);
  assert.equal(parseMoneyInput("120"), 12000);
  assert.equal(parseMoneyInput(""), null);
  assert.equal(parseMoneyInput("abc"), null);
  assert.equal(parseMoneyInput("-5"), null);
  assert.equal(parseMoneyInput("0"), null);
});

test("teklif sohbeti yalnız sahibine açılır", () => {
  const panel = (quote: PresentedQuote) => inLocale(createElement(QuoteChatPanel, { quote }));
  assert.match(panel(pricedQuote()), /Teklif sohbeti/);
  assert.equal(
    panel(
      pricedQuote({
        viewer: {
          canSeePrices: true,
          canEdit: false,
          isOwner: false,
          isShare: true,
          isAdmin: false,
        },
      })
    ),
    "",
    "paylaşım izleyicisine sohbet açılmış"
  );
});

// ─── Belge / proforma ───────────────────────────────────────────────────────

const BANK_FIXTURE = {
  bankName: "Ziraat Bankası",
  accountHolder: "Figurunica",
  iban: "TR33 0006 1005 1978 6457 8413 26",
  branch: "Etimesgut",
};

function renderDocument(quote: PresentedQuote): string {
  return inLocale(createElement(QuoteDocument, { quote, bank: BANK_FIXTURE }));
}

test("belge teklifin kimliğini, parçalarını ve geçerliliğini yazar", () => {
  const html = renderDocument(pricedQuote({ poNumber: "SATINALMA-77", title: "Kalıp seti" }));
  assert.match(html, /Figurunica/);
  assert.match(html, /8841014310/, "satıcı VKN'si yok");
  assert.match(html, /T-000123/);
  assert.match(html, /SATINALMA-77/);
  assert.match(html, /Braket/);
  assert.match(html, /FDM/);
  assert.match(html, /PLA/);
  assert.match(html, /120 × 80 × 40 mm/);
  assert.match(html, /Bu teklif 20 Ekim 2026 tarihine kadar geçerlidir\./);
});

test("belge toplamı KDV dökümüyle ve havale bilgileriyle kapatır", () => {
  const html = renderDocument(pricedQuote({ liveDraftReference: "FIG-A1B2C3D4" }));
  assert.match(html, /148,00/, "toplam yok");
  assert.match(html, /120,00/, "KDV hariç tutar yok");
  assert.match(html, /28,00/, "KDV tutarı yok");
  assert.match(html, /KDV dahil/);
  assert.match(html, /Proforma \/ Havale bilgileri/);
  assert.match(html, /TR33 0006 1005 1978 6457 8413 26/);
  assert.match(html, /Ziraat Bankası/);
  // Havale açıklaması GERÇEK ödeme referansıdır: dekont eşleştirmesi, hatırlatma
  // ve %3 havale indirimi taslak referansına (`FIG-…`) bağlıdır.
  assert.match(html, /Açıklama/);
  assert.match(html, /FIG-A1B2C3D4/);
});

test("ödeme referansı yokken proforma teklif numarasını havale açıklaması diye yazmaz", () => {
  // `T-000123` ile gönderilen havaleyi HİÇBİR ŞEY eşleştirmez: `/havale/<ref>`
  // yalnız taslak referansını çözer, dekont OCR'ı onu arar, indirim ve
  // hatırlatmalar ona bağlıdır. Referans yoksa belge müşteriyi ödeme adımına
  // yollar — IBAN'a karşılıksız para yollatmaz.
  const html = plain(renderDocument(pricedQuote({ liveDraftReference: null })));
  assert.match(html, /Proforma \/ Havale bilgileri/, "proforma bloğu kaybolmuş");
  assert.ok(
    !html.includes(tr["instantQuote.document.reference"]),
    "eşleşmeyen bir havale açıklaması yazılmış"
  );
  assert.ok(
    html.includes(tr["instantQuote.document.referencePending"]),
    "ödeme referansının nereden alınacağı yazılmamış"
  );
  // Teklif numarası belgede DURUR — ama "Teklif no" olarak, havale açıklaması
  // olarak değil.
  assert.ok(html.includes(tr["instantQuote.document.quoteNumber"]));
  assert.ok(html.includes("T-000123"));
});

test("belge fiyat kapısını aynen uygular ve imzalı model adresi taşımaz", () => {
  const html = renderDocument(quoteFixture());
  assert.doesNotMatch(html, /₺\s?\d/, "kapının arkasından belgeye rakam sızdı");
  assert.match(html, /Fiyatları görmek için giriş yapın/);
  // Belge paylaşılan bir çıktıdır: imzalı GLB / kaynak adresi ASLA girmez.
  assert.doesNotMatch(html, /\.glb/);
});

test("belgeye sapma satırı PresentedPart'tan girer, dolu değilse çizilmez", () => {
  // Anlaşmazlık savunması bu satıra bağlı (tasarım §3): "parça CAD'ime göre
  // köşeli geldi" tartışmasında sapmanın YAZILI olduğu yer teklif belgesidir.
  // Belgenin kaynağı `loadPresentedQuote` → `PresentedPart`tır;
  // `quote_checkouts.parts_snapshot` (yani `FrozenQuotePart`) bu ekranda hiç
  // okunmaz, bu yüzden testte de kullanılmaz.
  const step = stepPartFixture({
    price: { unitKurus: 7400, lineKurus: 14800, source: "auto", priceBreaks: [] },
  });
  const html = plain(renderDocument(pricedQuote({ parts: [step] })));
  assert.ok(
    html.includes(fill(tr["instantQuote.document.stepTessellation"], { mm: "0,01" })),
    "belgede sapma satırı yok"
  );
  const mesh = plain(renderDocument(pricedQuote()));
  assert.ok(!mesh.includes("sapma"), "mesh parçalı belgeye sapma satırı düşmüş");
});

test("belgenin yazdırma düğmesi çıktıya girmez", () => {
  const html = inLocale(createElement(QuoteDocumentPrintButton, {}));
  assert.match(html, /no-print/, "yazdır düğmesi çıktıdan gizlenmemiş");
  assert.match(html, /Yazdır \/ PDF/);
});

// ─── Açılış sayfası (/3d-baski) ve malzeme kütüphanesi ──────────────────────

/**
 * React metin içeriğinde `'` ve `&` gibi karakterleri kaçırır (`&#x27;`). Çapa
 * cümlesi (`₺74'ten başlayan`) kesme işareti taşıdığı için testler markup'ı
 * okunur hâle getirip öyle arar — aksi hâlde her assertion kaçış dizisi
 * ezberlemek zorunda kalırdı.
 */
function plain(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function renderLanding(
  uploader: ReactNode = createElement("div", { id: "uploader-slot" })
): string {
  return plain(
    inLocale(createElement(PrintServiceLanding, { snapshot: SEED_SNAPSHOT, uploader }))
  );
}

test("başlangıç fiyatı katalogdan hesaplanır, elle yazılmaz", () => {
  // Altın değer (test-quote-core G1 ile aynı hesap): 20 mm küp → V 8 cm³,
  // A 24 cm²; FDM/PLA, 1 adet, standart kademe. Malzeme + makine (≈2991 kr)
  // taban birim fiyatın (4900) altında kaldığı için taban devreye girer,
  // üstüne kurulum ücreti (2500) biner → 7400.
  assert.equal(technologyAnchorKurus(SEED_SNAPSHOT, "fdm"), 7400);
  // SLA: standart reçine 8 cm³ katı → malzeme 3174 + makine 3200 = 6374, taban
  // 7900'ün altında; kurulum 3500 → 11400.
  assert.equal(technologyAnchorKurus(SEED_SNAPSHOT, "sla"), 11400);
  assert.equal(catalogAnchorKurus(SEED_SNAPSHOT), 7400);
  assert.equal(technologyAnchorKurus(SEED_SNAPSHOT, "yok"), null);
});

test("çapa lira olarak YUKARI yuvarlanır (yayımlanan rakam gerçeğin altında kalmaz)", () => {
  assert.equal(formatAnchorPrice(7400), "₺74");
  assert.equal(formatAnchorPrice(7401), "₺75");
  assert.equal(formatAnchorPrice(1234500), "₺12.345");
});

test("çapa cümlesinin ayrılma eki sayının OKUNUŞUNA uyar", () => {
  // Bu cümle sayfanın alıntılanan cümlesidir (arama motoru indeksler, asistan
  // olduğu gibi tekrarlar): sabit `'den` eki katalogdaki DÖRT çapanın dördünü
  // de yanlış yazıyordu. Ek kuraldır: sert ünsüz (p ç t k f h s ş) → `t`,
  // kalın ünlü (a ı o u) → `an`.
  const seeded: Array<[number, string]> = [
    [7400, "₺74'ten başlayan"], // yetmiş dört
    [11400, "₺114'ten başlayan"], // yüz on dört
    [11586, "₺116'dan başlayan"], // yüz on altı
    [12266, "₺123'ten başlayan"], // yüz yirmi üç
  ];
  for (const [kurus, sentence] of seeded) {
    assert.equal(anchorSentence(kurus), sentence);
  }
  // Katalogun üretebileceği her sayı sözcüğü: birler, onlar, yüz ve binler.
  const byWord: Array<[number, string]> = [
    [1, "den"], // bir
    [2, "den"], // iki
    [3, "ten"], // üç
    [4, "ten"], // dört
    [5, "ten"], // beş
    [6, "dan"], // altı
    [7, "den"], // yedi
    [8, "den"], // sekiz
    [9, "dan"], // dokuz
    [10, "dan"], // on
    [20, "den"], // yirmi
    [30, "dan"], // otuz
    [40, "tan"], // kırk
    [50, "den"], // elli
    [60, "tan"], // altmış
    [70, "ten"], // yetmiş
    [80, "den"], // seksen
    [90, "dan"], // doksan
    [100, "den"], // yüz
    [1000, "den"], // bin
    [12000, "den"], // on iki bin
    [2000000, "dan"], // iki milyon
  ];
  for (const [lira, suffix] of byWord) {
    assert.equal(
      anchorSentence(lira * 100),
      `${formatAnchorPrice(lira * 100)}'${suffix} başlayan`,
      `${lira} için ek yanlış`
    );
  }
});

test("teknolojinin çapası o teknolojinin EN UCUZ malzemesidir", () => {
  for (const tech of SEED_SNAPSHOT.technologies) {
    const anchor = technologyAnchorKurus(SEED_SNAPSHOT, tech.key);
    assert.ok(anchor !== null, `${tech.key} çapası hesaplanamadı`);
    const perMaterial = SEED_SNAPSHOT.materials
      .filter((m) => m.technologyKey === tech.key)
      .map((m) => materialAnchorKurus(SEED_SNAPSHOT, m));
    assert.ok(
      perMaterial.every((p) => p !== null),
      `${tech.key}: malzeme çapası hesaplanamadı`
    );
    assert.equal(anchor, Math.min(...(perMaterial as number[])));
  }
});

test("açılış sayfası katalogdaki her rakamı yayımlar (alıntılanabilirlik)", () => {
  const html = renderLanding();
  assert.match(html, /ANLIK 3D BASKI TEKLİFİ/);
  assert.ok(html.includes("₺74'ten başlayan"), "FDM çapası yok");
  assert.ok(html.includes("₺114'ten başlayan"), "SLA çapası yok");
  for (const tech of SEED_SNAPSHOT.technologies) {
    assert.ok(html.includes(tech.name), `${tech.key} adı yok`);
    assert.ok(
      html.includes(`${tech.buildMm.x} × ${tech.buildMm.y} × ${tech.buildMm.z} mm`),
      `${tech.key} baskı hacmi yok`
    );
    assert.ok(html.includes(tech.toleranceText), `${tech.key} toleransı yok`);
    assert.ok(html.includes(`${tech.baseLeadDays} iş günü`), `${tech.key} teslim süresi yok`);
  }
  // Çapanın hangi parçaya ait olduğu SAYFADA yazmazsa rakam alıntılanamaz.
  assert.ok(html.includes("20 mm küp"), "çapanın dayanağı yazılmamış");
  assert.ok(html.includes("KDV dahil"));
});

test("çapa geçen her yüzey asgari sipariş tutarını da yazar", () => {
  // Çapa 20 mm küpün BİRİM fiyatıdır (₺74); o sepet ödeme ekranında
  // `min_order_kurus` ile ₺200'e tamamlanır. Asgariyi yazmayan bir sayfa,
  // alıntılanmak için yazılmış olduğu hâlde 2,7 katlık bir sürpriz vaat eder.
  const floor = formatAnchorPrice(SEED_SNAPSHOT.settings.minOrderKurus);
  assert.equal(floor, "₺200");

  const landing = renderLanding();
  assert.ok(landing.includes("₺74'ten başlayan"), "çapa yok");
  assert.ok(landing.includes(floor), "çapa var ama asgari sipariş tutarı yok");
  assert.ok(
    landing.includes(minOrderSentence(SEED_SNAPSHOT.settings.minOrderKurus)!),
    "asgari sipariş cümlesi tek kaynaktan gelmiyor"
  );
  // SSS'nin altında değil, çapanın YANINDA: ziyaretçi ₺74'ü ilk gördüğü yerde
  // ₺200'ü de görmeli ("Modelini yükle" ilk adımın başlığı, kahramanın sonu).
  const hero = landing.slice(0, landing.indexOf("Modelini yükle"));
  assert.ok(hero.includes("₺74'ten başlayan"), "kahraman bölümünde çapa yok");
  assert.ok(hero.includes(floor), "asgari sipariş tutarı çapanın yanında değil");

  // Bayrak kapalıyken de (SEO yüzeyi aynı kalır) ve malzeme kütüphanesinde de.
  assert.ok(renderLanding(createElement(ComingSoonNote)).includes(floor));
  const library = plain(inLocale(createElement(MaterialLibrary, { snapshot: SEED_SNAPSHOT })));
  assert.ok(library.includes("₺74'ten başlayan"), "kütüphanede çapa yok");
  assert.ok(library.includes(floor), "kütüphanede asgari sipariş tutarı yok");

  // Rakam KATALOGDAN gelir: elle yazılsaydı asgari değiştiğinde sayfa yalan söylerdi.
  const bumped: PricingSnapshot = {
    ...SEED_SNAPSHOT,
    settings: { ...SEED_SNAPSHOT.settings, minOrderKurus: 25000 },
  };
  const html = plain(
    inLocale(createElement(PrintServiceLanding, { snapshot: bumped, uploader: null }))
  );
  assert.ok(html.includes("₺250"), "asgari sipariş tutarı sayfaya sabit yazılmış");
  assert.ok(!html.includes("₺200"), "eski asgari tutar sayfada kalmış");
});

test("açılış sayfası dört adımı ve gizlilik taahhüdünü aynen yazar", () => {
  const html = renderLanding();
  for (const step of [
    "Modelini yükle",
    "Özelliklerini seç",
    "Anında fiyatını gör",
    "Üretime gönder",
  ]) {
    assert.ok(html.includes(step), `${step} adımı yok`);
  }
  assert.ok(
    html.includes(
      "Dosyalarınız yalnızca siparişinizi üreten, atanmış üretim ortağıyla paylaşılır."
    ),
    "gizlilik taahhüdü yok"
  );
});

test("malzeme kartları kütüphane sayfasındaki kendi çapalarına bağlanır", () => {
  const html = renderLanding();
  for (const material of SEED_SNAPSHOT.materials) {
    assert.ok(html.includes(material.name), `${material.key} adı yok`);
    assert.ok(
      html.includes(`href="/3d-baski/malzemeler#${material.key}"`),
      `${material.key} bağlantısı yok`
    );
  }
});

test("SSS müşterinin ilk sorduklarını RAKAMLA yanıtlar", () => {
  const faq = landingFaq(SEED_SNAPSHOT);
  assert.ok(faq.length >= 6, `SSS çok kısa: ${faq.length}`);
  const html = renderLanding();
  for (const { q, a } of faq) {
    assert.ok(html.includes(q), `soru sayfada yok: ${q}`);
    assert.ok(html.includes(a), `cevap sayfada yok: ${q}`);
  }
  const body = faq.map((f) => `${f.q} ${f.a}`).join(" ");
  for (const needle of [
    "STL",
    "OBJ",
    "3MF",
    // Tavan katalogdan gelir: sabit yazılsaydı tavan düştüğünde SSS'nin eski
    // rakamı yazdığını değil, testin eski rakamı aradığını öğrenirdik.
    `${SEED_SNAPSHOT.settings.maxFileBytes / 1048576} MB`,
    "20 parça",
    "hesap",
    "iş günü",
    "STEP",
    "manuel teklif",
    "Kurumsal",
    "Asgari sipariş",
  ]) {
    assert.ok(body.includes(needle), `SSS "${needle}" konusuna değinmiyor`);
  }
});

test("açılış metni STEP'i doğru anlatır: tavan ve sapma SABİTTEN gelir", () => {
  // Bu metinler bayrak OKUMAZ, yani yayına çıktıkları anda müşteriye
  // "STEP kabul ediliyor" derler. O yüzden söyledikleri şey uçtaki kuralla
  // BİREBİR aynı olmalı: tavan `STEP_MAX_BYTES`, sapma `STEP_TESSELLATION`.
  const html = renderLanding();
  const stepMb = Math.floor(STEP_MAX_BYTES / (1024 * 1024));
  assert.ok(html.includes(`${stepMb} MB`), "STEP tavanı sayfada yok");
  assert.ok(
    html.includes(`${STEP_TESSELLATION.deflectionMm.toLocaleString("tr-TR")} mm`),
    "sapma değeri sayfada yok"
  );
  // Birim hikâyesi: "biz mm varsaydık" DEĞİL, "dosyadan okundu".
  assert.match(html, /birimini dosyanın kendisinden okuyoruz/);
  assert.match(html, /mm olarak sabitlenir/);
  assert.ok(
    !html.includes("Dönüştüremiyorsanız"),
    "STEP'i STL'e çevirmeyi öğütleyen eski cümle sayfada kalmış"
  );
  // Hero, adım kartı ve SSS: üç yüzeyin üçü de biçim listesini aynı söyler.
  const listings = html.match(/STL, OBJ,? (?:ve|veya) 3MF/g) ?? [];
  assert.deepEqual(listings, [], `STEP'siz biçim listesi kalmış: ${listings.join(" | ")}`);
});

test("bayrak kapalıyken yükleyici yok ama SEO yüzeyi duruyor", () => {
  const html = renderLanding(createElement(ComingSoonNote));
  assert.match(html, /Yakında/);
  assert.doesNotMatch(html, /type="file"/, "kapalı bayrakta dosya girişi çizildi");
  // Katalog rakamları kalır: bayrak, arama motorunun okuduğu sayfayı kapatmaz.
  assert.ok(html.includes("₺74'ten başlayan"));
});

test("malzeme kütüphanesi her malzemeye çapa, özellik ve renk verir", () => {
  const html = plain(inLocale(createElement(MaterialLibrary, { snapshot: SEED_SNAPSHOT })));
  for (const material of SEED_SNAPSHOT.materials) {
    assert.ok(html.includes(`id="${material.key}"`), `${material.key} çapası yok`);
    assert.ok(html.includes(material.name), `${material.key} adı yok`);
    for (const color of material.colors) {
      assert.ok(html.includes(color.name), `${material.key}/${color.key} rengi yok`);
    }
  }
  assert.ok(html.includes("₺74'ten başlayan"), "PLA çapası kütüphanede yok");
  // Şeffaf PETG'nin renk farkı gizlenmez.
  assert.ok(html.includes("+₺5"), "renk ek ücreti yazılmamış");
});

test("Service JSON-LD fiyatı katalogdan alır ve kuruluşa bağlar", () => {
  const node = buildPrintServiceJsonLd(SEED_SNAPSHOT) as Record<string, unknown>;
  assert.equal(node["@type"], "Service");
  const offers = node.offers as Record<string, unknown>;
  assert.equal(offers["@type"], "AggregateOffer");
  assert.equal(offers.priceCurrency, "TRY");
  assert.equal(offers.lowPrice, "74.00");
  assert.equal((offers.offers as unknown[]).length, SEED_SNAPSHOT.technologies.length);
  const provider = node.provider as Record<string, unknown>;
  assert.match(String(provider["@id"]), /#organization$/);
  // Emitter sessizce "{}" yazarsa yapısal veri hiç yayımlanmamış olur.
  assert.notEqual(serializeJsonLd(node), "{}");
});

// ─── Hesap sayfaları ────────────────────────────────────────────────────────

const QUOTE_ROW: CustomerQuoteListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  number: "T-000123",
  status: "quoted",
  title: "Kalıp seti",
  partCount: 3,
  unitCount: 12,
  totalKurus: 148000,
  leadDays: 5,
  createdAt: "2026-09-20T09:00:00.000Z",
  updatedAt: "2026-09-20T09:00:00.000Z",
  expiresAt: "2026-10-20T09:00:00.000Z",
  expired: false,
  orderNumber: null,
};

test("teklif listesi numarayı, durumu, tutarı ve bağlantıyı yazar", () => {
  const html = plain(inLocale(createElement(QuoteListTable, { items: [QUOTE_ROW] })));
  assert.ok(html.includes("T-000123"));
  assert.ok(html.includes("Kalıp seti"));
  assert.ok(html.includes("Teklif hazır"), "durum rozeti yok");
  assert.match(html, /1\.480,00/, "tutar yok");
  assert.ok(html.includes('href="/teklif/T-000123"'), "teklif bağlantısı yok");
});

test("fiyatlanamamış teklif rakam uydurmaz, siparişe dönen teklif siparişe bağlanır", () => {
  const html = plain(
    inLocale(
      createElement(QuoteListTable, {
        items: [
          { ...QUOTE_ROW, number: "T-000124", totalKurus: null, status: "draft" },
          {
            ...QUOTE_ROW,
            number: "T-000125",
            status: "ordered",
            orderNumber: "FG-2026-0042",
          },
        ],
      })
    )
  );
  assert.ok(html.includes("—"), "tutarı olmayan satırda tire yok");
  assert.ok(html.includes('href="/track/FG-2026-0042"'), "sipariş bağlantısı yok");
});

test("süresi geçmiş taslak 'Taslak' demez, siparişe dönen teklif süre yüzünden bozulmaz", () => {
  // Saatlik bakım işi satıra dokunmadan önce de müşteri doğru şeyi görmeli:
  // açtığında karşılaşacağı ekran süre dolumu uyarısıdır.
  const stale = plain(
    inLocale(
      createElement(QuoteListTable, {
        items: [{ ...QUOTE_ROW, status: "draft", expired: true }],
      })
    )
  );
  assert.ok(stale.includes("Süresi doldu"), "süresi geçmiş taslak taslak olarak gösterildi");
  assert.ok(!stale.includes("Taslak"));

  const ordered = plain(
    inLocale(
      createElement(QuoteListTable, {
        items: [{ ...QUOTE_ROW, status: "ordered", expired: true, orderNumber: "FG-1" }],
      })
    )
  );
  assert.ok(ordered.includes("Siparişe dönüştü"), "siparişe dönen teklif süresi dolmuş sayıldı");
});

const LIBRARY_ROW: LibraryPart = {
  partId: "22222222-2222-4222-8222-222222222222",
  name: "Braket",
  fileName: "braket.stl",
  sourceFormat: "stl",
  sha256: "a".repeat(64),
  thumbnailUrl: null,
  dimensionsMm: { x: 120, y: 80, z: 40 },
  volumeCm3: 42.5,
  lastMaterialName: "PLA",
  quoteId: "11111111-1111-4111-8111-111111111111",
  quoteNumber: "T-000123",
  createdAt: "2026-09-20T09:00:00.000Z",
  useCount: 2,
};

test("parça kütüphanesi ölçüyü, malzemeyi ve kullanım sayısını yazar", () => {
  const html = plain(
    inLocale(
      createElement(PartLibraryGrid, { items: [LIBRARY_ROW], selected: [], onToggle: noop })
    )
  );
  assert.ok(html.includes("Braket"));
  assert.ok(html.includes("120 × 80 × 40 mm"));
  assert.ok(html.includes("PLA"), "son kullanılan malzeme yok");
  assert.ok(html.includes("2 teklifte kullanıldı"));
  assert.ok(html.includes("T-000123"), "kaynak teklif numarası yok");
});

// ─── Yıkıcı işlemler, sızdırmayan adres ve Türkçe kopya ─────────────────────

test("toplu silme ONAY ister ve düğmesi 'Seçimi temizle'den ayrılır", () => {
  // "Hepsini seç" bir onay kutusu yukarıda; çubukta "Seçilenleri sil" ile
  // "Seçimi temizle" yan yana, aynı ölçüde iki düğme. Tek yanlış dokunuş 20
  // parçayı birden siler (`deletedAt`), teklifi taslağa düşürür ve müşterinin
  // geri alma yolu YOKTUR — tek parça silmesi zaten onay sorarken.
  const source = fs.readFileSync(
    path.resolve("src/app/teklif/[number]/workspace-client.tsx"),
    "utf8"
  );
  const start = source.indexOf("<QuoteBulkBar");
  assert.ok(start > 0, "toplu çubuk çağrısı bulunamadı");
  const call = source.slice(start, source.indexOf("/>", start));
  assert.match(call, /onDelete=\{[\s\S]*?window\.confirm/, "toplu silme onaysız");
  assert.match(call, /instantQuote\.bulk\.deleteConfirm/, "onay cümlesi sözlükten gelmiyor");
  assert.match(
    tr["instantQuote.bulk.deleteConfirm"],
    /\{count\}/,
    "onay cümlesi kaç parçanın silineceğini söylemiyor"
  );

  // Görsel ayrım: silme düğmesi temizleme düğmesiyle aynı ağırlıkta olamaz.
  const bar = fs.readFileSync(path.resolve("src/components/quote/bulk-bar.tsx"), "utf8");
  const deleteButton = bar.slice(
    bar.indexOf("onClick={onDelete}"),
    bar.indexOf("onClick={onClear}")
  );
  assert.match(deleteButton, /rose|red/, "silme düğmesi yıkıcı olduğunu göstermiyor");
});

/** `track()` çağrısında hangi satıcı ucunun tetiklendiğini toplayan sahte tarayıcı. */
function trackInFakeBrowser(
  href: string,
  referrer = ""
): { dataLayer: unknown[]; gtag: unknown[][]; fbq: unknown[][]; ttq: unknown[][] } {
  const parsed = new URL(href);
  const calls = {
    dataLayer: [] as unknown[],
    gtag: [] as unknown[][],
    fbq: [] as unknown[][],
    ttq: [] as unknown[][],
  };
  const location = {
    href: parsed.href,
    origin: parsed.origin,
    pathname: parsed.pathname,
    search: parsed.search,
  };
  const consent = encodeURIComponent(JSON.stringify({ analytics: true, marketing: true }));
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = {
    window: g.window,
    document: g.document,
    location: g.location,
    fetch: g.fetch,
  };
  g.window = {
    location,
    dataLayer: calls.dataLayer,
    gtag: (...args: unknown[]) => void calls.gtag.push(args),
    fbq: (...args: unknown[]) => void calls.fbq.push(args),
    ttq: { track: (...args: unknown[]) => void calls.ttq.push(args) },
  };
  g.document = { cookie: `fig_consent=${consent}`, referrer };
  g.location = location;
  // Sunucu aynası birinci taraftır; testte ağa çıkmasın.
  g.fetch = () => Promise.resolve(undefined);
  try {
    track("page_view", { pagePath: buildTrackedUrl(location.pathname, location.search) });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  }
  return calls;
}

test("paylaşım token'ı üçüncü taraf etiketlerine GÖNDERİLMEZ", () => {
  // `?t=` bir taşıyıcı kimlik bilgisidir: teklifi ve (giriş yapmış izleyicide)
  // bütün fiyatları açar. Üçüncü tarafa gitmesi kimliği o tarafın günlüklerine
  // ve GA mülkünün URL raporlarına yazar.
  assert.equal(buildTrackedUrl("/teklif/T-1", "?t=abc&utm_source=x"), "/teklif/T-1?utm_source=x");
  assert.equal(buildTrackedUrl("/teklif/T-1", "?t=abc"), "/teklif/T-1");
  assert.equal(buildTrackedUrl("/teklif/T-1", ""), "/teklif/T-1");
  assert.equal(buildTrackedUrl("/3d-baski", "?utm_source=x"), "/3d-baski?utm_source=x");
  assert.ok(!buildTrackedUrl("/teklif/T-1", "?t=abc&utm_source=x").includes("abc"));

  assert.equal(hasUntrackedParams("?t=abc"), true);
  assert.equal(hasUntrackedParams("?utm_source=x&t=abc"), true);
  assert.equal(hasUntrackedParams("?utm_source=x"), false);
  assert.equal(hasUntrackedParams(""), false);

  assert.equal(
    buildTrackedHref("https://x.tr/teklif/T-1?t=abc&utm_source=x"),
    "https://x.tr/teklif/T-1?utm_source=x"
  );
  assert.equal(buildTrackedHref("https://x.tr/teklif/T-1?t=abc"), "https://x.tr/teklif/T-1");
  // Ayıklanacak bir şey yoksa adres OLDUĞU GİBİ döner (yeniden kodlanmaz).
  assert.equal(buildTrackedHref("https://x.tr/ara?q=a%20b"), "https://x.tr/ara?q=a%20b");
  assert.equal(buildTrackedHref("bozuk"), "");

  // ── Davranış: kimlik bilgisi taşıyan adreste HİÇBİR satıcı ucu tetiklenmez.
  // `buildTrackedUrl` yalnız bizim kendi `pagePath` alanımızı temizler; gtag.js
  // `page_location`ı, Meta `dl`yi, TikTok sayfa adresini, GTM kabı da
  // `{{Page URL}}`i `document.location`dan KENDİSİ okur.
  const shared = trackInFakeBrowser("https://x.tr/teklif/T-000123?t=" + "a".repeat(32));
  assert.deepEqual(shared.gtag, [], "GA4 olayı kimlik bilgisi taşıyan adreste gönderildi");
  assert.deepEqual(shared.fbq, [], "Meta pikseli kimlik bilgisi taşıyan adreste tetiklendi");
  assert.deepEqual(shared.ttq, [], "TikTok pikseli kimlik bilgisi taşıyan adreste tetiklendi");
  assert.deepEqual(shared.dataLayer, [], "dataLayer kimlik bilgisi taşıyan adreste beslendi");

  // ── Davranış: normal adreste GA4 olayı gider ve sayfa alanları AÇIKÇA geçilir
  // (otomatik `document.location` değeri ezilsin diye), yönlendiren de ayıklanır.
  const normal = trackInFakeBrowser(
    "https://x.tr/sepet?utm_source=x",
    "https://x.tr/teklif/T-000123?t=" + "a".repeat(32)
  );
  assert.equal(normal.gtag.length, 1, "GA4 olayı hiç gitmedi");
  const [verb, eventName, params] = normal.gtag[0] as [string, string, Record<string, unknown>];
  assert.equal(verb, "event");
  assert.equal(eventName, "page_view");
  assert.equal(params.page_location, "https://x.tr/sepet?utm_source=x");
  assert.equal(params.page_path, "/sepet?utm_source=x");
  assert.equal(params.page_referrer, "https://x.tr/teklif/T-000123");
  assert.ok(
    !JSON.stringify(normal.gtag).includes("a".repeat(32)),
    "token GA4 olayının içinde kaldı"
  );
  assert.equal(normal.fbq.length, 1, "Meta pikseli normal adreste de susuyor");
  assert.equal(normal.ttq.length, 1, "TikTok pikseli normal adreste de susuyor");
  if (hasGTM) {
    assert.equal(normal.dataLayer.length, 1);
    assert.equal(
      (normal.dataLayer[0] as Record<string, unknown>).page_location,
      "https://x.tr/sepet?utm_source=x"
    );
  }

  // Dört satıcı ucunun dördü de aynı kapının ARKASINDA duruyor.
  const client = fs.readFileSync(path.resolve("src/lib/analytics/client.ts"), "utf8");
  const gated = client.slice(client.indexOf("const credentialInUrl"), client.indexOf("mirrorToServer("));
  for (const call of ["pushDataLayer(", "window.gtag(", "window.fbq(", "window.ttq.track("]) {
    assert.ok(gated.includes(call), `${call} kimlik bilgisi kapısının dışında kaldı`);
  }

  // Yükleyiciler: GTM kabı ve iki piksel böyle bir adreste HİÇ yüklenmez,
  // GA4 yapılandırması da ayıklanmış adresi taşır.
  const scripts = fs.readFileSync(
    path.resolve("src/components/analytics/analytics-scripts.tsx"),
    "utf8"
  );
  for (const id of ['id="gtm"', 'id="meta-pixel"', 'id="tiktok-pixel"']) {
    const start = scripts.indexOf(id);
    assert.ok(start > 0, `${id} yükleyicisi bulunamadı`);
    const body = scripts.slice(start, scripts.indexOf("</Script>", start));
    assert.match(body, /\$\{HAS_CREDENTIAL\}/, `${id} kimlik bilgisi taşıyan adreste de yükleniyor`);
  }
  assert.match(
    scripts,
    /send_page_view:false,page_location:\$\{TRACKED_HREF\}/,
    "GA4 yapılandırması ham adresi taşıyor"
  );

  // Paylaşım bağlantısından çıkıldığında token YÖNLENDİREN alanıyla da gitmesin.
  for (const file of ["src/app/teklif/[number]/page.tsx", "src/app/teklif/[number]/belge/page.tsx"]) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.match(source, /referrer: "origin"/, `${file} yönlendiren ilkesini daraltmıyor`);
  }

  for (const file of ["src/components/analytics/analytics.tsx", "src/lib/analytics/client.ts"]) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.match(source, /buildTrackedUrl\(/, `${file} adresi süzmüyor`);
    assert.doesNotMatch(
      source,
      /\+ *\(?(window\.)?location\.search/,
      `${file} sorgu dizgisini ham birleştiriyor`
    );
  }
});

test("silme onayı ve ödeme fişi Türkçeyi doğru yazar", () => {
  // (b) Ünsüz benzeşmesi: "teklifden" değil "tekliften".
  assert.equal(tr["instantQuote.part.deleteConfirm"], "Bu parça tekliften silinsin mi?");

  // (c) Fişteki tarih ISO gün anahtarı değil, okunur tarihtir — kademe seçici
  // ve teklif belgesi zaten öyle yazıyor.
  const html = renderCheckout();
  assert.ok(html.includes("2 Kasım 2026 tarihinde kargoda"), "tarih okunur yazılmamış");
  assert.ok(!html.includes("2026-11-02"), "ham ISO gün anahtarı basılmış");
});

// ─── Ödeme ekranında hediye kartı (Faz 1a · T7) ──────────────────────────────

/** Kartsız TABAN: ikisi de sunucu hesabı, ekran bunları yalnız yazar. */
const NO_GIFT_TENDER: TenderViews = {
  card: { havaleDiscountKurus: 0, payableKurus: 14800 },
  bankTransfer: { havaleDiscountKurus: 444, payableKurus: 14356 },
};

/**
 * Uygulanmış kartın ÖN İZLEMESİ — uçtan geldiği gibi.
 *
 * Rakamlar birbirinden bağımsız seçildi (14800 − 4000 = 10800 tutuyor ama
 * havale satırı %3'ün tam karşılığı DEĞİL): ekran herhangi bir çıkarma ya da
 * oran hesabı yaparsa test kırmızıya döner.
 */
const GIFT_PREVIEW: QuoteGiftCardPreview = {
  valid: true,
  code: "GC-QA-TEST",
  balanceKurus: 4000,
  giftCardAmountKurus: 4000,
  fullyCovered: false,
  card: { havaleDiscountKurus: 0, payableKurus: 10800 },
  bankTransfer: { havaleDiscountKurus: 311, payableKurus: 10489 },
};

const money = (kurus: number) => formatCurrency(kurus, "tr");

function renderCheckout(over: Partial<QuoteCheckoutClientProps> = {}): string {
  return plain(
    inLocale(
      createElement(QuoteCheckoutClient, {
        quote: pricedQuote({ shipByDate: "2026-11-02" }),
        totalKurus: 14800,
        tender: NO_GIFT_TENDER,
        giftCardEnabled: false,
        savedAddress: null,
        ...over,
      })
    )
  );
}

function renderCheckoutForm(over: Partial<QuoteCheckoutFormProps> = {}): string {
  return plain(
    inLocale(
      createElement(QuoteCheckoutForm, {
        quote: pricedQuote(),
        totalKurus: 14800,
        tender: NO_GIFT_TENDER,
        paymentMethod: "card",
        onPaymentMethodChange: noop,
        giftCardEnabled: true,
        giftPreview: null,
        onGiftPreviewChange: noop,
        savedAddress: null,
        ...over,
      })
    )
  );
}

test("hediye kartı sözlüğü iki dilde de TAM ve yer tutucuları yerinde", () => {
  for (const suffix of [
    "title",
    "codeLabel",
    "apply",
    "applying",
    "remove",
    "applied",
    "remaining",
    "fullyCovered",
    "reservedPending",
    "disabled",
    "hint",
  ]) {
    const key = `instantQuote.checkout.giftCard.${suffix}`;
    assert.ok(trKeys.includes(key), `${key} Türkçe sözlükte yok`);
    assert.ok(enKeys.includes(key), `${key} İngilizce sözlükte yok`);
  }
  // Tutar taşıyan üç cümle yer tutucusunu KAYBETMEMELİ: kaybolursa ekran
  // rakamsız bir cümle basar ve kimse fark etmez.
  for (const suffix of ["applied", "remaining", "reservedPending"]) {
    const key = `instantQuote.checkout.giftCard.${suffix}` as keyof typeof tr;
    assert.match(tr[key], /\{amount\}/, `${key} {amount} yer tutucusunu taşımıyor`);
    assert.match(en[key], /\{amount\}/, `${key} (en) {amount} yer tutucusunu taşımıyor`);
  }
  // Hediye kartı bir ÖDEME ARACIDIR, iskonto değil (tasarım §3.3): fatura
  // matrahını düşürmediği için ekranda "indirim" diye ETİKETLENMEZ.
  assert.doesNotMatch(tr["instantQuote.checkout.giftCard.applied"], /ndirim/);
});

test("hediye kartı alanı bayrak KAPALIYKEN hiç ÇİZİLMEZ", () => {
  // Gizlemek yetmez: markup'a giren bir alan, bayrağı kapalı bir özelliğin
  // kodunu deneyen (ve sunucudan 400 alan) müşteri demek olurdu.
  const off = renderCheckout({ giftCardEnabled: false });
  assert.ok(!off.includes('name="giftCardCode"'), "kapalı bayrakta kod alanı markup'a girdi");
  assert.ok(
    !off.includes(tr["instantQuote.checkout.giftCard.title"]),
    "kapalı bayrakta hediye kartı başlığı çizildi"
  );

  // …ve açık bayrakta alan GERÇEKTEN var: yukarıdaki iddia "hiç çizilmedi"
  // anlamına gelsin.
  const on = renderCheckout({ giftCardEnabled: true });
  assert.ok(on.includes('name="giftCardCode"'), "açık bayrakta kod alanı yok");
  assert.ok(on.includes(tr["instantQuote.checkout.giftCard.codeLabel"]), "kod etiketi yok");
  assert.ok(on.includes(tr["instantQuote.checkout.giftCard.hint"]), "ipucu cümlesi yok");
  assert.ok(on.includes(tr["instantQuote.checkout.giftCard.apply"]), "uygula düğmesi yok");
});

test("uygulanan kart ödeme düğmesinde ve sözleşme kutusunda NET tutarı yazar", () => {
  const html = renderCheckoutForm({ giftPreview: GIFT_PREVIEW });
  assert.ok(
    html.includes(fill(tr["instantQuote.checkout.giftCard.applied"], { amount: money(4000) })),
    "karşılanan tutar satırı yok"
  );
  assert.ok(
    html.includes(fill(tr["instantQuote.checkout.giftCard.remaining"], { amount: money(10800) })),
    "ödenecek tutar satırı yok"
  );
  assert.ok(html.includes(tr["instantQuote.checkout.giftCard.remove"]), "kaldır düğmesi yok");

  // MSY m.6/2-a: ödeme yükümlülüğünden ÖNCE gösterilen "ödenecek toplam tutar"
  // NET tutardır. Formda brüt tutarın hiç geçmemesi bunu hem sözleşme kutusu
  // hem ödeme düğmesi için birden çiviler.
  assert.ok(html.includes(money(10800)), "net tutar formda yok");
  assert.ok(!html.includes(money(14800)), "brüt tutar sözleşme kutusunda/düğmede kaldı");

  // Havale seçilince rakam ÖN İZLEMEDEN gelir; ekran kendi çıkarmasını yapmaz.
  const havale = renderCheckoutForm({
    giftPreview: GIFT_PREVIEW,
    paymentMethod: "bank_transfer",
  });
  assert.ok(havale.includes(money(10489)), "havale dalında net tutar ön izlemeden gelmiyor");
  assert.ok(havale.includes(money(311)), "havale indirimi ön izlemeden gelmiyor");
  assert.ok(!havale.includes(money(444)), "kartsız tabanın havale indirimi ekranda kaldı");
});

test("kart tutarın tamamını karşılarsa müşteriye kart bilgisi İSTENMEYECEĞİ söylenir", () => {
  const html = renderCheckoutForm({
    giftPreview: {
      ...GIFT_PREVIEW,
      balanceKurus: 20_000,
      giftCardAmountKurus: 14_800,
      fullyCovered: true,
      card: { havaleDiscountKurus: 0, payableKurus: 0 },
      bankTransfer: { havaleDiscountKurus: 0, payableKurus: 0 },
    },
  });
  assert.ok(
    html.includes(tr["instantQuote.checkout.giftCard.fullyCovered"]),
    "tam karşılama cümlesi yok"
  );
  assert.ok(html.includes(money(0)), "ödenecek tutar sıfır olarak yazılmamış");
});

test("fiş hediye kartını İNDİRİM değil ÖDEME olarak yazar", () => {
  const html = plain(
    inLocale(
      createElement(QuoteCheckoutReceipt, {
        quote: pricedQuote(),
        totalKurus: 14800,
        giftCardAmountKurus: 4000,
        havaleDiscountKurus: 0,
        payableKurus: 10800,
      })
    )
  );
  // Brüt toplam fişte KALIR: hediye kartı siparişin büyüklüğünü değiştirmez,
  // yalnız tahsil edilen tutarı düşürür (tasarım §3.2).
  assert.ok(html.includes(money(14800)), "brüt toplam fişten kalkmış");
  assert.ok(
    html.includes(fill(tr["instantQuote.checkout.giftCard.applied"], { amount: money(4000) })),
    "fişte hediye kartı satırı yok"
  );
  assert.ok(
    html.includes(fill(tr["instantQuote.checkout.giftCard.remaining"], { amount: money(10800) })),
    "fişte ödenecek tutar yok"
  );
  assert.ok(
    !html.includes(tr["giftCard.discount"]),
    "hediye kartı fişte İSKONTO olarak etiketlenmiş (fatura matrahı §3.3)"
  );

  // Kart yoksa fiş bugünkü hâlinde kalır: ne hediye satırı ne ikinci bir toplam.
  const plainReceipt = plain(
    inLocale(
      createElement(QuoteCheckoutReceipt, {
        quote: pricedQuote(),
        totalKurus: 14800,
        giftCardAmountKurus: 0,
        havaleDiscountKurus: 0,
        payableKurus: 14800,
      })
    )
  );
  assert.ok(!plainReceipt.includes(tr["instantQuote.checkout.giftCard.title"]));
  assert.ok(
    !plainReceipt.includes(
      fill(tr["instantQuote.checkout.giftCard.remaining"], { amount: money(14800) })
    ),
    "kartsız fişte gereksiz bir ödenecek tutar satırı var"
  );
});

test("bekleyen ödemedeki rezervasyon müşteriye TUTARIYLA anlatılır", () => {
  const RESERVED_TAIL = "hediye kartı bakiyesi rezerve edildi";
  assert.ok(
    tr["instantQuote.checkout.giftCard.reservedPending"].includes(RESERVED_TAIL),
    "cümle değişti: aşağıdaki olumsuz iddia artık hiçbir şeyi sınamıyor"
  );
  const pending = {
    reference: "QT-000123",
    paymentMethod: "card" as const,
    paymentUrl: "/pay/QT-000123",
    cancellable: true,
    giftCardAmountKurus: 4000,
  };
  const html = plain(
    inLocale(createElement(QuotePendingPaymentClient, { quoteNumber: "T-000123", pending }))
  );
  assert.ok(
    html.includes(
      fill(tr["instantQuote.checkout.giftCard.reservedPending"], { amount: money(4000) })
    ),
    "rezerve edilen tutar bekleyen ödeme ekranında yazmıyor"
  );

  // Rezervasyonsuz bekleyen ödemede cümle HİÇ görünmez.
  const none = plain(
    inLocale(
      createElement(QuotePendingPaymentClient, {
        quoteNumber: "T-000123",
        pending: { ...pending, giftCardAmountKurus: 0 },
      })
    )
  );
  assert.ok(!none.includes(RESERVED_TAIL), "rezervasyon yokken de rezervasyon cümlesi çizildi");
});

test("tamamı hediye kartıyla karşılanmış bekleyen taslak ÖDEME BAĞLANTISI göstermez", () => {
  // Terfi ilk denemede patlamışsa taslak `pending` kalır ve kolonu
  // `gift_card_full`dür. Sunucunun 409 karşılaştırması onu KART sayar (doğru:
  // müşteri o taslak dururken ne kartla ne havaleyle yeni ödeme başlatamaz) ama
  // EKRANDA "kart ile ödeme bekliyor" + `/pay/<ref>` yalan: tahsil edilecek
  // nakit yok ve o sayfa ₺0 için PayTR token'ı deneyip patlar.
  const covered = {
    reference: "QT-000124",
    paymentMethod: "gift_card_full",
    // Tipin null kabul etmesi ŞART: `string` kalsa boş dizgi yazmak sessizce
    // çalışmayan bir bağlantı üretirdi.
    paymentUrl: null,
    cancellable: true,
    giftCardAmountKurus: 14_800,
  } satisfies PendingQuoteCheckout;
  const html = plain(
    inLocale(
      createElement(QuotePendingPaymentClient, { quoteNumber: "T-000124", pending: covered })
    )
  );
  assert.ok(
    !html.includes("/pay/QT-000124") && !html.includes("/havale/QT-000124"),
    "ödenecek nakdi olmayan taslak için ödeme sayfası bağlantısı çizildi"
  );
  assert.ok(
    !html.includes(tr["instantQuote.pendingPayment.continue"]),
    "ödemeye devam düğmesi çizildi"
  );
  assert.ok(
    !html.includes(tr["instantQuote.pendingPayment.card"]),
    "müşteriye kart ile ödeme beklediği söylendi"
  );
  assert.ok(
    html.includes(tr["instantQuote.checkout.giftCard.fullyCoveredPending"]),
    "tutarın tamamının karşılandığı söylenmiyor"
  );
  assert.ok(
    html.includes(tr["instantQuote.checkout.giftCard.fullyCoveredRetry"]),
    "siparişin oluşturulmakta olduğu söylenmiyor"
  );
  // Müşterinin TEK çıkışı iptaldir: rezervasyon duruyor, sipariş doğmadı.
  assert.ok(html.includes(tr["instantQuote.pendingPayment.cancel"]), "iptal kapısı kapandı");
  assert.ok(
    html.includes(
      fill(tr["instantQuote.checkout.giftCard.reservedPending"], { amount: money(14_800) })
    ),
    "rezerve edilen tutar yazılmıyor"
  );

  // Kart taslağı BUGÜNKÜ hâlinde kalır (değişiklik yalnız yeni dala ait).
  const card = plain(
    inLocale(
      createElement(QuotePendingPaymentClient, {
        quoteNumber: "T-000125",
        pending: {
          reference: "QT-000125",
          paymentMethod: "card",
          paymentUrl: "/pay/QT-000125",
          cancellable: true,
          giftCardAmountKurus: 0,
        } satisfies PendingQuoteCheckout,
      })
    )
  );
  assert.ok(card.includes("/pay/QT-000125"), "kart taslağının bağlantısı kayboldu");
  assert.ok(card.includes(tr["instantQuote.pendingPayment.continue"]));
  assert.ok(card.includes(tr["instantQuote.pendingPayment.card"]));
  assert.ok(
    !card.includes(tr["instantQuote.checkout.giftCard.fullyCoveredPending"]),
    "kart taslağına tam karşılama cümlesi sızdı"
  );
});

test("servisin iki müşteri cümlesi sözlükle BİREBİR aynı", () => {
  // Bu depoda hiçbir servis sözlük OKUMUYOR ve `quote-checkout.ts`in grafına
  // sözlük sokmak `server-only` tuzağına komşu (worker'lar aynı modülleri
  // import ediyor). Yani kopya KALIYOR; kayması ise imkânsız olmalı: kaynak,
  // sözlükteki cümleyi birebir taşımak zorunda.
  const source = fs
    .readFileSync(path.resolve("src/lib/services/quote-checkout.ts"), "utf8")
    // YORUMLAR ÖNCE DÜŞER: bu dosyanın yorumları cümlenin kendisini alıntılıyor
    // (ör. "AYNI cümle … yazılı"). Yorum sayılsaydı, canlı dizgi değişse bile
    // alıntı iddiayı yeşil tutar ve çivi hiçbir şey tutmaz hâle gelirdi.
    // Yalnız TAM SATIR `//` yorumları ve `/* */` blokları silinir: kod
    // içindeki bir dizgide geçen `//` (URL) böylece korunur.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    // `"…" +\n      "…"` → tek literal: satıra sığmayan cümleler kaynakta
    // bölünmüş yazılıyor, sözlükte ise tek parça duruyor.
    .replace(/"\s*\+\s*"/g, "");
  for (const key of [
    // `resolveGiftCardCode` bayrak kapısı (400 `gift_card_disabled`).
    "instantQuote.checkout.giftCard.disabled",
    // `promoteGiftCoveredDraft`ın `{autoConfirmed: false}` cümlesi.
    "instantQuote.checkout.giftCard.fullyCoveredRetry",
  ] as const) {
    // Anahtarın VARLIĞI ayrı iddia: eksik anahtarda `JSON.stringify(undefined)`
    // aramayı `"undefined"`a çevirirdi ve kaynakta o dizgi zaten var — iddia
    // sessizce hiçbir şeyi sınamaz hâle gelirdi.
    assert.ok(trKeys.includes(key), `${key} sözlükte yok`);
    assert.ok(
      source.includes(JSON.stringify(tr[key])),
      `quote-checkout.ts ile sözlük ayrıştı (${key}): aynı cümle iki yerde yazılı, ` +
        "İKİSİNİ BİRLİKTE değiştir"
    );
  }
});

test("tamamı karşılanan ödeme SİPARİŞE gider; dönemeyen taslak ekranda DURUR", () => {
  // Cevabın nereye götürdüğü saf bir karardır (tarayıcı yok): tam karşılanan
  // ödemede PayTR iframe'i de havale sayfası da YOKTUR ve tek doğru varış
  // siparişin kendisidir.
  assert.deepEqual(checkoutNavigation({ reference: "QT-1", iframeUrl: "https://paytr/x" }, "hata"), {
    kind: "external",
    url: "https://paytr/x",
  });
  assert.deepEqual(checkoutNavigation({ reference: "QT-1", redirectUrl: "/havale/QT-1" }, "hata"), {
    kind: "push",
    url: "/havale/QT-1",
  });
  assert.deepEqual(
    checkoutNavigation(
      { reference: "QT-1", paymentMethod: "gift_card_full", autoConfirmed: true, orderNumber: "QT-1" },
      "hata"
    ),
    { kind: "push", url: "/track/QT-1" }
  );

  // Bakiye düştü ama sipariş DOĞMADI: istek 200'dür (rezervasyon duruyor, bakım
  // turu yeniden deneyecek) ama müşteriyi olmayan bir siparişin takip sayfasına
  // yollamak, ona "siparişiniz yok" diyen bir 404 göstermek olurdu.
  assert.deepEqual(
    checkoutNavigation(
      { reference: "QT-1", autoConfirmed: false, error: "Sipariş kaydı tamamlanamadı." },
      "hata"
    ),
    { kind: "error", message: "Sipariş kaydı tamamlanamadı." }
  );
  // Gövde hiçbir dalı doldurmazsa taslak referansı son çaredir.
  assert.deepEqual(checkoutNavigation({ reference: "QT-1" }, "hata"), {
    kind: "push",
    url: "/track/QT-1",
  });
  assert.deepEqual(checkoutNavigation({}, "hata"), { kind: "error", message: "hata" });
});

test("kart yüzünden reddedilen ödeme ekrandaki ÖN İZLEMEYİ de düşürür", () => {
  // Kodun öneki sunucu sözleşmesidir (`quote-checkout.ts` · `giftCardRefusal`
  // → `gift_card_<sebep>`, bayrak kapalıyken `gift_card_disabled`). Önek
  // tutmazsa ekran "₺X karşılandı" yazmaya devam eder ve müşterinin gördüğü
  // rakam tahsil edilenden ayrışır.
  for (const code of [
    "gift_card_not_found",
    "gift_card_not_active",
    "gift_card_fully_used",
    "gift_card_expired",
    "gift_card_insufficient",
    "gift_card_limit_reached",
    "gift_card_disabled",
  ]) {
    assert.ok(isGiftCardRefusal(code), `${code} kart reddi sayılmadı`);
  }
  // Kartla ilgisi olmayan redler ön izlemeye DOKUNMAZ: müşteri tutarı
  // düzeltip aynı kartla tekrar denemeli.
  for (const code of ["version_mismatch", "paytr_failed", "pending_other_method", undefined]) {
    assert.equal(isGiftCardRefusal(code), false, `${code} yanlışlıkla kart reddi sayıldı`);
  }
});

// ─── Kontrollü alanlar, sözlük ve telefon yüksekliği (ertelenen borç D) ──────

test("dokunulmamış alan sunucudan gelen yeni değeri ALIR", () => {
  // React 19'un `defaultValue` davranışının kasıtlı eşdeğeri: alana hiç
  // dokunulmadıysa sunucunun yeni değeri ekrana geçer.
  const clean = syncedFieldState("eski not");
  assert.equal(syncedFieldValue(syncFromServer(clean, "yeni not")), "yeni not");
});

test("kullanıcı yazarken sunucudan gelen değer ÜZERİNE YAZMAZ", () => {
  // IQ-05'in gerçek zararı bu: iki sekmede açık bir teklifte diğer sekmenin
  // yazdığı değer, bu sekmede yazmakta olan müşterinin metnini siliyordu.
  const typing = editField(syncedFieldState("eski not"), "müşterinin yazd");
  assert.equal(
    syncedFieldValue(syncFromServer(typing, "diğer sekmenin notu")),
    "müşterinin yazd"
  );
});

test("gönderilen değer geri SEKMEZ, sonra gelen sunucu değişimi yine yansır", () => {
  // Yama uçtayken prop hâlâ ESKİ değeri taşır; alan o an "temiz" sayılsaydı
  // ekran bir an eski metne dönerdi (görünür bir geri sekme).
  const sent = commitField(editField(syncedFieldState("1"), "2"), "2");
  assert.equal(syncedFieldValue(syncFromServer(sent, "1")), "2", "yama uçarken geri sekti");

  // Yama indi: alan artık temiz, yani BAŞKA bir sekmenin değişimi yansır.
  const landed = syncFromServer(sent, "2");
  assert.equal(syncedFieldValue(landed), "2");
  assert.equal(syncedFieldValue(syncFromServer(landed, "3")), "3", "yamadan sonra eşitlenmiyor");
});

test("değişmeyen değeri göndermek alanı kirli BIRAKMAZ", () => {
  // Blur'da değer aynıysa yama hiç çıkmaz; alan yine de temize dönmeli, yoksa
  // bir daha hiçbir sunucu değişimini almaz.
  const same = commitField(editField(syncedFieldState("PO-1"), "PO-1"), "PO-1");
  assert.equal(syncedFieldValue(syncFromServer(same, "PO-2")), "PO-2");
});

test("teklif ekranındaki metin alanları kontrolsüz defaultValue kullanmıyor", () => {
  // Altı alan (parça adı, ölçek, parça notu, teklif başlığı, müşteri notu, PO)
  // kontrollü hâle getirildi; yeni bir `defaultValue` aynı tuzağı geri getirir.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.resolve(dir), { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx")) files.push(full);
    }
  };
  walk("src/components/quote");
  walk("src/app/teklif");
  assert.ok(files.length > 15, `taranan dosya sayısı şüpheli: ${files.length}`);
  for (const file of files) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.ok(!source.includes("defaultValue"), `${file} kontrolsüz defaultValue taşıyor`);
  }
});

test("parça kütüphanesi ve mesafeli satış özeti metinlerini SÖZLÜKTEN alır", () => {
  const html = plain(
    inLocale(
      createElement(PartLibraryGrid, { items: [LIBRARY_ROW], selected: [], onToggle: noop })
    )
  );
  for (const key of [
    "instantQuote.account.parts.dimensionsLabel",
    "instantQuote.account.parts.volumeLabel",
    "instantQuote.account.parts.lastMaterial",
    "instantQuote.account.parts.addedAt",
    "instantQuote.account.parts.loadMore",
  ] as const) {
    assert.ok(trKeys.includes(key), `${key} sözlükte yok`);
    assert.ok(enKeys.includes(key), `${key} İngilizce sözlükte yok`);
  }
  assert.ok(
    html.includes(tr["instantQuote.account.parts.lastMaterial"]),
    "son malzeme etiketi sözlükten gelmiyor"
  );

  // Mesafeli satış sözleşmesi özetindeki ürün adı da sözlükten gelir.
  assert.ok(trKeys.includes("instantQuote.checkout.contractProduct"));
  assert.match(tr["instantQuote.checkout.contractProduct"], /\{number\}/);
  assert.match(tr["instantQuote.checkout.contractProduct"], /\{parts\}/);

  // Bu iki dosyada sözlük dışında Türkçe metin KALMADI.
  for (const file of [
    "src/app/account/parcalar/parts-client.tsx",
    "src/components/quote/quote-checkout-form.tsx",
  ]) {
    const code = fs
      .readFileSync(path.resolve(file), "utf8")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /[çğışöüÇĞİŞÖÜ]/, `${file} sözlük dışında Türkçe metin taşıyor`);
  }
});

test("toplu işlem çubuğu telefonda tek satırlık eylem şeridi taşır", () => {
  // IQ-14: çubuk 390×844 görünümde ekranın %40'ına yakınını kaplıyordu (gerçek
  // ölçüm raporda). Yüksekliği üreten mekanizma tekti: sayaç, beş alan ve üç
  // düğme AYNI `flex-wrap` sırasında sarmalanıyordu. Artık eylemler tek satır,
  // alan dizisi sarmalamaz — yatay kayar.
  const source = fs
    .readFileSync(path.resolve("src/components/quote/bulk-bar.tsx"), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /flex-wrap/, "çubuk hâlâ sarmalıyor");
  assert.match(source, /overflow-x-auto/, "alan dizisi kaymıyor, sarmalıyor");

  // Telefonda simgeye inen düğmeler adlarını KAYBETMEZ.
  const html = inLocale(
    createElement(QuoteBulkBar, {
      selectedIds: ["p1", "p2"],
      catalog: catalogFixture,
      onApply: noop,
      onDelete: noop,
      onClear: noop,
    })
  );
  for (const key of [
    "instantQuote.bulk.apply",
    "instantQuote.bulk.delete",
    "instantQuote.bulk.clear",
  ] as const) {
    assert.ok(html.includes(tr[key]), `${tr[key]} düğmesinin adı kayboldu`);
  }
});
