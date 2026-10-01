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
import {
  canChatOnQuote,
  canCheckoutQuote,
  canSeeOwnerFields,
  canShareQuote,
  type TeamRole,
} from "../src/lib/config/quote-team";
import type {
  PartGeometry,
  QuoteAccessTeam,
  QuoteFxSnapshot,
  QuoteViewer,
} from "../src/lib/config/quote-types";
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
    // 0072: kişisel teklif. Takım dalı T-2'de gelir; bugün hiçbir kapı okumaz.
    teamId: null,
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
    fxDisplayEnabled?: boolean;
    isFrameworkBatch?: boolean;
    hasLiveFramework?: boolean;
    team?: QuoteAccessTeam | null;
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
    // Döviz bayrağı da aynı sebeple PARAMETRE. Varsayılan KAPALI: çıkış
    // durumu, `quote_fx_display_enabled`in üretimdeki hâlidir.
    fxDisplayEnabled: extra.fxDisplayEnabled ?? false,
    // Parti kapısı da PARAMETRE: `presentQuote` sorgu yapmaz, gerçeği
    // yükleyici (`loadPresentedQuote` → `quoteIsFrameworkBatch`) BEYAN eder.
    isFrameworkBatch: extra.isFrameworkBatch ?? false,
    // Anlaşmanın KAYNAK teklifi ölçüsü de öyle (`quoteHasLiveFramework`).
    hasLiveFramework: extra.hasLiveFramework ?? false,
    // Takım da PARAMETRE: üyelik satırını erişim kabuğu okur
    // (`resolveQuoteAccess` → `teamMembershipFor`), sunum katmanı sormaz.
    team: extra.team ?? null,
  });
}

const OWNER_VIEW: QuoteViewer = {
  canSeePrices: true,
  canEdit: true,
  isOwner: true,
  isShare: false,
  isAdmin: false,
  isTeam: false,
  teamRole: null,
};
const ANON_VIEW: QuoteViewer = {
  canSeePrices: false,
  canEdit: true,
  isOwner: true,
  isShare: false,
  isAdmin: false,
  isTeam: false,
  teamRole: null,
};
const SHARE_VIEW: QuoteViewer = {
  canSeePrices: false,
  canEdit: false,
  isOwner: false,
  isShare: true,
  isAdmin: false,
  isTeam: false,
  teamRole: null,
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
    teamRole: null,
  });
  assert.deepEqual(viewer, OWNER_VIEW);
});

test("anonim çerez: düzenler ama FİYAT GÖRMEZ", () => {
  const viewer = resolveQuoteViewer(makeQuote({ userId: null, anonymousId: "anon-1" }), {
    sessionUserId: null,
    anonymousId: "anon-1",
    shareToken: null,
    isAdmin: false,
    teamRole: null,
  });
  assert.deepEqual(viewer, ANON_VIEW);
});

test("anonim çerez teklif devralındıktan sonra geçersizdir", () => {
  const viewer = resolveQuoteViewer(makeQuote({ userId: OWNER_ID, anonymousId: "anon-1" }), {
    sessionUserId: null,
    anonymousId: "anon-1",
    shareToken: null,
    isAdmin: false,
    teamRole: null,
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
    teamRole: null,
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
    teamRole: null,
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
    teamRole: null,
  });
  assert.deepEqual(viewer, SHARE_VIEW);
});

test("paylaşım token'ı + oturum: fiyat açılır, düzenleme yine kapalı", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: STRANGER_ID,
    anonymousId: null,
    shareToken: SHARE_TOKEN,
    isAdmin: false,
    teamRole: null,
  });
  assert.deepEqual(viewer, { ...SHARE_VIEW, canSeePrices: true });
});

test("sahip paylaşım bağlantısıyla gelse de SAHİP kalır", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: OWNER_ID,
    anonymousId: null,
    shareToken: SHARE_TOKEN,
    isAdmin: false,
    teamRole: null,
  });
  assert.deepEqual(viewer, OWNER_VIEW);
});

test("yanlış paylaşım token'ı erişim vermez", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: null,
    anonymousId: null,
    shareToken: "x".repeat(32),
    isAdmin: false,
    teamRole: null,
  });
  assert.equal(viewer, null);
});

