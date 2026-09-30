/**
 * Teklif ucunun İKİ kapısı, DB'siz: KİM görebilir (erişim matrisi) ve NE
 * görünür (tek serileştirici).
 *
 * Fiyat gizleme bir görünüm ayarı değil, GÜVENLİK sınırıdır: fiyat kapısı
 * kapalı bir izleyicinin gövdesinde hiçbir fiyat anahtarı BULUNMAMALIDIR —
 * `null` bile değil, anahtarın kendisi olmamalı. Bu yüzden iddia tek tek
 * alanlara değil, serileştirilmiş JSON'un TAMAMINA bakar: yarın sunucuya
 * eklenen yeni bir fiyat alanı bu testi kendiliğinden düşürür.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addBusinessDays, istanbulDateKey } from "../src/lib/config/business-days";
import { MAX_AMOUNT_KURUS } from "../src/lib/config/prices";
import { computeQuote } from "../src/lib/config/quote-compute";
import { partPricingKey } from "../src/lib/config/quote-keys";
import { SEED_SNAPSHOT } from "../src/lib/config/quote-seed";
import { STEP_TESSELLATION } from "../src/lib/config/quote-step";
import type { PartGeometry, QuoteViewer } from "../src/lib/config/quote-types";
import type { Quote, QuotePart } from "../src/lib/db/schema";
import { resolveQuoteAccess, resolveQuoteViewer, shouldClaimQuote } from "../src/lib/services/quote-access";
import { toPricingPartInput } from "../src/lib/services/quote-cache";
import { presentQuote, toPricingInputs } from "../src/lib/services/quote-present";

const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const STRANGER_ID = "33333333-3333-4333-8333-333333333333";
const SHARE_TOKEN = "s".repeat(32);
const NOW = new Date("2026-09-23T09:00:00.000Z");

/** 20 mm'lik kapalı küp: analizi biten, otomatik fiyatlanabilen bir parça. */
const CUBE: PartGeometry = {
  volume: 8000,
  area: 2400,
  extents: { x: 20, y: 20, z: 20 },
  bodyCount: 1,
  isWatertight: true,
  isVolume: true,
  volumeEstimated: false,
  faceCount: 12,
  wallP1: 20,
  wallP5: 20,
  overhangArea: 400,
  sourceUnits: null,
  objectCount: 1,
  // Mesh dosyası: üçgenler dosyadan geldi, çevrilen bir B-rep yok.
  tessellation: null,
  solidCount: null,
};

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    seq: 1,
    number: "T-000001",
    userId: OWNER_ID,
    anonymousId: null,
    status: "draft",
    reviewKind: null,
    reviewNote: null,
    reviewRequestedAt: null,
    reviewedAt: null,
    reviewedByEmail: null,
    title: "Braket projesi",
    leadTier: "standard",
    addonKeys: ["uygunluk_sertifikasi"],
    customerNote: "Montaj deliklerine dikkat",
    poNumber: "PO-42",
    invoiceType: "corporate",
    companyName: "Acme Mühendislik A.Ş.",
    taxId: "1234567890",
    taxIdType: "vkn",
    taxOffice: "Kadıköy",
    billingAddress: null,
    pricingSnapshot: SEED_SNAPSHOT,
    snapshotTakenAt: new Date("2026-09-20T00:00:00.000Z"),
    // Döviz gösterimi (0071) kapalı: bu turda hiçbir teklif kur dondurmuyor.
    fxSnapshot: null,
    version: 3,
    totalKurus: null,
    leadDays: null,
    expiresAt: new Date("2026-10-20T00:00:00.000Z"),
    shareToken: SHARE_TOKEN,
    termsAcceptedAt: new Date("2026-09-20T00:00:00.000Z"),
    termsVersion: "2026-08-31",
    orderId: null,
    filesAttachedAt: null,
    sourceQuoteId: null,
    expiryReminderSentAt: null,
    abandonedReminderSentAt: null,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    updatedAt: new Date("2026-09-21T00:00:00.000Z"),
    ...overrides,
  };
}

