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
// İLK import olmak ZORUNDA: CSS modülü import eden bileşenleri (örn. /figur
// kahramanı) `tsx` altında render edilebilir yapar. Gerekçe stub'ın başlığında.
import "./support/stub-css-modules";
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
import {
  acceptedAccept,
  acceptedExtensions,
  formatNames,
  megabytes,
  uploadCodeMessage,
  validateQuoteFiles,
} from "../src/components/quote/dropzone";
import { OrderChat } from "../src/components/order-chat";
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
  LANDING_FAQ_TITLE,
  LANDING_STEPS_TITLE,
  MaterialLibrary,
  PrintServiceLanding,
  landingFaq,
  landingSteps,
} from "../src/app/3d-baski/sections";
import { LandingUploader } from "../src/app/3d-baski/landing-uploader";
import {
  anchorSentence,
  catalogAnchorKurus,
  formatAnchorPrice,
  materialAnchorKurus,
  minOrderSentence,
  technologyAnchorKurus,
} from "../src/app/3d-baski/pricing-anchors";
import { QuoteListTable } from "../src/app/account/teklifler/quotes-client";
import {
  TeamClient,
  type TeamMemberView,
  type TeamProfileView,
} from "../src/app/account/takim/team-client";
import { QuoteTeamBadge } from "../src/components/quote/team-badge";
import { TEAM_ROLES, type TeamRole } from "../src/lib/config/quote-team";
import { PartLibraryGrid } from "../src/app/account/parcalar/parts-client";
import {
  displayRate,
  fill,
  money as fxMoney,
  parseDisplayCurrency,
  rateText,
} from "../src/components/quote/format";
import {
  DISPLAY_CURRENCY_PREF_KEY,
  DisplayCurrencyPicker,
  displayCurrencySnapshot,
  readDisplayCurrencyPref,
  setDisplayCurrency,
  writeDisplayCurrencyPref,
} from "../src/components/quote/display-currency";
import { QuoteHeader } from "../src/components/quote/quote-header";
import { FrameworkSummary } from "../src/components/framework/framework-summary";
import { FrameworkClient } from "../src/app/cerceve/[number]/client";
import { FrameworkDocument } from "../src/app/cerceve/[number]/belge/framework-document";
import {
  FRAMEWORK_TERMS_VERSION,
  frameworkProgressBuckets,
} from "../src/lib/config/quote-framework";
import { FIGURINE_PRICE_KURUS, KDV_RATE_BPS } from "../src/lib/config/prices";
import { computeKdv } from "../src/lib/services/finance";
import type { FrameworkDetail } from "../src/lib/services/quote-framework";
import { presentFramework } from "../src/lib/services/quote-framework-present";
import {
  frameworkNotice,
  planRows,
  progressSegments,
  toQuantity,
  type FrameworkActionKey,
} from "../src/app/admin/cerceve/[id]/framework-values";
import { MAX_AMOUNT_KURUS } from "../src/lib/config/prices";
import { formatCurrency, formatDateLong } from "../src/lib/i18n/format";
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
  type DisplayCurrency,
  type FrozenFxRate,
  type FrozenQuotePart,
  type LibraryPart,
  type PresentedFxDisplay,
  type PresentedCatalog,
  type PresentedPart,
  type PresentedQuote,
  type PricingSnapshot,
  type QuoteFxSnapshot,
  type QuoteSourceFormat,
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
// V1 — alıntılanabilir rakamların yayımlandığı yüzeyler.
import { CreateFactsBand } from "../src/components/create/product-facts";
import { createUrlSellsFixedPriceFigure } from "../src/lib/create/design-templates";
import { FigurunicaLanding } from "../src/components/figurunica/landing";
import { FIGURUNICA_KEYS, pickFigurunicaDict } from "../src/components/figurunica/dict";
import { StorefrontHome } from "../src/components/marketplace/storefront";
import { LastUpdated } from "../src/components/last-updated";
import { PAGE_UPDATED_AT, pageUpdatedAt } from "../src/lib/config/page-updated";
import {
  FIGURINE_HEIGHT_LABEL,
  FIGURINE_LEAD_DAYS,
  FIGURINE_PRICE_LABEL,
  figurinePriceLabel,
  layerHeightLabel,
  withProductFacts,
} from "../src/lib/config/product-facts";
// V2 — aynı rakamların MAKİNE OKUNUR hâli (yapısal veri).
import { buildFigurineProductJsonLd } from "../src/lib/seo/figurine";
import { buildFaqPageJsonLd } from "../src/lib/seo/faq";
import { buildHowToJsonLd } from "../src/lib/seo/howto";
import { figurineFaqItems } from "../src/components/figurunica/faq-items";
import {
  HOW_IT_WORKS_STEPS,
  HowItWorksSteps,
  stepBodyText,
} from "../src/app/nasil-calisir/steps";

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
    "upload.formatListAnd": ["{rest}", "{last}"],
    "upload.formatListOr": ["{rest}", "{last}"],
    "upload.hint": ["{formats}", "{maxMb}"],
    "upload.invalidFormat": ["{file}", "{formats}"],
    "upload.stepInvalid": ["{file}"],
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

/**
 * `/takim` YENİ bir KÖK önektir (0072) ve davet sayfası TEK KULLANIMLIK bir
 * token taşıyor: `/takim/davet/<token>`. Şekli `/atolye/katil/<token>` ile
 * birebir aynı — herkese açık bir karşılama sayfası, adresinde bir sır.
 *
 * `/account/takim` zaten `/account` önekiyle kapanıyor, AMA davet sayfası
 * kapanMIYORDU: önek `NOINDEX_PREFIXES`te yoktu ve `robots.ts` disallow
 * listesinde de yoktu, yani sayfa yazıldığı an indekslenebilir olarak canlıya
 * çıkardı. Hiçbir mevcut test bunu zorlamıyordu (`scripts/test-robots.ts`
 * disallow listesinin yalnız beş sabit önekini pinliyor), bu yüzden iddia
 * BURADA duruyor: bu dosya `isNoindexPath`i ve `robots`u zaten import ediyor.
 *
 * MUTASYON SINAVI: `NOINDEX_PREFIXES`ten `"/takim"`i çıkar → ilk iki iddia
 * KIRMIZI; `robots.ts`in `DISALLOW` listesinden `"/takim/"`i çıkar → son iddia
 * KIRMIZI.
 */