test("teklifte token yokken boş token eşleşmez", () => {
  const viewer = resolveQuoteViewer(makeQuote({ shareToken: null }), {
    sessionUserId: null,
    anonymousId: null,
    shareToken: null,
    isAdmin: false,
    teamRole: null,
  });
  assert.equal(viewer, null);
});

test("yabancı (T-numarası tahmini) erişemez", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: STRANGER_ID,
    anonymousId: "baska-anon",
    shareToken: null,
    isAdmin: false,
    teamRole: null,
  });
  assert.equal(viewer, null);
});

test("admin oturumu her teklifi görür", () => {
  const viewer = resolveQuoteViewer(makeQuote(), {
    sessionUserId: null,
    anonymousId: null,
    shareToken: null,
    isAdmin: true,
    teamRole: null,
  });
  assert.deepEqual(viewer, {
    canSeePrices: true,
    canEdit: true,
    isOwner: false,
    isShare: false,
    isAdmin: true,
    isTeam: false,
    teamRole: null,
  });
});

// ─── TAKIM DALI (0072 · T-2) — bu sevkiyatın ÜÇ ÇIKIŞ KANITI ────────────────
//
// Takım dalı fiyatı KİMİN göreceğini genişletiyor; yani bir güvenlik sınırı.
// Aşağıdaki üç blok (K1/K2/K3) bu sevkiyatın çıkış koşuludur.
//
// DALIN YERİ: kişisel sahip → admin → **TAKIM** → anonim çerez → paylaşım.
// Üç argümanın her birinin kendi testi var:
//   · paylaşımdan ÖNCE  → "takım üyesi + doğru token → TAKIM dalı kazanır"
//   · sahipten SONRA    → "üyelikten çıkarılmış ama teklifi kendisi açmış"
//   · anonimden önce/sonra FARK ETMEZ → `quotes_team_requires_user_chk`
//     (takım teklifinde `user_id` daima dolu; kısıtın kendisi
//     `scripts/test-quote-team-db.ts` içinde 23514 ile ölçülür)

/** Takım kimliği; `makeQuote({ teamId: TEAM_ID })` bir takım teklifi yapar. */
const TEAM_ID = "55555555-5555-4555-8555-555555555555";

/** K1 tablosundaki hücre kodlarının açılımı — bugünkü beş alan. */
const CELL: Record<string, Omit<QuoteViewer, "isTeam" | "teamRole"> | null> = {
  "-": null,
  O: { canSeePrices: true, canEdit: true, isOwner: true, isShare: false, isAdmin: false },
  o: { canSeePrices: false, canEdit: true, isOwner: true, isShare: false, isAdmin: false },
  A: { canSeePrices: true, canEdit: true, isOwner: false, isShare: false, isAdmin: true },
  S: { canSeePrices: true, canEdit: false, isOwner: false, isShare: true, isAdmin: false },
  s: { canSeePrices: false, canEdit: false, isOwner: false, isShare: true, isAdmin: false },
};

/**
 * (K1) DENKLİK TABLOSU — **T-2'den ÖNCEKİ koddan alındı ve DONDURULDU.**
 *
 * Satır anahtarı `<teklif şekli>/<oturum>/<anonim çerez>`; değer, altı hücre:
 * `shareToken` ∈ {yok, doğru, yanlış} × `isAdmin` ∈ {false, true} sırasıyla.
 * 3 şekil × 3 oturum × 3 çerez × 3 token × 2 admin = **162 hücre.**
 *
 * Tablo bir YORUM değil, ölçülmüş bir çıkıştır: `teamRole: null` verildiğinde
 * matrisin bugünkü hâlinden kaydığı an bu testten anlaşılır. `takimli/*`
 * satırlarının `sahipli/*` ile BİREBİR aynı olması birincil kısıtın kanıtıdır
 * (takımı olmayan — ya da takımı olup rolü okunmayan — müşteri için davranış
 * bit bit aynı).
 */
