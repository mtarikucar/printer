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
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LocaleProvider } from "../src/lib/i18n/locale-context";
import { PriceGateModal } from "../src/components/quote/price-gate-modal";
import { QuotePartCard } from "../src/components/quote/part-card";
import { QuoteBulkBar } from "../src/components/quote/bulk-bar";
import { dfmMessage } from "../src/components/quote/dfm-list";
import { validateQuoteFiles } from "../src/components/quote/dropzone";
import { QuoteBanners } from "../src/components/quote/quote-banners";
import { QuoteChatPanel } from "../src/components/quote/quote-chat-panel";
import {
  QuoteSummary,
  displayedTotalKurus,
  readKdvExcludedPref,
  writeKdvExcludedPref,
} from "../src/components/quote/quote-summary";
import { QuoteReviewDialog, parseMoneyInput } from "../src/components/quote/review-request-dialog";
import { QuoteShareDialog } from "../src/components/quote/share-dialog";
import { QuoteDocument } from "../src/app/teklif/[number]/belge/quote-document";
import { QuoteDocumentPrintButton } from "../src/app/teklif/[number]/belge/print-button";
import {
  QuoteWorkspaceClient,
  createResponseOrder,
  groupPartsByTechnology,
  isOwnershipConflict,
} from "../src/app/teklif/[number]/workspace-client";
import { QuoteApiError } from "../src/lib/quote/client-api";
import en from "../src/lib/i18n/dictionaries/en";
import tr from "../src/lib/i18n/dictionaries/tr";
import {
  DFM_CODES,
  QUOTE_STATUSES,
  type PresentedCatalog,
  type PresentedPart,
  type PresentedQuote,
  type QuoteTotals,
  type QuoteViewer,
} from "../src/lib/config/quote-types";
import { EVENTS, isEventName } from "../src/lib/analytics/events";
import { isNoindexPath } from "../src/lib/seo/policy";
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
  const file = (name: string, size: number) =>
    ({ name, size }) as unknown as File;
  const { accepted, errors } = validateQuoteFiles(
    [
      file("govde.stl", 1_000),
      file("cizim.step", 1_000),
      file("dev.obj", 200 * 1024 * 1024),
      file("kapak.3mf", 2_000),
      file("taban.stl", 3_000),
    ],
    { maxFileBytes: 100 * 1024 * 1024, maxParts: 2, currentCount: 0, d: tr }
  );
  assert.deepEqual(
    accepted.map((f) => f.name),
    ["govde.stl", "kapak.3mf"]
  );
  assert.deepEqual(errors, [
    "cizim.step: yalnız STL, OBJ ve 3MF dosyaları yüklenebilir.",
    "dev.obj: dosya 100 MB sınırını aşıyor.",
    "Bir teklifte en fazla 2 parça olabilir.",
  ]);
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
  const html = renderDocument(pricedQuote());
  assert.match(html, /148,00/, "toplam yok");
  assert.match(html, /120,00/, "KDV hariç tutar yok");
  assert.match(html, /28,00/, "KDV tutarı yok");
  assert.match(html, /KDV dahil/);
  assert.match(html, /Proforma \/ Havale bilgileri/);
  assert.match(html, /TR33 0006 1005 1978 6457 8413 26/);
  assert.match(html, /Ziraat Bankası/);
  // Havale açıklaması teklif numarasıdır: müşteri parayı yollarken bunu yazar.
  assert.match(html, /Açıklama/);
});

test("belge fiyat kapısını aynen uygular ve imzalı model adresi taşımaz", () => {
  const html = renderDocument(quoteFixture());
  assert.doesNotMatch(html, /₺\s?\d/, "kapının arkasından belgeye rakam sızdı");
  assert.match(html, /Fiyatları görmek için giriş yapın/);
  // Belge paylaşılan bir çıktıdır: imzalı GLB / kaynak adresi ASLA girmez.
  assert.doesNotMatch(html, /\.glb/);
});

test("belgenin yazdırma düğmesi çıktıya girmez", () => {
  const html = inLocale(createElement(QuoteDocumentPrintButton, {}));
  assert.match(html, /no-print/, "yazdır düğmesi çıktıdan gizlenmemiş");
  assert.match(html, /Yazdır \/ PDF/);
});