test("takım davet sayfası noindex VE taranamaz (token'lı adres aramaya düşmez)", () => {
  assert.ok(isNoindexPath("/takim"), "/takim öneki noindex listesinde yok");
  assert.ok(
    isNoindexPath("/takim/davet/abc123"),
    "token'lı davet adresi noindex almıyor"
  );
  assert.ok(isNoindexPath("/account/takim"), "/account/takim noindex almıyor");
  // Karşı vaka: pazarlama sayfası yanlışlıkla kapatılmadı.
  assert.ok(!isNoindexPath("/3d-baski"));

  // robots.txt: hem `*` hem RETRIEVAL kuralı aynı listeyi paylaşıyor, yani
  // ikisini de ölçmek listenin paylaşıldığını da doğrular.
  const rules = robots().rules;
  const list = Array.isArray(rules) ? rules : [rules];
  const closing = list.filter((r) => r.allow !== undefined);
  assert.ok(closing.length >= 2, "beklenen iki tarama kuralı yok");
  for (const rule of closing) {
    const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow ?? ""];
    assert.ok(
      disallow.includes("/takim/"),
      `${String(rule.userAgent)}: /takim/ engellenmemiş`
    );
  }
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
  isTeam: false,
  teamRole: null,
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

function renderPartCard(
  part: PresentedPart,
  quote: PresentedQuote,
  rate: FrozenFxRate | null = null
): string {
  return inLocale(
    createElement(QuotePartCard, {
      part,
      catalog: quote.catalog,
      viewer: quote.viewer,
      rate,
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
        isTeam: false,
        teamRole: null,
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
    // Bayrak KAPALI olduğu için cümle STEP'i ANMAZ: reddettiğimiz biçimi
    // kabul ediyoruz demek olurdu (liste `acceptedFormats`ten türer).
    "cizim.step: yalnız STL, OBJ ve 3MF dosyaları yüklenebilir.",
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
  // Tek biçim, İKİ uzantı: `.stp` de aynı ISO 10303 dosyasıdır ve uçtaki kapı
  // da öyle okuyor (`quote-model-validation.ts`).
  assert.deepEqual(acceptedExtensions(["step"]), ["step", "stp"]);

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
    // Cümledeki liste KABUL EDİLEN listedir: bayrak kapalıyken reddin içinde
    // STEP anılmaz (aşağıdaki cümle testi bunu birebir yazıyor).
    fill(tr["instantQuote.upload.invalidFormat"], {
      file: "govde.step",
      formats: "STL, OBJ ve 3MF",
    }),
    fill(tr["instantQuote.upload.invalidFormat"], {
      file: "kapak.STP",
      formats: "STL, OBJ ve 3MF",
    }),
  ]);

  const open = validateQuoteFiles(files, { ...opts, acceptedFormats: ALL_FORMATS });
  assert.deepEqual(
    open.accepted.map((f) => f.name),
    ["govde.step", "kapak.STP"],
    "iki uzantı TEK biçimdir: .stp de kabul edilmeli"
  );
  assert.deepEqual(open.errors, []);
});

test("müşteri cümlesi biçim listesini BAYRAKTAN okur: kapalıyken STEP'i anmaz", () => {
  // Sabit bir cümle ("yalnız STL, OBJ, 3MF ve STEP…") bayrak kapalıyken
  // müşteriye, tam da reddettiğimiz biçimi kabul ettiğimizi söylerdi ve bu hâl
  // GEÇİCİ değil: `quote_step_enabled` varsayılan olarak kapalı
  // (`FLAG_DEFAULTS`). Liste bu yüzden `acceptedFormats`ten türer.
  assert.equal(formatNames(MESH_FORMATS, tr["instantQuote.upload.formatListAnd"]), "STL, OBJ ve 3MF");
  assert.equal(
    formatNames(ALL_FORMATS, tr["instantQuote.upload.formatListAnd"]),
    "STL, OBJ, 3MF ve STEP"
  );
  assert.equal(formatNames(ALL_FORMATS, en["instantQuote.upload.formatListOr"]), "STL, OBJ, 3MF or STEP");
  // Tek biçimli liste bağlaç istemez (kalıp hiç kullanılmaz).
  assert.equal(formatNames(["stl"], tr["instantQuote.upload.formatListAnd"]), "STL");

  const reject = (formats: QuoteSourceFormat[]) =>
    validateQuoteFiles([fakeFile("govde.igs", 1_000)], {
      maxFileBytes: 100 * 1024 * 1024,
      maxParts: 5,
      currentCount: 0,
      acceptedFormats: formats,
      d: tr,
    }).errors;
  assert.deepEqual(reject(MESH_FORMATS), [
    "govde.igs: yalnız STL, OBJ ve 3MF dosyaları yüklenebilir.",
  ]);
  // Bayrak AÇIKKEN cümle tasarım §6'nın birebir yazdığı hâle varır.
  assert.deepEqual(reject(ALL_FORMATS), [
    "govde.igs: yalnız STL, OBJ, 3MF ve STEP dosyaları yüklenebilir.",
  ]);

  // Ve aynı kural bırakma alanının altındaki İPUCU cümlesi için de geçerli:
  // GERÇEK markup üzerinden, iki çağrı yerinde de.
  const hint = (formats: QuoteSourceFormat[]) =>
    fill(tr["instantQuote.upload.hint"], {
      formats: formatNames(formats, tr["instantQuote.upload.formatListOr"]),
      maxMb: megabytes(catalogFixture.maxFileBytes),
    });
  assert.equal(hint(MESH_FORMATS), "STL, OBJ veya 3MF · en fazla 100 MB");
  assert.equal(hint(ALL_FORMATS), "STL, OBJ, 3MF veya STEP · en fazla 100 MB");

  const closedWorkspace = renderWorkspace(quoteFixture());
  assert.ok(closedWorkspace.includes(hint(MESH_FORMATS)), "çalışma alanı ipucusu listeden türemiyor");
  assert.ok(
    !closedWorkspace.includes("STEP"),
    "bayrak kapalıyken çalışma alanı STEP'ten söz ediyor"
  );
  const openWorkspace = renderWorkspace(
    quoteFixture({ catalog: { ...catalogFixture, acceptedFormats: ALL_FORMATS } })
  );
  assert.ok(openWorkspace.includes(hint(ALL_FORMATS)), "bayrak açıkken ipucu STEP'i anmıyor");

  const landing = (formats: QuoteSourceFormat[]) =>
    inLocale(
      createElement(LandingUploader, {
        maxFileBytes: catalogFixture.maxFileBytes,
        maxPartsPerQuote: catalogFixture.maxPartsPerQuote,
        acceptedFormats: formats,
      })
    );
  assert.ok(landing(MESH_FORMATS).includes(hint(MESH_FORMATS)));
  assert.ok(!landing(MESH_FORMATS).includes("STEP"), "açılış yükleyicisi kapalıyken STEP diyor");
  assert.ok(landing(ALL_FORMATS).includes(hint(ALL_FORMATS)));
});

test("uçtaki STEP reddi sözlükteki cümleye çevrilir (stepInvalid)", () => {
  // İstemci ISO 10303 kabuğunu OKUYAMAZ (dosya uca gitmeden bilinmez), o
  // yüzden cümlenin tetiği bir SUNUCU kodudur; ama cümle müşteriye ne
  // yapacağını söylediği için sözlükte durur ve iki yükleme yeri de onu
  // aynı yerden okur.
  assert.equal(
    uploadCodeMessage("step_not_iso", "govde.step", tr),
    "govde.step: geçerli bir STEP dosyası değil (ISO 10303 başlığı yok). CAD programınızdan AP203/AP214 olarak yeniden dışa aktarın."
  );
  assert.match(uploadCodeMessage("step_not_iso", "a.stp", en) ?? "", /AP203\/AP214/);
  // Eşlenmeyen kod ucun KENDİ cümlesine bırakılır (tablo kod kümesini
  // çoğaltmaz): `null` "ucun cümlesini göster" demek.
  assert.equal(uploadCodeMessage("step_no_data", "govde.step", tr), null);
  assert.equal(uploadCodeMessage(null, "govde.step", tr), null);

  // Kodun kendisi uçtan gelir: adı değişirse bu eşleme sessizce ölür.
  const server = fs.readFileSync(
    path.resolve("src/lib/services/quote-model-validation.ts"),
    "utf8"
  );
  assert.match(server, /fail\("step_not_iso"\)/);

  // Ve iki yükleme yeri de eşlemeyi ÇAĞIRIYOR (cümle ölü anahtar değil).
  for (const file of [
    "src/app/teklif/[number]/workspace-client.tsx",
    "src/app/3d-baski/landing-uploader.tsx",
  ]) {
    assert.match(
      fs.readFileSync(path.resolve(file), "utf8"),
      /uploadCodeMessage\(e\.code, file\.name, d\)/,
      `${file}: uçtan gelen kod sözlüğe çevrilmiyor`
    );
  }
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

function renderSummary(quote: PresentedQuote, currency: DisplayCurrency = "TRY"): string {
  return inLocale(
    createElement(QuoteSummary, {
      quote,
      currency,
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
          isTeam: false,
          teamRole: null,
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
      viewer: {
        canSeePrices: true,
        canEdit: false,
        isOwner: false,
        isShare: true,
        isAdmin: false,
        isTeam: false,
        teamRole: null,
      },
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

// ─── T-4 · TAKIM: 22 kapının EKRAN tarafı ──────────────────────────────────
//
// Bu blok dört ekran yüzeyini birlikte ölçüyor, çünkü ikisi tek başına
// düzeltildiğinde ÖTEKİNİ YALANLIYOR: özet kartındaki ödeme düğmesi
// (`quote-summary.tsx`) ile hemen altındaki "ödeyemezsin" cümlesi, ve sohbet
// PANELİ (`quote-chat-panel.tsx`) ile içindeki YAZMA alanı.
//
// Takım görünümleri `PresentedQuote.team` üzerinden kurulur: istemci
// `access.team`i GÖREMEZ (sunucu nesnesi), gövdeye giren şey ad + rol + ödeme
// anahtarıdır (T-2).
function teamViewer(
  teamRole: "owner" | "admin" | "member" | "viewer",
  over: Partial<QuoteViewer> = {}
): QuoteViewer {
  return {
    canSeePrices: true,
    canEdit: teamRole !== "viewer",
    isOwner: false,
    isShare: false,
    isAdmin: false,
    isTeam: true,
    teamRole,
    ...over,
  };
}
function teamQuote(
  teamRole: "owner" | "admin" | "member" | "viewer",
  memberCanCheckout: boolean,
  over: Partial<PresentedQuote> = {}
): PresentedQuote {
  return pricedQuote({
    viewer: teamViewer(teamRole),
    team: { name: "QA Mühendislik A.Ş.", role: teamRole, memberCanCheckout },
    readiness: { canCheckout: true, blockers: [] },
    ...over,
  });
}
const chatPanel = (quote: PresentedQuote) => inLocale(createElement(QuoteChatPanel, { quote }));
const CHECKOUT_LINK = /href="\/teklif\/T-000123\/odeme"/;
const DOCUMENT_LINK = /href="\/teklif\/T-000123\/belge"/;
/**
 * Sohbetin YAZMA alanı `<OrderChat canSend>` ile açılır/kapanır ve panel onu
 * MODAL'ın içinde çiziyor: kapalı modal hiçbir şey render etmediği için
 * (`modal-shell.tsx` · `if (!open) return null`) sunucu anlık görüntüsünde
 * alanın kendisi GÖRÜNMEZ. İddia o yüzden iki parçalı — ortak bileşenin
 * `canSend` davranışı ÖLÇÜLÜR, panelin o değeri hangi yüklemden aldığı
 * KAYNAKTAN okunur (aynı kalıp: "KDV hariç görünüm" vakası).
 */
const chatPanelSource = fs.readFileSync(
  path.resolve("src/components/quote/quote-chat-panel.tsx"),
  "utf8"
);

test("TAKIMSIZ teklifte dört yüzey de bugünkü hâlinde çizilir (denklik)", () => {
  // `team` ANAHTARI YOK (takımsız gövdede sunucu onu hiç yazmıyor) + kişisel
  // sahip: ödeme bağlantısı, sohbet düğmesi + yazma alanı, belge bağlantısı ve
  // "yeniden teklif" bantları bugünküyle aynı. Denkliğin GERÇEK kanıtı bu
  // dosyadaki DEĞİŞMEMİŞ onlarca iddianın yeşil kalmasıdır; bu vaka dördünü
  // tek yerde, tek bakışta okunur hâlde tutuyor.
  const quote = pricedQuote({ readiness: { canCheckout: true, blockers: [] } });
  assert.equal("team" in quote, false, "takımsız fikstüre `team` anahtarı girmiş");
  const summary = plain(renderSummary(quote));
  assert.match(summary, CHECKOUT_LINK, "sahibin ödeme bağlantısı kaybolmuş");
  assert.ok(
    !summary.includes(tr["instantQuote.summary.ownerOnlyCheckout"]),
    "sahibe 'ödeyemezsin' cümlesi basılmış"
  );
  assert.match(chatPanel(quote), /Teklif sohbeti/);
  assert.match(renderHeader(quote), DOCUMENT_LINK, "sahibin belge bağlantısı gitmiş");
  assert.match(
    renderBanners(pricedQuote({ status: "ordered", orderNumber: "FIG-1" })),
    /Yeniden teklif al/,
    "sahibin 'yeniden teklif' düğmesi gitmiş"
  );
});

test("takımın `viewer` rolü: ödeme YOK, yazma alanı YOK, panel VAR, belge VAR", () => {
  const quote = teamQuote("viewer", true);
  const summary = plain(renderSummary(quote));
  assert.doesNotMatch(summary, CHECKOUT_LINK, "salt okunur role ödeme bağlantısı verilmiş");
  assert.match(summary, /disabled/, "salt okunur rolde ödeme düğmesi açık kalmış");
  // PANEL VAR: üye yazışmayı OKUR (uç da GET'te 200 diyor).
  assert.match(chatPanel(quote), /Teklif sohbeti/, "üyeye sohbet paneli hiç açılmamış");
  assert.match(renderHeader(quote), DOCUMENT_LINK, "üye belgeye ULAŞAMIYOR");
  assert.ok(
    !renderBanners(teamQuote("viewer", true, { status: "ordered", orderNumber: "FIG-1" })).includes(
      "Yeniden teklif al"
    ),
    "salt okunur role yeniden teklif düğmesi verilmiş"
  );
});

test("takım admini `member_can_checkout` KAPALI olsa da ödeyebilir — ve cümle YAZILMAZ", () => {
  // #20 ile #21 BİRLİKTE: düğmeyi açıp cümleyi bırakmak, ödeyebilen admine
  // "bu teklifi yalnız sahibi ödeyebilir" yazmak olurdu.
  const html = plain(renderSummary(teamQuote("admin", false)));
  assert.match(html, CHECKOUT_LINK, "admin üye ödeyemiyor");
  assert.ok(
    !html.includes(tr["instantQuote.summary.ownerOnlyCheckout"]),
    "ödeyebilen üyeye 'ödeyemezsin' cümlesi basılmış"
  );
});

test("`member_can_checkout` kapalı iken `member` rolü: düğme YOK, sebep VAR", () => {
  const closed = plain(renderSummary(teamQuote("member", false)));
  assert.doesNotMatch(closed, CHECKOUT_LINK);
  // CÜMLE TAKIM ÜYESİNE ÖZGÜ (T-5): T-4 bu satırın koşulunu
  // `canCheckoutQuote`a çevirdiğinde cümle ödeme yetkisi olmayan ÜYEYE de
  // gösterilmeye başladı — ona "ödemeyi teklif SAHİBİ yapar" demek yanlıştı.
  assert.ok(
    closed.includes(tr["instantQuote.team.quote.noCheckoutPermission"]),
    "kapalı düğmenin sebebi yazılmamış"
  );
  assert.ok(
    !closed.includes(tr["instantQuote.summary.ownerOnlyCheckout"]),
    "takım üyesine 'sahip öder' cümlesi basılmış"
  );
  // Ayar AÇIKKEN aynı rol ödeyebilir ve cümle düşer: tek ayarın iki yüzeyi.
  const open = plain(renderSummary(teamQuote("member", true)));
  assert.match(open, CHECKOUT_LINK, "ayar açıkken member ödeyemiyor");
  assert.ok(!open.includes(tr["instantQuote.team.quote.noCheckoutPermission"]));
  assert.ok(!open.includes(tr["instantQuote.summary.ownerOnlyCheckout"]));
});

/**
 * CÜMLE AYRIMININ KARŞI YARISI: TAKIMSIZ izleyici bugünkü cümleyi okur.
 *
 * Koşul tek (`!canCheckoutQuote`), anahtar iki. Tek anahtarı genelleştirmek
 * kişisel teklifteki cümleyi de değiştirirdi — ve o cümleye bakan iddialar bu
 * dosyada zaten var.
 */
test("takımsız izleyicinin kapalı ödeme düğmesinin sebebi DEĞİŞMEDİ", () => {
  // Paylaşım izleyicisi: fiyatı görür (girişli), ödeyemez, takımı yok.
  const shared = plain(
    renderSummary(
      pricedQuote({
        viewer: {
          canSeePrices: true,
          canEdit: false,
          isOwner: false,
          isShare: true,
          isAdmin: false,
          isTeam: false,
          teamRole: null,
        },
        readiness: { canCheckout: true, blockers: [] },
      })
    )
  );
  assert.doesNotMatch(shared, CHECKOUT_LINK);
  assert.ok(
    shared.includes(tr["instantQuote.summary.ownerOnlyCheckout"]),
    "takımsız izleyicinin cümlesi değişmiş"
  );
  assert.ok(!shared.includes(tr["instantQuote.team.quote.noCheckoutPermission"]));
});

test("sohbet YAZMA alanı `canChatOnQuote`a bağlı: panel açılır, yazma kapanır", () => {
  // 1) Ortak bileşenin davranışı: `canSend` kapalıyken ne metin alanı ne
  //    gönder düğmesi çizilir (kapalı hâlin kendi cümlesi var).
  const chat = (canSend: boolean) =>
    inLocale(createElement(OrderChat, { basePath: "/api/quotes/x/messages", canSend }));
  assert.match(chat(true), new RegExp(tr["chat.send"]), "açık sohbette gönder düğmesi yok");
  assert.match(chat(true), /<textarea/);
  assert.ok(!chat(false).includes(tr["chat.send"]), "kapalı sohbette gönder düğmesi var");
  assert.doesNotMatch(chat(false), /<textarea/, "kapalı sohbette metin alanı var");
  // 2) Panelin o değeri hangi yüklemden aldığı: PANEL `canSeeOwnerFields`,
  //    YAZMA alanı `canChatOnQuote`. İkisi aynı yükleme bağlanırsa üye ya
  //    paneli hiç görmez ya takımın adına yazar.
  assert.match(
    chatPanelSource,
    /if \(!canSeeOwnerFields\(quote\.viewer\)\) return null/,
    "panel kapısı `canSeeOwnerFields` değil"
  );
  assert.match(
    chatPanelSource,
    /canSend=\{canChatOnQuote\(quote\.viewer\)\}/,
    "yazma alanı `canChatOnQuote`a bağlı değil"
  );
});

test("takım üyesi `requote`yi görür: düzenleyebilen üç rol, salt okunur rol değil", () => {
  for (const role of ["owner", "admin", "member"] as const) {
    assert.match(
      renderBanners(teamQuote(role, false, { status: "ordered", orderNumber: "FIG-1" })),
      /Yeniden teklif al/,
      `${role} rolü yeniden teklif alamıyor`
    );
  }
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
          isTeam: false,
          teamRole: null,
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

function renderDocument(quote: PresentedQuote, currency: DisplayCurrency = "TRY"): string {
  return inLocale(createElement(QuoteDocument, { quote, bank: BANK_FIXTURE, currency }));
}

function renderHeader(
  quote: PresentedQuote,
  currency: DisplayCurrency = "TRY",
  shareToken: string | null = null
): string {
  return inLocale(createElement(QuoteHeader, { quote, currency, shareToken, onPatch: noop }));
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

test("açılış metni, YÜKLEYİCİNİN kabul etmediği bir biçimi VAAT ETMEZ", () => {
  // Bu nöbetçi bir yanlışın bedelinden doğdu: STEP fazı bütün olarak yayına
  // çıktığında tanıtım metni canlıya "Evet, .step ve .stp dosyaları doğrudan
  // yüklenir" diye gitti, oysa `quote_step_enabled` kapalıydı ve yükleyici
  // dosyayı REDDEDİYORDU. Müşteriye vaat edilen şeyin uçta çalışması gerekir.
  //
  // Sebebi yapısal: bu üç yüzey (adım kartı, SSS, hero + `metadata` +
  // Service JSON-LD) bayrak OKUMUYOR — `landingFaq` ve `PrintServiceLanding`
  // yalnız katalog anlık görüntüsünü alıyor, `metadata` üretimi de öyle. Oysa
  // YÜKLEYİCİNİN biçim listesi bayraktan geliyor (`quoteAcceptedFormats`,
  // src/app/3d-baski/page.tsx). İki taraf ayrı kaynaktan beslendiği sürece
  // metin susmak zorunda.
  //
  // BAYRAĞI AÇAN KİŞİYE: bu iddiayı silmek yerine metni bayrağa bağla
  // (`landingFaq`/`PrintServiceLanding`/`metadata`/`seo/service.ts` kabul
  // listesini argüman olarak alsın), sonra bu testi "liste neyi diyorsa metin
  // onu der" hâline çevir. Kayıt defteri B3 maddesi.
  // STEP'i KAYNAK biçim olarak anmak serbesttir ve doğrudur ("STEP dosyamı
  // nasıl dışa aktarırım?" → "STL olarak kaydedin"). Yasak olan şey onu
  // YÜKLENEBİLİR biçim olarak sunmak; nöbetçi tam o üç kalıbı arar.
  const html = renderLanding();
  const promises = [
    { pattern: /\.ste?p\b/i, what: "uzantı (.step/.stp) — yüklenebilirlik vaadi" },
    { pattern: /(?:STL|OBJ|3MF)[^.]{0,40}\bSTEP\b/i, what: "kabul edilen biçim listesinde STEP" },
    { pattern: /STEP[^.]{0,40}doğrudan yüklen/i, what: '"STEP doğrudan yüklenir" cümlesi' },
  ];
  for (const { pattern, what } of promises) {
    assert.ok(
      !pattern.test(html),
      `tanıtım metni STEP'i yüklenebilir gösteriyor (${what}) ama metin bayrak OKUMUYOR: ` +
        "bayrak kapalıyken yükleyici o dosyayı reddeder ve vaat yalan olur"
    );
  }
});

test("bayrak kapalıyken yükleyici yok ama SEO yüzeyi duruyor", () => {
  const html = renderLanding(createElement(ComingSoonNote));
  assert.match(html, /Yakında/);
  assert.doesNotMatch(html, /type="file"/, "kapalı bayrakta dosya girişi çizildi");
  // Katalog rakamları kalır: bayrak, arama motorunun okuduğu sayfayı kapatmaz.
  assert.ok(html.includes("₺74'ten başlayan"));
});

test("açılış yükleyicisi de biçim listesini PROP'tan alır", () => {
  // İkinci çağrı yeri: `/3d-baski` yükleyicisi çalışma alanından AYRI bir
  // bileşen ve `accept` dizesini kendisi üretmiyor — sayfa bayraktan türetip
  // veriyor (`quoteAcceptedFormats`). Bu test o zincirin istemci ucunu tutar.
  const render = (formats: QuoteSourceFormat[]) =>
    inLocale(
      createElement(LandingUploader, {
        maxFileBytes: SEED_SNAPSHOT.settings.maxFileBytes,
        maxPartsPerQuote: SEED_SNAPSHOT.settings.maxPartsPerQuote,
        acceptedFormats: formats,
      })
    );
  const closed = render(MESH_FORMATS);
  assert.match(tagOf(closed, /<input type="file"[^>]*>/), /accept="\.stl,\.obj,\.3mf"/);
  assert.ok(!closed.includes(".step"), "bayrak kapalıyken açılış sayfası .step seçtiriyor");
  assert.match(
    tagOf(render(ALL_FORMATS), /<input type="file"[^>]*>/),
    /accept="\.stl,\.obj,\.3mf,\.step,\.stp"/
  );
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
  fxSnapshot: null,
  frameworkBatch: null,
  // 0072: takımsız satır — İKİSİ DE null ve ekran kolonu hiç çizmez (kolonun
  // kendisi T-5'in işi, bu tur yalnız alanları taşıyor).
  teamName: null,
  ownerName: null,
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

// ─── Döviz GÖSTERİMİ: tek render dikişi (Faz 2b · D3) ────────────────────────
//
// Bu bölümün tek sınavı şudur: EKRANDA ne değişti ve ne DEĞİŞMEDİ. Bağlayıcı
// her tutar ₺ kalmalı (32 Sayılı Karar m.4/g + 2008-32/34 Tebliğ m.8); döviz
// yalnız YANINDA duran yaklaşık bir ikinci okumadır. En önemli çivi ödeme
// ekranındadır: tahsil edilecek rakam dövize ÇEVRİLMEZ.

const FX_SNAPSHOT: QuoteFxSnapshot = {
  version: 1,
  source: "tcmb",
  bulletinDate: "2026-09-29",
  takenAt: "2026-09-29T15:30:00.000Z",
  rates: [
    { currency: "EUR", microTryPerUnit: 48_741_200 },
    { currency: "USD", microTryPerUnit: 41_523_100 },
    { currency: "GBP", microTryPerUnit: 55_903_400 },
  ],
};

const FX_DISPLAY: PresentedFxDisplay = {
  snapshot: FX_SNAPSHOT,
  currencies: ["TRY", "EUR", "USD", "GBP"],
};

const EUR_RATE: FrozenFxRate = { currency: "EUR", microTryPerUnit: 48_741_200 };

/** Döviz gösterimi AÇIK bir teklif (bayrak açık + kur donmuş + fiyat kapısı açık). */
function fxQuote(over: Partial<PresentedQuote> = {}): PresentedQuote {
  return pricedQuote({ display: FX_DISPLAY, ...over });
}

/**
 * YUVARLAMA üreten fiş: satırlar ayrı ayrı yuvarlandığı için toplamı tutmaz.
 * 10000 kr → 205, 4800 kr → 98 (Σ 303); 14800 kr → 304. Fark +1 cent ve
 * ekranda GÖRÜNEN bir satır olmak zorunda.
 */
const ROUNDING_TOTALS: QuoteTotals = {
  allPriced: true,
  partsKurus: 10000,
  addonLines: [{ key: "certificate", name: "Malzeme sertifikası", kurus: 4800 }],
  addonsKurus: 4800,
  minOrderTopUpKurus: 0,
  totalKurus: 14800,
  kdvExcludedKurus: 12000,
  kdvKurus: 2800,
  leadDays: 5,
};

/**
 * Aynı fişin İKİ parçalı hâli: parça satırları (5.000 + 5.000) ara toplamı
 * (10.000 kr) vermek zorunda. Bağımsız yuvarlansalardı 103 + 103 = 206 çıkar
 * ve hemen altındaki "≈ ara toplam" 205'i tutmazdı; AYRILMIŞ satırlar
 * (`convertPartLines`) 103 + 102 = 205 verir.
 */
function fxRoundingQuote(over: Partial<PresentedQuote> = {}): PresentedQuote {
  return fxQuote({
    totals: ROUNDING_TOTALS,
    parts: [
      partFixture({
        id: "p1",
        name: "Braket",
        price: { unitKurus: 2500, lineKurus: 5000, source: "auto", priceBreaks: [] },
      }),
      partFixture({
        id: "p2",
        name: "Kapak",
        price: { unitKurus: 2500, lineKurus: 5000, source: "auto", priceBreaks: [] },
      }),
    ],
    ...over,
  });
}

/**
 * GÖSTERİM TAVANINI aşan teklif: ₺2.000.000 üstü bir teklif GÖRÜNTÜLENEBİLİR
 * (tavan bir ÖDEME tavanıdır, teklif tarafında uygulanmaz —
 * `quote-currency.ts` başlığı), ama fişi çevrilemez. Yüzeyin tamamı ₺ kalmak
 * zorunda: kalemleri `€` toplamı `₺` bir ekran, okuyucunun topladığı sayılar
 * ile toplamı farklı para biriminde bırakırdı.
 */
const OVER_CAP_TOTALS: QuoteTotals = {
  allPriced: true,
  partsKurus: 150_000_000,
  addonLines: [{ key: "certificate", name: "Malzeme sertifikası", kurus: 60_000_000 }],
  addonsKurus: 60_000_000,
  minOrderTopUpKurus: 0,
  totalKurus: 210_000_000,
  kdvExcludedKurus: 175_000_000,
  kdvKurus: 35_000_000,
  leadDays: 5,
};

function fxOverCapQuote(over: Partial<PresentedQuote> = {}): PresentedQuote {
  return fxQuote({
    totals: OVER_CAP_TOTALS,
    parts: [
      partFixture({
        price: { unitKurus: 75_000_000, lineKurus: 150_000_000, source: "auto", priceBreaks: [] },
      }),
    ],
    ...over,
  });
}

/** Dövizde HİÇ görünmemesi gereken üç simge. */
const FX_SYMBOLS = ["€", "$", "£"] as const;

/** Bir rakamın markup'ta KAÇ KEZ geçtiği: "ikinci satır ayrılmış mı" çivisi. */
function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

test("çevirim dikişi TEK: `money` ₺ dışına yalnız DONMUŞ kurla çıkar", () => {
  // Kur yoksa ya da TRY seçiliyse mevcut biçimleyici aynen çalışır: depodaki
  // 44 çağrı yeri `formatCurrency`yi kullanmaya devam ediyor.
  assert.equal(fxMoney(14800, null), formatCurrency(14800, "tr"));
  assert.equal(fxMoney(14800), formatCurrency(14800, "tr"));
  // 14800 kr / 48,7412 = 303,647… € → 304 cent.
  assert.equal(fxMoney(14800, EUR_RATE), "€3,04");
  // GÖSTERİM TAVANI: çevrilemeyen tutar ₺'ye DÜŞER, ATMAZ — bir sunucu
  // bileşeninde atılan `RangeError` boş gövdeli bir 500'dür ve döviz kolonu,
  // yanında durduğu BAĞLAYICI ₺ okumasını da öldürürdü.
  //
  // Bu düşüş bir AĞ, kapı DEĞİL: müşteri onu hiç görmez, çünkü yüzey kapısı
  // (`fxSurface`) çevrilemeyen bir fişte kuru KOMPLE düşürür. "Yarısı €
  // yarısı ₺" hâli aşağıda YÜZEY davranışı olarak çivilidir.
  const overCap = MAX_AMOUNT_KURUS + 1;
  assert.equal(fxMoney(overCap, EUR_RATE), formatCurrency(overCap, "tr"));
  assert.equal(fxMoney(-1, EUR_RATE), formatCurrency(-1, "tr"));
});

test("`displayRate` seçimi DONMUŞ snapshot'tan çözer, yoksa ₺'ye düşer", () => {
  assert.deepEqual(displayRate(FX_SNAPSHOT, "EUR"), EUR_RATE);
  assert.equal(displayRate(FX_SNAPSHOT, "TRY"), null);
  assert.equal(displayRate(null, "EUR"), null, "kur yoksa döviz gösterimi de yok");
  assert.equal(displayRate(undefined, "EUR"), null);
  // Donmuş snapshot'ta o birim YOKSA (katalog sonradan büyümüş olabilir)
  // sessizce ₺: yarım bir küme göstermek yanlış rakam göstermektir.
  assert.equal(displayRate({ ...FX_SNAPSHOT, rates: [EUR_RATE] }, "USD"), null);
});

test("`?kur=` geçersiz/bilinmeyen değerde SESSİZCE TRY'ye düşer", () => {
  assert.equal(parseDisplayCurrency("EUR"), "EUR");
  assert.equal(parseDisplayCurrency("eur"), "EUR");
  assert.equal(parseDisplayCurrency("TRY"), "TRY");
  for (const bad of ["CHF", "xyz", "", "JPY", undefined, null, 42, ["EUR"]]) {
    assert.equal(parseDisplayCurrency(bad), "TRY", `${String(bad)} TRY'ye düşmedi`);
  }
});

test("kur metni mikro-TRY'yi TCMB'nin dört hanesiyle yazar", () => {
  assert.equal(rateText(EUR_RATE), "48,7412");
});

test("özet, EUR seçiliyken ₺'nin YANINA döviz okuması koyar", () => {
  const html = plain(renderSummary(fxQuote(), "EUR"));
  assert.ok(html.includes("€3,04"), "toplamın döviz karşılığı yok");
  // Çalışma alanının fişi SEÇİLİ birimde okunur (K2): ₺ rakamı yerini verir.
  // İki kolon yalnız BELGEDE durur (K3) — bir sonraki vaka.
  assert.ok(!html.includes(money(14800)), "aynı tutar iki kez basılmış");
  // Ama "₺" kelimesi ekrandan kaybolmaz: kur cümlesi hangi paraya karşılık
  // okuduğunu söyler.
  assert.ok(html.includes("₺"), "₺ bağı tamamen kopmuş");
  // Kur ve BÜLTEN TARİHİ her rakamın yanında yazılı olmak zorunda (R6).
  assert.ok(html.includes("48,7412"), "kur yazılmamış");
  assert.ok(html.includes("TCMB"), "kaynak atfı yok");
  assert.ok(html.includes("29 Eylül 2026"), "bülten tarihi yok");
  assert.ok(html.includes(tr["instantQuote.fx.indicative"]), "bilgi amaçlılık cümlesi yok");
  // Seçici sağ sütunda durur.
  assert.ok(html.includes(tr["instantQuote.fx.label"]), "para birimi seçicisi çizilmemiş");
  assert.ok(html.includes(tr["instantQuote.fx.try"]), "₺ seçeneği yok");
});

test("özet, `display` YOKKEN tek bir döviz simgesi bile basmaz", () => {
  // Bayrak kapalı / kur bayat hâli: `presentQuote` `display` anahtarını hiç
  // göndermez ve EUR tercihi tarayıcıda kalmış olsa bile ekran ₺ kalır.
  const html = plain(renderSummary(pricedQuote(), "EUR"));
  for (const symbol of FX_SYMBOLS) {
    assert.ok(!html.includes(symbol), `${symbol} sızdı`);
  }
  assert.ok(!html.includes(tr["instantQuote.fx.label"]), "seçici çizilmiş");
  assert.ok(html.includes(money(14800)), "₺ toplam yok");
});

test("YUVARLAMA satırı yalnız fark VARKEN çizilir", () => {
  const withRounding = plain(renderSummary(fxRoundingQuote(), "EUR"));
  assert.ok(withRounding.includes(tr["instantQuote.fx.rounding"]), "yuvarlama satırı yok");
  assert.ok(withRounding.includes("€0,01"), "yuvarlama tutarı yok");
  // Satırlar + yuvarlama = toplam: 205 + 98 + 1 = 304.
  assert.ok(withRounding.includes("€2,05"), "parça ara toplamı yok");
  assert.ok(withRounding.includes("€0,98"), "ek hizmet satırı yok");
  assert.ok(withRounding.includes("€3,04"), "toplam yok");

  // Tek satırlık fişte fark SIFIRDIR: gereksiz satır çizilmez.
  const without = plain(renderSummary(fxQuote(), "EUR"));
  assert.ok(!without.includes(tr["instantQuote.fx.rounding"]), "sıfır fark satırı çizildi");
});

test("belgede İKİ kolon durur: bağlayıcı ₺ VE yanında ≈ döviz", () => {
  const html = plain(renderDocument(fxRoundingQuote(), "EUR"));
  assert.ok(html.includes("€"), "döviz kolonu yok");
  assert.ok(html.includes("₺"), "BAĞLAYICI ₺ kolonu kayboldu");
  assert.ok(html.includes(money(14800)), "₺ toplam yok");
  assert.ok(html.includes("€3,04"), "≈ toplam yok");
  assert.ok(
    html.includes(fill(tr["instantQuote.document.fxColumn"], { currency: "EUR" })),
    "≈ kolon başlığı yok"
  );
  // Yuvarlama satırı kâğıtta da görünür: satırları toplayan okuyucu farkı
  // belgede bulmalı.
  assert.ok(html.includes(tr["instantQuote.fx.rounding"]), "belgede yuvarlama satırı yok");
});

test("belgenin döviz kolonu TOPLANIR: parça satırları ara toplamı verir", () => {
  // İki parça 5.000 + 5.000 kr, EUR 48,7412. Bağımsız yuvarlama 103 + 103 =
  // 206 verir ve hemen altındaki "≈ ara toplam" 205'i TUTMAZ — kâğıtta
  // açıklanmamış bir cent. Ayrılmış satırlar (`convertPartLines`) 103 + 102
  // basar: satın alma birimi kolonu toplayınca ara toplamı bulur (R5).
  const html = plain(renderDocument(fxRoundingQuote(), "EUR"));
  assert.equal(occurrences(html, "€1,03"), 1, "ilk parça satırı yok ya da iki kez basılmış");
  assert.equal(
    occurrences(html, "€1,02"),
    1,
    "ikinci parça satırı AYRILMAMIŞ (bağımsız yuvarlanmış) — kolon ara toplamı tutmuyor"
  );
  // 103 + 102 = 205 → ara toplam; 205 + 98 (ek hizmet) + 1 (yuvarlama) = 304.
  assert.ok(html.includes("€2,05"), "≈ parça ara toplamı yok");
  assert.ok(html.includes("€0,98"), "≈ ek hizmet satırı yok");
  assert.ok(html.includes("€0,01"), "≈ yuvarlama satırı yok");
  assert.ok(html.includes("€3,04"), "≈ toplam yok");
  // Bağlayıcı kolon aynı satırlarda ₺ kalır: iki kolon YAN YANA.
  assert.ok(html.includes(money(5000)), "parça satırının bağlayıcı ₺ tutarı kayboldu");
  assert.ok(html.includes(money(10000)), "₺ ara toplam kayboldu");
});

test("ÖDEME FİŞİ döviz seçiliyken TOPLANIR: satırlar + yuvarlama = brüt toplam", () => {
  // Fişte ara toplam satırı YOK: satırların kendisi (parça · ek hizmet)
  // doğrudan brüt toplamla karşılaştırılır, o yüzden YUVARLAMA satırı bu
  // yüzeyde de çizilmek zorunda. Yoksa müşteri 1,03 + 1,02 + 0,98 = 3,03
  // toplar ve fişte 3,04 okur.
  const html = plain(
    inLocale(
      createElement(QuoteCheckoutReceipt, {
        quote: fxRoundingQuote(),
        totalKurus: 14800,
        giftCardAmountKurus: 0,
        havaleDiscountKurus: 0,
        payableKurus: 14800,
        rate: EUR_RATE,
      })
    )
  );
  assert.equal(occurrences(html, "€1,03"), 1, "ilk parça satırı yok");
  assert.equal(occurrences(html, "€1,02"), 1, "ikinci parça satırı AYRILMAMIŞ");
  assert.ok(html.includes("€0,98"), "ek hizmet satırı yok");
  assert.ok(html.includes(tr["instantQuote.fx.rounding"]), "fişte YUVARLAMA satırı yok");
  assert.ok(html.includes("€0,01"), "yuvarlama tutarı yok");
  assert.ok(html.includes("€3,04"), "brüt toplam yok");

  // ₺ gösterimde fark YOKTUR (sunucu hesabı): satır da doğmaz.
  const tryOnly = plain(
    inLocale(
      createElement(QuoteCheckoutReceipt, {
        quote: fxRoundingQuote(),
        totalKurus: 14800,
        giftCardAmountKurus: 0,
        havaleDiscountKurus: 0,
        payableKurus: 14800,
      })
    )
  );
  assert.ok(!tryOnly.includes(tr["instantQuote.fx.rounding"]), "₺ fişte yuvarlama satırı çizildi");
});

test("GÖSTERİM TAVANINI aşan teklifte yüzeyin TAMAMI ₺ kalır (yarısı değil)", () => {
  // ₺2.000.000 üstü bir teklif görüntülenebilir ama fişi çevrilemez. Kapı
  // TUTAR başına olsaydı kalemler `€3.077.436,26` toplam `₺2.100.000,00`
  // basılırdı: okuyucunun topladığı sayılar ile toplam farklı para
  // biriminde olurdu. Tasarımın sözü "gösterim KENDİSİ yok olur".
  const surfaces = {
    özet: plain(renderSummary(fxOverCapQuote(), "EUR")),
    belge: plain(renderDocument(fxOverCapQuote(), "EUR")),
    ödeme: renderCheckout({
      quote: fxOverCapQuote({ shipByDate: "2026-11-02" }),
      totalKurus: 210_000_000,
      currency: "EUR",
    }),
    fiş: plain(
      inLocale(
        createElement(QuoteCheckoutReceipt, {
          quote: fxOverCapQuote(),
          totalKurus: 210_000_000,
          giftCardAmountKurus: 0,
          havaleDiscountKurus: 0,
          payableKurus: 210_000_000,
          rate: EUR_RATE,
        })
      )
    ),
  };
  for (const [label, html] of Object.entries(surfaces)) {
    for (const symbol of FX_SYMBOLS) {
      assert.ok(!html.includes(symbol), `${label}: ${symbol} sızdı`);
    }
    assert.ok(html.includes(money(210_000_000)), `${label}: bağlayıcı ₺ toplam yok`);
  }
  // Seçici de çizilmez: hiçbir birim çevrilemediği için ÖLÜ bir düğme olurdu.
  assert.ok(!surfaces["özet"].includes(tr["instantQuote.fx.label"]), "ölü seçici çizildi");
  // Belge bağlantısı ölü bir `?kur=` yazmaz.
  assert.match(renderHeader(fxOverCapQuote(), "EUR", null), /\/teklif\/T-000123\/belge"/);
  // `?kur=EUR` ile gelen müşteri sessiz bırakılmaz: cümle yazılır.
  assert.ok(
    surfaces["belge"].includes(tr["instantQuote.fx.unavailable"]),
    "karşılanamayan seçim belgede sessiz kaldı"
  );
});

test("belge alt bilgisi bülten tarihini, kaynağı ve bağlayıcı kolonu YAZAR", () => {
  const html = plain(renderDocument(fxQuote(), "EUR"));
  assert.ok(html.includes("TCMB"), "kaynak atfı yok (TCMB verisi atıfla kullanılır)");
  assert.ok(html.includes("29 Eylül 2026"), "bülten tarihi yok");
  assert.ok(html.includes("48,7412"), "kur yok");
  assert.match(html, /Bağlayıcı tutar Türk lirası kolonudur/);
});

test("belgede `?kur=` karşılanamazsa cümle YAZILIR, sayfa DÜŞMEZ", () => {
  // Bayrak kapalı ya da kur bayat: `display` yok. Müşteri `?kur=EUR` ile
  // gelmişse sessiz kalmak "istediğim kolon nerede" sorusunu cevapsız bırakır.
  const html = plain(renderDocument(pricedQuote(), "EUR"));
  assert.ok(html.includes(tr["instantQuote.fx.unavailable"]), "karşılanamayan seçim sessiz kaldı");
  for (const symbol of FX_SYMBOLS) {
    assert.ok(!html.includes(symbol), `${symbol} sızdı`);
  }
  // TRY istenmişse cümle de YOK: döviz istemeyen müşteriye hata gösterilmez.
  const tryOnly = plain(renderDocument(pricedQuote(), "TRY"));
  assert.ok(!tryOnly.includes(tr["instantQuote.fx.unavailable"]));
});

test("ÖDEME EKRANI: brüt toplam ikincil okuma alır, havale indirimi ₺ KALIR", () => {
  const html = renderCheckout({
    quote: fxQuote({ shipByDate: "2026-11-02" }),
    currency: "EUR",
  });
  // Fişin ÜST tarafı (parça satırı, ek hizmet, brüt toplam, KDV) ikincil
  // okumayı alabilir: "ne alıyorum, brüt kaça".
  assert.ok(html.includes("€3,04"), "brüt toplamın döviz okuması yok");
  assert.ok(html.includes(money(14800)), "bağlayıcı ₺ toplam kayboldu");
  // Havale indirimi YAPILACAK bir tahsilatın parçasıdır: çevrilmez.
  assert.ok(html.includes(`−${money(444)}`), "havale indirimi ₺ değil");
  assert.ok(!html.includes("−€"), "havale indirimi dövize çevrilmiş");
});

test("ÖDEME FİŞİ: hediye kartı ve ödenecek tutar satırları YALNIZ ₺", () => {
  // Fişi doğrudan çizmek tender dökümünü (brüt → kart → ödenecek) durumdan
  // bağımsız sınanabilir kılıyor; bu turun EN ÖNEMLİ çivisi burada.
  const html = plain(
    inLocale(
      createElement(QuoteCheckoutReceipt, {
        quote: fxQuote(),
        totalKurus: 14800,
        giftCardAmountKurus: GIFT_PREVIEW.giftCardAmountKurus,
        havaleDiscountKurus: GIFT_PREVIEW.bankTransfer.havaleDiscountKurus,
        payableKurus: GIFT_PREVIEW.card.payableKurus,
        rate: EUR_RATE,
      })
    )
  );
  // Müşteri yaklaşık sayıyı ödeyeceği tutar sanmamalı (MSY m.6/2-a + 32
  // Sayılı Karar m.4/g): üç satır da ₺.
  for (const [key, kurus] of [
    ["instantQuote.checkout.giftCard.applied", 4000],
    ["instantQuote.checkout.giftCard.remaining", 10800],
  ] as const) {
    assert.ok(html.includes(fill(tr[key], { amount: money(kurus) })), `${key} ₺ değil`);
  }
  assert.ok(html.includes(`−${money(311)}`), "havale indirimi ₺ değil");
  // Brüt toplam ise ikincil okumasını alır: fişin iki yarısı BİLEREK farklı.
  assert.ok(html.includes("€3,04"), "brüt toplamın döviz okuması yok");
});

test("ÖDEME FORMU: düğme üstündeki tutar ve sözleşme özeti YALNIZ ₺", () => {
  const html = renderCheckoutForm({
    quote: fxQuote(),
    rate: EUR_RATE,
    giftPreview: GIFT_PREVIEW,
  });
  // Düğme: `submit · ₺108,00` (hediye kartı uygulanmış).
  assert.ok(
    html.includes(`${tr["instantQuote.checkout.submit"]} · ${money(10800)}`),
    "düğme üstündeki tutar ₺ değil"
  );
  // MSY m.6/2-a: "vergiler dâhil toplam fiyat", ödeme yükümlülüğünden HEMEN
  // ÖNCE. `DistanceContractConsent` para birimini ÖĞRENMEZ.
  assert.ok(html.includes(money(10800)), "sözleşme özetindeki tutar ₺ değil");
  // Tahsilatın ₺ olduğu AÇIKÇA yazılı ve onay bloğunun HEMEN ÜSTÜNDE.
  const notice = fill(tr["instantQuote.fx.chargedInTry"], { amount: money(10800) });
  assert.ok(html.includes(notice), "tahsilat ₺ uyarısı yok");
  const noticeAt = html.indexOf(notice);
  const consentAt = html.indexOf(tr["consent.contract.summaryTitle"]);
  assert.ok(consentAt > 0, "mesafeli satış onayı çizilmemiş");
  assert.ok(noticeAt > 0 && noticeAt < consentAt, "uyarı onayın ÜSTÜNDE değil");
});

test("ÖDEME FORMU: döviz seçilmemişken tahsilat uyarısı da YOK", () => {
  const html = renderCheckoutForm({ quote: fxQuote(), rate: null });
  assert.ok(
    !html.includes(fill(tr["instantQuote.fx.chargedInTry"], { amount: money(14800) })),
    "₺ gösterimde anlamsız bir uyarı çizildi"
  );
});

test("parça kartı, kademe tablosu ve ek hizmetler aynı dikişten geçer", () => {
  const part = partFixture({
    price: {
      unitKurus: 7400,
      lineKurus: 14800,
      source: "auto",
      priceBreaks: [
        { quantity: 1, unitKurus: 7400 },
        { quantity: 10, unitKurus: 6400 },
      ],
    },
  });
  const html = plain(renderPartCard(part, fxQuote({ parts: [part] }), EUR_RATE));
  assert.ok(html.includes(fxMoney(7400, EUR_RATE)), "birim fiyatın döviz okuması yok");
  assert.ok(html.includes(fxMoney(14800, EUR_RATE)), "satır tutarının döviz okuması yok");
  assert.ok(html.includes(fxMoney(6400, EUR_RATE)), "kademe tablosu ₺'de kalmış");
  // Kart da fişle aynı davranır: aynı tutar iki kez basılmaz.
  assert.ok(!html.includes(money(7400)), "aynı birim fiyat iki kez basılmış");

  // Kur YOKKEN aynı kart ₺ basar — dikişin iki yönü de sınanıyor.
  const tryOnly = plain(renderPartCard(part, pricedQuote({ parts: [part] })));
  assert.ok(tryOnly.includes(money(7400)), "₺ birim fiyat yok");
  for (const symbol of FX_SYMBOLS) {
    assert.ok(!tryOnly.includes(symbol), `${symbol} sızdı`);
  }
});

test("hesap listesindeki tutar kolonu teklifin KENDİ donmuş kurunu izler", () => {
  const withRate = plain(
    inLocale(
      createElement(QuoteListTable, {
        items: [{ ...QUOTE_ROW, totalKurus: 14800, fxSnapshot: FX_SNAPSHOT }],
        currency: "EUR",
      })
    )
  );
  assert.ok(withRate.includes("€3,04"), "liste tercihi izlemiyor");

  // Kuru olmayan satır (bayrak kapalıyken ya da eski teklifte) ₺ kalır.
  const noRate = plain(
    inLocale(
      createElement(QuoteListTable, {
        items: [{ ...QUOTE_ROW, totalKurus: 14800, fxSnapshot: null }],
        currency: "EUR",
      })
    )
  );
  assert.ok(noRate.includes(money(14800)));
  for (const symbol of FX_SYMBOLS) {
    assert.ok(!noRate.includes(symbol), `${symbol} sızdı`);
  }
});

test("belge bağlantısı aktif seçimi taşır; `?t=` ile birlikte doğru ayraçla", () => {
  assert.match(renderHeader(fxQuote(), "EUR", null), /\/teklif\/T-000123\/belge\?kur=EUR"/);
  assert.match(
    plain(renderHeader(fxQuote(), "EUR", "abc123")),
    /\/teklif\/T-000123\/belge\?t=abc123&kur=EUR"/
  );
  // ₺ seçiliyken adres KİRLENMEZ.
  assert.match(renderHeader(fxQuote(), "TRY", null), /\/teklif\/T-000123\/belge"/);
  // Kur karşılanamıyorsa ölü bir `?kur=` yazılmaz.
  assert.match(renderHeader(pricedQuote(), "EUR", null), /\/teklif\/T-000123\/belge"/);
});

test("tercih deposu atan `localStorage` ile de ÇALIŞIR (bellek kopyası)", () => {
  const throwing = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("SecurityError");
    },
  } as unknown as Storage;
  // Erişimin KENDİSİ atsa bile okuma bağlayıcı birime düşer, yazma sessizce
  // yutulur: bir gösterim kolaylığı yüzünden teklif ekranı çökmemeli.
  assert.equal(readDisplayCurrencyPref(throwing), "TRY");
  assert.doesNotThrow(() => writeDisplayCurrencyPref(throwing, "EUR"));
  assert.equal(readDisplayCurrencyPref(null), "TRY");

  const store = new Map<string, string>();
  const ok = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as unknown as Storage;
  writeDisplayCurrencyPref(ok, "USD");
  assert.equal(readDisplayCurrencyPref(ok), "USD");
  // Depodaki çöp değer bağlayıcı birime düşer (kapalı küme).
  store.set(DISPLAY_CURRENCY_PREF_KEY, "CHF");
  assert.equal(readDisplayCurrencyPref(ok), "TRY");

  // Yazma başarısız olsa bile DÜĞME çalışmalı: seçim bellekte de tutulur.
  setDisplayCurrency("GBP");
  assert.equal(displayCurrencySnapshot(), "GBP");
  setDisplayCurrency("TRY");
  assert.equal(displayCurrencySnapshot(), "TRY");
});

test("seçici `display` YOKKEN hiç çizilmez", () => {
  assert.equal(
    inLocale(createElement(DisplayCurrencyPicker, { display: null })),
    "",
    "kur yokken seçici çizildi"
  );
  const html = inLocale(createElement(DisplayCurrencyPicker, { display: FX_DISPLAY }));
  assert.ok(html.includes(tr["instantQuote.fx.label"]));
  for (const currency of FX_DISPLAY.currencies) {
    if (currency === "TRY") continue;
    assert.ok(html.includes(currency), `${currency} seçeneği yok`);
  }
  // ₺ seçiliyken kur cümlesi YOK: çevrilmiş bir rakam da yok.
  assert.ok(!html.includes("48,7412"), "₺ gösterimde kur cümlesi çizildi");
});

test("döviz sözlüğü iki dilde de TAM ve yer tutucuları yerinde", () => {
  for (const key of [
    "instantQuote.fx.label",
    "instantQuote.fx.try",
    "instantQuote.fx.rateNote",
    "instantQuote.fx.indicative",
    "instantQuote.fx.rounding",
    "instantQuote.fx.unavailable",
    "instantQuote.fx.chargedInTry",
    "instantQuote.document.fxColumn",
    "instantQuote.document.fxFooter",
  ] as const) {
    assert.ok(trKeys.includes(key), `${key} Türkçe sözlükte yok`);
    assert.ok(enKeys.includes(key), `${key} İngilizce sözlükte yok`);
  }
  for (const key of ["instantQuote.fx.rateNote", "instantQuote.document.fxFooter"] as const) {
    for (const placeholder of [/\{currency\}/, /\{rate\}/, /\{date\}/]) {
      assert.match(tr[key], placeholder, `${key} yer tutucusunu kaybetti`);
      assert.match(en[key], placeholder, `${key} (en) yer tutucusunu kaybetti`);
    }
  }
  assert.match(tr["instantQuote.fx.chargedInTry"], /\{amount\}/);
  assert.match(en["instantQuote.fx.chargedInTry"], /\{amount\}/);
  assert.match(tr["instantQuote.document.fxColumn"], /\{currency\}/);
  // Tahsilatın ₺ olduğu AÇIKÇA yazılı olmak zorunda.
  assert.match(tr["instantQuote.fx.chargedInTry"], /Türk lirası/);
  assert.match(tr["instantQuote.fx.indicative"], /Türk lirası/);
  assert.match(tr["instantQuote.document.fxFooter"], /TCMB/);
});

// ─── BAYRAK-KAPALI KANITI (Faz 2b · D4) ─────────────────────────────────────
//
// Bayrağı kapatmak DAĞITIM GEREKTİRMEZ: `platform_flags` tablosunda tek bir
// satır (`/admin/ayarlar`). Kapatmanın sunum tarafındaki karşılığı
// `presentQuote`un `display` anahtarını hiç göndermemesidir
// (`scripts/test-quote-api.ts`). Bu bölüm o anahtarın YOKLUĞUNUN EKRANDA ne
// demek olduğunu tek tek iddia ediyor — ve "bayrak kapalı" ile "bayrak açık
// ama kur yok" AYNI yüzey sonucunu vermek zorunda, çünkü ikisi de `display`
// göndermiyor.

test("BAYRAK KAPALI: `/teklif` yüzeylerinin HİÇBİRİNDE döviz yok, ₺ YERİNDE", () => {
  // Tarayıcıda kalmış bir "EUR" tercihi hiçbir yüzeyi çeviremez: bu yüzden
  // seçim her yüzeye AÇIKÇA "EUR" olarak verilir ve yine de ₺ beklenir.
  // `display` yok, `rate` yok — dönüşüm yapacak bir kur hiç ortada değil.
  //
  // Demetin alanları: etiket · markup · ₺ RAKAM basmak zorunda mı ·
  // karşılanamayan seçimi AÇIKLAMAKLA yükümlü mü. Sonuncusu yalnız
  // BELGE öyle, çünkü tek `?kur=` isteği ALAN yüzey odur (ayrı bir sunucu
  // render'ı, tarayıcı tercihini okuyamaz); kendi vakası hemen aşağıda o
  // cümlenin YAZILDIĞINI iddia ediyor. Öteki yüzeylerde aynı cümle, döviz
  // istemeyen müşteriye gösterilen anlamsız bir hata olurdu.
  const off = pricedQuote();
  const surfaces = [
    ["çalışma alanı", plain(renderWorkspace(off)), true, false],
    ["özet", plain(renderSummary(off, "EUR")), true, false],
    ["parça kartı", plain(renderPartCard(off.parts[0]!, off, null)), true, false],
    ["belge", plain(renderDocument(off, "EUR")), true, true],
    ["ödeme ekranı", renderCheckout({ quote: off }), true, false],
    ["ödeme formu", renderCheckoutForm({ quote: off, rate: null }), true, false],
    [
      "hesap listesi",
      plain(
        inLocale(
          createElement(QuoteListTable, {
            items: [{ ...QUOTE_ROW, totalKurus: 14800, fxSnapshot: null }],
            currency: "EUR",
          })
        )
      ),
      true,
      false,
    ],
    ["teklif başlığı", plain(renderHeader(off, "EUR", null)), false, false],
  ] as const;

  for (const [label, html, mustShowTry, mayExplainMissingFx] of surfaces) {
    for (const symbol of FX_SYMBOLS) {
      assert.ok(!html.includes(symbol), `${label}: ${symbol} sızdı`);
    }
    assert.ok(!html.includes(tr["instantQuote.fx.label"]), `${label}: seçici çizildi`);
    assert.ok(!html.includes(tr["instantQuote.fx.rateNote"]), `${label}: kur cümlesi çizildi`);
    assert.ok(
      !html.includes(tr["instantQuote.fx.chargedInTry"]),
      `${label}: ₺ gösterimde anlamsız tahsilat uyarısı çizildi`
    );
    if (!mayExplainMissingFx) {
      assert.ok(
        !html.includes(tr["instantQuote.fx.unavailable"]),
        `${label}: seçim yapılmamışken "karşılanamadı" cümlesi çizildi`
      );
    }
    // ₺ RAKAM YERİNDE: hiç fiyat basmayan bir ekran da yukarıdaki olumsuz
    // iddiaların TAMAMINI geçerdi. Kapatma yolu fiyatı gizlemek DEĞİL.
    if (mustShowTry) {
      assert.ok(html.includes(money(14800)), `${label}: bağlayıcı ₺ tutar kayboldu`);
    }
  }
});

test("BAYRAK KAPALI: belge `?kur=EUR` ile açılsa bile YALNIZ ₺ basar", () => {
  // Belge ayrı bir SUNUCU render'ı: tarayıcı tercihini okuyamaz, seçimi
  // `?kur=` ile alır. Karşılanamayan bir seçim sayfayı DÜŞÜRMEZ ve sessiz de
  // kalmaz — tek cümleyle söyler, kâğıdın tamamı ₺ kalır (D3 kararı #1).
  const html = plain(renderDocument(pricedQuote(), "EUR"));
  assert.ok(html.includes(tr["instantQuote.fx.unavailable"]), "karşılanamayan seçim sessiz kaldı");
  assert.ok(html.includes(money(14800)), "bağlayıcı ₺ toplam kayboldu");
  assert.ok(html.includes(money(7400)), "₺ birim fiyat kayboldu");
  for (const symbol of FX_SYMBOLS) {
    assert.ok(!html.includes(symbol), `${symbol} sızdı`);
  }
  // İkinci kolonun BAŞLIĞI da yok: boş bir "≈ EUR" kolonu kâğıtta durmaz.
  assert.ok(
    !html.includes(fill(tr["instantQuote.document.fxColumn"], { currency: "EUR" })),
    "boş döviz kolonu başlığı çizildi"
  );
});

test("BAYRAK KAPALI: ödenecek tutar ZATEN ₺ydi, ₺ KALIYOR", () => {
  // Bu iddia bayrağın konusu bile değil — tahsil edilen rakam bayrak AÇIKKEN
  // de ₺ydi (32 Sayılı Karar m.4/g) — ama kapatma kanıtının parçası: kapanış
  // ödeme ekranında hiçbir şeyi oynatmıyor.
  const notice = fill(tr["instantQuote.fx.chargedInTry"], { amount: money(14800) });
  const withFx = renderCheckoutForm({ quote: fxQuote(), totalKurus: 14800, rate: EUR_RATE });
  const withoutFx = renderCheckoutForm({ quote: pricedQuote(), totalKurus: 14800, rate: null });
  for (const [label, html] of [
    ["bayrak açık", withFx],
    ["bayrak kapalı", withoutFx],
  ] as const) {
    assert.ok(html.includes(money(14800)), `${label}: ödenecek ₺ tutar yok`);
  }
  // Bayrak açıkken EKLENEN tek şey uyarı cümlesi; kapanınca o da gidiyor ve
  // ödenecek rakam DEĞİŞMİYOR.
  assert.ok(withFx.includes(notice), "açıkken uyarı yok");
  assert.ok(!withoutFx.includes(notice), "kapalıyken uyarı var");
  for (const symbol of FX_SYMBOLS) {
    assert.ok(!withoutFx.includes(symbol), `kapalıyken ${symbol} sızdı`);
  }
});

test("SİPARİŞ/İADE ve e-posta yüzeyleri bu turda döviz ÖĞRENMEDİ", () => {
  // Y3 + Y4: o yüzeylerin rakamı YAPILMIŞ/YAPILACAK bir tahsilatı anlatır ve
  // e-postalar hiç tutar taşımaz. Kapı dosya listesiyle tutulur — biri
  // çevirim dikişini import ederse burada görünür.
  for (const rel of [
    "src/components/distance-contract-consent.tsx",
    "src/lib/services/quote-notify.ts",
  ]) {
    const code = fs.readFileSync(path.resolve(rel), "utf8");
    assert.doesNotMatch(
      code,
      /quote-currency|formatMoneyMinor|\bmoney\(/,
      `${rel} döviz gösterimini öğrenmiş`
    );
  }
});

// ─── ÇERÇEVE SİPARİŞLER: admin ekranı (0073) ────────────────────────────────
//
// Üç şey ölçülür ve üçü de PARA sorusudur:
//
//  1. İKİ TOPLAM AYRI ALANDA durur ve ekran hiçbirini ötekinin yerine yazmaz.
//     `committedTotalKurus` tek-sevkiyat projeksiyonudur, `batchesTotalKurus`
//     ise Σ parti tutarıdır; ikisi GENELDE EŞİT DEĞİLDİR (sabit/parça-başı ek
//     hizmetler her partide yeniden tahsil edilir).
//  2. EKRANDA PARA ARİTMETİĞİ YOKTUR: `client.tsx` dosyalarında çarpma, bölme
//     ve oran yok; tutar önizlemesi sunucudan (`dryRun`) geliyor.
//  3. Adet alanı BOŞ ile OKUNAMAZ'ı ayırıyor: yanlış ayrım planlanmış bir
//     adedi sessizce düşürürdü.

test("ÇERÇEVE: iki toplam AYRI alanlarda, biri ötekinin yerine yazılmıyor", () => {
  const committedTotalKurus = 1_200_000;
  const batchesTotalKurus = 1_260_000; // ek hizmetler her partide yeniden işler
  const html = renderToStaticMarkup(
    createElement(FrameworkSummary, {
      parts: [
        {
          partId: "p1",
          position: 1,
          name: "Gövde",
          technologyName: "FDM",
          materialName: "PLA",
          finishName: "Ham",
          quantity: 400,
          unitKurus: 3000,
          lineKurus: 1_200_000,
        },
      ],
      addons: [],
      committedUnits: 400,
      committedTotalKurus,
      batchesTotalKurus,
    })
  );
  assert.ok(
    html.includes(formatCurrency(committedTotalKurus, "tr")),
    "tek-sevkiyat projeksiyonu ekranda yok"
  );
  assert.ok(
    html.includes(formatCurrency(batchesTotalKurus, "tr")),
    "Σ parti tutarı ekranda yok"
  );
  // İki alan AYRI etiketle duruyor: aynı rakam iki kez yazılıp "toplam" diye
  // sunulmuyor.
  assert.match(html, /tek sevkiyatta/i, "birinci toplamın etiketi yok");
  assert.match(html, /parti tutar/i, "ikinci toplamın etiketi yok");
  // Ve ekran aradaki FARKI hesaplamıyor: bir çıkarma "kayıp para" gibi
  // okunacak üçüncü bir sayı üretirdi.
  assert.ok(
    !html.includes(formatCurrency(batchesTotalKurus - committedTotalKurus, "tr")),
    "ekran iki toplamın farkını üçüncü bir sayı olarak yazıyor"
  );
});

test("ÇERÇEVE: client.tsx dosyalarında para aritmetiği YOK", () => {
  // Program değişmezi: her tutar uçtan gelir. Tarama, YORUMLARI ve dizeleri
  // çıkardıktan sonra kalan KODDA aritmetik operatör arar.
  const CLIENTS = [
    "src/app/admin/cerceve/client.tsx",
    "src/app/admin/cerceve/[id]/client.tsx",
    "src/components/framework/framework-summary.tsx",
    "src/components/framework/batch-timeline.tsx",
    "src/components/framework/batch-planner.tsx",
    "src/components/framework/progress-bars.tsx",
  ];
  for (const rel of CLIENTS) {
    const raw = fs.readFileSync(path.resolve(rel), "utf8");
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    // `Kurus` taşıyan bir ifadenin yanında HİÇBİR aritmetik operatör
    // olmamalı: toplama da yasak, çünkü "satırları ekranda toplamak" ek
    // hizmetleri ve asgari tamamlamayı görmeyen bir toplam üretirdi.
    const moneyArithmetic = code.match(
      /\w*[Kk]urus\w*\s*[*/%+-][^>=]|[*/%+-]\s*\w*[Kk]urus\w*/g
    );
    assert.equal(
      moneyArithmetic,
      null,
      `${rel}: tutar üzerinde aritmetik var → ${moneyArithmetic?.join(", ")}`
    );
    // Kuruş ↔ ₺ çevrimi de ekranda YAPILMAZ: tek biçimleyici
    // `formatCurrency`dir ve `/ 100` yazan bir ekran ikinci bir para kuralı
    // kurmuş olurdu.
    for (const conversion of [/\/\s*100\b/, /\*\s*100\b/, /toFixed\(/]) {
      assert.doesNotMatch(code, conversion, `${rel}: ekranda para çevrimi var`);
    }
  }
});

test("ÇERÇEVE: yığın çubuk oranı SAF modülde, kovalar taahhüde toplanır", () => {
  const progress = {
    committedUnits: 400,
    unplannedUnits: 100,
    plannedUnits: 100,
    awaitingPaymentUnits: 50,
    inProductionUnits: 50,
    shippedUnits: 50,
    deliveredUnits: 40,
    cancelledOrRefundedUnits: 10,
  };
  const segments = progressSegments(progress);
  assert.equal(segments.length, 7, "altı kova + ayrık kova beklenir");
  const units = segments.reduce((sum, s) => sum + s.units, 0);
  assert.equal(units, progress.committedUnits, "kovaların toplamı taahhüdü tutmuyor");
  const pct = segments.reduce((sum, s) => sum + s.pct, 0);
  assert.ok(Math.abs(pct - 100) < 1e-9, `oranların toplamı 100 değil: ${pct}`);
  // Taahhüt SIFIRKEN hiçbir dilim çizilmez: sıfıra bölmek `NaN` genişlik
  // demekti ve `NaN` bir CSS değeri olarak SESSİZCE yok sayılır.
  for (const s of progressSegments({ ...progress, committedUnits: 0 })) {
    assert.equal(s.pct, 0, `${s.key}: sıfır taahhütte oran üretildi`);
  }
});

test("ÇERÇEVE: adet alanı BOŞ ile OKUNAMAZ'ı ayırır", () => {
  // Ayrım adet kaybını önler: `NaN` JSON'da `null`a düşer ve `null` bir adet
  // alanında "bu parçayı partiye hiç koyma" demektir.
  assert.equal(toQuantity(""), null);
  assert.equal(toQuantity("   "), null);
  assert.equal(toQuantity("0"), null, "sıfır adet = alan boş");
  assert.equal(toQuantity("120"), 120);
  for (const bad of ["1o", "abc", "1e3", "0x10", "-5", "1.5", "1,5", "12a3"]) {
    assert.equal(toQuantity(bad), "invalid", `${bad} okunamadı sayılmalı`);
  }
});

test("ÇERÇEVE: okunamayan ya da kalandan büyük TEK alan bütün planı durdurur", () => {
  const parts = [
    { partId: "a", position: 1, name: "Gövde", remaining: 200 },
    { partId: "b", position: 2, name: "Kapak", remaining: 50 },
  ];
  assert.deepEqual(planRows(parts, { a: "120", b: "" }), [{ partId: "a", quantity: 120 }]);
  const unreadable = planRows(parts, { a: "120", b: "1o" });
  assert.equal(typeof unreadable, "string");
  assert.match(unreadable as string, /P02 Kapak/, "hangi parça olduğu yazmalı");
  const tooMany = planRows(parts, { a: "120", b: "60" });
  assert.equal(typeof tooMany, "string");
  assert.match(tooMany as string, /kalan 50/, "kalan taahhüt yazmalı");
  // Hiç adet yazılmamış bir plan da gönderilmez.
  assert.equal(typeof planRows(parts, {}), "string");
});

test("ÇERÇEVE: başarı cümlesi İŞLEMDEN gelir (sekiz düğme aynı cümleyi paylaşmıyor)", () => {
  const actions: FrameworkActionKey[] = [
    "plan-preview",
    "plan",
    "release",
    "batch-cancel",
    "activate",
    "cancel",
    "extend",
    "preferences",
  ];
  const texts = new Set(actions.map((a) => frameworkNotice(a)));
  assert.equal(texts.size, actions.length, "iki işlem aynı cümleyi paylaşıyor");
  for (const a of actions) {
    assert.ok(frameworkNotice(a).length > 20, `${a}: cümle yok`);
  }
  // Ön izleme HİÇBİR ŞEY YAZMADIĞINI söylemek zorunda.
  assert.match(frameworkNotice("plan-preview"), /YAZILMADI/);
  // Anlaşma iptali ödenmiş partilere dokunmadığını söylemek zorunda.
  assert.match(frameworkNotice("cancel"), /ÖDENMİŞ/);
  // Çapa bir kapı değil, bir aday.
  assert.match(frameworkNotice("preferences"), /ilk adayıdır/);
});

test("ÇERÇEVE: tezgâh etiketi PROP olarak iner, ekran kapasite modülünü import etmez", () => {
  // İstemci bileşeni `services/manufacturer-capacity`i IMPORT EDEMEZ (`pg`yi
  // paketine sürükler); etiket sunucuda `manufacturerLoadLabel` ile üretilir.
  // Depo geneli tarayıcı da bunu ayrıca kontrol ediyor
  // (`scripts/test-manufacturer-capacity.ts`).
  for (const rel of [
    "src/app/admin/cerceve/[id]/client.tsx",
    "src/app/admin/cerceve/[id]/framework-values.ts",
  ]) {
    const code = fs.readFileSync(path.resolve(rel), "utf8");
    assert.doesNotMatch(
      code,
      /services\/manufacturer-capacity/,
      `${rel}: kapasite modülü istemciye sızmış`
    );
  }
  const page = fs.readFileSync(path.resolve("src/app/admin/cerceve/[id]/page.tsx"), "utf8");
  assert.match(page, /manufacturerLoadLabel\(/, "etiket sunucuda üretilmiyor");
  const client = fs.readFileSync(
    path.resolve("src/app/admin/cerceve/[id]/client.tsx"),
    "utf8"
  );
  assert.match(client, /benchLabel/, "etiket prop olarak inmiyor");
  // Ve ekran kendi eşiğini KURMUYOR: ileriye dönük yük GÖSTERİMDİR.
  assert.doesNotMatch(client, /maxConcurrentOrders/, "ekranda elle kapasite eşiği var");
});

test("ÇERÇEVE: parti tutarı önizlemesi SUNUCUDAN gelir (dryRun), ekran hesaplamaz", () => {
  const planner = fs.readFileSync(
    path.resolve("src/components/framework/batch-planner.tsx"),
    "utf8"
  );
  // Planlayıcı tutarı PROP olarak alır ve kendi satır toplamını kurmaz.
  assert.match(planner, /preview: PlanPreviewRow\[\] \| null/, "önizleme prop değil");
  assert.doesNotMatch(planner, /unitKurus/, "planlayıcı kilitli birim fiyatı okuyor");
  const client = fs.readFileSync(
    path.resolve("src/app/admin/cerceve/[id]/client.tsx"),
    "utf8"
  );
  assert.match(client, /dryRun: true/, "ön izleme ucu dryRun ile çağrılmıyor");
});

test("ÇERÇEVE: bayrak kapalıyken admin EKRANLARI 404 (oturum kapıyı AÇMAZ)", () => {
  // Kapalı bir özelliğin varlığını duyurmanın anlamı yok: her iki sayfa da
  // `notFound()` ile kapanıyor, hiçbir yerde 403 üretmiyor.
  //
  // KAPI `frameworkScreensEnabled` OLMAK ZORUNDA: `frameworkSurfacesEnabled`
  // admin oturumunu iç test için GEÇİRİYOR ve bu sayfalara yalnız admin
  // girebildiği için o kapı bir ekranda hiçbir şeyi kapatmaz — bayrak
  // kapalıyken de ekran çizilir, dönüştürme kartı görünür ve anlaşma
  // KURULABİLİRDİ (§F3.4 "render edilmez" diyor). Testin adı ancak oturumdan
  // arınmış bir kapıyla doğru.
  const strip = (raw: string): string =>
    raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/\s+/g, " ");

  for (const rel of ["src/app/admin/cerceve/page.tsx", "src/app/admin/cerceve/[id]/page.tsx"]) {
    const code = strip(fs.readFileSync(path.resolve(rel), "utf8"));
    assert.match(
      code,
      /if \(!\(await frameworkScreensEnabled\(\)\)\) notFound\(\);/,
      `${rel}: bayrak kapısı yok`
    );
    assert.doesNotMatch(
      code,
      /frameworkSurfacesEnabled/,
      `${rel}: ekran, admin oturumunu geçiren UÇ kapısını kullanıyor`
    );
    assert.doesNotMatch(code, /\b403\b/, `${rel}: 403 üretiyor`);
  }

  // Kapının KENDİSİ: yalnız bayrak okunur, `isAdminSession` HİÇ sorulmaz.
  const access = strip(fs.readFileSync(path.resolve("src/lib/services/quote-access.ts"), "utf8"));
  assert.match(
    access,
    /export async function frameworkScreensEnabled\(\): Promise<boolean> \{ return isFlagEnabled\("framework_orders_enabled"\); \}/,
    "ekran kapısı yalnız bayrağı okumuyor"
  );
  // Uçların kapısı DEĞİŞMEDİ: iç test istisnası orada kalır (§F3.2).
  assert.match(
    access,
    /export async function frameworkSurfacesEnabled\(\): Promise<boolean> \{ if \(await isFlagEnabled\("framework_orders_enabled"\)\) return true; return isAdminSession\(\); \}/,
    "uç kapısının iç test istisnası kaybolmuş"
  );

  // Teklif karar ekranındaki dönüştürme düğmesi bayrak kapalıyken HİÇ render
  // EDİLMEZ: kapı sayfada, prop `null` iner.
  const quotePage = fs
    .readFileSync(path.resolve("src/app/admin/teklifler/[id]/page.tsx"), "utf8")
    .replace(/\s+/g, " ");
  assert.match(
    quotePage,
    /if \(await frameworkScreensEnabled\(\)\) \{ frameworkEntry = await loadFrameworkEntry/,
    "dönüştürme kapısı bayrağa bağlı değil"
  );
  const quoteClient = fs.readFileSync(
    path.resolve("src/app/admin/teklifler/[id]/client.tsx"),
    "utf8"
  );
  assert.match(
    quoteClient,
    /\{\(frameworkEntry \|\| frameworkEntryUnreadable\) && \(/,
    "kart bayrak kapalıyken de çizilebiliyor"
  );

  // KENAR ÇUBUĞU da bayrağa bağlı: 404 veren bir ekrana götüren bir menü
  // satırı bırakmak admin'e olmayan bir ekran söylemekti.
  const sidebar = strip(fs.readFileSync(path.resolve("src/app/admin/sidebar.tsx"), "utf8"));
  assert.match(
    sidebar,
    /\.\.\.\(frameworkEnabled \? \[ \{ href: "\/admin\/cerceve"/,
    "kenar çubuğu satırı bayrak kapalıyken de çiziliyor"
  );
  const layout = strip(fs.readFileSync(path.resolve("src/app/admin/layout.tsx"), "utf8"));
  assert.match(
    layout,
    /const frameworkEnabled = await frameworkScreensEnabled\(\);/,
    "düzen bayrağı okumuyor"
  );
  // Rozet sayımı da bayrak kapalıyken koşmaz (satır zaten çizilmiyor).
  assert.match(
    layout,
    /frameworkEnabled \? displayRead\("serbest bırakılabilir partiler", releasableBatchCount\(\)\) : Promise\.resolve\(0\)/,
    "rozet sayımı bayrak kapalıyken de koşuyor"
  );
});

// ─── F4: MÜŞTERİ ÇERÇEVE YÜZEYİ ─────────────────────────────────────────────
//
// Dört şey kanıtlanıyor ve dördü de aynı kuralın yarısı: EKRANIN SÖYLEDİĞİ,
// TESTİN KANITLADIĞI ŞEYLE BİREBİR AYNI olmak zorunda.
//
//  1. fiyat kapısı çerçevede de TUTAR: `canSeePrices=false` izleyiciye hiçbir
//     fiyat ANAHTARI gitmez (ad taraması, `…Kurus`),
//  2. iki toplam AYRI alanlarda ve ekran ikisini AYRI etiketle yazar,
//  3. üretici görünümü DAR: fiyat ve müşteri kimliği yok,
//  4. belgenin beş zorunlu cümlesi hem kâğıtta hem SÖZLÜKTE aynen var.

const FW_PART: FrozenQuotePart = {
  partId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  position: 1,
  name: "Gövde",
  fileName: "govde.stl",
  sourceFormat: "stl",
  canonicalStlKey: "quote-parts/x/canonical.stl",
  thumbnailKey: null,
  drawingKey: null,
  drawingName: null,
  scaleFactor: 1,
  technologyKey: "sla",
  technologyName: "SLA reçine",
  materialKey: "std",
  materialName: "Standart reçine",
  colorName: "Gri",
  colorHex: "#888888",
  finishKey: "raw",
  finishName: "Ham",
  layerUm: 50,
  infillPct: null,
  quantity: 400,
  dimensionsMm: { x: 40, y: 30, z: 20 },
  volumeCm3: 12,
  tessellationMm: null,
  unitKurus: 3_000,
  lineKurus: 1_200_000,
  note: null,
  dfmWarnings: ["thin_walls"],
};

/** `loadFrameworkDetail`in çıktısının şekli — fiyat kapısının girdisi. */
function frameworkDetail(
  over: Partial<FrameworkDetail> = {}
): FrameworkDetail {
  const batch: FrameworkDetail["batches"][number] = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    position: 1,
    status: "released",
    plannedShipDate: "2026-11-14",
    units: 100,
    amountKurus: 300_000,
    quoteId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    quoteNumber: "T-000777",
    // Klon teklif: fiyatlanmış ve geçerliliği SÜRÜYOR (NOW_FW'den sonra), yani
    // parti bugün ödenebilir. Süresi dolmuş klonun vakası ayrı bir testte.
    quoteStatus: "quoted",
    quoteExpiresAt: "2026-10-20T20:59:59.999Z",
    orderId: null,
    orderNumber: null,
    orderStatus: null,
    paymentStatus: null,
    commissionRateBps: null,
    releasedAt: "2026-10-01T09:00:00.000Z",
    cancelledAt: null,
    cancelReason: null,
    note: null,
    trackingNumber: null,
    shippedAt: null,
    deliveredAt: null,
    releaseWindowOpen: false,
    shipByDate: "2026-10-15",
    lines: [{ partId: FW_PART.partId, position: 0, quantity: 100, unitKurus: 3_000, lineKurus: 300_000 }],
  };
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    number: "C-000123",
    status: "active",
    title: "Kalıp seti",
    quoteId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    quoteNumber: "T-000123",
    userId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    leadTier: "standard",
    addonKeys: ["rush_pack"],
    partsSnapshot: [FW_PART],
    addonsSnapshot: [{ key: "rush_pack", name: "Hızlı paket", kurus: 50_000 }],
    committedUnits: 400,
    leadDays: 7,
    committedTotalKurus: 1_250_000,
    batchesTotalKurus: 300_000,
    priceLockedUntil: "2026-12-31T20:59:59.999Z",
    lockExpired: false,
    preferredManufacturerId: null,
    preferredManufacturerName: null,
    shippingAddress: {
      adres: "Sanayi Mah. 1. Cadde No 5",
      ilce: "Çankaya",
      il: "Ankara",
      postaKodu: "06100",
      telefon: "+905551112233",
    },
    termsAcceptedAt: "2026-09-30T10:00:00.000Z",
    termsVersion: FRAMEWORK_TERMS_VERSION,
    customerNote: null,
    adminNote: null,
    activatedAt: "2026-09-30T10:00:00.000Z",
    activatedByEmail: "admin@example.test",
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-09-29T08:00:00.000Z",
    batches: [batch],
    progress: frameworkProgressBuckets(
      [{ partId: FW_PART.partId, quantity: 400, unitKurus: 3_000 }],
      [
        {
          partId: FW_PART.partId,
          quantity: 100,
          batchStatus: "released",
          orderId: null,
          cancelled: false,
          paymentStatus: null,
          shippedAt: null,
          deliveredAt: null,
        },
      ]
    ),
    ...over,
  };
}

const NOW_FW = new Date("2026-10-05T09:00:00.000Z");

/** Gövdedeki TÜM anahtar adları (iç içe nesneler ve diziler dâhil). */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      allKeys(child, out);
    }
  }
  return out;
}

test("ÇERÇEVE: canSeePrices=false izleyiciye HİÇ fiyat anahtarı gitmez", () => {
  const hidden = presentFramework({
    detail: frameworkDetail(),
    viewer: { canSeePrices: false, isOwner: true, isAdmin: false },
    now: NOW_FW,
    sign: (key) => `/signed/${key}`,
  });
  // Ad taraması: çerçeve tutarlarının adları `…Kurus` ile BİTMEK ZORUNDA
  // (f-1 §F1.5), yani tek bir kural bütün gövdeyi tarayabilir.
  const leaked = allKeys(hidden).filter((k) => /Kurus$/.test(k));
  assert.deepEqual(leaked, [], `fiyat anahtarı sızdı: ${leaked.join(", ")}`);
  // `undefined` ATAMAK YETMEZ: anahtarın KENDİSİ yok olmalı (RSC props'unda ve
  // `Object.keys`te görünürdü).
  assert.ok(!("committedTotalKurus" in hidden));
  assert.ok(!("batchesTotalKurus" in hidden));
  assert.ok(!("kdvRatePercent" in hidden), "KDV oranı da tutarlarla aynı kapıdan geçer");
  assert.ok(!("unitKurus" in hidden.parts[0]));
  assert.ok(!("amountKurus" in hidden.batches[0]));
  assert.ok(!("unitKurus" in hidden.batches[0].lines[0]));
  assert.ok(!("kurus" in hidden.addons[0]));
  // Fiyatsız olmayan şeyler YİNE gelir: adetler, tarihler, kova kırılımı.
  assert.equal(hidden.committedUnits, 400);
  assert.equal(hidden.progress.total.committedUnits, 400);

  // Kapı AÇIK izleyicide aynı alanlar VAR (test boş bir gövdeyi yeşil saymasın).
  const shown = presentFramework({
    detail: frameworkDetail(),
    viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
    now: NOW_FW,
    sign: (key) => `/signed/${key}`,
  });
  assert.equal(shown.committedTotalKurus, 1_250_000);
  assert.equal(shown.batchesTotalKurus, 300_000);
  assert.equal(shown.parts[0].unitKurus, 3_000);
  assert.equal(shown.batches[0].amountKurus, 300_000);
});

test("ÇERÇEVE: İKİ TOPLAM ayrı alanlarda ve KDV hariç taban sunucuda türetilir", () => {
  const view = presentFramework({
    detail: frameworkDetail(),
    viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
    now: NOW_FW,
    sign: (key) => `/signed/${key}`,
  });
  // İkisi AYNI alan DEĞİL ve biri ötekinin yerine yazılmıyor.
  assert.notEqual(view.committedTotalKurus, view.batchesTotalKurus);
  assert.equal(view.committedTotalKurus, 1_250_000, "tek-sevkiyat projeksiyonu");
  assert.equal(view.batchesTotalKurus, 300_000, "Σ parti tutarı");
  // KDV hariç taban EKRANDA değil `computeKdv` ile sunucuda hesaplanır.
  const kdv = computeKdv(1_250_000, KDV_RATE_BPS);
  assert.equal(view.committedKdvExcludedKurus, kdv.subtotalKurus);
  assert.equal(view.committedKdvKurus, kdv.kdvKurus);
  assert.equal(
    view.committedKdvExcludedKurus! + view.committedKdvKurus!,
    view.committedTotalKurus,
    "KDV hariç + KDV = toplam"
  );
});

test("ÇERÇEVE: belge İKİ toplamı AYRI etiketle yazar, farkını hesaplamaz", () => {
  const view = presentFramework({
    detail: frameworkDetail(),
    viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
    now: NOW_FW,
    sign: (key) => `/signed/${key}`,
  });
  const html = plain(
    renderToStaticMarkup(createElement(FrameworkDocument, { framework: view, d: tr }))
  );
  assert.ok(html.includes(formatCurrency(1_250_000, "tr")), "tek-sevkiyat toplamı yok");
  assert.ok(html.includes(formatCurrency(300_000, "tr")), "Σ parti tutarı yok");
  assert.ok(html.includes(tr["instantQuote.framework.committedTotal"]), "birinci etiket yok");
  assert.ok(html.includes(tr["instantQuote.framework.batchesTotal"]), "ikinci etiket yok");
  assert.ok(
    !html.includes(formatCurrency(1_250_000 - 300_000, "tr")),
    "belge iki toplamın FARKINI üçüncü bir sayı olarak yazıyor"
  );
});

test("ÇERÇEVE: belgenin BEŞ zorunlu cümlesi kâğıtta ve sözlükte AYNEN var", () => {
  // Kilidi DOLMUŞ bir anlaşmanın belgesi beş cümlenin HEPSİNİ taşır:
  // `.priceLockedUntil` (tarih her hâlde yazılır, belge bir kayıttır) ve
  // `.lockExpired` (yalnız dolmuşken) bir arada ancak bu hâlde görünür.
  const view = presentFramework({
    // Kilit DOLMUŞ: `presentFramework` bunu `priceLockedUntil` ile `now`dan
    // KENDİ türetir (servisin `lockExpired` alanını kopyalamaz), yani hâli
    // tarih üzerinden kurmak gerekiyor — ekranın ölçüsü `releaseBatch`in
    // ölçüsüyle aynı kalsın.
    detail: frameworkDetail({ priceLockedUntil: "2026-09-30T20:59:59.999Z" }),
    viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
    now: NOW_FW,
    sign: (key) => `/signed/${key}`,
  });
  const html = plain(
    renderToStaticMarkup(createElement(FrameworkDocument, { framework: view, d: tr }))
  );

  // Parametreli cümlenin BEKLENEN DOLDURULMUŞ hâli: belge tarihi
  // `formatDateLong` ile basıyor, bu yüzden iddia da aynı biçimlendiriciyle
  // kurulur. "Yer tutucuyu sil, kalanın ilk yarısını ara" kestirmesi
  // KULLANILMIYOR: `{date}` silinince ortada ÇİFT BOŞLUK kalıyordu ve
  // `split("  ")[0]` iddiayı `html.includes("Fiyat")`e indiriyordu — cümle
  // tamamen değişse bile yeşil kalan bir pin.
  const FILLS: Partial<Record<string, Record<string, string>>> = {
    "instantQuote.framework.priceLockedUntil": {
      date: formatDateLong("2026-09-30T20:59:59.999Z", "tr"),
    },
  };

  const MANDATORY = [
    "instantQuote.framework.priceLockedUntil",
    "instantQuote.framework.lockExpired",
    "instantQuote.framework.tryBindingFxApprox",
    "instantQuote.framework.perBatchBilling",
    "instantQuote.framework.warningsPerBatch",
  ] as const;

  // KAYNAK-SÖZLÜK PİNİ: cümle sözlük DOSYASINDA da aynen duruyor mu.
  // YORUMLAR SAYMAZ — tam satır `//` ve `/* */` stripleyerek karşılaştırılır,
  // yoksa yorumdaki bir alıntı pini yeşil tutar (controller'ın `7741a3d`
  // düzeltmesi).
  const trSource = fs
    .readFileSync(path.resolve("src/lib/i18n/dictionaries/tr.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  for (const key of MANDATORY) {
    const sentence = (tr as Record<string, string>)[key];
    assert.ok(sentence && sentence.length > 10, `${key} cümlesi yok`);
    // Kâğıtta TAM METİN aranır: parametreli cümle fixture'ın tarihiyle
    // doldurularak, parametresiz cümle olduğu gibi. Böylece cümlenin TEK bir
    // kelimesi değişse bile iddia kırmızı döner.
    const needle = FILLS[key] ? fill(sentence, FILLS[key]!) : sentence;
    assert.ok(
      !/\{\w+\}/.test(needle),
      `${key} doldurulmamış yer tutucu taşıyor: ${needle} (FILLS'e ekle)`
    );
    assert.ok(html.includes(needle), `${key} belgede YOK: ${needle.slice(0, 64)}…`);
    assert.ok(
      trSource.includes(sentence.slice(0, 40)),
      `${key} sözlük KAYNAĞINDA (yorum dışı) yok`
    );
  }

  // Ve kilidi dolmamış bir belge "geçerliliği doldu" DEMEZ.
  const live = presentFramework({
    detail: frameworkDetail(),
    viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
    now: NOW_FW,
    sign: (key) => `/signed/${key}`,
  });
  const liveHtml = plain(
    renderToStaticMarkup(createElement(FrameworkDocument, { framework: live, d: tr }))
  );
  assert.ok(
    !liveHtml.includes(tr["instantQuote.framework.lockExpired"]),
    "yürürlükteki anlaşmanın belgesi süresi dolmuş diyor"
  );
});

test("ÇERÇEVE: belge zorunlu HUKUKÎ içeriğin tamamını taşır", () => {
  const view = presentFramework({
    detail: frameworkDetail(),
    viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
    now: NOW_FW,
    sign: (key) => `/signed/${key}`,
  });
  const html = plain(
    renderToStaticMarkup(createElement(FrameworkDocument, { framework: view, d: tr }))
  );
  for (const key of [
    "instantQuote.framework.doc.freeCancel",
    "instantQuote.framework.doc.madeToOrder",
    "instantQuote.framework.doc.businessDays",
    "instantQuote.framework.doc.separateInvoice",
    "instantQuote.summary.kdvLineNote",
  ] as const) {
    assert.ok(
      html.includes((tr as Record<string, string>)[key]),
      `${key} belgede yok`
    );
  }
  // Taahhüt edilen adet, şart sürümü ve kabul tarihi.
  assert.ok(html.includes("400"), "taahhüt edilen adet yok");
  assert.ok(html.includes(FRAMEWORK_TERMS_VERSION), "şartların sürümü yok");
  assert.ok(html.includes(tr["instantQuote.framework.doc.termsAcceptedAt"]), "kabul tarihi yok");
  // e-Fatura VAAT EDİLMEZ (tasarım §10 madde 5).
  assert.doesNotMatch(html, /e-Fatura entegrasyonu(?! vaat edilmez)/);
});

test("ÇERÇEVE: müşteri client.tsx dosyalarında para aritmetiği YOK", () => {
  const CLIENTS = [
    "src/app/cerceve/[number]/client.tsx",
    "src/app/cerceve/[number]/framework-values.ts",
    "src/app/cerceve/[number]/belge/framework-document.tsx",
    "src/app/account/cerceve/frameworks-client.tsx",
    "src/app/manufacturer/plan/client.tsx",
  ];
  for (const rel of CLIENTS) {
    const raw = fs.readFileSync(path.resolve(rel), "utf8");
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const moneyArithmetic = code.match(
      /\w*[Kk]urus\w*\s*[*/%+-][^>=]|[*/%+-]\s*\w*[Kk]urus\w*/g
    );
    assert.equal(
      moneyArithmetic,
      null,
      `${rel}: tutar üzerinde aritmetik var → ${moneyArithmetic?.join(", ")}`
    );
    for (const conversion of [/\/\s*100\b/, /toFixed\(/]) {
      assert.doesNotMatch(code, conversion, `${rel}: ekranda para çevrimi var`);
    }
  }
});

test("ÇERÇEVE: üretici görünümü DAR — fiyat YOK, müşteri kimliği YOK", () => {
  const strip = (raw: string): string =>
    raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  // 1. Sipariş sayfasının üreticiye GÖNDERDİĞİ kart bloğu.
  const page = strip(
    fs.readFileSync(path.resolve("src/app/manufacturer/orders/[id]/page.tsx"), "utf8")
  );
  const block = /framework: frameworkCardRead\s*\?\s*\{([\s\S]*?)\}\s*:\s*null,/.exec(page);
  assert.ok(block, "üreticiye giden çerçeve kartı bloğu bulunamadı");
  for (const forbidden of [/Kurus/, /customer/i, /email/i, /phone/i, /amount/i]) {
    assert.doesNotMatch(block![1], forbidden, `üretici kartında yasak alan: ${forbidden}`);
  }

  // 2. İstemcinin PROP TİPİ de dar: tip genişlerse sayfa onu doldurabilir.
  const client = strip(
    fs.readFileSync(path.resolve("src/app/manufacturer/orders/[id]/client.tsx"), "utf8")
  );
  const typeBlock = /framework: \{([\s\S]*?)\n {4}\} \| null;/.exec(client);
  assert.ok(typeBlock, "üretici kartının prop tipi bulunamadı");
  for (const forbidden of [/Kurus/, /customer/i, /email/i, /phone/i]) {
    assert.doesNotMatch(typeBlock![1], forbidden, `üretici prop tipinde yasak alan: ${forbidden}`);
  }

  // 3. `/manufacturer/plan` satırları da fiyatsız ve müşterisiz.
  const planClient = strip(
    fs.readFileSync(path.resolve("src/app/manufacturer/plan/client.tsx"), "utf8")
  );
  for (const forbidden of [/Kurus/, /customerName/, /formatCurrency/]) {
    assert.doesNotMatch(planClient, forbidden, `plan ekranında yasak alan: ${forbidden}`);
  }
  // Servis satırının kendisi de tutar taşımıyor (tip düzeyinde kanıt).
  const service = strip(fs.readFileSync(path.resolve("src/lib/services/quote-framework.ts"), "utf8"));
  const planType = /export interface ManufacturerPlannedBatch \{([\s\S]*?)\n\}/.exec(service);
  assert.ok(planType, "ManufacturerPlannedBatch tipi bulunamadı");
  assert.doesNotMatch(planType![1], /Kurus/, "üreticinin parti satırı tutar taşıyor");
});

test("ÇERÇEVE: bayrak kapalıyken MÜŞTERİ ve ÜRETİCİ yüzeyleri 404", () => {
  const strip = (raw: string): string =>
    raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/\s+/g, " ");

  // MÜŞTERİ yüzeyleri `frameworkSurfacesEnabled` kullanır: admin oturumu iç
  // test için GEÇER (bu sayfalara admin'in kendi oturumuyla girmesi gerçek bir
  // iç test, `/admin/**` ile aynı değil).
  for (const rel of [
    "src/app/cerceve/[number]/page.tsx",
    "src/app/cerceve/[number]/belge/page.tsx",
    "src/app/account/cerceve/page.tsx",
  ]) {
    const code = strip(fs.readFileSync(path.resolve(rel), "utf8"));
    assert.match(
      code,
      /if \(!\(await frameworkSurfacesEnabled\(\)\)\) notFound\(\);/,
      `${rel}: bayrak kapısı yok`
    );
    assert.doesNotMatch(code, /\b403\b/, `${rel}: 403 üretiyor`);
  }

  // UÇLAR da aynı kapıdan geçer ve 404 gövdesi "çerçeve" der (teklif değil).
  for (const rel of [
    "src/app/api/customer/frameworks/route.ts",
    "src/app/api/customer/frameworks/[number]/route.ts",
  ]) {
    const code = strip(fs.readFileSync(path.resolve(rel), "utf8"));
    assert.match(
      code,
      /if \(!\(await frameworkSurfacesEnabled\(\)\)\) return frameworkNotFound\(\);/,
      `${rel}: bayrak kapısı yok`
    );
    assert.doesNotMatch(code, /\b403\b/, `${rel}: 403 üretiyor`);
  }
  const shared = strip(
    fs.readFileSync(path.resolve("src/app/api/customer/frameworks/_shared.ts"), "utf8")
  );
  assert.match(shared, /status: 404/, "ortak cevap 404 değil");
  assert.match(shared, /framework_not_found/, "kod alanı yok");

  // ÜRETİCİ ekranı `frameworkScreensEnabled` kullanır (admin oturumunun bu
  // panelde bir karşılığı yok, kapı yalnız bayrak).
  const plan = strip(fs.readFileSync(path.resolve("src/app/manufacturer/plan/page.tsx"), "utf8"));
  assert.match(
    plan,
    /if \(!\(await frameworkScreensEnabled\(\)\)\) notFound\(\);/,
    "üretici plan ekranının bayrak kapısı yok"
  );
  // Kenar çubuğu satırı da bayrağa bağlı: 404 veren bir ekrana götüren bir
  // menü maddesi bırakmak üreticiye olmayan bir sayfa söylemekti.
  const sidebar = strip(fs.readFileSync(path.resolve("src/app/manufacturer/sidebar.tsx"), "utf8"));
  assert.match(
    sidebar,
    /\.\.\.\(frameworkPlanEnabled \? \[ \{ href: "\/manufacturer\/plan"/,
    "üretici kenar çubuğu satırı bayrak kapalıyken de çiziliyor"
  );
});

test("ÇERÇEVE: müşteri ekranı kilit cümlesini ve parti onayını yazar", () => {
  const view = presentFramework({
    detail: frameworkDetail(),
    viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
    now: NOW_FW,
    sign: (key) => `/signed/${key}`,
  });
  const html = plain(inLocale(createElement(FrameworkClient, { initial: view })));
  assert.ok(html.includes("C-000123"), "anlaşma numarası yok");
  assert.ok(
    html.includes(fill(tr["instantQuote.framework.priceLockedUntil"], { date: "31.12.2026" })),
    "fiyat kilidi cümlesi yok"
  );
  assert.ok(html.includes(tr["instantQuote.framework.perBatchBilling"]), "parti başına fatura cümlesi yok");
  // ADLANDIRILMIŞ ENGELİN TELAFİSİ: "Bu partiyi öde" ÖNCE bir onay adımı
  // açar; doğrudan ödeme sayfasına giden bir bağlantı DEĞİLDİR, çünkü orada
  // "Parti 3/8" bağlamı gösterilemiyor.
  assert.ok(html.includes(tr["instantQuote.framework.payBatch"]), "ödeme düğmesi yok");
  assert.ok(
    !html.includes('href="/teklif/T-000777/odeme"'),
    "ödeme sayfasına ONAYSIZ doğrudan bağlantı var"
  );
  const clientSrc = fs.readFileSync(path.resolve("src/app/cerceve/[number]/client.tsx"), "utf8");
  assert.match(clientSrc, /payConfirmNote/, "onay adımının gerekçe cümlesi yok");
  assert.match(clientSrc, /\/odeme/, "onaydan sonra ödeme yoluna gitmiyor");
  // Kilidi dolmuş anlaşmada ekran "yeni fiyat için bize yazın" der.
  const expiredHtml = plain(
    inLocale(
      createElement(FrameworkClient, {
        initial: presentFramework({
          // Kilit DOLMUŞ: `presentFramework` bunu `priceLockedUntil` ile `now`dan
    // KENDİ türetir (servisin `lockExpired` alanını kopyalamaz), yani hâli
    // tarih üzerinden kurmak gerekiyor — ekranın ölçüsü `releaseBatch`in
    // ölçüsüyle aynı kalsın.
    detail: frameworkDetail({ priceLockedUntil: "2026-09-30T20:59:59.999Z" }),
          viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
          now: NOW_FW,
          sign: (key) => `/signed/${key}`,
        }),
      })
    )
  );
  assert.ok(expiredHtml.includes(tr["instantQuote.framework.lockExpired"]));
});

test("ÇERÇEVE: KLONUN SÜRESİ dolunca 'öde' düğmesi DÜŞER, cümle YAZILIR", () => {
  // Parti serbest bırakılmış olması ödenebilir olması DEMEK DEĞİL: klon
  // sıradan bir `quotes` satırıdır ve bakımın `expireQuotes` aşaması onu
  // kapatabilir (R2 kapısı yalnız anlaşmanın KAYNAK teklifini koruyor).
  // Havalesi geciken partide ekran "Bu partiyi öde" çizmeye devam ederse
  // müşteri `/teklif/<no>/odeme`de `canCheckout=false` ile reddedilir.
  const base = frameworkDetail();
  const batchOf = (over: Record<string, unknown>) =>
    presentFramework({
      detail: frameworkDetail({ batches: [{ ...base.batches[0], ...over }] }),
      viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
      now: NOW_FW,
      sign: (key) => `/signed/${key}`,
    }).batches[0];

  const live = batchOf({});
  assert.equal(live.payable, true, "yürürlükteki klonlu parti ödenemez sayıldı");
  assert.equal(live.payBlocked, false);

  // (a) Bakım turu klonu kapattı.
  const closed = batchOf({ quoteStatus: "expired", quoteExpiresAt: "2026-10-01T20:59:59.999Z" });
  assert.equal(closed.payable, false, "süresi dolmuş klonda hâlâ 'öde' çiziliyor");
  assert.equal(closed.payBlocked, true, "müşteriye partinin neden ödenemediği söylenmiyor");

  // (b) Tur HENÜZ KOŞMADI: durum `quoted`, ama TARİH geçmiş. `quotePermissions`
  // tarihi durumdan bağımsız ölçüyor ve ödeme ucu da onu çağırıyor.
  const stale = batchOf({ quoteExpiresAt: "2026-10-01T20:59:59.999Z" });
  assert.equal(stale.payable, false, "tarihi geçmiş klon `quoted` diye ödenebilir sayıldı");
  assert.equal(stale.payBlocked, true);

  // (c) İptal edilmiş klon da aynı kapıdan geçer.
  assert.equal(batchOf({ quoteStatus: "cancelled" }).payBlocked, true);

  // EKRAN: düğme YOK, cümle VAR (ve tersi).
  const blockedHtml = plain(
    inLocale(
      createElement(FrameworkClient, {
        initial: presentFramework({
          detail: frameworkDetail({
            batches: [
              {
                ...base.batches[0],
                quoteStatus: "expired",
                quoteExpiresAt: "2026-10-01T20:59:59.999Z",
              },
            ],
          }),
          viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
          now: NOW_FW,
          sign: (key) => `/signed/${key}`,
        }),
      })
    )
  );
  assert.ok(
    blockedHtml.includes(tr["instantQuote.framework.payUnavailable"]),
    "ödenemeyen partide müşteriye hiçbir şey söylenmiyor"
  );
  assert.ok(
    !blockedHtml.includes(tr["instantQuote.framework.payBatch"]),
    "ödenemeyen partide 'Bu partiyi öde' düğmesi hâlâ çiziliyor"
  );
  const liveHtml = plain(
    inLocale(
      createElement(FrameworkClient, {
        initial: presentFramework({
          detail: base,
          viewer: { canSeePrices: true, isOwner: true, isAdmin: false },
          now: NOW_FW,
          sign: (key) => `/signed/${key}`,
        }),
      })
    )
  );
  assert.ok(
    !liveHtml.includes(tr["instantQuote.framework.payUnavailable"]),
    "ödenebilir partide 'bağlantı geçersiz' cümlesi yazılıyor"
  );
});

test("ÇERÇEVE: müşteri ekranı ÇERÇEVE ODASINA abone (framework:<id>)", () => {
  // Müşteri akışı (`/api/realtime/customer`) YETMEZ: `emitFrameworkChanged`
  // `topics.customer(userId)`ye yalnız çağıran `userId` verdiğinde düşüyor ve
  // `planBatches` / `createFrameworkFromQuote` vermiyor — admin parti planını
  // kurduğunda açık ekran tazelenmezdi. Üstelik o uç MÜŞTERİ oturumu istiyor,
  // yani anlaşmayı admin oturumuyla açan biri hiç canlı olmazdı.
  // YORUMLAR SAYMAZ: bir yorumda duran adres pini yeşil tutardı.
  const strip = (raw: string): string =>
    raw
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/\s+/g, " ");

  const page = strip(
    fs.readFileSync(path.resolve("src/app/cerceve/[number]/page.tsx"), "utf8")
  );
  assert.match(
    page,
    /RealtimeProvider url=\{`\/api\/realtime\/framework\/\$\{encodeURIComponent\(access\.frameworkId\)\}`\}/,
    "müşteri ekranı çerçeve odasına abone değil"
  );
  assert.doesNotMatch(page, /\/api\/realtime\/customer/, "müşteri akışına abonelik geri geldi");

  const route = strip(
    fs.readFileSync(path.resolve("src/app/api/realtime/framework/[id]/route.ts"), "utf8")
  );
  assert.match(route, /sseResponse\(req, \[topics\.framework\(access\.frameworkId\)\]\)/, "oda konusu yok");
  // KAPI, sayfanın kapısıyla AYNI iki işlev: ikinci bir erişim matrisi değil.
  assert.match(
    route,
    /if \(!\(await frameworkSurfacesEnabled\(\)\)\) return frameworkNotFound\(\);/,
    "bayrak kapısı yok"
  );
  assert.match(route, /resolveFrameworkAccess\(id\)/, "erişim matrisi okunmuyor");
  assert.doesNotMatch(route, /\b403\b/, "akış 403 üretiyor (numara varlığını sayar)");
});

test("ÇERÇEVE: hesap listesindeki parti teklifi ROZETLE anlaşmaya bağlanır", () => {
  const html = plain(
    inLocale(
      createElement(QuoteListTable, {
        items: [
          {
            ...QUOTE_ROW,
            number: "T-000777",
            frameworkBatch: { number: "C-000123", position: 3 },
          },
        ],
      })
    )
  );
  assert.ok(
    html.includes(
      fill(tr["instantQuote.framework.batchBadge"], { number: "C-000123", position: 3 })
    ),
    "çerçeve rozeti yok: müşteri listede adsız bir T- satırı görür"
  );
  assert.ok(html.includes('href="/cerceve/C-000123"'), "rozet anlaşmaya bağlanmıyor");
  // Parti olmayan satırda rozet HİÇ çizilmez.
  const plainRow = plain(inLocale(createElement(QuoteListTable, { items: [QUOTE_ROW] })));
  assert.ok(!plainRow.includes("Çerçeve"), "sıradan teklifte de rozet çiziliyor");
});

// ─── TAKIM ÇALIŞMA ALANI: /account/takim, rozet ve kolonlar (0072 · T-5) ────
//
// Sorulan soru tek: YETKİ MATRİSİ ekranda da uygulanıyor mu, ve takımı olmayan
// müşterinin ekranı bit bit aynı mı kaldı.

const TEAM_PROFILE: TeamProfileView = {
  id: "88888888-8888-4888-8888-888888888888",
  name: "QA Mühendislik A.Ş.",
  invoiceType: "corporate",
  companyName: "QA Mühendislik A.Ş.",
  taxId: "1234567890",
  taxIdType: "vkn",
  taxOffice: "Kadıköy",
  billingAddress: null,
  shippingAddress: null,
  memberCanCheckout: false,
};

const SELF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Ekranı BİR ROLÜN gözünden çizer. Rol SUNUCUDAN prop olarak geliyor
 * (`page.tsx`), yani bu fikstür gerçek yolun aynısıdır — istemci rolü kendi
 * türetmiyor.
 */
function renderTeamClient(role: TeamRole): string {
  const self: TeamMemberView = {
    userId: SELF_ID,
    name: "Can Üye",
    email: "can@qa.test",
    role,
    joinedAt: "2026-09-02T09:00:00.000Z",
  };
  const other: TeamMemberView = {
    userId: OTHER_ID,
    name: "Ayşe Sahip",
    email: "ayse@qa.test",
    // "Takım başına tek sahip" DB kısıtı: sahip rolünü oynayan izleyicinin
    // yanına ikinci bir `owner` konmaz.
    role: role === "owner" ? "member" : "owner",
    joinedAt: "2026-09-01T09:00:00.000Z",
  };
  return plain(
    inLocale(
      createElement(TeamClient, {
        team: TEAM_PROFILE,
        role,
        members: [other, self],
        invites: [
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            email: "davet@qa.test",
            role: "member",
            expiresAt: "2026-10-01T09:00:00.000Z",
          },
        ],
        sessionUserId: SELF_ID,
      })
    )
  );
}

test("TAKIM EKRANI: `viewer` rolünde davet, rol seçici ve profil formu YOK", () => {
  const html = renderTeamClient("viewer");
  assert.ok(!html.includes(tr["instantQuote.team.invite.submit"]), "davet formu çizildi");
  assert.ok(!html.includes(tr["instantQuote.team.invite.title"]), "davet bölümü çizildi");
  // Rol seçici VE profil formunun TEK seçicisi: salt okunur rolde ekranda
  // HİÇBİR `<select>` olmamalı.
  assert.doesNotMatch(html, /<select/, "salt okunur rolde seçici çizildi");
  assert.ok(!html.includes(tr["instantQuote.team.profile.title"]), "profil formu çizildi");
  assert.ok(
    !html.includes(tr["instantQuote.team.profile.memberCanCheckout"]),
    "`member_can_checkout` anahtarı salt okunur role çizildi"
  );
  assert.ok(!html.includes(tr["instantQuote.team.profile.deleteTeam"]), "takımı sil çizildi");
  assert.ok(!html.includes(tr["instantQuote.team.member.remove"]), "üye çıkarma çizildi");
  // Okuma yolu AÇIK: üye listesi, teklifler ve siparişler dört rolün hepsinde.
  assert.ok(html.includes("ayse@qa.test"), "üye listesi yok");
  assert.ok(html.includes(tr["instantQuote.team.quote.listTitle"]), "teklif listesi yok");
  assert.ok(html.includes(tr["instantQuote.team.orders.title"]), "sipariş listesi yok");
});

test("TAKIM EKRANI: `member` rolünde davet formu YOK ama teklif listesi VAR", () => {
  const html = renderTeamClient("member");
  assert.ok(!html.includes(tr["instantQuote.team.invite.submit"]), "üyeye davet formu çizildi");
  assert.ok(!html.includes(tr["instantQuote.team.profile.title"]), "üyeye profil formu çizildi");
  assert.ok(
    !html.includes(tr["instantQuote.team.profile.memberCanCheckout"]),
    "üyeye `member_can_checkout` anahtarı çizildi"
  );
  assert.ok(html.includes(tr["instantQuote.team.quote.listTitle"]), "teklif listesi yok");
  assert.ok(html.includes(tr["instantQuote.team.orders.title"]), "sipariş listesi yok");
});

test("TAKIM EKRANI: `admin` rolünde davet formu VAR, 'takımı sil' YOK", () => {
  const html = renderTeamClient("admin");
  assert.ok(html.includes(tr["instantQuote.team.invite.submit"]), "yöneticide davet formu yok");
  assert.ok(html.includes(tr["instantQuote.team.profile.title"]), "yöneticide profil formu yok");
  assert.ok(
    html.includes(tr["instantQuote.team.profile.memberCanCheckout"]),
    "yöneticide `member_can_checkout` anahtarı yok"
  );
  assert.ok(
    !html.includes(tr["instantQuote.team.profile.deleteTeam"]),
    "yöneticiye 'takımı sil' çizildi"
  );
});

test("TAKIM EKRANI: `owner` rolünde hepsi VAR", () => {
  const html = renderTeamClient("owner");
  for (const key of [
    "instantQuote.team.invite.submit",
    "instantQuote.team.profile.title",
    "instantQuote.team.profile.memberCanCheckout",
    "instantQuote.team.profile.deleteTeam",
    "instantQuote.team.member.remove",
    "instantQuote.team.member.transfer",
    "instantQuote.team.quote.listTitle",
    "instantQuote.team.orders.title",
  ] as const) {
    assert.ok(html.includes(tr[key]), `sahipte ${key} yok`);
  }
  // Sahip AYRILAMAZ (önce devretmeli): düğme hiçbir rolde ölü durmaz.
  assert.ok(!html.includes(tr["instantQuote.team.member.leave"]), "sahibe 'ayrıl' çizildi");
});

test("TAKIM EKRANI: üye satırı YALNIZ ad + e-posta + rol taşır", () => {
  // Telefon ve kişisel adres takımla PAYLAŞILMAZ; ekranın onları isteyecek bir
  // alanı da yok (prop tipi taşımıyor, bu yüzden iddia metne bakar).
  const html = renderTeamClient("owner");
  assert.ok(html.includes(tr["instantQuote.team.member.privacyNote"]), "gizlilik notu yok");
  for (const forbidden of [/telefon:/i, /\+90/, /adres defteri/i]) {
    assert.doesNotMatch(html, forbidden, `üye listesinde yasak alan: ${forbidden}`);
  }
});

test("TAKIM EKRANI: siparişler SALT OKUNUR olduğunu YAZAR", () => {
  for (const role of TEAM_ROLES) {
    assert.ok(
      renderTeamClient(role).includes(tr["instantQuote.team.orders.readOnly"]),
      `${role}: salt okunur cümlesi yok`
    );
  }
});

test("TAKIM EKRANI: teslimat adresinin yalnız ÖN DOLDURDUĞU yazılı", () => {
  // `quotes`ta `shipping_address` kolonu YOK; adres ödeme sırasında alınıp
  // doğrudan taslağa yazılıyor. Ekran bunu söylemezse müşteri adresi burada
  // değiştirip siparişin oraya gideceğini sanır.
  const html = renderTeamClient("owner");
  assert.ok(html.includes(tr["instantQuote.team.profile.shippingNote"]), "ön doldurma notu yok");
  assert.ok(html.includes(tr["instantQuote.team.profile.invoiceNote"]), "fatura notu yok");
});

test("TAKIM EKRANI: takımı olmayan müşteri 'takım kur' formu görür", () => {
  const html = plain(
    inLocale(
      createElement(TeamClient, {
        team: null,
        role: null,
        members: [],
        invites: [],
        sessionUserId: SELF_ID,
      })
    )
  );
  assert.ok(html.includes(tr["instantQuote.team.create.submit"]), "kurma formu yok");
  // KVKK onayı ZORUNLU ve varsayılan olarak KAPALI (onayın kanıtı eylemdir).
  assert.ok(html.includes(tr["instantQuote.team.create.kvkk"]), "KVKK cümlesi yok");
  assert.doesNotMatch(
    html,
    /type="checkbox"[^>]*checked/,
    "onay kutusu varsayılan olarak işaretli"
  );
  // Takımı olmayan ekranda üye/davet/sipariş bölümleri HİÇ çizilmez.
  assert.ok(
    !html.includes(tr["instantQuote.team.orders.title"]),
    "takımsız ekranda sipariş bölümü"
  );
});

test("TAKIM EKRANI: ekranda para aritmetiği YOK", () => {
  const raw = fs.readFileSync(path.resolve("src/app/account/takim/team-client.tsx"), "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const moneyArithmetic = code.match(/\w*[Kk]urus\w*\s*[*/%+-][^>=]|[*/%+-]\s*\w*[Kk]urus\w*/g);
  assert.equal(moneyArithmetic, null, `tutar üzerinde aritmetik: ${moneyArithmetic?.join(", ")}`);
  for (const conversion of [/\/\s*100\b/, /toFixed\(/]) {
    assert.doesNotMatch(code, conversion, "ekranda para çevrimi var");
  }
});

// ─── Takım rozeti ───────────────────────────────────────────────────────────

function renderTeamBadge(quote: PresentedQuote): string {
  return plain(inLocale(createElement(QuoteTeamBadge, { quote, onQuoteChanged: noop })));
}

test("ROZET: takımsız teklifte HİÇ çizilmez (tek <div> bile yok)", () => {
  // Birincil kısıt: `team` anahtarı olmayan gövdede rozet yoktur. Sondanın
  // cevabı da gelmediği için "kendi takımım" sorusu hiç sorulmaz.
  const quote = pricedQuote();
  assert.equal("team" in quote, false, "takımsız fikstüre `team` anahtarı girmiş");
  assert.equal(renderTeamBadge(quote), "", "takımsız teklifte rozet çizildi");
});

test("ROZET: takım teklifinde ad yazılır ve 'ayır' düğmesi çizilir", () => {
  const html = renderTeamBadge(teamQuote("admin", false));
  assert.ok(
    html.includes(fill(tr["instantQuote.team.quote.badge"], { team: "QA Mühendislik A.Ş." })),
    "rozet takımın adını yazmıyor"
  );
  assert.ok(html.includes(tr["instantQuote.team.quote.detach"]), "'ayır' düğmesi yok");
  // Teklif ZATEN bağlı: "bağla" düğmesi çizilmez.
  assert.ok(
    !html.includes(tr["instantQuote.team.quote.attach"]),
    "bağlı teklifte 'bağla' düğmesi"
  );
});

test("ROZET: `viewer` rolünde düğme YOK, ad VAR", () => {
  const html = renderTeamBadge(teamQuote("viewer", false));
  assert.ok(html.includes("QA Mühendislik A.Ş."), "salt okunur üye takımın adını görmüyor");
  assert.ok(
    !html.includes(tr["instantQuote.team.quote.detach"]),
    "salt okunur rolde 'ayır' düğmesi"
  );
  assert.ok(
    !html.includes(tr["instantQuote.team.quote.attach"]),
    "salt okunur rolde 'bağla' düğmesi"
  );
});

test("ROZET: `member` yalnız KENDİ açtığı teklifi ayırır", () => {
  // Kendi açtığı teklif: erişim KİŞİSEL SAHİPLİKTEN gelir (`isOwner`), yani
  // "kendi işi" kuralı tutar.
  const own = teamQuote("member", false, {
    viewer: {
      canSeePrices: true,
      canEdit: true,
      isOwner: true,
      isShare: false,
      isAdmin: false,
      isTeam: true,
      teamRole: "member",
    },
  });
  assert.ok(
    renderTeamBadge(own).includes(tr["instantQuote.team.quote.detach"]),
    "üye kendi teklifini ayıramıyor"
  );
  // Meslektaşının teklifi: erişim yalnız ÜYELİKTEN gelir → düğme YOK.
  assert.ok(
    !renderTeamBadge(teamQuote("member", false)).includes(
      tr["instantQuote.team.quote.detach"]
    ),
    "üye başkasının teklifini ayırabiliyor"
  );
});

// ─── "Takım" ve "Açan" kolonları ────────────────────────────────────────────

test("KOLON: takımsız listede tablo bugünküyle BİREBİR aynı (yedi <th>)", () => {
  const html = inLocale(createElement(QuoteListTable, { items: [QUOTE_ROW] }));
  assert.equal(QUOTE_ROW.teamName, null);
  assert.equal(QUOTE_ROW.ownerName, null);
  assert.equal((html.match(/<th\b/g) ?? []).length, 7, "kolon sayısı değişmiş");
  assert.ok(
    !html.includes(tr["instantQuote.account.quotes.column.team"]),
    "Takım kolonu çizildi"
  );
  assert.ok(
    !html.includes(tr["instantQuote.account.quotes.column.owner"]),
    "Açan kolonu çizildi"
  );
});

test("KOLON: HERHANGİ bir satırda veri varsa iki kolon daha çizilir", () => {
  // Ölçü "ilk satır" DEĞİL "herhangi bir satır": takıma bağlı tek teklifi olan
  // müşteride de kolon görünmeli.
  const html = plain(
    inLocale(
      createElement(QuoteListTable, {
        items: [
          QUOTE_ROW,
          {
            ...QUOTE_ROW,
            id: "22222222-2222-4222-8222-222222222222",
            number: "T-000456",
            teamName: "QA Mühendislik A.Ş.",
            ownerName: "Ayşe Sahip",
          },
        ],
      })
    )
  );
  assert.equal((html.match(/<th\b/g) ?? []).length, 9, "iki kolon eklenmemiş");
  assert.ok(html.includes(tr["instantQuote.account.quotes.column.team"]), "Takım başlığı yok");
  assert.ok(html.includes(tr["instantQuote.account.quotes.column.owner"]), "Açan başlığı yok");
  assert.ok(html.includes("QA Mühendislik A.Ş."), "takım adı satıra yazılmamış");
  assert.ok(html.includes("Ayşe Sahip"), "açan kişi satıra yazılmamış");
});

test("TAKIM EKRANI: davet formu Turnstile jetonunu GÖNDERİYOR", () => {
  // `Turnstile` bileşeni SITE_KEY yokken `null` döner (dev/test), yani markup
  // üzerinden ölçülemez. Kapı bu yüzden KAYNAKTAN pinlenir — ucun kendi
  // tarafındaki `verifyTurnstileToken` iddiası `test-customer-team-api.ts`te.
  const source = fs.readFileSync(path.resolve("src/app/account/takim/team-client.tsx"), "utf8");
  assert.match(source, /from "@\/components\/turnstile"/, "Turnstile import edilmemiş");
  assert.match(source, /<Turnstile ref=\{turnstileRef\} \/>/, "Turnstile çizilmemiş");
  assert.match(source, /turnstileRef\.current\?\.getToken\(\)/, "jeton alınmıyor");
  assert.match(source, /turnstileToken: token/, "jeton gövdeye yazılmıyor");
});

test("TAKIM: KVKK onay kutusu ÜÇ yerde — kurma, davet GÖNDERME ve davet KABULÜ", () => {
  // Tasarım §8 + brief §T5.2'nin KVKK listesi: (1) takım kurma formu,
  // (2) davet GÖNDERME formu, (3) davet kabul ekranı. Dördüncü yer teklifi
  // takıma bağlama UYARISIDIR ve o bir onay kutusu değil (`window.confirm`).
  const teamClient = fs.readFileSync(
    path.resolve("src/app/account/takim/team-client.tsx"),
    "utf8"
  );
  const inviteClient = fs.readFileSync(
    path.resolve("src/app/takim/davet/[token]/invite-client.tsx"),
    "utf8"
  );
  // Takım ekranında İKİ form var (kurma + davet), yani İKİ onay gövdesi.
  assert.equal(
    (teamClient.match(/kvkkConsent: consent/g) ?? []).length,
    2,
    "takım ekranında iki KVKK onayı (kurma + davet) yok"
  );
  assert.match(inviteClient, /kvkkConsent: consent/, "davet kabulü onayı göndermiyor");
  // Davet GÖNDERME gövdesi: e-posta + rol + ONAY + jeton.
  // MUTASYON SINAVI: gövdeden `kvkkConsent`i çıkar → bu iddia KIRMIZI.
  const inviteBody =
    /body: JSON\.stringify\(\{ email, role, kvkkConsent: consent, turnstileToken: token \}\)/;
  assert.match(teamClient, inviteBody, "davet gövdesi beklenen alanları taşımıyor");
  // Her üç kutu da ZORUNLU: onay verilmeden düğme basılamaz. Ekrandaki kapı
  // ucun kopyası değil, karşılığıdır — şema iddiası
  // `test-customer-team-api.ts`te (`kvkkConsent: kvkkConsentField`, üç uç).
  assert.equal(
    (teamClient.match(/disabled=\{busy \|\| !consent\}/g) ?? []).length,
    2,
    "takım ekranındaki iki düğme de onaya bağlı değil"
  );
  assert.match(inviteClient, /disabled=\{busy \|\| !consent\}/, "kabul düğmesi onaya bağlı değil");
  assert.match(
    teamClient,
    /d\["instantQuote\.team\.invite\.sendKvkk"\]/,
    "davet formunun onay cümlesi çizilmiyor"
  );
  // Bağlama onayı bir CÜMLEDİR ve rozette duruyor.
  const badge = fs.readFileSync(path.resolve("src/components/quote/team-badge.tsx"), "utf8");
  assert.match(
    badge,
    /window\.confirm\(d\["instantQuote\.team\.quote\.attachWarning"\]\)/,
    "bağlama onayı uyarı cümlesini göstermiyor"
  );
});

test("TAKIM EKRANI: takım teklifleri UÇTA daraltılır (`?scope=team`), istemcide süzülmez", () => {
  // Sayfa-1 süzgeci takım satırlarını SESSİZCE kaybediyordu: liste ucu kişisel
  // ve takım satırlarını birlikte, 20'lik sayfalarla döndürüyor (PAGE_SIZE),
  // yani son 20 teklifi kişisel olan müşteri takımın onlarca teklifi olsa da
  // boş liste okuyordu. Canlı kanıt `scripts/test-quote-service-db.ts`te
  // (kapsamın gerçek satırlarla ölçümü); buradaki iddia EKRANIN hangi soruyu
  // sorduğudur.
  const source = fs.readFileSync(path.resolve("src/app/account/takim/team-client.tsx"), "utf8");
  assert.match(source, /"\/api\/customer\/quotes\?scope=team&page=1"/, "kapsam sorulmuyor");
  // MUTASYON SINAVI: istemci süzgecini geri koy → bu iddia KIRMIZI.
  assert.ok(
    !/filter\(\(item\) => item\.teamName !== null\)/.test(source),
    "istemci süzgeci geri gelmiş (uç kapsamı varken ikinci bir kural)"
  );
  // Kırpılma SESSİZ değil: uçtan `hasNext` gelirse tam listeye yol gösterilir.
  assert.match(source, /page\.hasNext && \(/, "`hasNext` okunmuyor");
  assert.match(
    source,
    /d\["instantQuote\.team\.quote\.listMore"\]/,
    "daha fazla teklif için yol gösterilmiyor"
  );
  // Uç kapsamı GERÇEKTEN uyguluyor (şema değil, sorgu): `scope=team` değeri
  // servise geçiyor ve servis koşulu daraltıyor.
  const route = fs.readFileSync(path.resolve("src/app/api/customer/quotes/route.ts"), "utf8");
  assert.match(route, /searchParams\.get\("scope"\) === "team"/, "uç kapsamı okumuyor");
  assert.match(route, /scopeOf\(request\)/, "kapsam servise geçmiyor");
  const service = fs.readFileSync(path.resolve("src/lib/services/quote-service.ts"), "utf8");
  assert.match(
    service,
    /listScope === "team" && scope\.team !== null\s*\?\s*eq\(quotes\.teamId, scope\.team\.teamId\)/,
    "servis kapsamı sorguda daraltmıyor"
  );
});

// ─── V1: yazılı olup TARAYICIYA GÖRÜNMEYEN rakamlar ─────────────────────────
//
// Ölçüm (2026-10-02): gerçek bir ChatGPT oturumunda "figür nerede
// yaptırabilirim" sorusuna Figurunica ÇIKMADI; çıkan üç markanın üçünde de
// alıntılanabilir bir RAKAM vardı. Bizim rakamlarımız sözlükte yazılıydı ama
// tarayıcıya giden HTML'de yoktu. Aşağıdaki nöbetçiler o rakamların TEKRAR
// kaybolmasını engeller: her biri "sayfa müşteriye/asistana hangi rakamı
// söylüyor" sorusunu sorar, bir bileşenin var olup olmadığını değil.

/**
 * Kaynak pinlerinden YORUMLARI ayıklar.
 *
 * Bu sevkiyatın dosya başlıkları yasakladıkları kalıpları (`new Date()`,
 * `force-dynamic`, elle yazılmış "25 µm") GEREKÇE olarak anıyor; nöbetçi kendi
 * gerekçesini ihlal sanmasın. Ev deseni (bkz. aynı dosyadaki diğer `strip`'ler).
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * `/create` dal kapısının JSX bloğunu — `{kapı && ( … )}` — METİN olarak ayırır.
 *
 * Neden ayrı bir ayıklayıcı: bu kapının arkasında İKİ nöbetçinin birlikte
 * koruduğu şey var (gerçekler bandı + figürin şeması) ve ikisi de MESAFEYLE
 * sınanamaz. `{kapı &&[\s\S]{0,300}<Band` gibi bir kalıp kapının KAPANIŞ
 * süslüsünü umursamadan geçer: korunan düğüm kapının ALTINA, kardeş olmayan
 * bir yere taşındığında da yeşil kalır — yani "yakınında" demekle "içinde"
 * demeyi karıştırır. Oysa ihlalin kendisi tam bu: band koşulsuzlaşırsa teklif
 * dallarında ₺3.499 yayımlanır, şema koşulsuzlaşırsa ekranda görünmeyen bir
 * `Offer` yayımlanır. Bu yüzden iddia İKİ yönlü kuruluyor — düğüm blokta VAR,
 * bloğun DIŞINDA yok.
 *
 * Süslü sayarak yürümek bu dosya için yeterli: `page.tsx` yorumsuz okunuyor
 * (yukarıdaki `stripComments`) ve blokta süslü taşıyan dize/şablon yok. Biri
 * eklenirse ayıklayıcı yanlış yerde durur ve iddia KIRMIZI döner — sessizce
 * yeşile kaçmaz.
 */
function createGateBlock(page: string, gateName: string): { inside: string; outside: string } {
  const open = page.search(new RegExp(`\\{\\s*${gateName}\\s*&&`));
  assert.notEqual(open, -1, `/create: \`${gateName}\` bir JSX kapısı olarak çizilmiyor`);
  let depth = 0;
  let end = -1;
  for (let i = open; i < page.length; i++) {
    if (page[i] === "{") depth++;
    else if (page[i] === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  assert.notEqual(end, -1, "/create: dal kapısının süslü parantezi kapanmıyor");
  return { inside: page.slice(open, end), outside: page.slice(0, open) + page.slice(end) };
}

/** `/create`in sunucuda çizilen gerçekler bandı. */
function renderCreateFactsBand(): string {
  return plain(
    inLocale(
      createElement(CreateFactsBand, {
        title: tr["create.product.title"],
        spec: tr["create.product.spec"],
        included: tr["create.product.included"],
      })
    )
  );
}

/** `/figur`in tam gövdesi (sayfanın `FigurunicaLanding` dışında gövdesi yok). */
function renderFigurBody(): string {
  return plain(inLocale(createElement(FigurunicaLanding, { d: pickFigurunicaDict(tr) })));
}

/** Anasayfa gövdesi — vitrin ürünsüz de çizilmek ZORUNDA (çıpa oradan gelmez). */
function renderStorefront(): string {
  return plain(
    inLocale(createElement(StorefrontHome, { products: [], roots: [], networkMap: null }))
  );
}

test("fiyat ve ölçü ETİKETİ sabitten türer, biçim tek yerde yazılı", () => {
  // Bu etiket dört yüzeyin (anasayfa, /figur, /create bandı, akışın ürün
  // kartı) paylaştığı TEK dize. Sabit değişince dördü birlikte değişir.
  assert.equal(FIGURINE_PRICE_LABEL, "₺3.499");
  assert.equal(FIGURINE_HEIGHT_LABEL, "15 cm");
  assert.equal(FIGURINE_PRICE_KURUS, 349900);

  // Etiket KURUŞ KAYBETMEZ: tam liraya oturmayan bir fiyat sessizce
  // yuvarlanırsa yayımlanan rakam tahsil edilen rakamdan sapar — bu sevkiyatın
  // tam da engellemeye çalıştığı şey. V1'de bu dal yalnız KAYNAK PİNİYLE
  // korunabiliyordu (sabit tek bir değer); V2 etiketi saf bir fonksiyona
  // ayırdı, çünkü yapısal veri şemadaki rakamdan sayfadaki etiketi yeniden
  // üretip karşılaştırıyor. Artık iki dal da DEĞERLE sınanıyor.
  assert.equal(figurinePriceLabel(FIGURINE_PRICE_KURUS), FIGURINE_PRICE_LABEL);
  assert.equal(figurinePriceLabel(349950), "₺3.499,50");
  assert.equal(figurinePriceLabel(350000), "₺3.500");
});

test("tanıtım cümlelerindeki rakam ELLE YAZILI DEĞİL, yer tutucudan gelir", () => {
  // Dört anahtar da bu sevkiyattan önce HİÇBİR YERDE render edilmiyordu ve
  // rakamı cümlenin içine elle yazılmıştı. Artık render ediliyorlar — ve rakam
  // sabitten geliyor, yani fiyat değiştiğinde cümle yalan söylemiyor.
  const expected: Record<string, string> = {
    "landing.hero.trust3": "₺3.499 tek fiyat",
    "landing.cta.subtitle":
      "Tek fiyat ₺3.499. Profesyonel el boyaması ve ücretsiz kargo dahil.",
    "landing.pricing.feature1": "15 cm SLA reçine figürin",
    "landing.box.figurine.desc":
      "15 cm, yüksek detaylı SLA reçine baskı; atölyemizde elle boyanmış.",
  };
  for (const [key, sentence] of Object.entries(expected)) {
    const raw = (tr as Record<string, string>)[key];
    assert.ok(raw, `${key} sözlükte yok`);
    assert.doesNotMatch(
      raw,
      /\d/,
      `tr:${key} içinde elle yazılmış bir rakam var — bir gün FIGURINE_PRICE_KURUS'tan ayrışır`
    );
    assert.equal(
      withProductFacts(raw),
      sentence,
      `tr:${key} doldurulduğunda eski cümleyi vermiyor`
    );
    // İngilizce sözlük `Dictionary` tipinin kaynağı; orada da rakam kalmasın.
    assert.doesNotMatch((en as Record<string, string>)[key], /\d/, `en:${key} rakam taşıyor`);
  }
  // Tip kapısı dördünü tanımalı, yoksa `pickFigurunicaDict` onları taşımaz.
  for (const key of Object.keys(expected)) {
    assert.ok(
      (FIGURUNICA_KEYS as readonly string[]).includes(key),
      `${key} FIGURUNICA_KEYS'te yok`
    );
  }
});

test("/create'in sunucu bandı fiyatı, ölçüyü ve teslim süresini YAYINLAR", () => {
  // Brief'in üç gerçeği. Band olmadan /create HTML'inde "3.499" SIFIR kez
  // geçiyordu (ölçüm 2026-10-02, canlı sunucu HTML'i).
  const html = renderCreateFactsBand();
  assert.ok(html.includes("₺3.499"), "fiyat bandda yok");
  assert.ok(html.includes("15 cm"), "ölçü bandda yok");
  assert.ok(html.includes("5-7 iş günü"), "üretim süresi bandda yok");
  assert.ok(html.includes("Ücretsiz kargo dahil"), "kargo taahhüdü bandda yok");
});

test("/create gerçekler bandı SUSPENSE SINIRININ DIŞINDA ve sunucuda çiziliyor", () => {
  // MUTASYON SINAVI: bandı yeniden `<Suspense>`in İÇİNE al → bu iddia KIRMIZI.
  // Sınırın içi, `useSearchParams` yüzünden statik üretimde fallback'e düşen
  // alt ağaçtır; ayrıca dinamik render'da fallback hiç SERVİS EDİLMEZ, yani
  // "fallback'e koy" çözümü rakamı hiçbir tarayıcıya ULAŞTIRMAZ.
  const page = stripComments(fs.readFileSync(path.resolve("src/app/create/page.tsx"), "utf8"));
  assert.doesNotMatch(
    page,
    /^\s*["']use client["']/m,
    "/create sayfası istemci modülü — gerçekler bandı sunucuda çizilmiyor"
  );
  // İKİ KÜT KAÇIŞ YASAK — ve bu iddia ne söylediğini bilerek söylüyor: rota
  // zaten dinamik (hem kök layout'un `cookies()` okuması hem de bu sayfanın
  // `searchParams` okuması yüzünden), yani burada "rotayı sunucuya bağlama"
  // diye bir koruma MÜMKÜN DEĞİL. Pinlenen şey dar: `force-dynamic` /
  // `revalidate = 0` bütün segmenti önbelleğin (ve ileride PPR'ın) dışına
  // atar, oysa bu sayfanın sunucudan istediği tek şey URL'in kendisi.
  assert.doesNotMatch(
    page,
    /force-dynamic|revalidate\s*=\s*0/,
    "/create segmenti küt kaçışla önbelleğin dışına atılmış"
  );
  // Sayfa URL'i gerçekten okuyor: band dalın doğruluğuna bağlı (alttaki iddia).
  assert.match(page, /searchParams/, "/create sayfası URL'i okumuyor");

  const closeSuspense = page.indexOf("</Suspense>");
  const band = page.indexOf("<CreateFactsBand");
  assert.notEqual(closeSuspense, -1, "/create sayfasında Suspense sınırı yok");
  assert.notEqual(band, -1, "/create sayfası gerçekler bandını çizmiyor");
  assert.ok(
    band > closeSuspense,
    "<CreateFactsBand> Suspense sınırının İÇİNDE — statik üretimde HTML'den düşer"
  );

  // Akışın kendisi hâlâ istemcide ve dört sorgu parametresi dalı da duruyor.
  const client = fs.readFileSync(path.resolve("src/app/create/create-client.tsx"), "utf8");
  assert.match(client, /^["']use client["']/m, "akış istemci modülü değil");
  for (const param of ["path", "style", "previewId", "fromOrder"]) {
    assert.ok(
      client.includes(`searchParams.get("${param}")`),
      `?${param}= dalı kaybolmuş — müşteri davranışı değişti`
    );
  }
  // Bandın cümlesi akışın ürün kartıyla AYNI bileşenden gelir, iki kopya değil.
  assert.match(client, /<CreateProductFacts/, "ürün kartı paylaşılan bileşeni kullanmıyor");
});

test("/create bandı YALNIZ sabit fiyatlı dalda çiziliyor, teklif dallarında SUSUYOR", () => {
  // Band koşulsuzken, "bu ürünün liste fiyatı yoktur" diyen üç dalda da
  // "₺3.499 · 5-7 iş günü" yayınlıyordu; upload dalında ise aynı ekranda İKİ
  // farklı ₺ rakamı duruyordu (akış müşterinin kendi teklifini yazıyor).
  // Yayımlanan beyan akışın kendi beyanını yalanlamasın.
  for (const url of [
    {},
    { path: "photo" },
    { style: "storybook" },
    { style: "realistic" },
    // Bilinmeyen/Creative Lab slug'ı: istemci beyaz listeye almayıp varsayılan
    // figür şablonuna düşüyor, yani ekranda gerçekten sabit fiyatlı ürün var.
    { style: "keychain" },
  ]) {
    assert.equal(
      createUrlSellsFixedPriceFigure(url),
      true,
      `${JSON.stringify(url)} sabit fiyatlı dal, band SUSMAMALI`
    );
  }
  for (const url of [
    { path: "upload" },
    { path: "design" },
    { path: "object" },
    { style: "object" },
    { previewId: "pv_1" },
    { fromOrder: "ord_1" },
    // Tekrar eden parametrede `URLSearchParams.get` gibi İLK değer kazanır —
    // `CreateRouter` istemcide tam bunu okuyor, band onunla aynı dalı görmeli.
    { path: ["upload", "photo"] },
  ]) {
    assert.equal(
      createUrlSellsFixedPriceFigure(url),
      false,
      `${JSON.stringify(url)} teklif/bilinmeyen dal, band ₺ rakamı YAYINLAMAMALI`
    );
  }

  // O üç dalın ekrandaki cümlesi gerçekten "sabit fiyat yok" diyor; kapının
  // gerekçesi sözlükten doğrulanıyor, yorumdan değil.
  for (const key of [
    "create.designFlow.quotePrice",
    "create.customDesign.body",
    "create.customDesign.quoteNext",
  ]) {
    const sentence = (tr as Record<string, string>)[key];
    assert.ok(sentence, `${key} sözlükte yok`);
    assert.ok(
      !sentence.includes(FIGURINE_PRICE_LABEL),
      `tr:${key} teklif dalında liste fiyatı yazıyor`
    );
    assert.match(sentence, /fiyat/i, `tr:${key} artık fiyattan söz etmiyor — kapı gerekçesiz`);
  }

  // MUTASYON SINAVI: `page.tsx`te bandı koşulsuz çiz (ya da kapıyı `true` gibi
  // sabit bir ifadeye çevir) → bu iddia KIRMIZI. Kapının ADI yukarıdaki
  // yüklemeye BAĞLANAN değişkenden okunuyor, yoksa `{true && <Band/>}` da
  // "koşullu" sayılırdı.
  const page = stripComments(fs.readFileSync(path.resolve("src/app/create/page.tsx"), "utf8"));
  const gate = page.match(/const\s+(\w+)\s*=\s*createUrlSellsFixedPriceFigure\(/);
  assert.ok(gate, "/create sayfası dalı sormuyor — band koşulsuz çiziliyor");
  // İddia KAPSAMA, mesafe değil: band kapının JSX bloğunun İÇİNDE ve sayfanın
  // başka hiçbir yerinde çizilmiyor. Bandı kapının ALTINA koşulsuz taşımak da
  // (kapıyı koruyup kardeşliği bozmak) bu yüzden kırmızı döner.
  const factsGate = createGateBlock(page, gate[1]);
  assert.match(
    factsGate.inside,
    /<CreateFactsBand/,
    "<CreateFactsBand> dal kapısının İÇİNDE değil — teklif dallarında da ₺3.499 yayınlar"
  );
  assert.ok(
    !factsGate.outside.includes("<CreateFactsBand"),
    "<CreateFactsBand> kapının DIŞINDA da çiziliyor — teklif dallarında ₺3.499 yayınlanır"
  );
});

test("/figur ürün gerçeklerini DEKORATİF göstergeden ÖNCE yayınlar", () => {
  // Ölçüm: atıfların %44,2'si dokümanın ilk %30'undan geliyor. /figur bugüne
  // kadar HİÇ ₺ rakamı yayınlamıyordu, DOM sırasının başında ise alıntılanamaz
  // yazıcı göstergesi vardı ("layer 000/420", "27.4°C", "12,480").
  const html = renderFigurBody();
  assert.ok(html.includes("₺3.499"), "/figur fiyat yayınlamıyor");
  assert.ok(html.includes("15 cm"), "/figur ölçü yayınlamıyor");
  assert.ok(html.includes("5-7"), "/figur üretim süresi yayınlamıyor");

  const facts = Math.max(html.indexOf("₺3.499"), html.indexOf("15 cm"));
  for (const noise of ["000/420", "27.4", "12,480", "405nm"]) {
    const at = html.indexOf(noise);
    assert.notEqual(at, -1, `dekoratif gösterge "${noise}" kaybolmuş — nöbetçi kör kaldı`);
    assert.ok(
      facts < at,
      `ürün gerçekleri dekoratif "${noise}" metninden SONRA geliyor (gerçek ${facts}, gürültü ${at})`
    );
  }
  // Gösterge ekran okuyucuya da okunmaz.
  const sections = fs.readFileSync(path.resolve("src/components/figurunica/sections.tsx"), "utf8");
  assert.match(
    sections,
    /className=\{s\("hero-printer"\)\}\s*\n\s*aria-hidden="true"/,
    "yazıcı sahnesi aria-hidden değil"
  );
});

test("anasayfa bir FİYAT ÇIPASI yayınlar (vitrin boşken de)", () => {
  // Anasayfa sitemap önceliği 1.0 olan sayfa ve bugüne kadar görünür
  // metninde (1.359 karakter) tek bir ₺ rakamı yoktu. Çıpa vitrin
  // ürünlerinden GELMEZ: ürün listesi boşken de yazılmak zorunda.
  const html = renderStorefront();
  assert.ok(html.includes("₺3.499"), "anasayfa fiyat çıpası yayınlamıyor");
  assert.ok(html.includes("15 cm"), "anasayfa ölçü yayınlamıyor");
  assert.ok(html.includes("ücretsiz kargo dahil"), "anasayfa kargo taahhüdünü yazmıyor");
});

test("/nasil-calisir katman yüksekliğini RAKAMLA yazar, elle yazmadan", () => {
  // Rakip "14K reçine" yazıyor; bizim niteliksel cümlemiz ("katman izi
  // görünmeyecek kadar ince") alıntılanamaz. Rakam bir dosya ötede duruyordu.
  assert.equal(layerHeightLabel(tr), "25 µm");
  assert.equal(layerHeightLabel(en), "25 µm");

  const page = stripComments(
    fs.readFileSync(path.resolve("src/app/nasil-calisir/page.tsx"), "utf8")
  );
  // MUTASYON SINAVI: `25 µm`i sayfaya elle yaz → bu iddia KIRMIZI.
  assert.doesNotMatch(
    page,
    /\b25\s*µm/,
    "katman yüksekliği sayfaya ELLE yazılmış — /figur kahramanıyla bir gün ayrışır"
  );
  assert.match(page, /layerHeightLabel\(/, "katman yüksekliği tek kaynaktan okunmuyor");
  // Niteliksel cümle SİLİNMEDİ, rakam onun yanına kondu.
  assert.match(page, /Katman izi görünmeyecek kadar ince/, "niteliksel cümle silinmiş");
});

test("ticari sayfaların her birinde Son güncelleme satırı var", () => {
  // Ölçüm: yazar + son güncelleme alanı olmayan sayfaların bir asistanın
  // kaynak kartına çıkma oranı 2,4 kat düşük.
  const pages: Array<[string, string]> = [
    ["", "src/app/page.tsx"],
    ["/figur", "src/app/figur/page.tsx"],
    ["/nasil-calisir", "src/app/nasil-calisir/page.tsx"],
    ["/3d-baski", "src/app/3d-baski/page.tsx"],
    ["/urunler", "src/app/urunler/page.tsx"],
    ["/shop", "src/app/shop/page.tsx"],
  ];
  for (const [route, file] of pages) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.match(source, /<LastUpdated\b/, `${route || "/"}: Son güncelleme satırı çizilmiyor`);
    assert.ok(pageUpdatedAt(route), `${route || "/"}: tarihi kayıtlı değil`);
  }
  // Kayıt listesinde OLMAYAN bir yol satırı hiç çizmez (uydurma tarih yok).
  assert.equal(pageUpdatedAt("/admin/dashboard"), null);
  // "/" ve "" aynı sayfa.
  assert.equal(pageUpdatedAt("/"), pageUpdatedAt(""));
});

test("Son güncelleme tarihi `new Date()`ten TÜREMEZ", () => {
  // MUTASYON SINAVI: tarihi `new Date()` yap → bu iddia KIRMIZI. Her render'da
  // bugünü göstermek YANLIŞ bir tazelik sinyalidir: içerik altı ay önce
  // yazılmış olsa bile taze görünür. `sitemap.ts`in bugünkü hatası tam bu.
  for (const file of ["src/lib/config/page-updated.ts", "src/components/last-updated.tsx"]) {
    const source = stripComments(fs.readFileSync(path.resolve(file), "utf8"));
    assert.doesNotMatch(source, /new Date\(\s*\)/, `${file}: tarih saatten okunuyor`);
    assert.doesNotMatch(source, /Date\.now\(\)/, `${file}: tarih saatten okunuyor`);
  }
  // Satır insana Türkçe tarihi, makineye ISO tarihi AYNI düğümden verir.
  const html = plain(inLocale(createElement(LastUpdated, { path: "/figur", locale: "tr" })));
  assert.ok(html.includes("Son güncelleme"), "etiket yok");
  // HTML niteliği büyük/küçük harfe duyarsız; React `<time dateTime>`i olduğu
  // gibi basıyor, tarayıcı `datetime` olarak okuyor.
  assert.match(
    html,
    new RegExp(`datetime="${PAGE_UPDATED_AT["/figur"]}"`, "i"),
    `makine okunur tarih yok: ${html}`
  );
  assert.ok(html.includes("2 Ekim 2026"), `insan okunur tarih yok: ${html}`);
});

// ─── V2: yapısal veri — aynı rakamlar MAKİNE OKUNUR ─────────────────────────
//
// V1 rakamları tarayıcının gördüğü HTML'e taşıdı; V2 onları işaretliyor. Tek
// kural: **şemadaki her değer, sayfada GÖRÜNEN değerin birebir aynısı.**
// Ayrışırsa Google yapısal veriyi yok sayar ("structured data mismatch").
// Aşağıdaki nöbetçiler şemayı render edilen HTML'le karşılaştırır — yani
// "şema geçerli mi" değil, "şema sayfanın söylediğini mi söylüyor" sorusu.
// Şemanın kendi sözleşmesi (alanlar, @id, iade politikası) için bkz.
// `scripts/test-seo-jsonld.ts`.

/** Yapısal verinin kurulduğu adres ve sabit saat (priceValidUntil yuvarlanır). */
const SEO_APP_URL = "https://figurunica.com";
const SEO_NOW = Date.UTC(2026, 9, 2);

/**
 * Markup'ın GÖRÜNÜR METNİ. Şema metni tek bir dize, ekrandaki karşılığı ise
 * işaretlemeyle bölünmüş olabilir ("… sonra <strong>5-7 iş günü</strong>
 * sürer."); karşılaştırma bu yüzden etiketler ve React'in metin düğümleri
 * arasına koyduğu `<!-- -->` ayraçları ayıklandıktan sonra yapılır.
 */
function visibleText(html: string): string {
  return plain(html.replace(/<[^>]*>/g, ""));
}

test("figürin şeması /figur ve /create'te GÖRÜNEN rakamların AYNISINI söyler", () => {
  // MUTASYON SINAVI: şemadaki fiyatı 100 kuruş kaydır → bu iddia KIRMIZI,
  // çünkü şemadaki rakamdan üretilen etiket ("₺3.500") sayfada YOK.
  const node = buildFigurineProductJsonLd(tr, SEO_APP_URL, SEO_NOW);
  const offer = node.offers as Record<string, unknown>;
  const schemaLabel = figurinePriceLabel(Math.round(Number(offer.price) * 100));
  const height = node.height as Record<string, unknown>;
  const delivery = (offer.shippingDetails as Record<string, unknown>)
    .deliveryTime as Record<string, unknown>;
  const handling = delivery.handlingTime as Record<string, number>;
  const transit = delivery.transitTime as Record<string, number>;
  const production = `${handling.minValue}-${handling.maxValue}`;
  const shipping = `${transit.minValue}-${transit.maxValue}`;

  // 150 mm → "15 cm": şemanın mm değeri sayfanın bastığı etiketle aynı ölçü.
  assert.equal(`${Number(height.value) / 10} cm`, FIGURINE_HEIGHT_LABEL);

  for (const [surface, html] of [
    ["/figur", renderFigurBody()],
    ["/create", renderCreateFactsBand()],
  ] as Array<[string, string]>) {
    assert.ok(
      html.includes(schemaLabel),
      `${surface}: şemanın fiyatı (${schemaLabel}) sayfada görünmüyor`
    );
    assert.ok(
      html.includes(FIGURINE_HEIGHT_LABEL),
      `${surface}: şemanın ölçüsü sayfada görünmüyor`
    );
    assert.ok(
      html.includes(production),
      `${surface}: şemanın üretim süresi (${production}) sayfada görünmüyor`
    );
    assert.ok(
      html.includes(shipping),
      `${surface}: şemanın kargo süresi (${shipping}) sayfada görünmüyor`
    );
  }

  // Ürün adı ve açıklaması da sözlükten gelir, şemaya elle yazılmaz.
  assert.equal(node.name, tr["create.product.title"]);
  assert.ok(
    String(node.description).includes(tr["create.product.spec"]),
    "açıklama sayfanın ürün künyesinden türemiyor"
  );
  // Sabit sayfanın da, şemanın da kaynağı: ikisi ayrı yazılsa bir gün ayrışır.
  assert.equal(handling.maxValue, FIGURINE_LEAD_DAYS.productionMax);
  assert.equal(transit.maxValue, FIGURINE_LEAD_DAYS.transitMax);
});

test("figürin şeması ÜÇ sayfada da AYNI @id ile yayımlanıyor", () => {
  // Üç farklı `@id` üç ayrı ürün demek olurdu; aynı `@id` tek ürünün üç
  // yüzeyi. `/create` kapısı V1'in dal kapısıyla AYNI: liste fiyatı olmayan
  // dalda şema da yayımlanmaz, yoksa şema sayfanın beyanını yalanlar.
  const expected = `${SEO_APP_URL}/figur#figurine`;
  assert.equal(buildFigurineProductJsonLd(tr, SEO_APP_URL, SEO_NOW)["@id"], expected);

  const figur = fs.readFileSync(path.resolve("src/app/figur/page.tsx"), "utf8");
  const nasil = fs.readFileSync(path.resolve("src/app/nasil-calisir/page.tsx"), "utf8");
  const create = stripComments(
    fs.readFileSync(path.resolve("src/app/create/page.tsx"), "utf8")
  );
  for (const [name, source] of [
    ["/figur", figur],
    ["/nasil-calisir", nasil],
    ["/create", create],
  ] as Array<[string, string]>) {
    assert.match(
      source,
      /buildFigurineProductJsonLd\(/,
      `${name}: figürin şemasını yayınlamıyor`
    );
    assert.match(source, /<JsonLd\b/, `${name}: JSON-LD yayıcısını çizmiyor`);
  }
  const gate = create.match(/const\s+(\w+)\s*=\s*createUrlSellsFixedPriceFigure\(/);
  assert.ok(gate, "/create dalı sormuyor");
  // V1 bandıyla AYNI kapsama iddiası: şema kapının bloğunun içinde, dışında
  // ise hiç yok. Şemayı kapının bir satır ALTINA taşımak `?path=upload`ta
  // ekranda görünmeyen bir `Offer` yayınlamak olurdu.
  //
  // Aranan şey ÇAĞRI (`…JsonLd(`), yalnız ad değil: `import` satırı zaten
  // kapının dışında durmak ZORUNDA, yani çıplak adı dışarıda yasaklamak
  // doğru kodu kırmızı gösterirdi.
  const schemaGate = createGateBlock(create, gate[1]);
  assert.match(
    schemaGate.inside,
    /buildFigurineProductJsonLd\(/,
    "/create figürin şemasını dal kapısının İÇİNDE yayınlamıyor"
  );
  assert.ok(
    !schemaGate.outside.includes("buildFigurineProductJsonLd("),
    "/create figürin şemasını kapının DIŞINDA da yayınlıyor — fiyatsız dalda `Offer` sızar"
  );
});

test("/figur SSS şeması sayfadaki soru-cevapların AYNISI", () => {
  // MUTASYON SINAVI: şemaya sayfada OLMAYAN bir cevap ekle → bu iddia KIRMIZI.
  // Şema sözlükten TÜRETİLİR (`figurineFaqItems`), elle kopyalanmaz: iki kopya
  // bir gün ayrışır ve Google'ın gördüğü cevap sayfadakinden farklı olur.
  const d = pickFigurunicaDict(tr);
  const node = buildFaqPageJsonLd({
    url: `${SEO_APP_URL}/figur`,
    name: d["landing.faq.title"],
    items: figurineFaqItems(d),
  });
  assert.ok(node, "/figur SSS şeması üretilmiyor");
  const text = visibleText(renderFigurBody());
  const entities = node.mainEntity as Array<Record<string, unknown>>;
  assert.equal(entities.length, 8, "sekiz soru-cevap bekleniyor");
  for (const entity of entities) {
    const q = String(entity.name);
    const a = String((entity.acceptedAnswer as Record<string, unknown>).text);
    assert.ok(text.includes(q), `soru sayfada yok: ${q}`);
    assert.ok(text.includes(a), `cevap sayfada yok: ${q}`);
  }
  // Ekrandaki liste de AYNI işlevden gelir (ikinci bir dizi değil).
  const faq = fs.readFileSync(path.resolve("src/components/figurunica/faq.tsx"), "utf8");
  assert.match(faq, /figurineFaqItems\(/, "ekran SSS listesi paylaşılan kaynaktan gelmiyor");
  const page = fs.readFileSync(path.resolve("src/app/figur/page.tsx"), "utf8");
  assert.match(page, /buildFaqPageJsonLd\(/, "/figur SSS şemasını yayınlamıyor");
});

test("/3d-baski SSS ve adım şemaları sayfanın KENDİ gövdesinden türüyor", () => {
  const text = visibleText(renderLanding());
  const faqNode = buildFaqPageJsonLd({
    url: `${SEO_APP_URL}/3d-baski`,
    name: LANDING_FAQ_TITLE,
    items: landingFaq(SEED_SNAPSHOT),
  });
  assert.ok(faqNode, "/3d-baski SSS şeması üretilmiyor");
  const entities = faqNode.mainEntity as Array<Record<string, unknown>>;
  assert.equal(entities.length, landingFaq(SEED_SNAPSHOT).length);
  for (const entity of entities) {
    const q = String(entity.name);
    const a = String((entity.acceptedAnswer as Record<string, unknown>).text);
    assert.ok(text.includes(q), `soru sayfada yok: ${q}`);
    assert.ok(text.includes(a), `cevap sayfada yok: ${q}`);
  }

  const howTo = buildHowToJsonLd({
    url: `${SEO_APP_URL}/3d-baski`,
    name: LANDING_STEPS_TITLE,
    steps: landingSteps(SEED_SNAPSHOT).map((s) => ({ name: s.title, text: s.body })),
  });
  assert.ok(howTo, "/3d-baski adım şeması üretilmiyor");
  assert.ok(text.includes(LANDING_STEPS_TITLE), "adım bölümünün başlığı sayfada yok");
  for (const step of howTo.step as Array<Record<string, unknown>>) {
    assert.ok(text.includes(String(step.name)), `adım başlığı sayfada yok: ${step.name}`);
    assert.ok(text.includes(String(step.text)), `adım gövdesi sayfada yok: ${step.name}`);
  }

  // Sayfa iki şemayı da yayınlıyor; HowTo bayrakla KAPILI (gerekçe page.tsx'te:
  // motor kapalıyken "dosyanı yükle, ödemeni yap" diyen bir yol haritası
  // yayınlamak, yükleyicinin reddettiği bir şeyi vaat etmek olur).
  const page = stripComments(fs.readFileSync(path.resolve("src/app/3d-baski/page.tsx"), "utf8"));
  assert.match(page, /buildFaqPageJsonLd\(/, "/3d-baski SSS şemasını yayınlamıyor");
  assert.match(
    page,
    /\{\s*flagEnabled\s*&&\s*howTo\s*\?\s*<JsonLd data=\{howTo\}/,
    "/3d-baski adım şeması bayrak kapısının arkasında değil"
  );
  // SSS bayrağa bakmıyor (bölüm iki durumda da ekranda).
  assert.match(
    page,
    /\{\s*faq\s*\?\s*<JsonLd data=\{faq\}/,
    "/3d-baski SSS şeması bayrakla kapatılmış — bölüm ekranda duruyor"
  );
});

test("/nasil-calisir adım şeması render edilen LİSTEYLE birebir", () => {
  // Altı adım sayfaya ELLE yazılıydı; şemaya kopyalamak iki metin demekti.
  // Artık tek kaynak `HOW_IT_WORKS_STEPS`: hem `<ol>` hem şema oradan.
  // MUTASYON SINAVI: şemaya sayfada olmayan bir adım ekle → KIRMIZI.
  for (const locale of ["tr", "en"] as const) {
    const section = HOW_IT_WORKS_STEPS[locale];
    const node = buildHowToJsonLd({
      url: `${SEO_APP_URL}/nasil-calisir`,
      name: section.title,
      steps: section.steps.map((s) => ({ name: s.name, text: stepBodyText(s) })),
    });
    assert.ok(node, `${locale}: adım şeması üretilmiyor`);
    const html = inLocale(createElement(HowItWorksSteps, { steps: section.steps }));
    const text = visibleText(html);
    const list = node.step as Array<Record<string, unknown>>;
    assert.equal(list.length, 6, `${locale}: altı adım bekleniyor`);
    assert.deepEqual(
      list.map((s) => s.position),
      [1, 2, 3, 4, 5, 6],
      `${locale}: adımlar sıralı değil`
    );
    for (const step of list) {
      assert.ok(
        text.includes(String(step.name)),
        `${locale}: adım başlığı listede yok: ${step.name}`
      );
      assert.ok(
        text.includes(String(step.text)),
        `${locale}: adım gövdesi listede yok: ${step.name}`
      );
    }
    // Kalın yazılan rakamlar ("5-7 iş günü") şemanın metninde DURUYOR.
    assert.ok(html.includes("<strong>"), `${locale}: liste kalın parçaları kaybetti`);
  }

  const page = stripComments(
    fs.readFileSync(path.resolve("src/app/nasil-calisir/page.tsx"), "utf8")
  );
  assert.match(page, /<HowItWorksSteps/, "/nasil-calisir listeyi paylaşılan kaynaktan çizmiyor");
  assert.match(page, /buildHowToJsonLd\(/, "/nasil-calisir adım şemasını yayınlamıyor");
  // Adım metinleri sayfada İKİNCİ kez yazılı olmasın.
  assert.doesNotMatch(
    page,
    /Fotoğrafı yükle/,
    "adım metni sayfaya elle yazılmış — şemayla bir gün ayrışır"
  );
});