const TODAY: Record<string, string> = {
  "sahipli/yok/yok": "-AsA-A",
  "sahipli/yok/eslesen": "-AsA-A",
  "sahipli/yok/eslesmeyen": "-AsA-A",
  "sahipli/sahip/yok": "OOOOOO",
  "sahipli/sahip/eslesen": "OOOOOO",
  "sahipli/sahip/eslesmeyen": "OOOOOO",
  "sahipli/yabanci/yok": "-ASA-A",
  "sahipli/yabanci/eslesen": "-ASA-A",
  "sahipli/yabanci/eslesmeyen": "-ASA-A",
  "anonim/yok/yok": "-AsA-A",
  "anonim/yok/eslesen": "oAoAoA",
  "anonim/yok/eslesmeyen": "-AsA-A",
  "anonim/sahip/yok": "-ASA-A",
  "anonim/sahip/eslesen": "OAOAOA",
  "anonim/sahip/eslesmeyen": "-ASA-A",
  "anonim/yabanci/yok": "-ASA-A",
  "anonim/yabanci/eslesen": "OAOAOA",
  "anonim/yabanci/eslesmeyen": "-ASA-A",
  "takimli/yok/yok": "-AsA-A",
  "takimli/yok/eslesen": "-AsA-A",
  "takimli/yok/eslesmeyen": "-AsA-A",
  "takimli/sahip/yok": "OOOOOO",
  "takimli/sahip/eslesen": "OOOOOO",
  "takimli/sahip/eslesmeyen": "OOOOOO",
  "takimli/yabanci/yok": "-ASA-A",
  "takimli/yabanci/eslesen": "-ASA-A",
  "takimli/yabanci/eslesmeyen": "-ASA-A",
};

/** Bugünkü beş alan; K1 yalnız bunları donmuş tabloyla karşılaştırır. */
function five(viewer: QuoteViewer | null): Omit<QuoteViewer, "isTeam" | "teamRole"> | null {
  if (viewer === null) return null;
  const { canSeePrices, canEdit, isOwner, isShare, isAdmin } = viewer;
  return { canSeePrices, canEdit, isOwner, isShare, isAdmin };
}

test("(K1) teamRole null iken 162 hücrenin HİÇBİRİ bugünkü değerinden kaymaz", () => {
  const shapes = {
    sahipli: makeQuote(),
    anonim: makeQuote({ userId: null, anonymousId: "anon-1" }),
    takimli: makeQuote({ teamId: TEAM_ID }),
  };
  const sessions = { yok: null, sahip: OWNER_ID, yabanci: STRANGER_ID };
  const anons = { yok: null, eslesen: "anon-1", eslesmeyen: "anon-2" };
  // Yanlış token DOĞRU UZUNLUKTA: matris önce uzunluğu karşılaştırıyor, yani
  // kısa bir dizgiyle yazılmış bir vaka karşılaştırmanın kendisini sınamazdı.
  const shares = [null, SHARE_TOKEN, "x".repeat(SHARE_TOKEN.length)];

  let cells = 0;
  for (const [shapeName, quote] of Object.entries(shapes)) {
    for (const [sessionName, sessionUserId] of Object.entries(sessions)) {
      for (const [anonName, anonymousId] of Object.entries(anons)) {
        const key = `${shapeName}/${sessionName}/${anonName}`;
        const row = TODAY[key];
        assert.ok(row, `${key} donmuş tabloda yok`);
        let column = 0;
        for (const shareToken of shares) {
          for (const isAdmin of [false, true]) {
            const viewer = resolveQuoteViewer(quote, {
              sessionUserId,
              anonymousId,
              shareToken,
              isAdmin,
              teamRole: null,
            });
            assert.deepEqual(five(viewer), CELL[row[column]], `${key} hücre ${column}`);
            // Rol okunmadığı için YENİ alanlar da sönük kalır: `team_id` dolu
            // satırlar bile bugünkü matrise düşer (geri dönüş planı).
            assert.equal(viewer?.isTeam ?? false, false, `${key} hücre ${column}: isTeam yandı`);
            assert.equal(viewer?.teamRole ?? null, null, `${key} hücre ${column}: teamRole doldu`);
            column++;
            cells++;
          }
        }
      }
    }
  }
  assert.equal(cells, 162, "ızgara küçüldü — bir eksen kaybolmuş");

  // Ve asıl iddia: TAKIMLI teklifin satırları SAHİPLİ teklifin satırlarıyla
  // bire bir aynı. `team_id` kolonunun varlığı tek bir hücreyi oynatmıyor.
  for (const sessionName of ["yok", "sahip", "yabanci"]) {
    for (const anonName of ["yok", "eslesen", "eslesmeyen"]) {
      assert.equal(
        TODAY[`takimli/${sessionName}/${anonName}`],
        TODAY[`sahipli/${sessionName}/${anonName}`],
        `takimli/${sessionName}/${anonName} sahipli satırından ayrıştı`
      );
    }
  }
});