function makePart(overrides: Partial<QuotePart> = {}): QuotePart {
  return {
    id: "44444444-4444-4444-8444-444444444441",
    quoteId: "11111111-1111-4111-8111-111111111111",
    sortOrder: 0,
    name: "Braket",
    fileName: "braket.stl",
    sourceKey: "quote-parts/p1/source.stl",
    sourceFormat: "stl",
    sourceBytes: 2048,
    sourceSha256: "a".repeat(64),
    uploadId: "upload-1",
    analysisStatus: "ready",
    analysisAttempt: 1,
    analysisError: null,
    geometry: CUBE,
    canonicalStlKey: "quote-parts/p1/canonical.stl",
    previewGlbKey: "quote-parts/p1/preview.glb",
    thumbnailKey: "quote-parts/p1/thumb.webp",
    units: "mm",
    scale: 1,
    technologyKey: "fdm",
    materialKey: "pla",
    colorKey: "beyaz",
    finishKey: "ham",
    layerUm: 200,
    infillPct: 20,
    quantity: 2,
    note: null,
    drawingKey: null,
    drawingName: null,
    criticalTolerance: false,
    dfmAckKey: null,
    manualUnitPriceKurus: null,
    manualPriceKey: null,
    manualPricedAt: null,
    manualPricedByEmail: null,
    targetUnitPriceKurus: 12345,
    deletedAt: null,
    filesPurgedAt: null,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    ...overrides,
  };
}

const sign = (key: string) => `https://dosya.test/${key}?imza=1`;

function present(
  viewer: QuoteViewer,
  quote = makeQuote(),
  parts = [makePart()],
  extra: {
    liveDraftReference?: string | null;
    orderNumber?: string | null;
    stepEnabled?: boolean;
  } = {}
) {
  const computed = computeQuote(quote.pricingSnapshot, toPricingInputs(parts), {
    leadTier: quote.leadTier,
    addonKeys: quote.addonKeys,
  });
  return presentQuote({
    quote,
    parts,
    snapshot: quote.pricingSnapshot,
    computed,
    viewer,
    liveDraftReference: extra.liveDraftReference ?? null,
    orderNumber: extra.orderNumber ?? null,
    catalogChanged: false,
    now: NOW,
    sign,
    shareBaseUrl: "https://figurunica.test/teklif/T-000001",
    // Bayrak, serileştiriciye PARAMETRE olarak gelir: bu dosya DB'siz
    // çalıştığı için `presentQuote`un bir bayrak okuması yapmadığının da
    // kanıtıdır (okuyan yer `stepUploadsEnabled`, `quote-access.ts`).
    stepEnabled: extra.stepEnabled ?? false,
  });
}

const OWNER_VIEW: QuoteViewer = {
  canSeePrices: true,
  canEdit: true,
  isOwner: true,
  isShare: false,
  isAdmin: false,
};
const ANON_VIEW: QuoteViewer = {
  canSeePrices: false,
  canEdit: true,
  isOwner: true,
  isShare: false,
  isAdmin: false,
};
const SHARE_VIEW: QuoteViewer = {
  canSeePrices: false,
  canEdit: false,
  isOwner: false,
  isShare: true,
  isAdmin: false,
};

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

// ─── Erişim matrisi (spec §"Erişim ve fiyat gizleme") ───────────────────────

test("sahip: oturum kullanıcısı teklifin sahibiyse düzenler ve fiyatı görür", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: OWNER_ID,
    anonymousId: null,
    shareToken: null,
    isAdmin: false,
  });
  assert.deepEqual(viewer, OWNER_VIEW);
});

test("anonim çerez: düzenler ama FİYAT GÖRMEZ", () => {
  const viewer = resolveQuoteViewer(makeQuote({ userId: null, anonymousId: "anon-1" }), {
    sessionUserId: null,
    anonymousId: "anon-1",
    shareToken: null,
    isAdmin: false,
  });
  assert.deepEqual(viewer, ANON_VIEW);
});

