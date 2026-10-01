/**
 * ÇERÇEVE ANLAŞMALAR — saf çekirdeğin testi (0073 · F1).
 *
 * DB YOK, Redis YOK. Kanıtlanan şey dört başlıkta toplanıyor:
 *
 *   1. PARA: parti satırı `unit × adet` ile hesaplanır ve bu, teklif motorunun
 *      manuel dalının (`quote-compute.ts`) ÜRETTİĞİ sayının AYNISIdır. Çerçeve
 *      ikinci bir çarpma icat etmedi (aynı kural DB CHECK'inde de duruyor:
 *      `quote_framework_batch_lines_line_chk`).
 *   2. KAPASİTE: ağırlık kuralının TEK kopyası var (`painterLoadUnits`) ve bu
 *      modül eşiği KURMAZ — `benchHasRoom` argüman olarak gelir. Bir ekran,
 *      ucun uygulamadığı bir ölçüyle kimseyi kapatamaz.
 *   3. PLAN KAPILARI: dört kural birbirini MASKELEMEZ; bozuk bir plan dört
 *      retle birden döner, admin neyi düzeltmesi gerektiğini görür.
 *   4. KOVA MATEMATİĞİ: kovalar DAİMA taahhüde toplanır ve aynı sipariş iki
 *      kovaya birden sayılmaz — aksi hâlde ekran yalan söyler. İPTAL, şemanın
 *      hiç üretmediği bir durum dizesiyle değil, depodaki tek iptal ölçüsünün
 *      (`actualReturnFacts`, `order-money.ts`) GERÇEĞİYLE okunur.
 *
 * Ayrıca kaynak denetimi: bu modül `server-only`, `node:`, `@/lib/db` ya da
 * `services/manufacturer-capacity` IMPORT ETMEZ (worker grafı + istemci paketi
 * güvende, kapasite kapısı tek sahipli).
 *
 * Çalıştır: npx tsx scripts/test-quote-framework.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addBusinessDays, istanbulDateKey } from "../src/lib/config/business-days";
import { computeQuote } from "../src/lib/config/quote-compute";
import {
  BATCH_STATUSES,
  FRAMEWORK_STATUSES,
  FRAMEWORK_TERMS_VERSION,
  MAX_BATCHES_PER_FRAMEWORK,
  MAX_FRAMEWORK_TOTAL_KURUS,
  frameworkBatchDriftCode,
  frameworkBatchLoadUnits,
  frameworkBatchTotals,
  frameworkCommitmentRemaining,
  frameworkLineKurus,
  frameworkPaintingForbidden,
  frameworkProgressBuckets,
  validateBatchPlan,
  validateFrameworkAgreement,
  FRAMEWORK_PRICE_DRIFT_ERROR,
  type FrameworkBatchLineInput,
  type FrameworkCommitmentPart,
  type FrameworkProgressLine,
  type FrameworkRefusalCode,
} from "../src/lib/config/quote-framework";
import {
  BATCH_STATUS_DICT_KEYS,
  FRAMEWORK_BUCKET_DICT_KEYS,
  FRAMEWORK_STATUS_DICT_KEYS,
} from "../src/app/cerceve/[number]/framework-values";
import { progressSegments } from "../src/app/admin/cerceve/[id]/framework-values";
import en from "../src/lib/i18n/dictionaries/en";
import tr from "../src/lib/i18n/dictionaries/tr";
import { QUOTE_FRAMEWORK_BATCH_REASON } from "../src/lib/config/quote-policy";
import { painterLoadUnits } from "../src/lib/config/painter-scoring";
import { MAX_AMOUNT_KURUS } from "../src/lib/config/prices";
import { partPricingKey } from "../src/lib/config/quote-keys";
import { SEED_SNAPSHOT } from "../src/lib/config/quote-seed";
import type { PartConfig, PricingPartInput, PricingSnapshot } from "../src/lib/config/quote-types";

const ROOT = join(__dirname, "..");
const MODULE = "src/lib/config/quote-framework.ts";
const moduleSrc = readFileSync(join(ROOT, MODULE), "utf8");

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log("  ok  ", name);
  } catch (err) {
    fail++;
    failures.push(`${name}: ${(err as Error).message}`);
    console.error("  FAIL", name, "\n      ", (err as Error).message);
  }
}

/** Yorumları atar: bir kuralın yorumda ANILMASI onu yazmak değildir. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const moduleCode = stripComments(moduleSrc);

const S: PricingSnapshot = SEED_SNAPSHOT;
/** Deterministik sözde rastgele: kırmızı bir koşu aynı sayılarla tekrarlanabilir. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
function codes(refusals: { code: FrameworkRefusalCode }[]): FrameworkRefusalCode[] {
  return refusals.map((r) => r.code).sort();
}

// ─── 1) Kapalı kümeler ve sabitler ──────────────────────────────────────────

console.log("\n1) kapalı kümeler ve sabitler");

test("çerçeve durumları kapalı küme", () => {
  assert.deepEqual([...FRAMEWORK_STATUSES], [
    "draft",
    "active",
    "completed",
    "expired",
    "cancelled",
  ]);
});
test("parti durumları kapalı küme", () => {
  assert.deepEqual([...BATCH_STATUSES], ["planned", "released", "cancelled"]);
});
test("parti üst sınırı 24", () => {
  assert.equal(MAX_BATCHES_PER_FRAMEWORK, 24);
});
test("çerçeve şartları sürümü var ve mesafeli sözleşme sürümü DEĞİL", () => {
  assert.match(FRAMEWORK_TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(
    !moduleCode.includes("DISTANCE_CONTRACT_VERSION") &&
      !moduleCode.includes("PRELIMINARY_INFO_VERSION"),
    "çerçeve şartları mesafeli satış sürümleriyle karıştırılmış"
  );
});

// ─── 2) PARA: tek çarpma, tek tavan ─────────────────────────────────────────
//
// `frameworkLineKurus` teklif motorunun MANUEL dalının ürettiği sayıyı
// üretmelidir: kilitli birim fiyat manuel fiyattır ve parti satırı o fiyatın
// adetle çarpımıdır. Üç yer (saf çekirdek, DB CHECK'i, computeQuote) TEK kural.

console.log("\n2) para: satır aritmetiği computeQuote'un manuel dalıyla aynı");

const BASE_CONFIG: PartConfig = {
  technologyKey: "fdm",
  materialKey: "pla",
  colorKey: "beyaz",
  finishKey: "ham",
  layerUm: 200,
  infillPct: 20,
  quantity: 1,
  units: "mm",
  scale: 1,
  criticalTolerance: false,
};
const CUBE = {
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
  tessellation: null,
  solidCount: null,
};

/** Manuel (yani KİLİTLİ) birim fiyatı olan bir parça: anahtarı adetle üretilir. */
function manualPart(unitKurus: number, quantity: number): PricingPartInput {
  const config: PartConfig = { ...BASE_CONFIG, quantity };
  return {
    id: "p1",
    analysisStatus: "ready",
    geometry: CUBE,
    sourceSha256: "sha-cube-20",
    config,
    manualUnitPriceKurus: unitKurus,
    manualPriceKey: partPricingKey({ sourceSha256: "sha-cube-20", config }, "standard"),
    dfmAckKey: null,
  };
}
/** computeQuote'un manuel dalının yazdığı satır tutarı. */
function engineLineKurus(unitKurus: number, quantity: number): number {
  const computed = computeQuote(S, [manualPart(unitKurus, quantity)], {
    leadTier: "standard",
    addonKeys: [],
  });
  const price = computed.parts[0]!.price;
  assert.ok(price.ok, "manuel fiyatlı parça fiyatlanamadı");
  assert.equal(price.source, "manual");
  return price.lineKurus;
}