test("(K2) takım teklifi YABANCIYA fazladan hiçbir hak vermez", () => {
  const teamQuote = makeQuote({ teamId: TEAM_ID });

  // Üye OLMAYAN (rolü yok) bir yabancı: 404. "Bu teklif bir takımın" bilgisi
  // bile sızmaz.
  assert.equal(
    resolveQuoteViewer(teamQuote, {
      sessionUserId: STRANGER_ID,
      anonymousId: null,
      shareToken: null,
      isAdmin: false,
      teamRole: null,
    }),
    null
  );

  // Aynı teklif + DOĞRU paylaşım token'ı → bugünkü paylaşım izleyicisi, bir
  // satırı bile değişmemiş hâlde. `isTeam` sönük: token takım hakkı vermez.
  assert.deepEqual(
    resolveQuoteViewer(teamQuote, {
      sessionUserId: null,
      anonymousId: null,
      shareToken: SHARE_TOKEN,
      isAdmin: false,
      teamRole: null,
    }),
    SHARE_VIEW
  );

  // ÇIKARILMIŞ ÜYE: rol `null`a döndüğü an aynı teklif 404. Önbellek yok, bir
  // istek sonrası bile gecikme yok (kabuk her istekte üyelik satırına bakar).
  const member = { sessionUserId: STRANGER_ID, anonymousId: null, shareToken: null, isAdmin: false };
  assert.equal(
    resolveQuoteViewer(teamQuote, { ...member, teamRole: "member" })?.isTeam,
    true,
    "üye kendi takımının teklifini göremiyor"
  );
  assert.equal(resolveQuoteViewer(teamQuote, { ...member, teamRole: null }), null);

  // BAŞKA bir takımın rolü bu teklifte işe yaramaz: dal `quote.teamId`i de
  // şart koşuyor, yoksa kişisel bir teklif herhangi bir takım üyesine açılırdı.
  assert.equal(
    resolveQuoteViewer(makeQuote({ teamId: null, userId: OWNER_ID }), {
      ...member,
      teamRole: "owner",
    }),
    null
  );
});

test("(K3) `viewer` rolü HİÇBİR ŞEYİ değiştiremez", () => {
  const teamQuote = makeQuote({ teamId: TEAM_ID });
  const ctx = (teamRole: TeamRole) => ({
    sessionUserId: STRANGER_ID,
    anonymousId: null,
    shareToken: null,
    isAdmin: false,
    teamRole,
  });

  const readOnly = resolveQuoteViewer(teamQuote, ctx("viewer"));
  assert.deepEqual(readOnly, {
    // Üye GİRİŞ YAPMIŞTIR: fiyat kapısının amacı (müşteri kazanımı) sağlanmış.
    canSeePrices: true,
    canEdit: false,
    // `isOwner` "KİŞİSEL sahip" demeye devam ediyor — takım dalı onu açmaz,
    // yani bugünkü `viewer.isOwner` okumaları sessizce genişlemez.
    isOwner: false,
    isShare: false,
    isAdmin: false,
    isTeam: true,
    teamRole: "viewer",
  });

  for (const role of ["owner", "admin", "member"] as const) {
    const viewer = resolveQuoteViewer(teamQuote, ctx(role));
    assert.equal(viewer?.canEdit, true, `${role} düzenleyemiyor`);
    assert.equal(viewer?.isTeam, true);
    assert.equal(viewer?.isOwner, false, `${role} KİŞİSEL sahip sayıldı`);
    assert.equal(viewer?.teamRole, role);
  }

  // Salt-okunur rol GERÇEKTEN salt okunur: para, sohbet ve paylaşım kapıları
  // da kapalı (`src/lib/config/quote-team.ts`). T-4 bu kapıları canlı
  // çağrılara bağladı, yani iddia artık GERÇEK ifadeyi ölçüyor — takım ayarı
  // AÇIK olsa bile `viewer` rolü ödeyemez.
  assert.equal(canCheckoutQuote(readOnly!, { memberCanCheckout: true }), false);
  assert.equal(canChatOnQuote(readOnly!), false);
  assert.equal(canShareQuote(readOnly!), false);
  // …ama OKUR: sohbetin GET'i, belge bağlantısı ve sahibe giden alanlar dört
  // rolde de açık (`canSeeOwnerFields`). "Yazamaz" ile "göremez" ayrı iki şey.
  assert.equal(canSeeOwnerFields(readOnly!), true);
});