test("anonim çerez teklif devralındıktan sonra geçersizdir", () => {
  const viewer = resolveQuoteViewer(makeQuote({ userId: OWNER_ID, anonymousId: "anon-1" }), {
    sessionUserId: null,
    anonymousId: "anon-1",
    shareToken: null,
    isAdmin: false,
  });
  assert.equal(viewer, null);
});

// Girişli müşteri, ÖNCEDEN anonim açtığı kendi teklifini açıyor. Devir (claim)
// yalnız fiyat kapısı modalı O AN giriş yaptırdığında çalışıyordu; sayfayı
// zaten girişliyken açan müşteri sonsuza dek fiyatsız kalıyor ve kendisine
// gereksiz bir giriş formu gösteriliyordu. Oturum varsa anonim çerez sahibi de
// tanınan müşteridir: fiyat kapısının amacı (müşteri kazanımı) zaten sağlanmış.
test("girişli müşteri kendi anonim teklifini açınca FİYAT GÖRÜR", () => {
  const viewer = resolveQuoteViewer(makeQuote({ userId: null, anonymousId: "anon-1" }), {
    sessionUserId: OWNER_ID,
    anonymousId: "anon-1",
    shareToken: null,
    isAdmin: false,
  });
  assert.deepEqual(viewer, OWNER_VIEW);
});

test("devir koşulu: yalnız girişli müşterinin kendi anonim teklifi devredilir", () => {
  const anon = { userId: null, anonymousId: "anon-1" };
  // Devredilir: oturum var, çerez eşleşiyor.
  assert.equal(shouldClaimQuote(anon, { sessionUserId: OWNER_ID, anonymousId: "anon-1" }), true);
  // Devredilmez: oturum yok.
  assert.equal(shouldClaimQuote(anon, { sessionUserId: null, anonymousId: "anon-1" }), false);
  // Devredilmez: başka birinin çerezi.
  assert.equal(shouldClaimQuote(anon, { sessionUserId: OWNER_ID, anonymousId: "anon-2" }), false);
  // Devredilmez: teklifin zaten sahibi var (başka hesaba geçmesi hırsızlık olurdu).
  assert.equal(
    shouldClaimQuote({ userId: STRANGER_ID, anonymousId: "anon-1" }, { sessionUserId: OWNER_ID, anonymousId: "anon-1" }),
    false
  );
});

// Admin oturumu da aynı dala takılıyordu: anonim çerez eşleştiği an admin
// dalına hiç gelinmiyor, panelde girişli sahip fiyatı göremiyordu.
test("admin, anonim çerezi de eşleşse fiyatı görür", () => {
  const viewer = resolveQuoteViewer(makeQuote({ userId: null, anonymousId: "anon-1" }), {
    sessionUserId: null,
    anonymousId: "anon-1",
    shareToken: null,
    isAdmin: true,
  });
  assert.equal(viewer?.canSeePrices, true);
  assert.equal(viewer?.isAdmin, true);
});

test("paylaşım token'ı: salt okunur, girişsizken fiyatsız", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: null,
    anonymousId: null,
    shareToken: SHARE_TOKEN,
    isAdmin: false,
  });
  assert.deepEqual(viewer, SHARE_VIEW);
});

test("paylaşım token'ı + oturum: fiyat açılır, düzenleme yine kapalı", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: STRANGER_ID,
    anonymousId: null,
    shareToken: SHARE_TOKEN,
    isAdmin: false,
  });
  assert.deepEqual(viewer, { ...SHARE_VIEW, canSeePrices: true });
});

test("sahip paylaşım bağlantısıyla gelse de SAHİP kalır", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: OWNER_ID,
    anonymousId: null,
    shareToken: SHARE_TOKEN,
    isAdmin: false,
  });
  assert.deepEqual(viewer, OWNER_VIEW);
});

test("yanlış paylaşım token'ı erişim vermez", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: null,
    anonymousId: null,
    shareToken: "x".repeat(32),
    isAdmin: false,
  });
  assert.equal(viewer, null);
});

test("teklifte token yokken boş token eşleşmez", () => {
  const viewer = resolveQuoteViewer(makeQuote({ shareToken: null }), {
    sessionUserId: null,
    anonymousId: null,
    shareToken: null,
    isAdmin: false,
  });
  assert.equal(viewer, null);
});