test("altın değerler: satır = birim × adet", () => {
  assert.equal(frameworkLineKurus(9999, 1), 9999);
  assert.equal(frameworkLineKurus(12_500, 120), 1_500_000);
  assert.equal(frameworkLineKurus(1, 100_000), 100_000);
  assert.equal(frameworkLineKurus(9999, 1), engineLineKurus(9999, 1));
  assert.equal(frameworkLineKurus(12_500, 120), engineLineKurus(12_500, 120));
});
test("10.000 rastgele (birim, adet) çiftinde motorla BİREBİR aynı", () => {
  const random = rng(20260930);
  for (let i = 0; i < 10_000; i++) {
    const unitKurus = 1 + Math.floor(random() * 200_000);
    const quantity = 1 + Math.floor(random() * 1000);
    const mine = frameworkLineKurus(unitKurus, quantity);
    assert.equal(mine, unitKurus * quantity, `${unitKurus} × ${quantity}`);
    if (i % 250 === 0) {
      assert.equal(mine, engineLineKurus(unitKurus, quantity), `${unitKurus} × ${quantity}`);
    }
  }
});
test("parti toplamı satırlardan türer, elle toplanmaz", () => {
  const lines: FrameworkBatchLineInput[] = [
    { partId: "a", quantity: 120, unitKurus: 12_500 },
    { partId: "b", quantity: 40, unitKurus: 7_000 },
  ];
  assert.deepEqual(frameworkBatchTotals(lines), {
    units: 160,
    partsKurus: 120 * 12_500 + 40 * 7_000,
  });
  assert.deepEqual(frameworkBatchTotals([]), { units: 0, partsKurus: 0 });
});
test("çerçeve tavanı MAX_AMOUNT_KURUS'tan TÜRETİLİR (₺40M)", () => {
  assert.equal(MAX_FRAMEWORK_TOTAL_KURUS, 20 * MAX_AMOUNT_KURUS);
  assert.equal(MAX_FRAMEWORK_TOTAL_KURUS, 40_000_000_00);
  assert.ok(
    !/2_000_000_00|200000000/.test(moduleCode),
    "tavan sayısı yeniden yazılmış: MAX_AMOUNT_KURUS import edilmeli"
  );
});

// ─── 3) Kapasite: ağırlık kuralının tek kopyası ─────────────────────────────

console.log("\n3) kapasite: ağırlık tek kaynaktan, eşik BU MODÜLDE değil");

test("frameworkBatchLoadUnits === painterLoadUnits", () => {
  for (const n of [1, 19, 20, 21, 500]) {
    assert.equal(frameworkBatchLoadUnits(n), painterLoadUnits(n), `${n} adet`);
  }
  assert.equal(frameworkBatchLoadUnits(500), 26);
});
test("ağırlık kuralı bu modülde YENİDEN YAZILMAZ (painterLoadUnits import edilir)", () => {
  assert.ok(
    /import\s*\{[\s\S]*?painterLoadUnits[\s\S]*?\}\s*from/.test(moduleCode),
    "painterLoadUnits import edilmiyor"
  );
  assert.doesNotMatch(
    moduleCode,
    /\/\s*20|0\.05|PAINTER_UNITS_PER_EXTRA_SLOT\s*=/,
    "ağırlık formülünün düz sayısı bu modüle kopyalanmış"
  );
});
test("kapasite EŞİĞİ bu modülde YOK (maxConcurrentOrders karşılaştırması yok)", () => {
  assert.ok(
    !moduleCode.includes("maxConcurrentOrders"),
    "eşik bu modüle kaçmış: karar `manufacturerHasRoom`un olmalı"
  );
});

// ─── 4) Saflık: worker grafı ve istemci paketi ──────────────────────────────

console.log("\n4) saflık (kaynak denetimi)");