test("takım üyesi PAYLAŞIM bağlantısıyla gelse de kendi işinde salt okunur kalmaz", () => {
  // `:63-64` gerekçesinin takım karşılığı: dal paylaşımın ALTINA konsa, viewer
  // olmayan bir üye `?t=`li bir URL ile düzenleme hakkını kaybederdi.
  const viewer = resolveQuoteViewer(makeQuote({ teamId: TEAM_ID }), {
    sessionUserId: STRANGER_ID,
    anonymousId: null,
    shareToken: SHARE_TOKEN,
    isAdmin: false,
    teamRole: "member",
  });
  assert.equal(viewer?.isTeam, true, "paylaşım dalı takım dalını yuttu");
  assert.equal(viewer?.isShare, false);
  assert.equal(viewer?.canEdit, true);
});

test("üyelikten çıkarılmış ama teklifi KENDİSİ açmış kişi erişimini KAYBETMEZ", () => {
  // Kişisel sahip dalı İLK kalır (tasarım §3.3): kendi yüklediği dosyaya
  // erişimi, takımdan çıkarılması yüzünden kaybetmemeli.
  const viewer = resolveQuoteViewer(makeQuote({ teamId: TEAM_ID, userId: OWNER_ID }), {
    sessionUserId: OWNER_ID,
    anonymousId: null,
    shareToken: null,
    isAdmin: false,
    teamRole: null,
  });
  assert.deepEqual(viewer, OWNER_VIEW);
});

test("kendi takımının teklifini açan SAHİP, takım dalına DÜŞMEZ", () => {
  // Sıra kanıtı: rol dolu olsa bile kişisel sahip dalı önce tutar, yani
  // `isOwner` kapıları (22 okuma) bu sevkiyatta davranış değiştirmez.
  const viewer = resolveQuoteViewer(makeQuote({ teamId: TEAM_ID }), {
    sessionUserId: OWNER_ID,
    anonymousId: null,
    shareToken: null,
    isAdmin: false,
    teamRole: "owner",
  });
  assert.deepEqual(viewer, OWNER_VIEW);
});