test("yabancı (T-numarası tahmini) erişemez", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: STRANGER_ID,
    anonymousId: "baska-anon",
    shareToken: null,
    isAdmin: false,
  });
  assert.equal(viewer, null);
});

test("admin oturumu her teklifi görür", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: null,
    anonymousId: null,
    shareToken: null,
    isAdmin: true,
  });
  assert.deepEqual(viewer, {
    canSeePrices: true,
    canEdit: true,
    isOwner: false,
    isShare: false,
    isAdmin: true,
  });
});

// ─── Tek serileştirici: fiyat kapısı ────────────────────────────────────────

test("sahip: toplamlar, parça fiyatı, fatura ve paylaşım bağlantısı görünür", () => {
  const view = present(OWNER_VIEW);
  assert.ok(view.totals, "sahip toplamları görür");
  assert.equal(view.totals?.allPriced, true);
  assert.ok((view.parts[0].price?.unitKurus ?? 0) > 0, "birim fiyat hesaplandı");
  assert.equal(view.parts[0].price?.source, "auto");
  assert.equal(view.parts[0].targetUnitPriceKurus, 12345);
  assert.equal(view.invoice?.companyName, "Acme Mühendislik A.Ş.");
  assert.equal(view.shareUrl, `https://figurunica.test/teklif/T-000001?t=${SHARE_TOKEN}`);
  assert.equal(view.customerNote, "Montaj deliklerine dikkat");
  assert.ok(view.leadOptions.every((o) => typeof o.totalKurus === "number"));
});

test("catalog.acceptedFormats bayraktan gelir; YÜKLENMİŞ STEP parçası bayraktan bağımsızdır", () => {
  // Geri dönüş planının (tasarım §5) sözleşmesi: bayrak kapanınca yeni STEP
  // YÜKLEMESİ durur, yüklenmiş parça çalışmaya DEVAM eder — görünür, ölçülü ve
  // fiyatlı kalır. Aksi hâlde "bayrağı kapat" komutu, ödemesini bekleyen
  // müşterinin teklifini bozan bir işlem olurdu.
  const stepPart = makePart({
    fileName: "govde.step",
    sourceFormat: "step",
    sourceKey: "quote-parts/p1/source.step",
    geometry: { ...CUBE, sourceUnits: "mm", tessellation: STEP_TESSELLATION, solidCount: 1 },
  });
  const closed = present(OWNER_VIEW, makeQuote(), [stepPart]);
  assert.deepEqual(closed.catalog.acceptedFormats, ["stl", "obj", "3mf"]);
  assert.equal(closed.parts[0].sourceFormat, "step");
  assert.ok((closed.parts[0].price?.unitKurus ?? 0) > 0, "kapalı bayrakta STEP parçası fiyatsız");
  const open = present(OWNER_VIEW, makeQuote(), [stepPart], { stepEnabled: true });
  assert.deepEqual(open.catalog.acceptedFormats, ["stl", "obj", "3mf", "step"]);
});

test("sapma TEK yerde türer: geometri → PresentedPart.tessellationMm", () => {
  // Teklif belgesinin kaynağı `loadPresentedQuote` → `PresentedPart`tır
  // (`parts_snapshot` o ekranda okunmaz), yani anlaşmazlık savunmasının
  // taşıyıcısı bu alan. Türetme bir yerde durur: geometride ne yazılıysa o.
  const stepPart = makePart({
    fileName: "govde.step",
    sourceFormat: "step",
    sourceKey: "quote-parts/p1/source.step",
    geometry: { ...CUBE, sourceUnits: "mm", tessellation: STEP_TESSELLATION, solidCount: 1 },
  });
  const step = present(OWNER_VIEW, makeQuote(), [stepPart]);
  assert.equal(step.parts[0].tessellationMm, STEP_TESSELLATION.deflectionMm);

  // Mesh parçasında (üçgenler dosyadan geldi) alan null KALIR.
  assert.equal(present(OWNER_VIEW).parts[0].tessellationMm, null);
  // Analizi henüz bitmemiş parçada geometri yok: yine null, patlamaz.
  const pending = present(OWNER_VIEW, makeQuote(), [
    makePart({ analysisStatus: "queued", geometry: null }),
  ]);
  assert.equal(pending.parts[0].tessellationMm, null);

  // Sapma bir NİTELİK, fiyat değil: fiyat kapısı kapalı izleyiciye de gider
  // (ad `…Kurus` ile bitmediği için fiyat süzgecine hiç takılmaz).
  const gated = present(ANON_VIEW, makeQuote(), [stepPart]);
  assert.equal(gated.parts[0].tessellationMm, STEP_TESSELLATION.deflectionMm);
  assert.equal("price" in gated.parts[0], false);
});