for (const [label, pattern] of [
  ['"server-only" import etmiyor', /["']server-only["']/],
  ['`node:` import etmiyor', /from\s+["']node:/],
  ["`@/lib/db` import etmiyor", /["']@\/lib\/db/],
  ["`services/manufacturer-capacity` import etmiyor", /manufacturer-capacity/],
  ["hiçbir `services/` modülünü import etmiyor", /from\s+["']@\/lib\/services\//],
] as const) {
  test(`${MODULE}: ${label}`, () => {
    assert.doesNotMatch(moduleCode, pattern);
  });
}
test("kova matematiği sipariş DURUM dizesini KENDİ ölçmez (iptal GERÇEĞİ argüman)", () => {
  // `orderStatusEnum` (`schema.ts:55`) `'cancelled'` diye bir değer TAŞIMAZ:
  // iptal `status='rejected'` yazar, `payment_status`u `'succeeded'` bırakır ve
  // ikinci biçimi (`order_refunds.kind='cancellation'`) `status`ta hiç
  // görünmez. Bu modül şema enum'unu göremediği için durumu kendi ölçerse
  // sessizce yanlış olur; ölçü `order-money.ts`in `actualReturnFacts`ında durur
  // ve buraya hazır GERÇEK (`cancelled`) olarak gelir.
  assert.ok(
    !moduleCode.includes("orderStatus"),
    "sipariş durum dizesi bu modüle geri kaçmış: enum'u göremeyen bir karşılaştırma"
  );
  assert.match(
    moduleCode,
    /countsAsRevenue\(line\.paymentStatus\)\s*&&\s*!line\.cancelled/,
    "ciro kapısı iptal gerçeğiyle EŞLEŞTİRİLMEMİŞ (`revenueKurus`un deseni)"
  );
});
test("tutar adları `…Kurus` ile BİTER (fiyat kapısı çerçeveyi de süzsün)", () => {
  // D'nin `…Kurus` YASAĞI çevrilmiş DÖVİZ değerlerine özeldi. Çerçeve tutarları
  // kuruş tamsayısıdır: adı `…Kurus` ile bitmezse `quote-present.ts`in
  // `endsWith("Kurus")` kapısı onları fiyatsız izleyiciye SIZDIRIR.
  assert.ok(moduleCode.includes("amountKurus"), "amountKurus yok");
  assert.ok(moduleCode.includes("partsKurus"), "partsKurus yok");
  assert.ok(moduleCode.includes("unitKurus"), "unitKurus yok");
  for (const name of ["amountMinor", "amountMicro", "totalMinor"]) {
    assert.ok(!moduleCode.includes(name), `${name}: döviz adlandırması çerçeveye taşınmış`);
  }
});

// SERVİS KATMANI (`src/lib/services/quote-framework.ts`) da denetlenir: saf
// olmak zorunda DEĞİL (DB'ye bağlanıyor) ama `server-only` grafına
// GİREMEZ — bakım turu (standalone Node worker) onu import edecek.
const SERVICE = "src/lib/services/quote-framework.ts";
const serviceCode = stripComments(readFileSync(join(ROOT, SERVICE), "utf8"));

test(`${SERVICE}: \`server-only\` İÇERMEZ`, () => {
  assert.doesNotMatch(serviceCode, /["']server-only["']/);
});
test(`${SERVICE}: \`quote-checkout\` dizesini İÇERMEZ`, () => {
  // `quote-checkout.ts` → `analytics/attribution-server.ts` → `server-only`:
  // standalone Node worker'ını açılışta crash-loop'a sokar. `freezeParts` bu
  // yüzden `quote-service.ts`e taşındı.
  assert.doesNotMatch(serviceCode, /quote-checkout/);
});
test(`${SERVICE}: \`loadActiveSnapshot\` ÇAĞIRMAZ (kilidi açan tek çağrı)`, () => {
  // Klonun snapshot'ı ANLAŞMANIN snapshot'ıdır. Canlı kataloğu okumak,
  // kilitli fiyatı sessizce bugünün fiyatına çevirmek olurdu.
  assert.doesNotMatch(serviceCode, /loadActiveSnapshot/);
});
test(`${SERVICE}: tahsilat zincirini İÇERMEZ (çerçeve bir indirim değil)`, () => {
  assert.doesNotMatch(serviceCode, /quote-tender|computeTender|payableKurus/);
});
test(`${SERVICE}: ikinci bir kapasite sorgusu KURMAZ`, () => {
  // Kapasitenin tek sahibi `manufacturer-capacity.ts`tir (KARAR 1): eşik ve
  // tezgâh tanımı orada durur, burada YALNIZ çağrılır.
  assert.match(serviceCode, /loadManufacturerCapacities/);
  assert.match(serviceCode, /manufacturerHasRoom/);
  assert.doesNotMatch(serviceCode, /ACTIVE_MFG_STATUSES|orderStillOnManufacturerBench/);
});
test("`freezeParts` depoda TEK yerde TANIMLI (tek dondurma yolu)", () => {
  // İkinci bir dondurma, kilitli fiyatın sürüklenmesinin en kısa yoludur.
  const defs = execFileSync(
    "grep",
    ["-rlE", "^(export )?function freezeParts\\(", "src", "scripts"],
    { cwd: ROOT, encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  assert.deepEqual(defs, ["src/lib/services/quote-service.ts"]);
});

// ─── 5) Anlaşma kurulumu: boyama YASAK, tavan tek ───────────────────────────

console.log("\n5) anlaşma kurulumu");

const PAINTED_FINISH = S.finishes.find((f) => f.costLineKind === "painting");
assert.ok(PAINTED_FINISH, "tohum katalogda boyama kalemi olan bir yüzey bulunamadı");

test("boyama kalemi taşıyan yüzey anlaşmayı REDDETTİRİR", () => {
  assert.equal(frameworkPaintingForbidden(S, [{ finishKey: "ham" }]), false);
  assert.equal(frameworkPaintingForbidden(S, [{ finishKey: PAINTED_FINISH!.key }]), true);
  assert.equal(
    frameworkPaintingForbidden(S, [{ finishKey: "ham" }, { finishKey: PAINTED_FINISH!.key }]),
    true,
    "tek boyalı parça bile yeter"
  );
});
test("bilinmeyen yüzey de REDDEDİLİR (kanıtlayamadığımız şey lehe yazılmaz)", () => {
  assert.equal(frameworkPaintingForbidden(S, [{ finishKey: "olmayan_yuzey" }]), true);
});
test("boyalı parça: anlaşma doğrulayıcısı `painting_forbidden` döner", () => {
  const refusals = validateFrameworkAgreement({
    snapshot: S,
    parts: [{ finishKey: PAINTED_FINISH!.key }],
    committedTotalKurus: 1_000_000,
  });
  assert.deepEqual(codes(refusals), ["painting_forbidden"]);
});
test("çerçeve TOPLAMI: tam sınır geçer, bir kuruş fazlası REDDEDİLİR", () => {
  const ok = validateFrameworkAgreement({
    snapshot: S,
    parts: [{ finishKey: "ham" }],
    committedTotalKurus: MAX_FRAMEWORK_TOTAL_KURUS,
  });
  assert.deepEqual(ok, []);
  const over = validateFrameworkAgreement({
    snapshot: S,
    parts: [{ finishKey: "ham" }],
    committedTotalKurus: MAX_FRAMEWORK_TOTAL_KURUS + 1,
  });
  assert.deepEqual(codes(over), ["framework_total_over_cap"]);
});
test("çerçeve toplamı parti tavanını AŞABİLİR (tek ödeme değil)", () => {
  const refusals = validateFrameworkAgreement({
    snapshot: S,
    parts: [{ finishKey: "ham" }],
    committedTotalKurus: MAX_AMOUNT_KURUS + 1,
  });
  assert.deepEqual(refusals, []);
});

// ─── 6) Taahhüt defteri ─────────────────────────────────────────────────────

console.log("\n6) taahhüt defteri");

const COMMITMENT: FrameworkCommitmentPart[] = [
  { partId: "P1", quantity: 100, unitKurus: 12_500 },
  { partId: "P2", quantity: 40, unitKurus: 7_000 },
];

test("kalan taahhüt = taahhüt − TÜKETEN satırlar", () => {
  const remaining = frameworkCommitmentRemaining(COMMITMENT, [
    { partId: "P1", quantity: 60, batchStatus: "released", orderId: "o1" },
    { partId: "P1", quantity: 10, batchStatus: "planned", orderId: null },
    { partId: "P2", quantity: 40, batchStatus: "planned", orderId: null },
  ]);
  assert.equal(remaining.get("P1"), 30);
  assert.equal(remaining.get("P2"), 0);
});
test("serbest bırakılMAMIŞ iptal partisi taahhüdü TÜKETMEZ", () => {
  const remaining = frameworkCommitmentRemaining(COMMITMENT, [
    { partId: "P1", quantity: 100, batchStatus: "cancelled", orderId: null },
  ]);
  assert.equal(remaining.get("P1"), 100, "iptal edilmiş plan yeniden planlanabilmeli");
});
test("serbest bırakılMIŞ (siparişi olan) parti iptali taahhüdü TÜKETİR", () => {
  // Para hareket etti: taahhüt geri yüklenmez (tasarım §3.1).
  const remaining = frameworkCommitmentRemaining(COMMITMENT, [
    { partId: "P1", quantity: 100, batchStatus: "cancelled", orderId: "o1" },
  ]);
  assert.equal(remaining.get("P1"), 0);
});

// ─── 7) Plan doğrulayıcı: dört kural, dört ayrı ret ─────────────────────────

console.log("\n7) plan doğrulayıcı");

const NOW = new Date("2026-10-05T09:00:00.000Z"); // Pazartesi 12:00 İstanbul
const LEAD_DAYS = 7;
const FROZEN = S.settings.holidays;
const earliestKey = (holidays: string[], days = LEAD_DAYS) =>
  istanbulDateKey(addBusinessDays(NOW, days, holidays, S.settings.cutoffHour));

/** Kuralların hepsini GEÇEN bir plan; her vaka tek bir alanı bozar. */
function goodPlan(over: {
  lines?: FrameworkBatchLineInput[];
  plannedShipDate?: string;
  benchHasRoom?: boolean;
  snapshot?: PricingSnapshot;
  ledger?: Parameters<typeof frameworkCommitmentRemaining>[1];
  existingBatchCount?: number;
  addonsKurus?: number;
}) {
  const lines = over.lines ?? [{ partId: "P1", quantity: 100, unitKurus: 12_500 }];
  const totals = frameworkBatchTotals(lines);
  const addonsKurus = over.addonsKurus ?? 0;
  return validateBatchPlan({
    snapshot: over.snapshot ?? S,
    commitment: COMMITMENT,
    ledger: over.ledger ?? [],
    lines,
    batch: {
      units: totals.units,
      amountKurus: totals.partsKurus + addonsKurus,
      plannedShipDate: over.plannedShipDate ?? earliestKey(FROZEN),
      benchHasRoom: over.benchHasRoom ?? true,
    },
    addonsKurus,
    leadDays: LEAD_DAYS,
    now: NOW,
    existingBatchCount: over.existingBatchCount ?? 0,
  });
}

test("kuralların hepsini geçen plan BOŞ dizi döner", () => {
  assert.deepEqual(goodPlan({}), []);
});
test("Σ parti adedi = taahhüt → geçer; taahhüt + 1 → REDDEDİLİR", () => {
  assert.deepEqual(goodPlan({ lines: [{ partId: "P1", quantity: 100, unitKurus: 12_500 }] }), []);
  const over = goodPlan({ lines: [{ partId: "P1", quantity: 101, unitKurus: 12_500 }] });
  assert.deepEqual(codes(over), ["commitment_exceeded"], "kapı <= olmalı, < değil");
});
test("önceki partiler taahhüdü tüketir: kalan 30 iken 31 REDDEDİLİR", () => {
  const ledger = [
    { partId: "P1", quantity: 70, batchStatus: "released" as const, orderId: "o1" },
  ];
  assert.deepEqual(goodPlan({ ledger, lines: [{ partId: "P1", quantity: 30, unitKurus: 12_500 }] }), []);
  assert.deepEqual(
    codes(goodPlan({ ledger, lines: [{ partId: "P1", quantity: 31, unitKurus: 12_500 }] })),
    ["commitment_exceeded"]
  );
});
test("AYNI parça iki satırda → duplicate_part, taahhüt sessizce aşılmaz", () => {
  // Bu vakanın sebebi: taahhüt kapısı her satırı AYNI `left` değerine karşı
  // ölçüyor. Tekillik kapısı olmasaydı 100 kalanda 60+60 iki satır olarak
  // İKİSİ DE geçerdi (60 <= 100) ve parti taahhüdün iki katını planlardı;
  // `(batch_id, part_id)` tekil indeksi onu yazmazdı ama admin'in gördüğü şey
  // sebebi söylemeyen bir 23505 olurdu.
  const dup = goodPlan({
    lines: [
      { partId: "P1", quantity: 60, unitKurus: 12_500 },
      { partId: "P1", quantity: 60, unitKurus: 12_500 },
    ],
  });
  assert.ok(codes(dup).includes("duplicate_part"), "ikinci satır reddedilmeli");
  assert.ok(dup.length > 0, "toplayıp geçirmek taahhüdü sessizce aşardı");
});
test("bozuk satır veritabanına GİTMEZ: adet 0 ve birim fiyat 0 → invalid_line", () => {
  // `_qty_chk`/`_unit_chk` kısıtları bunu zaten tutuyor, ama INSERT anında:
  // saf kapı geçirirse admin 23514 görür, hangi satır neden reddedildi
  // bilgisini değil.
  assert.ok(
    codes(goodPlan({ lines: [{ partId: "P1", quantity: 0, unitKurus: 12_500 }] })).includes(
      "invalid_line"
    )
  );
  assert.ok(
    codes(goodPlan({ lines: [{ partId: "P1", quantity: 5, unitKurus: 0 }] })).includes(
      "invalid_line"
    )
  );
  assert.ok(
    codes(goodPlan({ lines: [{ partId: "P1", quantity: 1.5, unitKurus: 12_500 }] })).includes(
      "invalid_line"
    ),
    "tam sayı olmayan adet de reddedilmeli"
  );
});
test("taahhütte OLMAYAN parça REDDEDİLİR", () => {
  assert.deepEqual(
    codes(goodPlan({ lines: [{ partId: "YOK", quantity: 2, unitKurus: 12_500 }] })),
    ["commitment_exceeded"]
  );
});
test("asgari tamamlama sürprizi imkânsız: minOrder − 1 REDDEDİLİR, minOrder geçer", () => {
  const min = S.settings.minOrderKurus;
  assert.equal(min, 20000);
  assert.deepEqual(
    codes(goodPlan({ lines: [{ partId: "P1", quantity: 1, unitKurus: min - 1 }] })),
    ["below_min_order"]
  );
  assert.deepEqual(goodPlan({ lines: [{ partId: "P1", quantity: 1, unitKurus: min }] }), []);
});
test("ek hizmet tutarı asgari tamamlamaya SAYILIR", () => {
  const min = S.settings.minOrderKurus;
  assert.deepEqual(
    goodPlan({ lines: [{ partId: "P1", quantity: 1, unitKurus: min - 500 }], addonsKurus: 500 }),
    []
  );
});
test("tezgâh kararı ARGÜMANDIR: benchHasRoom=false REDDEDİLİR", () => {
  assert.deepEqual(codes(goodPlan({ benchHasRoom: false })), ["bench_full"]);
  assert.deepEqual(goodPlan({ benchHasRoom: true }), []);
});
test("plannedShipDate: en erken iş günü geçer, bir İŞ GÜNÜ öncesi REDDEDİLİR", () => {
  assert.deepEqual(goodPlan({ plannedShipDate: earliestKey(FROZEN) }), []);
  assert.deepEqual(
    codes(goodPlan({ plannedShipDate: earliestKey(FROZEN, LEAD_DAYS - 1) })),
    ["ship_date_too_early"]
  );
  assert.deepEqual(goodPlan({ plannedShipDate: earliestKey(FROZEN, LEAD_DAYS + 1) }), []);
});
test("tarih kapısı DONMUŞ tatil listesini okur (canlıya eklenen tatil kaydırmaz)", () => {
  const frozenEarliest = earliestKey(FROZEN);
  // İmzadan SONRA eklenen bir tatil: aynı tarih DONMUŞ snapshot'ta geçerli
  // kalır. Canlı listeye (ayrı bir snapshot) girdiğinde gün kayar — yani
  // fonksiyon tatilleri VERİLEN snapshot'tan okuyor, başka bir kanaldan değil.
  const live: PricingSnapshot = {
    ...S,
    settings: { ...S.settings, holidays: [...FROZEN, frozenEarliest] },
  };
  assert.deepEqual(goodPlan({ plannedShipDate: frozenEarliest }), []);
  assert.deepEqual(
    codes(goodPlan({ plannedShipDate: frozenEarliest, snapshot: live })),
    ["ship_date_too_early"]
  );
  assert.ok(
    moduleCode.includes("addBusinessDays"),
    "ikinci bir takvim yazılmış: addBusinessDays import edilmeli"
  );
});
test("parti sayısı tavanı: 24. parti geçer, 25. REDDEDİLİR", () => {
  assert.deepEqual(goodPlan({ existingBatchCount: MAX_BATCHES_PER_FRAMEWORK - 1 }), []);
  assert.deepEqual(codes(goodPlan({ existingBatchCount: MAX_BATCHES_PER_FRAMEWORK })), [
    "batch_limit_reached",
  ]);
});
test("parti tutarı MAX_AMOUNT_KURUS'u AŞAMAZ (tek ödeme tavanı)", () => {
  const lines = [{ partId: "P1", quantity: 100, unitKurus: MAX_AMOUNT_KURUS / 100 + 1 }];
  assert.deepEqual(codes(goodPlan({ lines })), ["batch_amount_over_cap"]);
  assert.deepEqual(goodPlan({ lines: [{ partId: "P1", quantity: 100, unitKurus: MAX_AMOUNT_KURUS / 100 }] }), []);
});
test("parti tutarı satırlardan SAPAMAZ (üç yer, tek aritmetik)", () => {
  const lines: FrameworkBatchLineInput[] = [{ partId: "P1", quantity: 100, unitKurus: 12_500 }];
  const refusals = validateBatchPlan({
    snapshot: S,
    commitment: COMMITMENT,
    ledger: [],
    lines,
    batch: {
      units: 100,
      amountKurus: 1_250_001, // elle toplanmış: bir kuruş fazla
      plannedShipDate: earliestKey(FROZEN),
      benchHasRoom: true,
    },
    addonsKurus: 0,
    leadDays: LEAD_DAYS,
    now: NOW,
    existingBatchCount: 0,
  });
  assert.deepEqual(codes(refusals), ["batch_totals_mismatch"]);
});
test("DÖRT kural birden bozuk: DÖRT ret döner, hiçbiri diğerini maskelemez", () => {
  const refusals = goodPlan({
    lines: [{ partId: "P1", quantity: 101, unitKurus: 19 }], // taahhüt + asgari
    benchHasRoom: false,
    plannedShipDate: "2026-10-06",
  });
  assert.deepEqual(codes(refusals), [
    "below_min_order",
    "bench_full",
    "commitment_exceeded",
    "ship_date_too_early",
  ]);
  for (const r of refusals) {
    assert.ok(r.message.length > 0, `${r.code} için Türkçe cümle yok`);
  }
});

// ─── 8) Kova matematiği ─────────────────────────────────────────────────────

console.log("\n8) kova matematiği");

function line(over: Partial<FrameworkProgressLine> = {}): FrameworkProgressLine {
  return {
    partId: "P1",
    quantity: 10,
    batchStatus: "planned",
    orderId: null,
    cancelled: false,
    paymentStatus: null,
    shippedAt: null,
    deliveredAt: null,
    ...over,
  };
}
function sumBuckets(p: ReturnType<typeof frameworkProgressBuckets>["total"]): number {
  return (
    p.unplannedUnits +
    p.plannedUnits +
    p.awaitingPaymentUnits +
    p.inProductionUnits +
    p.shippedUnits +
    p.deliveredUnits +
    p.cancelledOrRefundedUnits
  );
}

test("her durum kendi kovasına düşer", () => {
  const { total } = frameworkProgressBuckets(COMMITMENT, [
    line({ quantity: 10, batchStatus: "planned" }),
    // "Ödeme bekleyen"in GERÇEK hâli: klon teklif var, ödenmediği için henüz
    // `orders` satırı YOK (`orderId: null`).
    line({ quantity: 10, batchStatus: "released" }),
    // SAVUNMA dalı (şema bu çifti üretmez: `paymentStatusEnum` yalnız
    // `succeeded | refunded`). Ciro kapısı bir BEYAZ LİSTEdir: `succeeded`
    // dışındaki hiçbir değer "Üretimde" göstermez.
    line({
      quantity: 10,
      batchStatus: "released",
      orderId: "o-havale",
      paymentStatus: "pending",
    }),
    line({
      quantity: 10,
      batchStatus: "released",
      orderId: "o-uretim",
      paymentStatus: "succeeded",
    }),
    line({
      quantity: 10,
      batchStatus: "released",
      orderId: "o-sevk",
      paymentStatus: "succeeded",
      shippedAt: new Date("2026-11-01T10:00:00Z"),
    }),
    line({
      quantity: 10,
      batchStatus: "released",
      orderId: "o-teslim",
      paymentStatus: "succeeded",
      shippedAt: new Date("2026-11-01T10:00:00Z"),
      deliveredAt: new Date("2026-11-04T10:00:00Z"),
    }),
    line({
      quantity: 10,
      batchStatus: "released",
      orderId: "o-iade",
      paymentStatus: "refunded",
      shippedAt: new Date("2026-11-01T10:00:00Z"),
      deliveredAt: new Date("2026-11-04T10:00:00Z"),
    }),
  ]);
  assert.equal(total.plannedUnits, 10);
  assert.equal(total.awaitingPaymentUnits, 20, "klonu var + ciroya saymayan ödeme");
  assert.equal(total.inProductionUnits, 10);
  assert.equal(total.shippedUnits, 10);
  assert.equal(total.deliveredUnits, 10);
  assert.equal(total.cancelledOrRefundedUnits, 10);
  assert.equal(total.committedUnits, 140);
  assert.equal(total.unplannedUnits, 70);
  assert.equal(sumBuckets(total), total.committedUnits);
});
test("iade edilmiş VE sevk edilmiş sipariş YALNIZ ayrık kovaya sayılır", () => {
  const { total } = frameworkProgressBuckets(COMMITMENT, [
    line({
      quantity: 10,
      batchStatus: "released",
      orderId: "o1",
      paymentStatus: "refunded",
      shippedAt: new Date("2026-11-01T10:00:00Z"),
    }),
  ]);
  assert.equal(total.cancelledOrRefundedUnits, 10);
  assert.equal(total.shippedUnits, 0, "çifte sayım");
  assert.equal(total.deliveredUnits, 0);
  assert.equal(sumBuckets(total), total.committedUnits);
});
test("GERÇEK iptal (ödeme `succeeded` KALIR) ayrık kovaya sayılır, ÜRETİMDE görünmez", () => {
  // Depodaki iptal yolu: `order-refund-record.ts` `closeOrder` `status`u
  // `'rejected'` yapar ve `payment_status`u `'succeeded'` BIRAKIR (iade ise
  // tersi). İkinci iptal biçimi (`order_refunds.kind='cancellation'`) `status`ta
  // hiç görünmez. İkisi de `actualReturnFacts(...).cancelled` ile ölçülür ve
  // yükleyici o GERÇEĞİ `cancelled` alanında verir — kova dizeyi ölçmez.
  const { total } = frameworkProgressBuckets(COMMITMENT, [
    line({
      quantity: 10,
      batchStatus: "released",
      orderId: "o1",
      cancelled: true,
      paymentStatus: "succeeded",
    }),
  ]);
  assert.equal(total.cancelledOrRefundedUnits, 10);
  assert.equal(total.inProductionUnits, 0, "iptal edilmiş parti 'Üretimde' gösterilemez");
  assert.equal(total.awaitingPaymentUnits, 0);
  assert.equal(sumBuckets(total), total.committedUnits);
});
test("SEVK/TESLİM edilmiş bir parti sonradan iptal edilirse YALNIZ ayrık kovada", () => {
  // İptal geriye dönük kapatır: sevk ve teslim damgaları yerinde kalır. Ayrık
  // kova fiziksel gerçeğin ÜSTÜNDE durur, yoksa çubuk taahhüdü aşar.
  const { total } = frameworkProgressBuckets(COMMITMENT, [
    line({
      quantity: 10,
      batchStatus: "released",
      orderId: "o-sevk",
      cancelled: true,
      paymentStatus: "succeeded",
      shippedAt: new Date("2026-11-01T10:00:00Z"),
    }),
    line({
      quantity: 10,
      batchStatus: "released",
      orderId: "o-teslim",
      cancelled: true,
      paymentStatus: "succeeded",
      shippedAt: new Date("2026-11-01T10:00:00Z"),
      deliveredAt: new Date("2026-11-04T10:00:00Z"),
    }),
  ]);
  assert.equal(total.cancelledOrRefundedUnits, 20);
  assert.equal(total.shippedUnits, 0, "çifte sayım");
  assert.equal(total.deliveredUnits, 0, "çifte sayım");
  assert.equal(sumBuckets(total), total.committedUnits);
});
test("serbest bırakılMAMIŞ iptal partisi planlanmamışa DÖNER", () => {
  const { total } = frameworkProgressBuckets(COMMITMENT, [
    line({ quantity: 100, batchStatus: "cancelled", orderId: null }),
  ]);
  assert.equal(total.cancelledOrRefundedUnits, 0);
  assert.equal(total.unplannedUnits, 140, "iptal edilen plan yeniden planlanabilir");
  assert.equal(sumBuckets(total), total.committedUnits);
});
test("parça kırılımı anlaşma toplamına toplanır", () => {
  const rows = [
    line({ partId: "P1", quantity: 60, batchStatus: "released", orderId: "o1", paymentStatus: "succeeded" }),
    line({ partId: "P2", quantity: 40, batchStatus: "planned" }),
  ];
  const { total, byPart } = frameworkProgressBuckets(COMMITMENT, rows);
  assert.deepEqual(byPart.map((p) => p.partId), ["P1", "P2"]);
  assert.equal(byPart[0]!.inProductionUnits, 60);
  assert.equal(byPart[0]!.unplannedUnits, 40);
  assert.equal(byPart[1]!.plannedUnits, 40);
  assert.equal(byPart[1]!.unplannedUnits, 0);
  for (const p of byPart) assert.equal(sumBuckets(p), p.committedUnits, p.partId);
  assert.equal(
    total.committedUnits,
    byPart.reduce((s, p) => s + p.committedUnits, 0)
  );
});
test("1.000 rastgele satır kümesinde kovalar DAİMA taahhüde toplanır", () => {
  const random = rng(73_0073);
  for (let round = 0; round < 1000; round++) {
    // Kapının izin verdiği şekilde üretilir: Σ tüketen adet <= taahhüt.
    const rows: FrameworkProgressLine[] = [];
    for (const part of COMMITMENT) {
      let left = part.quantity;
      while (left > 0) {
        const quantity = 1 + Math.floor(random() * left);
        const roll = random();
        const cancelledPlan = roll < 0.12;
        const released = roll >= 0.2;
        const hasOrder = roll >= 0.35;
        rows.push({
          partId: part.partId,
          quantity,
          batchStatus: cancelledPlan ? "cancelled" : released ? "released" : "planned",
          orderId: !cancelledPlan && hasOrder ? `o-${round}-${left}` : null,
          cancelled: roll > 0.9,
          paymentStatus: roll > 0.8 ? "refunded" : hasOrder ? "succeeded" : null,
          shippedAt: roll > 0.6 ? new Date("2026-11-01T10:00:00Z") : null,
          deliveredAt: roll > 0.7 ? new Date("2026-11-04T10:00:00Z") : null,
        });
        // İptal edilen plan taahhüdü tüketmez: kalan azalmaz.
        if (!cancelledPlan || rows[rows.length - 1]!.orderId !== null) left -= quantity;
      }
    }
    const { total, byPart } = frameworkProgressBuckets(COMMITMENT, rows);
    assert.equal(sumBuckets(total), total.committedUnits, `tur ${round}`);
    assert.equal(total.committedUnits, 140, `tur ${round}`);
    for (const p of byPart) {
      assert.equal(sumBuckets(p), p.committedUnits, `tur ${round} · ${p.partId}`);
      assert.ok(p.unplannedUnits >= 0, `tur ${round} · ${p.partId} negatif kova`);
    }
  }
});

// ─── 9) Eşitlik kapısı (fiyat sapması) ──────────────────────────────────────

console.log("\n9) eşitlik kapısı: kilitli tutar ile bugün hesaplanan brüt");

test("eşit tutarda kapı AÇIK (null döner)", () => {
  assert.equal(frameworkBatchDriftCode(1_234_500, 1_234_500), null);
  assert.equal(frameworkBatchDriftCode(1, 1), null);
});

test("bir kuruşluk sapma bile REDDEDİLİR", () => {
  assert.equal(frameworkBatchDriftCode(1_234_501, 1_234_500), "framework_price_drift");
  assert.equal(frameworkBatchDriftCode(1_234_499, 1_234_500), "framework_price_drift");
});

test("yön simetrik: yukarı da aşağı da sapmadır", () => {
  // Aşağı sapma da reddedilir: müşteri lehine bir sapma bile anlaşmada YAZMAYAN
  // bir tutardır ve kaynağı bilinmeyen bir hesaptır.
  assert.equal(frameworkBatchDriftCode(1, 2), "framework_price_drift");
  assert.equal(frameworkBatchDriftCode(2, 1), "framework_price_drift");
});

test("kapı TAMSAYI karşılaştırmasıdır, tolerans YOK", () => {
  // Kuruş tamsayısıdır; bir epsilon toleransı, sapmanın toleransın altında
  // kaldığı her turda kilitli fiyatın sessizce kaymasına izin verirdi.
  assert.ok(!/epsilon|tolerance|Math\.abs/i.test(moduleCode), "tolerans/abs yazılmış");
});

test("reddin Türkçe cümlesi TEK yerde", () => {
  assert.match(FRAMEWORK_PRICE_DRIFT_ERROR, /çerçeve/i);
  assert.ok(FRAMEWORK_PRICE_DRIFT_ERROR.length > 30, "cümle müşteriye ne yapacağını söylemeli");
});

test("kapı BRÜT karşılaştırır: tahsilat zinciri bu modüle GİRMEZ", () => {
  // `payableKurus` ile karşılaştırmak, hediye kartı kullanan her partiyi
  // ödenemez bir 409'a düşürürdü (G birleşti).
  assert.ok(!/payableKurus|giftCard|havaleDiscount/.test(moduleCode));
  assert.ok(!/quote-tender/.test(moduleCode));
});

// ─── 7) Ekranın etiketleri: kapalı küme ile sözlük BİREBİR ─────────────────
//
// Kovalar DAİMA taahhüde toplanır, yani çubuğun TAMAMI bu yedi etikettir. Bir
// kova etiketsiz kalırsa ekran, toplamı taahhüde ulaşmayan bir çubuk çizer ve
// müşteri hangi sayıya güveneceğini bilemez.

console.log("\n7) kova etiketleri ↔ sözlük anahtarları");

test("YEDİ kova, YEDİ sözlük anahtarı — ikisi de kapalı küme", () => {
  const keys = Object.keys(FRAMEWORK_BUCKET_DICT_KEYS).sort();
  // Kümenin kendisi saf çekirdekten geliyor: `progressSegments` yedi dilim
  // üretir ve her dilimin anahtarı eşlemede OLMAK ZORUNDA.
  const bucketKeys = progressSegments({
    committedUnits: 0,
    unplannedUnits: 0,
    plannedUnits: 0,
    awaitingPaymentUnits: 0,
    inProductionUnits: 0,
    shippedUnits: 0,
    deliveredUnits: 0,
    cancelledOrRefundedUnits: 0,
  })
    .map((s) => s.key)
    .sort();
  assert.equal(bucketKeys.length, 7, "altı kova + ayrık kova beklenir");
  assert.deepEqual(keys, bucketKeys, "eşleme ile kova kümesi ayrışmış");
  // Her anahtarın İKİ sözlükte de bir cümlesi var ve boş değil.
  for (const key of Object.values(FRAMEWORK_BUCKET_DICT_KEYS)) {
    for (const [name, dict] of [["tr", tr], ["en", en]] as const) {
      const value = (dict as Record<string, string>)[key];
      assert.ok(value && value.trim().length > 0, `${name}: ${key} karşılığı yok`);
    }
  }
});

test("anlaşma ve parti durumlarının da TAM karşılığı var", () => {
  assert.deepEqual(Object.keys(FRAMEWORK_STATUS_DICT_KEYS).sort(), [...FRAMEWORK_STATUSES].sort());
  assert.deepEqual(Object.keys(BATCH_STATUS_DICT_KEYS).sort(), [...BATCH_STATUSES].sort());
  for (const key of [
    ...Object.values(FRAMEWORK_STATUS_DICT_KEYS),
    ...Object.values(BATCH_STATUS_DICT_KEYS),
  ]) {
    assert.ok((tr as Record<string, string>)[key], `tr: ${key} yok`);
    assert.ok((en as Record<string, string>)[key], `en: ${key} yok`);
  }
});

test("etiketler sözlükten GELİR, saf modülde Türkçe cümle yoktur", () => {
  // Admin tarafı Türkçeyi sabit yazabilir (ev precedent'i); müşteri yüzeyinin
  // saf katmanı YAZMAZ — yoksa aynı cümle iki yerde ayrışırdı.
  const customerValues = readFileSync(
    join(ROOT, "src/app/cerceve/[number]/framework-values.ts"),
    "utf8"
  );
  const code = stripComments(customerValues);
  for (const label of ["Planlanmamış", "Ödeme bekleyen", "Teslim edilen", "İptal / iade"]) {
    assert.ok(!code.includes(label), `saf katmanda sabit Türkçe cümle: ${label}`);
  }
  // Ve eşlemenin değerlerinin HEPSİ `instantQuote.framework.` önekli.
  for (const key of Object.values(FRAMEWORK_BUCKET_DICT_KEYS)) {
    assert.ok(
      String(key).startsWith("instantQuote.framework."),
      `${key} müşteri sözlüğünün çerçeve bloğunda değil`
    );
  }
});

test("ret cümlesini gösteren her dosya ADMİN altında (fiyat kapısı atlanmasın)", () => {
  // Ret cümlesi ham kuruş taşıyor ("1999900 < 2000000") ve `quote-present.ts`in
  // fiyat kapısı yalnız adı `Kurus` ile BİTEN anahtarları ayıklıyor — yani bu
  // metin bir müşteri yüzeyinde yankılanırsa tutar `canSeePrices`i ATLAR.
  // Kümeyi kapalı tutmak, o günü imkânsız kılmanın en ucuz yolu.
  const touchers = execFileSync(
    "grep",
    ["-rlE", "FrameworkPlanRefusal|FRAMEWORK_REFUSAL_LABELS_TR|refusals\\??\\.(map|join)", "src"],
    { cwd: ROOT, encoding: "utf8" }
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  // Modülün kendisi ve onu ÜRETEN servis yüzey değildir; yüzey olan her şey
  // admin ağacında durmak zorunda.
  const ALLOWED_NON_SURFACE = [
    "src/lib/config/quote-framework.ts",
    "src/lib/services/quote-framework.ts",
  ];
  const offenders = touchers.filter(
    (file) =>
      !ALLOWED_NON_SURFACE.includes(file) &&
      !file.startsWith("src/app/admin/") &&
      !file.startsWith("src/app/api/admin/")
  );
  assert.deepEqual(
    offenders,
    [],
    "ret cümlesi admin DIŞINDA bir dosyaya girmiş: ham kuruş fiyat kapısını atlar"
  );
  assert.ok(touchers.length >= 3, "tarama hiçbir şey bulamadıysa kalıp bayatlamıştır");
});

test("müşteriye gösterilen `.readOnly` cümlesi POLİTİKANIN cümlesidir", () => {
  // Ekran, ucun uygulamadığı bir kuralı yazamaz: klon parti teklifinin
  // düzenlenemez olduğunu söyleyen cümle `quotePermissions`in `blockedReason`u
  // ile BİREBİR aynı olmak zorunda (f-2 §F2.5).
  assert.equal(
    (tr as Record<string, string>)["instantQuote.framework.readOnly"],
    QUOTE_FRAMEWORK_BATCH_REASON
  );
});

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail > 0) {
  console.log("\nBaşarısızlar:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