test("admin, takım teklifinde de ADMİN kalır", () => {
  // Admin dalı takım dalından ÖNCE: takımında rolü olan bir yönetici panelde
  // admin bağlantılarını görmeye devam eder.
  const viewer = resolveQuoteViewer(makeQuote({ teamId: TEAM_ID, userId: STRANGER_ID }), {
    sessionUserId: OWNER_ID,
    anonymousId: null,
    shareToken: null,
    isAdmin: true,
    teamRole: "admin",
  });
  assert.equal(viewer?.isAdmin, true);
  assert.equal(viewer?.isTeam, false, "admin takım dalına düştü");
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

// ─── `PresentedQuote.team` (0072 · T-2) ─────────────────────────────────────

const TEAM: QuoteAccessTeam = {
  id: TEAM_ID,
  name: "Acme Mühendislik A.Ş.",
  role: "member",
  memberCanCheckout: false,
};

test("takımsız teklifte `team` ANAHTARI gövdede HİÇ YOK", () => {
  // Dosyanın açılış kuralı: yokluk `null` ile değil, anahtarın KENDİSİNİN
  // olmamasıyla anlatılır (`undefined` RSC props'unda ve `Object.keys`te
  // görünür).
  const view = present(OWNER_VIEW);
  assert.equal("team" in view, false);
});

test("takım adı PAYLAŞIM bağlantısına SIZMAZ", () => {
  // Takım adı bir fiyat değil, ama bağlantıyı eline geçiren kişiye "bu hangi
  // firmanın teklifi" demek de gerekmez — `invoice`/`shareUrl` ile aynı kapı.
  for (const viewer of [SHARE_VIEW, { ...SHARE_VIEW, canSeePrices: true }]) {
    const view = present(viewer, makeQuote({ teamId: TEAM_ID }), [makePart()], { team: TEAM });
    assert.equal("team" in view, false);
    assert.equal(
      JSON.stringify(view).includes(TEAM.name),
      false,
      "takım adı gövdenin bir yerinde geçiyor"
    );
  }
});

test("takım üyesi ve kişisel sahip `team` alanını görür — kimliği GÖRMEZ", () => {
  const teamViewer: QuoteViewer = {
    canSeePrices: true,
    canEdit: true,
    isOwner: false,
    isShare: false,
    isAdmin: false,
    isTeam: true,
    teamRole: "member",
  };
  for (const viewer of [teamViewer, OWNER_VIEW]) {
    const view = present(viewer, makeQuote({ teamId: TEAM_ID }), [makePart()], { team: TEAM });
    assert.deepEqual(view.team, {
      name: TEAM.name,
      role: "member",
      memberCanCheckout: false,
    });
    // Takım kimliği erişim kabuğunun işi (`QuoteAccessTeam.id`), ekranın değil:
    // gövdeye girse paylaşımı olmayan bir uca tahmin edilebilir bir anahtar
    // taşırdı.
    assert.equal("id" in (view.team ?? {}), false);
  }
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
    fxDisplayEnabled: false,
    isFrameworkBatch: false,
    hasLiveFramework: false,
    team: null,
  });
  assert.equal(view.locked, true);
  assert.equal(view.liveDraftReference, "FIG-ABCD1234");
  assert.equal(view.readiness.canCheckout, true);
  assert.equal(view.catalogChangedSinceSnapshot, true);
});

test("çerçeve partisi KİLİTLİ gösterilir, ödemesi AÇIK kalır", () => {
  // Ekran ile uç AYNI cevabı vermeli: `assertEditable` bu teklifi 409 ile
  // reddediyor (`quote-service.ts`), yani ekran onu düzenlenebilir
  // GÖSTEREMEZ — gösterirse müşteri `demoteQuotedToDraft`i tetikler ve
  // anlaşmanın kilitli fiyatı canlı katalog fiyatına döner (tasarım R1).
  const quote = makeQuote({ status: "quoted" });
  const batch = present(OWNER_VIEW, quote, [makePart()], { isFrameworkBatch: true });
  assert.equal(batch.locked, true);
  assert.equal(batch.readiness.canCheckout, true, "parti ÖDENEBİLİR kalmalı");
  // Aynı teklif parti OLMASA düzenlenebilirdi: kilidi getiren şey alanın kendisi.
  const plain = present(OWNER_VIEW, quote, [makePart()], { isFrameworkBatch: false });
  assert.equal(plain.locked, false);
});