test("fiyat kapısı kapalıyken gövdede TEK BİR fiyat anahtarı yok", () => {
  const view = present(ANON_VIEW);
  const json = JSON.stringify(view);
  const leak = /"price"|"totals"|Kurus"/.exec(json);
  assert.equal(leak, null, `fiyat anahtarı sızdı: ${leak?.[0]}`);
  assert.equal("totals" in view, false);
  assert.equal("price" in view.parts[0], false);
  assert.equal("targetUnitPriceKurus" in view.parts[0], false);
  assert.equal("totalKurus" in view.leadOptions[0], false);
  assert.equal("priceKurus" in view.catalog.addons[0], false);
  assert.equal("priceType" in view.catalog.addons[0], false);
  // Fiyatsız izleyici de teslim süresini ve seçenek adlarını görmeye devam eder.
  assert.equal(typeof view.leadOptions[0].leadDays, "number");
  assert.ok(view.catalog.technologies.length > 0);
});

test("fiyat kapısı kapalıyken teklif düzeyindeki limit uyarısı da kuruş taşımaz", () => {
  // 1000 adet × 2 kat ölçek → otomatik teklif tavanını (₺100.000) aşar; uyarı
  // parametresinde `maxTotalKurus` vardır ve gizlenmesi gerekir.
  const view = present(ANON_VIEW, makeQuote(), [makePart({ quantity: 1000, scale: 2 })]);
  const issue = view.quoteIssues.find((i) => i.code === "qty_over_auto");
  assert.ok(issue, "teklif düzeyinde limit uyarısı bekleniyordu");
  assert.equal("maxTotalKurus" in (issue?.params ?? {}), false);
  assert.equal(/Kurus"/.test(JSON.stringify(view)), false);
});

test("paylaşım görünümü: GLB, fatura, paylaşım bağlantısı ve özel notlar yok", () => {
  const view = present(SHARE_VIEW);
  assert.equal(view.parts[0].previewGlbUrl, null);
  assert.equal(view.parts[0].thumbnailUrl, sign("quote-parts/p1/thumb.webp"));
  assert.equal("invoice" in view, false);
  assert.equal("shareUrl" in view, false);
  assert.equal(view.customerNote, null);
  assert.equal(view.poNumber, null);
  assert.equal(/Kurus"/.test(JSON.stringify(view)), false);
});

test("giriş yapmış paylaşım izleyicisi fiyatı görür ama GLB'yi göremez", () => {
  const view = present({ ...SHARE_VIEW, canSeePrices: true });
  assert.ok(view.totals);
  assert.equal(view.parts[0].previewGlbUrl, null);
  assert.equal("invoice" in view, false);
});

test("paylaşım görünümünde ÖDEME REFERANSI ve SİPARİŞ NUMARASI yok", () => {
  // İkisi de oturumsuz açılan kamuya açık sayfaların anahtarıdır:
  // `/pay/<ref>` tam tutarı ve kartla öde düğmesini, `/track/<no>` siparişin
  // takibini hiçbir kontrol olmadan gösterir. Paylaşım bağlantısını alan kişi
  // fiyatı göremiyorsa, fiyatı gösteren sayfanın adresini de alamamalı.
  const keys = { liveDraftReference: "FIG-ABCD1234", orderNumber: "FIG-000999" };
  for (const viewer of [SHARE_VIEW, { ...SHARE_VIEW, canSeePrices: true }]) {
    const view = present(viewer, makeQuote(), [makePart()], keys);
    assert.equal(view.liveDraftReference, null);
    assert.equal(view.orderNumber, null);
    assert.equal(
      /FIG-ABCD1234|FIG-000999/.test(JSON.stringify(view)),
      false,
      "referans gövdenin hiçbir yerinde geçmemeli"
    );
  }
  const owner = present(OWNER_VIEW, makeQuote(), [makePart()], keys);
  assert.equal(owner.liveDraftReference, "FIG-ABCD1234");
  assert.equal(owner.orderNumber, "FIG-000999");
});

// ─── Ödeme hazırlığı ve teslim tarihi ───────────────────────────────────────

test("readiness.blockers `checkoutBlockers` cümlelerini aynen taşır", () => {
  const view = present(OWNER_VIEW, makeQuote({ termsAcceptedAt: null }));
  assert.equal(view.termsAccepted, false);
  assert.equal(view.readiness.canCheckout, false);
  assert.deepEqual(view.readiness.blockers, [
    "Mesafeli satış sözleşmesini ve ön bilgilendirmeyi onaylayın.",
  ]);
});

test("her şey hazırsa ödeme açıktır ve engel listesi boştur", () => {
  const view = present(OWNER_VIEW);
  assert.deepEqual(view.readiness.blockers, []);
  assert.equal(view.readiness.canCheckout, true);
  assert.equal(view.locked, false);
});

test("bekleyen ödeme teklifi kilitler ama ödemeye devam açık kalır", () => {
  const quote = makeQuote();
  const parts = [makePart()];
  const computed = computeQuote(quote.pricingSnapshot, toPricingInputs(parts), {
    leadTier: quote.leadTier,
    addonKeys: quote.addonKeys,
  });
  const view = presentQuote({
    quote,
    parts,
    snapshot: quote.pricingSnapshot,
    computed,
    viewer: OWNER_VIEW,
    liveDraftReference: "FIG-ABCD1234",
    orderNumber: null,
    catalogChanged: true,
    now: NOW,
    sign,
    shareBaseUrl: "https://figurunica.test/teklif/T-000001",
    stepEnabled: false,
  });
  assert.equal(view.locked, true);
  assert.equal(view.liveDraftReference, "FIG-ABCD1234");
  assert.equal(view.readiness.canCheckout, true);
  assert.equal(view.catalogChangedSinceSnapshot, true);
});

test("süresi dolmuş teklif kilitlidir ve engel cümlesini taşır", () => {
  const view = present(OWNER_VIEW, makeQuote({ expiresAt: new Date("2026-09-01T00:00:00.000Z") }));
  assert.equal(view.expired, true);
  assert.equal(view.locked, true);
  assert.equal(view.readiness.canCheckout, false);
  assert.ok(view.readiness.blockers.includes("Teklifin süresi doldu — yeniden fiyatlayın."));
});

test("shipByDate iş günü takviminden gelir", () => {
  const view = present(OWNER_VIEW);
  const leadDays = view.totals?.leadDays ?? null;
  assert.equal(typeof leadDays, "number");
  const expected = istanbulDateKey(
    addBusinessDays(
      NOW,
      leadDays!,
      SEED_SNAPSHOT.settings.holidays,
      SEED_SNAPSHOT.settings.cutoffHour
    )
  );
  assert.equal(view.shipByDate, expected);
});

test("fiyatlanamayan teklifte shipByDate yoktur", () => {
  const view = present(OWNER_VIEW, makeQuote(), [
    makePart({ analysisStatus: "queued", geometry: null, thumbnailKey: null }),
  ]);
  assert.equal(view.shipByDate, null);
  assert.equal(view.parts[0].dimensionsMm, null);
  assert.ok(view.readiness.blockers.some((b) => b.includes("analizi sürüyor")));
});

// ─── DB'den gelen manuel fiyatın doğrulanması (taşıma maddesi b) ────────────

test("geçerli manuel fiyat fiyat çekirdeğine ulaşır", () => {
  const part = makePart({ finishKey: "boyali", manualUnitPriceKurus: 45000 });
  const valid = makePart({
    ...part,
    manualPriceKey: partPricingKey(toPricingInputs([part])[0], "standard"),
  });
  const view = present(OWNER_VIEW, makeQuote(), [valid]);
  assert.equal(view.parts[0].price?.source, "manual");
  assert.equal(view.parts[0].price?.unitKurus, 45000);
});

test("aralık dışı manuel fiyat hesaba GİRMEZ", () => {
  for (const bad of [0, -1, 1.5, MAX_AMOUNT_KURUS + 1]) {
    const part = makePart({ finishKey: "boyali", manualUnitPriceKurus: bad });
    const withKey = makePart({
      ...part,
      manualPriceKey: partPricingKey(toPricingInputs([part])[0], "standard"),
    });
    const [input] = toPricingInputs([withKey]);
    assert.equal(input.manualUnitPriceKurus, null, `${bad} reddedilmeliydi`);
    assert.equal(input.manualPriceKey, null, `${bad} anahtarı da düşmeliydi`);
    const view = present(OWNER_VIEW, makeQuote(), [withKey]);
    assert.equal(view.parts[0].price ?? null, null);
    assert.equal(view.parts[0].needsManualPrice, true);

    // Kapı ORTAK ÇEVİRİCİDE durmalı, yalnız bu sarmalayıcıda değil: teklif
    // önbelleği (`recomputeQuoteCache`) `toPricingPartInput`i doğrudan çağıran
    // TEK `computeQuote` müşterisidir, ve kolonda CHECK yoktur. Kapı burada
    // olmazsa önbellekteki toplam, ödemede tahsil edilecek tutarla çelişir.
    const raw = toPricingPartInput(withKey);
    assert.equal(raw.manualUnitPriceKurus, null, `${bad} çeviricide reddedilmeliydi`);
    assert.equal(raw.manualPriceKey, null, `${bad} anahtarı çeviricide düşmeliydi`);
  }
  // Geçerli değer AYNEN geçer: kapı fiyatı yutmamalı.
  const good = makePart({ finishKey: "boyali", manualUnitPriceKurus: 45000 });
  const keyed = makePart({
    ...good,
    manualPriceKey: partPricingKey(toPricingInputs([good])[0], "standard"),
  });
  assert.equal(toPricingPartInput(keyed).manualUnitPriceKurus, 45000);
  assert.equal(toPricingPartInput(keyed).manualPriceKey, keyed.manualPriceKey);
});

// ─── Adresten gelen numara (taşıma notu m2) ─────────────────────────────────

test("bozuk kaçışlı numara FIRLATMAZ, 404'e düşer", async () => {
  // Next dinamik parçayı ZATEN çözer; ikinci bir `decodeURIComponent` `a%`
  // üzerinde `URIError` fırlatır ve ziyaretçi 404 yerine 500 görür (Sentry'de
  // de uygulama hatası olarak birikir). Erişim çözümü uuid ya da `T-` numarası
  // olmayan her şeyi zaten SORGUSUZ reddeder, yani bu çağrı veritabanına
  // gitmez.
  for (const bad of ["a%", "%", "T-%E0%A4%A", "T-000123%"]) {
    assert.equal(await resolveQuoteAccess(bad), null, `${bad} 404 vermedi`);
  }
});

test("teklif sayfaları adresteki numarayı İKİNCİ kez çözmez", () => {
  const root = join(import.meta.dirname, "..", "src/app/teklif/[number]");
  for (const file of ["page.tsx", "belge/page.tsx", "odeme/page.tsx"]) {
    const source = readFileSync(join(root, file), "utf8");
    assert.ok(
      !source.includes("decodeURIComponent("),
      `${file} adres parçasını ikinci kez çözüyor`
    );
  }
});

async function main(): Promise<void> {
  let failures = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (err) {
      failures++;
      console.error(`  FAIL ${name}`);
      console.error(err);
      break;
    }
  }
  console.log(`${tests.length - failures}/${tests.length} passed`);
  if (failures > 0) process.exit(1);
}

void main();