test("anlaşmanın KAYNAK teklifi de KİLİTLİ gösterilir, ödemesi AÇIK kalır", () => {
  // İkinci kapsam: anlaşmanın tanımı bu teklifte duruyor. Ekran onu
  // düzenlenebilir gösterirse müşteri malzemeyi değiştirir ve BİR SONRAKİ
  // parti başka bir ürünü kilitli fiyattan üretir (`assertEditable` bu
  // teklifi de 409 ile reddediyor).
  const quote = makeQuote({ status: "quoted" });
  const source = present(OWNER_VIEW, quote, [makePart()], { hasLiveFramework: true });
  assert.equal(source.locked, true);
  assert.equal(source.readiness.canCheckout, true, "kaynak teklif ÖDENEBİLİR kalmalı");
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

// ─── Döviz GÖSTERİMİ: `display` anahtarı (Faz 2b · D3) ──────────────────────
//
// Kur bir FİYATTIR: fiyat kapısının ARKASINDA durur (tasarım R7). Üç kapı
// birden aranır ve biri kapalıysa anahtar HİÇ EKLENMEZ — `view.display ===
// undefined` iddiası YETMEZ, anahtarın YOKLUĞU iddia edilir (`quote-present.ts`
// açılış kuralı: `undefined` atamak `JSON.stringify`de kaybolsa da RSC
// props'unda ve `Object.keys`te görünür).

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

test("bayrak KAPALIYKEN `display` anahtarı gövdede HİÇ YOK", () => {
  const view = present(OWNER_VIEW, makeQuote({ fxSnapshot: FX_SNAPSHOT }));
  assert.equal("display" in view, false, "bayrak kapalı ama anahtar gönderilmiş");
});

test("fiyat kapısı KAPALIYKEN `display` anahtarı gövdede HİÇ YOK", () => {
  // R7: kur ekranda, fiyat kapısı arkasında değil. Bayrak AÇIK, kur DOLU —
  // eksik olan tek şey `canSeePrices`.
  for (const viewer of [ANON_VIEW, SHARE_VIEW]) {
    const view = present(viewer, makeQuote({ fxSnapshot: FX_SNAPSHOT }), [makePart()], {
      fxDisplayEnabled: true,
    });
    assert.equal("display" in view, false, "fiyat kapısı kapalı ama kur gönderilmiş");
    assert.equal("totals" in view, false, "fiyat kapısı sızdırıyor (kontrol)");
  }
});

test("BOZULMUŞ YOL: kur YOKSA sayfa DÜŞMEZ, yalnız anahtar gelmez", () => {
  // `fx_snapshot` NULL, kur hiç çekilememiş ya da BAYAT olduğu için
  // (`loadActiveFxSnapshot` o hâlde null döner). Bayrak açık olsa bile gövde
  // sessizce ₺ kalır — bu vaka ZORUNLU.
  const view = present(OWNER_VIEW, makeQuote({ fxSnapshot: null }), [makePart()], {
    fxDisplayEnabled: true,
  });
  assert.equal("display" in view, false);
  assert.ok(view.totals, "fiyat gövdesi kur yokluğundan etkilenmemeli");
});

test("MUTLU YOL: bülten tarihi müşteriye AYNEN gider, baştaki birim BAĞLAYICI", () => {
  const view = present(OWNER_VIEW, makeQuote({ fxSnapshot: FX_SNAPSHOT }), [makePart()], {
    fxDisplayEnabled: true,
  });
  assert.equal("display" in view, true, "mutlu yolda anahtar gelmedi");
  assert.deepEqual(view.display?.snapshot, FX_SNAPSHOT);
  assert.equal(view.display?.snapshot.bulletinDate, "2026-09-29");
  assert.equal(view.display?.currencies[0], "TRY", "baştaki eleman bağlayıcı olan değil");
  // Seçici listesi DONMUŞ snapshot'ın kendi satırlarından türer, sabitten
  // değil: eski bir snapshot yarın eklenen bir birimi taşımaz ve müşteriye
  // çevrilemeyen bir birim seçtirilmemeli.
  assert.deepEqual(view.display?.currencies, ["TRY", "EUR", "USD", "GBP"]);
  const half = { ...FX_SNAPSHOT, rates: [FX_SNAPSHOT.rates[0]] };
  const halfView = present(OWNER_VIEW, makeQuote({ fxSnapshot: half }), [makePart()], {
    fxDisplayEnabled: true,
  });
  assert.deepEqual(halfView.display?.currencies, ["TRY", "EUR"]);
});

test("`display` eklenmesi para gövdesini KİRLETMEDİ", () => {
  // Sunum eklemesinin para yoluna dokunmadığının kanıtı: aynı teklif iki kez
  // serileştirilir ve `totals` bit bit AYNI çıkar.
  const quote = makeQuote({ fxSnapshot: FX_SNAPSHOT });
  const withoutFx = present(OWNER_VIEW, quote);
  const withFx = present(OWNER_VIEW, quote, [makePart()], { fxDisplayEnabled: true });
  assert.deepEqual(withFx.totals, withoutFx.totals);
  // Ve hiçbir alanı `…Kurus` ile bitmiyor (fiyat kapısı ada bakıyor).
  const fxKeys = Object.keys(withFx.display ?? {});
  assert.deepEqual(
    fxKeys.filter((k) => k.endsWith("Kurus")),
    []
  );
});

test("BOZULMUŞ YOLLARIN HİÇBİRİ bir fiyatı DEĞİŞTİRMEZ (para gövdesi bit bit aynı)", () => {
  // "Kur bir fiyatı yanlış yapamaz" cümlesinin tek DOĞRUDAN kanıtı. Dört hâl
  // yan yana dizilir; dördünde de para gövdesi AYNI olmak zorunda:
  //
  //   1. bayrak KAPALI + kur DOLU   → kapatma yolu (tek bir DB satırı)
  //   2. bayrak AÇIK  + kur YOK     → `fx_rates` boş ya da bülten BAYAT
  //   3. bayrak AÇIK  + DAR kur     → snapshot yalnız EUR taşıyor
  //   4. bayrak AÇIK  + kur DOLU    → mutlu yol
  //
  // 3 numara `display` GÖNDERİR ve bu doğrudur: DAR bir snapshot bozuk değil,
  // yalnız dardır — seçici listesi snapshot'ın KENDİ satırlarından türüyor
  // (D3), yani müşteriye çevrilemeyen bir birim seçtirilmiyor. Bugünün
  // `loadActiveFxSnapshot`ı YARIM bir bülteni hiç dondurmaz (o hâlde `null`
  // döner, `test-fx-db.ts` "BOZULMUŞ YOL 3"); bu şekli taşıyabilecek tek şey
  // katalog büyümeden ÖNCE dondurulmuş eski bir tekliftir ve onun kendi
  // satırları pekâlâ çevrilebilir.
  //
  // "Bayrak kapalı" ile "bayrak açık ama kur yok" FARKLI iki hâldir ve ikisi
  // de yalnız ₺ göstermek zorundadır; bu vaka ikisini de aynı ölçüye sokar.
  const quote = makeQuote({ fxSnapshot: FX_SNAPSHOT });
  const half: QuoteFxSnapshot = { ...FX_SNAPSHOT, rates: [FX_SNAPSHOT.rates[0]!] };
  const states = [
    ["bayrak KAPALI + kur dolu", present(OWNER_VIEW, quote, [makePart()])],
    [
      "bayrak açık + kur YOK",
      present(OWNER_VIEW, makeQuote({ fxSnapshot: null }), [makePart()], {
        fxDisplayEnabled: true,
      }),
    ],
    [
      "bayrak açık + DAR kur kümesi",
      present(OWNER_VIEW, makeQuote({ fxSnapshot: half }), [makePart()], {
        fxDisplayEnabled: true,
      }),
    ],
    ["mutlu yol", present(OWNER_VIEW, quote, [makePart()], { fxDisplayEnabled: true })],
  ] as const;

  const baseline = states[0][1];
  assert.ok(baseline.totals, "çıkış durumunda fiyat gövdesi hiç gelmedi");
  // Para gövdesinin anahtar kümesi KAPALI yazılır: yarın `QuoteTotals`a bir
  // kuruş alanı eklenirse bu satır kırılır ve yeni alanın da bu
  // karşılaştırmaya girmesi gerektiği anlaşılır (sessizce kapsam dışı kalmaz).
  assert.deepEqual(Object.keys(baseline.totals).sort(), [
    "addonLines",
    "addonsKurus",
    "allPriced",
    "kdvExcludedKurus",
    "kdvKurus",
    "leadDays",
    "minOrderTopUpKurus",
    "partsKurus",
    "totalKurus",
  ]);

  for (const [label, view] of states) {
    assert.deepEqual(view.totals, baseline.totals, `${label}: toplamlar oynadı`);
    assert.deepEqual(view.leadOptions, baseline.leadOptions, `${label}: kademe fiyatları oynadı`);
    assert.deepEqual(
      view.parts.map((p) => p.price),
      baseline.parts.map((p) => p.price),
      `${label}: parça fiyatları oynadı`
    );
  }

  // …ve yukarıdaki eşitlikler "hiçbir şey olmuyor" diye bedava yeşil DEĞİL:
  // `display` anahtarı hâllere göre gerçekten farklı davranıyor. İlk İKİ hâl
  // (bayrak kapalı / kur yok) anahtarı HİÇ göndermiyor, son ikisi gönderiyor.
  assert.deepEqual(
    states.map(([, view]) => "display" in view),
    [false, false, true, true]
  );
  // DAR küme gerçekten dar geldi: yüzey çevirebildiği birimi sunuyor, ötekini
  // sunmuyor.
  assert.deepEqual(states[2][1].display?.currencies, ["TRY", "EUR"]);
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
