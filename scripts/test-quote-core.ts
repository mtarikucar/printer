/**
 * Anlık teklif motorunun SAF çekirdeği: birim çevrimi, fiyat, DfM, iş günü,
 * politika, teklif numarası ve tohum katalog.
 *
 * DB yok, Redis yok, ağ yok — bu modüllerin tamamı `server-only`suzdur ve BullMQ
 * worker'ı da import eder. Altın değerler elle hesaplanmıştır: bir sayı
 * değişirse önce ALGORİTMA metnine (spec §quote-pricing) bakılır, teste değil.
 */
import assert from "node:assert/strict";

import type {
  PartConfig,
  PartGeometry,
  PricingPartInput,
  QuoteStatus,
} from "../src/lib/config/quote-types";
import { LEAD_TIER_KEYS } from "../src/lib/config/quote-types";
import { scaledGeometry, suggestUnits, unitFactor } from "../src/lib/config/quote-units";
import { dfmWarningKey, partPricingKey } from "../src/lib/config/quote-keys";
import {
  addonLines,
  applyTierDays,
  findFinish,
  findMaterial,
  findTechnology,
  leadTier,
  partLeadDaysBase,
  priceUnitAuto,
  qtyDiscountBps,
} from "../src/lib/config/quote-pricing";
import { evaluatePartDfm } from "../src/lib/config/quote-dfm";
import { computeQuote, defaultPartConfig } from "../src/lib/config/quote-compute";
import { addBusinessDays, istanbulDateKey } from "../src/lib/config/business-days";
import { checkoutBlockers, quotePermissions } from "../src/lib/config/quote-policy";
import { formatQuoteNumber, parseQuoteNumber } from "../src/lib/config/quote-number";
import { SEED_SNAPSHOT } from "../src/lib/config/quote-seed";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗   ${name}\n      ${(err as Error).message}`);
  }
}

function near(actual: number, expected: number, eps = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${actual} ≉ ${expected} (tolerans ${eps})`
  );
}

const S = SEED_SNAPSHOT;

// ─── Ortak fikstürler ───────────────────────────────────────────────────────

/** 20 mm küp, dosya birimi = mm. */
const CUBE_20MM: PartGeometry = {
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
};

function cube(edge: number, over: Partial<PartGeometry> = {}): PartGeometry {
  return {
    ...CUBE_20MM,
    volume: edge ** 3,
    area: 6 * edge ** 2,
    extents: { x: edge, y: edge, z: edge },
    wallP1: edge,
    wallP5: edge,
    overhangArea: edge ** 2,
    ...over,
  };
}

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

function part(
  over: Partial<Omit<PricingPartInput, "config">> = {},
  cfg: Partial<PartConfig> = {}
): PricingPartInput {
  return {
    id: "p1",
    analysisStatus: "ready",
    geometry: CUBE_20MM,
    sourceSha256: "sha-cube-20",
    manualUnitPriceKurus: null,
    manualPriceKey: null,
    dfmAckKey: null,
    ...over,
    config: { ...BASE_CONFIG, ...cfg },
  };
}

function priced(p: PricingPartInput, tierKey: (typeof LEAD_TIER_KEYS)[number] = "standard") {
  const computed = computeQuote(S, [p], { leadTier: tierKey, addonKeys: [] });
  const price = computed.parts[0]!.price;
  assert.ok(price.ok, `parça fiyatlanamadı: ${price.ok ? "" : price.reason}`);
  return { computed, price };
}

// ─── 1) Tohum katalog ───────────────────────────────────────────────────────

console.log("\n1) Tohum katalog (SEED_SNAPSHOT)");
test("SQL tohumuyla aynı satırlar ve sıra", () => {
  assert.equal(S.version, 1);
  assert.equal(S.takenAt, "2026-09-22T00:00:00.000Z");
  assert.deepEqual(
    S.technologies.map((t) => [t.key, t.sortOrder]),
    [
      ["fdm", 0],
      ["sla", 1],
    ]
  );
  assert.deepEqual(
    S.materials.map((m) => [m.key, m.technologyKey, m.sortOrder]),
    [
      ["pla", "fdm", 0],
      ["petg", "fdm", 1],
      ["abs", "fdm", 2],
      ["tpu95a", "fdm", 3],
      ["standard_resin", "sla", 4],
      ["tough_resin", "sla", 5],
      ["flex_resin", "sla", 6],
    ]
  );
  assert.deepEqual(
    S.finishes.map((f) => [f.key, f.sortOrder]),
    [
      ["ham", 0],
      ["zimpara", 1],
      ["astar", 2],
      ["boyali", 3],
      ["ozel", 4],
    ]
  );
  assert.deepEqual(
    S.addons.map((a) => [a.key, a.priceKurus, a.sortOrder]),
    [
      ["uygunluk_sertifikasi", 35000, 0],
      ["olcum_raporu", 125000, 1],
      ["malzeme_veri_sayfasi", 15000, 2],
      ["rohs_beyani", 25000, 3],
    ]
  );
});
test("politika satırı SQL ile birebir", () => {
  const s = S.settings;
  assert.equal(s.minOrderKurus, 20000);
  assert.equal(s.maxAutoTotalKurus, 10000000);
  assert.equal(s.maxAutoQtyPerPart, 1000);
  assert.equal(s.maxPartsPerQuote, 20);
  assert.equal(s.maxFileBytes, 104857600);
  assert.equal(s.quoteValidDays, 30);
  assert.equal(s.retentionDaysAfterExpiry, 90);
  assert.equal(s.cutoffHour, 14);
  assert.equal(s.havaleDiscountApplies, true);
  assert.deepEqual(s.priceBreakQuantities, [1, 5, 10, 25, 50, 100]);
  assert.deepEqual(
    s.qtyBreaks.map((b) => [b.minQty, b.discountBps]),
    [
      [1, 0],
      [5, 500],
      [10, 1000],
      [25, 1500],
      [50, 2000],
      [100, 2500],
      [500, 3000],
    ]
  );
  assert.deepEqual(
    s.leadTiers.map((t) => [t.key, t.multiplierBps, t.daysDelta, t.minDays]),
    [
      ["economy", 9000, 3, 5],
      ["standard", 10000, 0, 3],
      ["express", 14000, -2, 2],
    ]
  );
  assert.equal(s.holidays.length, 27);
  assert.ok(s.holidays.includes("2026-10-29"));
});
test("arama yardımcıları anahtarları çözer", () => {
  assert.equal(findTechnology(S, "fdm")?.name, "FDM (Filament)");
  assert.equal(findTechnology(S, "yok"), null);
  assert.equal(findMaterial(S, "fdm", "pla")?.densityGCm3, 1.24);
  assert.equal(findMaterial(S, "sla", "pla"), null, "PLA SLA'ya ait değil");
  assert.equal(findFinish(S, "fdm", "ham")?.key, "ham");
  assert.equal(findFinish(S, "fdm", "yok"), null);
  assert.equal(leadTier(S, "express").multiplierBps, 14000);
});

// ─── 2) Birimler ────────────────────────────────────────────────────────────

console.log("\n2) Birim çevrimi");
test("unitFactor mm 1, cm 10, in 25.4", () => {
  assert.equal(unitFactor("mm"), 1);
  assert.equal(unitFactor("cm"), 10);
  assert.equal(unitFactor("in"), 25.4);
});
test("G5 — inç küp 25.4 mm'ye ölçeklenir", () => {
  const g = scaledGeometry(cube(1), "in", 1);
  near(g.volumeMm3 ?? 0, 16387.064, 1e-3);
  near(g.extentsMm.x, 25.4, 1e-9);
  near(g.extentsMm.y, 25.4, 1e-9);
  near(g.extentsMm.z, 25.4, 1e-9);
  near(g.volumeCm3 ?? 0, 16.387064, 1e-6);
  near(g.areaMm2, 6 * 25.4 * 25.4, 1e-6);
});
test("ölçekli boyutlar küçükten büyüğe sıralanır", () => {
  const g = scaledGeometry(
    { ...CUBE_20MM, extents: { x: 30, y: 10, z: 20 } },
    "mm",
    1
  );
  assert.deepEqual(g.sortedMm, [10, 20, 30]);
});
test("hacimsiz geometri null kalır", () => {
  const g = scaledGeometry({ ...CUBE_20MM, volume: null, wallP1: null }, "mm", 2);
  assert.equal(g.volumeMm3, null);
  assert.equal(g.volumeCm3, null);
  assert.equal(g.wallP1Mm, null);
  assert.equal(g.factor, 2);
});
test("suggestUnits: 3MF birimi kazanır, küçük sayılar inç", () => {
  const build = { x: 250, y: 210, z: 210 };
  assert.equal(suggestUnits({ ...cube(5), sourceUnits: "cm" }, build), "cm");
  assert.equal(suggestUnits(cube(5), build), "in");
  assert.equal(suggestUnits(CUBE_20MM, build), null, "20 mm küp zaten makul");
  assert.equal(suggestUnits(cube(9), build), "cm", "9 inç z'ye sığmaz, cm sığar");
});

// ─── 3) Altın fiyatlar ──────────────────────────────────────────────────────

console.log("\n3) Altın fiyatlar");
test("G1 — 20 mm PLA küp, adet 1, standart", () => {
  const { computed, price } = priced(part());
  assert.ok(price.ok);
  assert.equal(price.unitKurus, 7400);
  assert.equal(price.lineKurus, 7400);
  assert.equal(price.source, "auto");
  const b = price.breakdown;
  assert.ok(b, "otomatik fiyatta döküm olmalı");
  near(b.effectiveVolumeCm3, 3.904, 1e-9);
  near(b.grams, 5.325056, 1e-9);
  assert.equal(b.setupKurus, 2500);
  assert.equal(b.qtyDiscountBps, 0);
  assert.equal(b.tierMultiplierBps, 10000);

  const t = computed.totals;
  assert.equal(t.allPriced, true);
  assert.equal(t.partsKurus, 7400);
  assert.equal(t.addonsKurus, 0);
  assert.equal(t.minOrderTopUpKurus, 12600);
  assert.equal(t.totalKurus, 20000);
  assert.equal(t.kdvExcludedKurus, Math.round(20000 / 1.2));
  assert.equal(t.kdvExcludedKurus, 16667);
  assert.equal(t.kdvKurus, 20000 - 16667);
  assert.equal(t.leadDays, 3);
});
test("G1 — teslim seçenekleri: standart 3, ekspres 2, ekonomik 6", () => {
  const { computed } = priced(part());
  const days = Object.fromEntries(computed.leadOptions.map((o) => [o.key, o.leadDays]));
  assert.equal(days.standard, 3);
  assert.equal(days.express, 2);
  assert.equal(days.economy, 6);
  const totals = Object.fromEntries(
    computed.leadOptions.map((o) => [o.key, o.totalKurus])
  );
  assert.equal(totals.standard, 20000);
  assert.ok(typeof totals.express === "number" && totals.express > 0);
});
test("G2 — adet 10: birim 4660, satır 46600, tamamlama yok", () => {
  const { computed, price } = priced(part({}, { quantity: 10 }));
  assert.ok(price.ok);
  assert.equal(price.unitKurus, 4660);
  assert.equal(price.lineKurus, 46600);
  assert.equal(computed.totals.minOrderTopUpKurus, 0);
  assert.equal(computed.totals.totalKurus, 46600);
});
test("G3 — adet 10 ekspres: 4660 × 1.4 = 6524", () => {
  const { price } = priced(part({}, { quantity: 10 }), "express");
  assert.ok(price.ok);
  assert.equal(price.unitKurus, Math.ceil((4660 * 14000) / 10000));
  assert.equal(price.unitKurus, 6524);
});
test("G4 — cm biriminde 2 birimlik küp G1 ile aynı fiyat", () => {
  const { price } = priced(part({ geometry: cube(2) }, { units: "cm" }));
  assert.ok(price.ok);
  assert.equal(price.unitKurus, 7400);
  assert.equal(price.lineKurus, 7400);
});
test("G6 — manuel fiyat yalnız kendi anahtarıyla geçerli", () => {
  const cfg: PartConfig = { ...BASE_CONFIG, finishKey: "boyali" };
  const key = partPricingKey({ sourceSha256: "sha-cube-20", config: cfg }, "standard");
  const manual = part(
    { manualUnitPriceKurus: 9999, manualPriceKey: key },
    { finishKey: "boyali" }
  );
  const { price } = priced(manual);
  assert.ok(price.ok);
  assert.equal(price.source, "manual");
  assert.equal(price.unitKurus, 9999);
  assert.equal(price.lineKurus, 9999);
  assert.equal(price.breakdown, null);

  // Adet değişince anahtar tutmaz: manuel fiyat düşer, parça yine engelli olur.
  const moved = { ...manual, config: { ...manual.config, quantity: 2 } };
  const after = computeQuote(S, [moved], { leadTier: "standard", addonKeys: [] });
  assert.equal(after.parts[0]!.price.ok, false);
  assert.equal(after.totals.allPriced, false);

  // Boyasız (engelsiz) bir parçada anahtar tutmazsa otomatik fiyata düşer.
  const cleanKey = partPricingKey({ sourceSha256: "sha-cube-20", config: BASE_CONFIG }, "standard");
  const cleanManual = part({ manualUnitPriceKurus: 9999, manualPriceKey: cleanKey });
  assert.equal(priced(cleanManual).price.ok && priced(cleanManual).price.unitKurus, 9999);
  const stale = { ...cleanManual, manualPriceKey: `${cleanKey}-eski` };
  const staleRes = priced(stale).price;
  assert.ok(staleRes.ok);
  assert.equal(staleRes.source, "auto");
  assert.equal(staleRes.unitKurus, 7400);
});
test("birim × adet her zaman satıra eşittir (1..120, her kademe)", () => {
  for (const tierKey of LEAD_TIER_KEYS) {
    for (let q = 1; q <= 120; q++) {
      const { price } = priced(part({}, { quantity: q }), tierKey);
      assert.ok(price.ok);
      assert.equal(
        price.lineKurus,
        price.unitKurus * q,
        `${tierKey} adet ${q}: ${price.unitKurus}×${q} ≠ ${price.lineKurus}`
      );
      assert.ok(Number.isInteger(price.unitKurus), `${tierKey} adet ${q} tam sayı değil`);
    }
  }
});
test("adet indirimi en yüksek eşiği uygular", () => {
  const breaks = S.settings.qtyBreaks;
  assert.equal(qtyDiscountBps(breaks, 1), 0);
  assert.equal(qtyDiscountBps(breaks, 4), 0);
  assert.equal(qtyDiscountBps(breaks, 5), 500);
  assert.equal(qtyDiscountBps(breaks, 9), 500);
  assert.equal(qtyDiscountBps(breaks, 10), 1000);
  assert.equal(qtyDiscountBps(breaks, 499), 2500);
  assert.equal(qtyDiscountBps(breaks, 100000), 3000);
});
test("priceUnitAuto SLA'da katı hacim kullanır (doluluk yok)", () => {
  const scaled = scaledGeometry(CUBE_20MM, "mm", 1);
  const out = priceUnitAuto({
    snapshot: S,
    scaled,
    config: {
      ...BASE_CONFIG,
      technologyKey: "sla",
      materialKey: "standard_resin",
      colorKey: "gri",
      layerUm: 50,
      infillPct: null,
    },
    tier: leadTier(S, "standard"),
    quantity: 1,
  });
  near(out.breakdown.effectiveVolumeCm3, 8, 1e-9);
  assert.ok(out.unitKurus >= 7900, "SLA taban fiyatının altına inemez");
});
test("ek hizmet satırları tür başına doğru çarpılır", () => {
  const lines = addonLines(S, ["uygunluk_sertifikasi", "olcum_raporu", "yok"], 3, 12);
  assert.deepEqual(
    lines.map((l) => [l.key, l.kurus]),
    [
      ["uygunluk_sertifikasi", 35000],
      ["olcum_raporu", 125000],
    ]
  );
  const withAddons = computeQuote(S, [part({}, { quantity: 10 })], {
    leadTier: "standard",
    addonKeys: ["olcum_raporu"],
  });
  assert.equal(withAddons.totals.addonsKurus, 125000);
  assert.equal(withAddons.totals.totalKurus, 46600 + 125000);
  assert.equal(withAddons.totals.leadDays, 4, "ölçüm raporu 1 gün ekler");
});
test("teslim günü tabanı ve kademe uygulaması", () => {
  assert.equal(partLeadDaysBase(S, BASE_CONFIG), 3);
  assert.equal(partLeadDaysBase(S, { ...BASE_CONFIG, finishKey: "astar" }), 5);
  assert.equal(
    partLeadDaysBase(S, {
      ...BASE_CONFIG,
      technologyKey: "sla",
      materialKey: "tough_resin",
      colorKey: "gri",
      layerUm: 50,
      infillPct: null,
    }),
    5
  );
  assert.equal(applyTierDays(3, leadTier(S, "express")), 2);
  assert.equal(applyTierDays(10, leadTier(S, "express")), 8);
  assert.equal(applyTierDays(1, leadTier(S, "standard")), 3);
  assert.equal(applyTierDays(3, leadTier(S, "economy")), 6);
});
test("fiyat kademeleri politika adetlerini izler", () => {
  const { price } = priced(part());
  assert.ok(price.ok);
  assert.deepEqual(
    price.priceBreaks.map((b) => b.quantity),
    S.settings.priceBreakQuantities
  );
  assert.equal(price.priceBreaks.find((b) => b.quantity === 1)?.unitKurus, 7400);
  assert.equal(price.priceBreaks.find((b) => b.quantity === 10)?.unitKurus, 4660);
});

// ─── 4) DfM ─────────────────────────────────────────────────────────────────

console.log("\n4) DfM");
function codes(p: PricingPartInput) {
  return evaluatePartDfm(p, S).issues.map((i) => i.code);
}

test("300 mm küp FDM'e sığmaz — too_large, ölçek 0.7", () => {
  const p = part({ geometry: cube(300) });
  const res = evaluatePartDfm(p, S);
  const issue = res.issues.find((i) => i.code === "too_large");
  assert.ok(issue, "too_large bekleniyordu");
  assert.equal(issue.severity, "error");
  assert.equal(issue.params?.maxX, 250);
  assert.equal(issue.params?.maxY, 210);
  assert.equal(issue.params?.maxZ, 210);
  assert.equal(issue.params?.fitScale, 0.7);
  assert.equal(
    issue.params?.fitsTechnology,
    undefined,
    "SLA de sığmıyor — öneri olmamalı"
  );
  assert.equal(res.blocking, true);
});
test("fitScale MUTLAK ölçektir — mevcut ölçekle çarpılmaz, ona ATANIR", () => {
  // 150 mm küp × ölçek 2 = 300 mm: yukarıdaki vakayla AYNI sığmazlık, farklı ölçek.
  const p = part({ geometry: cube(150) }, { scale: 2 });
  const issue = evaluatePartDfm(p, S).issues.find((i) => i.code === "too_large");
  assert.ok(issue, "too_large bekleniyordu");
  assert.equal(issue.params?.fitScale, 1.4, "mutlak ölçek = floor2(2 × 0.7); çarpan 0.7 DEĞİL");
  // Önerilen ölçek gerçekten sığmalı: 150 × 1.4 = 210 ≤ 210.
  const fixed = part({ geometry: cube(150) }, { scale: Number(issue.params?.fitScale) });
  assert.ok(
    !evaluatePartDfm(fixed, S).issues.some((i) => i.code === "too_large"),
    "fitScale uygulanınca parça sığmalı"
  );
});
test("1 mm küp — too_small", () => {
  assert.ok(codes(part({ geometry: cube(1) })).includes("too_small"));
});
test("ince duvar uyarısı ve onay anahtarı", () => {
  const p = part({ geometry: { ...CUBE_20MM, wallP1: 0.5 } });
  const res = evaluatePartDfm(p, S);
  const issue = res.issues.find((i) => i.code === "thin_walls");
  assert.ok(issue);
  assert.equal(issue.severity, "warning");
  assert.equal(issue.params?.wallMm, 0.5);
  assert.equal(issue.params?.minMm, 0.8);
  assert.equal(res.blocking, false, "uyarı fiyatı engellemez");
  assert.ok(res.warningKey, "uyarı anahtarı üretilmeli");
  assert.equal(res.warningKey, dfmWarningKey(["thin_walls"], p));
});
test("çok gövdeli parça uyarı verir", () => {
  const p = part({ geometry: { ...CUBE_20MM, bodyCount: 2 } });
  const res = evaluatePartDfm(p, S);
  const issue = res.issues.find((i) => i.code === "multiple_bodies");
  assert.ok(issue);
  assert.equal(issue.severity, "warning");
  assert.equal(issue.params?.count, 2);
});
test("boyalı yüzey manuel fiyat ister ve engeller", () => {
  const p = part({}, { finishKey: "boyali" });
  const res = evaluatePartDfm(p, S);
  assert.ok(res.issues.some((i) => i.code === "finish_manual" && i.severity === "error"));
  assert.equal(res.blocking, true);
  const computed = computeQuote(S, [p], { leadTier: "standard", addonKeys: [] });
  assert.equal(computed.parts[0]!.price.ok, false);
});
test("SLA + doluluk yüzdesi — config_invalid", () => {
  const p = part(
    {},
    {
      technologyKey: "sla",
      materialKey: "standard_resin",
      colorKey: "gri",
      layerUm: 50,
      infillPct: 20,
    }
  );
  assert.ok(codes(p).includes("config_invalid"));
  const computed = computeQuote(S, [p], { leadTier: "standard", addonKeys: [] });
  const price = computed.parts[0]!.price;
  assert.equal(price.ok, false);
  assert.equal(price.ok === false && price.reason, "config_invalid");
});
test("bilinmeyen anahtar ve yanlış katman — config_invalid", () => {
  assert.ok(codes(part({}, { materialKey: "yok" })).includes("config_invalid"));
  assert.ok(codes(part({}, { colorKey: "mor" })).includes("config_invalid"));
  assert.ok(codes(part({}, { layerUm: 137 })).includes("config_invalid"));
  assert.ok(codes(part({}, { infillPct: 77 })).includes("config_invalid"));
});
test("adet otomatik sınırı aşınca qty_over_auto", () => {
  assert.ok(codes(part({}, { quantity: 1001 })).includes("qty_over_auto"));
  assert.ok(!codes(part({}, { quantity: 1000 })).includes("qty_over_auto"));
});
test("analiz bekliyor / başarısız", () => {
  assert.deepEqual(codes(part({ analysisStatus: "queued", geometry: null })), [
    "analysis_pending",
  ]);
  assert.deepEqual(codes(part({ analysisStatus: "analyzing", geometry: null })), [
    "analysis_pending",
  ]);
  assert.deepEqual(codes(part({ analysisStatus: "failed", geometry: null })), [
    "analysis_failed",
  ]);
  const computed = computeQuote(S, [part({ analysisStatus: "queued", geometry: null })], {
    leadTier: "standard",
    addonKeys: [],
  });
  const price = computed.parts[0]!.price;
  assert.equal(price.ok, false);
  assert.equal(price.ok === false && price.reason, "not_ready");
});
test("hacim ölçülemedi / su geçirmez değil", () => {
  assert.ok(codes(part({ geometry: { ...CUBE_20MM, volume: null } })).includes("no_volume"));
  const p = part({
    geometry: { ...CUBE_20MM, isVolume: false, volumeEstimated: true, isWatertight: false },
  });
  const res = evaluatePartDfm(p, S);
  assert.ok(res.issues.some((i) => i.code === "not_watertight" && i.severity === "warning"));
});
test("kritik tolerans manuel teklife düşer", () => {
  assert.ok(codes(part({}, { criticalTolerance: true })).includes("tolerance_manual"));
});
test("geçerli manuel fiyat yumuşak hataları açar, sert olanları açmaz", () => {
  const softCfg: PartConfig = { ...BASE_CONFIG, finishKey: "boyali" };
  const softKey = partPricingKey({ sourceSha256: "sha-cube-20", config: softCfg }, "standard");
  const soft = computeQuote(
    S,
    [part({ manualUnitPriceKurus: 5000, manualPriceKey: softKey }, { finishKey: "boyali" })],
    { leadTier: "standard", addonKeys: [] }
  );
  assert.equal(soft.parts[0]!.dfm.blocking, false);
  assert.equal(soft.parts[0]!.price.ok, true);

  const hardCfg: PartConfig = { ...BASE_CONFIG, layerUm: 137 };
  const hardKey = partPricingKey({ sourceSha256: "sha-cube-20", config: hardCfg }, "standard");
  const hard = computeQuote(
    S,
    [part({ manualUnitPriceKurus: 5000, manualPriceKey: hardKey }, { layerUm: 137 })],
    { leadTier: "standard", addonKeys: [] }
  );
  assert.equal(hard.parts[0]!.dfm.blocking, true, "config_invalid manuel fiyatla da engeller");
  assert.equal(hard.parts[0]!.price.ok, false);
});
test("teklif toplamı otomatik sınırı aşarsa quoteIssues'a düşer", () => {
  // 20 cm küp × 10: tek tek her parça fiyatlanabilir, toplam sınırı aşar.
  const big = computeQuote(S, [part({ geometry: cube(200) }, { quantity: 10 })], {
    leadTier: "standard",
    addonKeys: [],
  });
  assert.equal(big.totals.allPriced, true);
  assert.ok(big.totals.totalKurus > S.settings.maxAutoTotalKurus);
  const issue = big.quoteIssues.find((i) => i.code === "qty_over_auto");
  assert.ok(issue, "toplam sınırı aşınca teklif düzeyinde konu açılmalı");
  assert.equal(issue.params?.reason, "total");
  assert.equal(issue.severity, "error");
  // Her parça tek tek fiyatlansa bile sınırı aşan toplam ödemeye gidemez.
  const parts = [part({ geometry: cube(200) }, { quantity: 10 })];
  assert.ok(
    checkoutBlockers(big, parts, { termsAccepted: true, expired: false }).some((s) =>
      /sınır/i.test(s)
    )
  );
});

// ─── 5) Anahtarlar ──────────────────────────────────────────────────────────

console.log("\n5) Anahtarlar");
test("partPricingKey konfig ve kademeye duyarlı, kararlı", () => {
  const p = { sourceSha256: "abc", config: BASE_CONFIG };
  assert.equal(partPricingKey(p, "standard"), partPricingKey(p, "standard"));
  assert.notEqual(partPricingKey(p, "standard"), partPricingKey(p, "express"));
  assert.notEqual(
    partPricingKey(p, "standard"),
    partPricingKey({ ...p, config: { ...BASE_CONFIG, quantity: 2 } }, "standard")
  );
  assert.notEqual(
    partPricingKey(p, "standard"),
    partPricingKey({ sourceSha256: "abd", config: BASE_CONFIG }, "standard")
  );
  assert.notEqual(
    partPricingKey(p, "standard"),
    partPricingKey({ sourceSha256: null, config: BASE_CONFIG }, "standard")
  );
  assert.ok(partPricingKey(p, "standard").length > 0);
});
test("dfmWarningKey kod sırasından bağımsız", () => {
  const p = { sourceSha256: "abc", config: BASE_CONFIG };
  assert.equal(
    dfmWarningKey(["thin_walls", "multiple_bodies"], p),
    dfmWarningKey(["multiple_bodies", "thin_walls"], p)
  );
  assert.notEqual(dfmWarningKey(["thin_walls"], p), dfmWarningKey(["multiple_bodies"], p));
  assert.notEqual(
    dfmWarningKey(["thin_walls"], p),
    dfmWarningKey(["thin_walls"], { ...p, config: { ...BASE_CONFIG, scale: 2 } })
  );
});

// ─── 6) Varsayılan konfig ───────────────────────────────────────────────────

console.log("\n6) Varsayılan konfig");
test("defaultPartConfig katalogun ilk geçerli seçeneklerini alır", () => {
  const cfg = defaultPartConfig(S, CUBE_20MM);
  assert.equal(cfg.technologyKey, "fdm");
  assert.equal(cfg.materialKey, "pla");
  assert.equal(cfg.colorKey, "beyaz");
  assert.equal(cfg.finishKey, "ham");
  assert.equal(cfg.layerUm, 200);
  assert.equal(cfg.infillPct, 20);
  assert.equal(cfg.quantity, 1);
  assert.equal(cfg.units, "mm");
  assert.equal(cfg.scale, 1);
  assert.equal(cfg.criticalTolerance, false);
  assert.equal(evaluatePartDfm(part({}, cfg), S).blocking, false);
});
test("defaultPartConfig 3MF birimini benimser", () => {
  const cfg = defaultPartConfig(S, { ...CUBE_20MM, sourceUnits: "in" });
  assert.equal(cfg.units, "in");
  assert.equal(defaultPartConfig(S, null).units, "mm");
});

// ─── 7) İş günleri ──────────────────────────────────────────────────────────

console.log("\n7) İş günleri");
const HOLIDAYS = S.settings.holidays;
test("istanbulDateKey UTC damgayı İstanbul gününe çevirir", () => {
  assert.equal(istanbulDateKey(new Date("2026-10-27T08:00:00Z")), "2026-10-27");
  assert.equal(istanbulDateKey(new Date("2026-10-27T21:30:00Z")), "2026-10-28");
  assert.equal(istanbulDateKey(new Date("2026-01-01T00:30:00Z")), "2026-01-01");
});
test("cutoff öncesi: 3 iş günü 29 Ekim tatilini atlar", () => {
  const out = addBusinessDays(new Date("2026-10-27T08:00:00Z"), 3, HOLIDAYS, 14);
  assert.equal(istanbulDateKey(out), "2026-11-02");
});
test("cutoff sonrası ertesi iş gününden sayılır", () => {
  const out = addBusinessDays(new Date("2026-10-27T13:00:00Z"), 3, HOLIDAYS, 14);
  assert.equal(istanbulDateKey(out), "2026-11-03");
});
test("cumartesi başlangıcı pazartesiye taşınır", () => {
  const out = addBusinessDays(new Date("2026-10-31T07:00:00Z"), 1, HOLIDAYS, 14);
  assert.equal(istanbulDateKey(out), "2026-11-03");
});
test("sıfır gün ilk iş gününü verir", () => {
  assert.equal(
    istanbulDateKey(addBusinessDays(new Date("2026-10-31T07:00:00Z"), 0, HOLIDAYS, 14)),
    "2026-11-02"
  );
  assert.equal(
    istanbulDateKey(addBusinessDays(new Date("2026-10-27T08:00:00Z"), 0, HOLIDAYS, 14)),
    "2026-10-27"
  );
});

// ─── 8) Teklif numarası ─────────────────────────────────────────────────────

console.log("\n8) Teklif numarası");
test("biçim ve çözümleme simetrik", () => {
  assert.equal(formatQuoteNumber(123), "T-000123");
  assert.equal(formatQuoteNumber(1), "T-000001");
  assert.equal(formatQuoteNumber(1234567), "T-1234567", "7 hanede kırpma yok");
  assert.equal(parseQuoteNumber("T-000123"), 123);
  assert.equal(parseQuoteNumber("T-1234567"), 1234567);
  assert.equal(parseQuoteNumber("x"), null);
  assert.equal(parseQuoteNumber("T-12"), null, "6 haneden kısa geçersiz");
  assert.equal(parseQuoteNumber("t-000123"), 123, "küçük harf kabul");
  assert.equal(parseQuoteNumber(" T-000123 "), 123, "boşluk kırpılır");
  assert.equal(parseQuoteNumber("T-00012a"), null);
  for (const n of [1, 42, 999999, 1000000]) {
    assert.equal(parseQuoteNumber(formatQuoteNumber(n)), n);
  }
});

// ─── 9) Politika ────────────────────────────────────────────────────────────

console.log("\n9) Politika");
const NOW = new Date("2026-09-22T10:00:00Z");
const FUTURE = new Date("2026-10-22T10:00:00Z");
const PAST = new Date("2026-09-01T10:00:00Z");
function perms(status: QuoteStatus, over: Partial<{ expiresAt: Date; orderId: string | null; hasLiveDraft: boolean }> = {}) {
  return quotePermissions(
    {
      status,
      expiresAt: over.expiresAt ?? FUTURE,
      orderId: over.orderId ?? null,
    },
    { hasLiveDraft: over.hasLiveDraft ?? false, now: NOW }
  );
}
test("taslak düzenlenebilir ve ödenebilir", () => {
  const p = perms("draft");
  assert.deepEqual(p, {
    canEdit: true,
    canCheckout: true,
    canRequestReview: true,
    blockedReason: null,
  });
});
test("süresi dolan teklif kapanır", () => {
  const byStatus = perms("expired");
  assert.equal(byStatus.canEdit, false);
  assert.equal(byStatus.canCheckout, false);
  assert.equal(byStatus.canRequestReview, false);
  assert.equal(byStatus.blockedReason, "Teklifin süresi doldu — yeniden fiyatlayın.");
  const byDate = perms("quoted", { expiresAt: PAST });
  assert.equal(byDate.canCheckout, false);
  assert.equal(byDate.blockedReason, "Teklifin süresi doldu — yeniden fiyatlayın.");
});
test("canlı taslak varken düzenleme kapalı, ödeme açık", () => {
  const p = perms("draft", { hasLiveDraft: true });
  assert.equal(p.canEdit, false);
  assert.equal(p.canCheckout, true);
  assert.equal(p.canRequestReview, false);
  assert.equal(p.blockedReason, "Bu teklif için bekleyen bir ödeme var.");
});
test("siparişe dönen ve iptal edilen teklifte hiçbir şey yapılamaz", () => {
  for (const status of ["ordered", "cancelled"] as QuoteStatus[]) {
    const p = perms(status);
    assert.equal(p.canEdit, false, status);
    assert.equal(p.canCheckout, false, status);
    assert.equal(p.canRequestReview, false, status);
    assert.ok(p.blockedReason, status);
  }
  const withOrder = perms("quoted", { orderId: "o1" });
  assert.equal(withOrder.canCheckout, false);
});
test("incelemedeki teklif düzenlenir ama ödenemez", () => {
  const p = perms("needs_review");
  assert.equal(p.canEdit, true);
  assert.equal(p.canCheckout, false);
  assert.equal(p.canRequestReview, false);
  assert.ok(p.blockedReason);
});
test("checkoutBlockers hazır teklifte boş döner", () => {
  const parts = [part({}, { quantity: 10 })];
  const computed = computeQuote(S, parts, { leadTier: "standard", addonKeys: [] });
  assert.deepEqual(
    checkoutBlockers(computed, parts, { termsAccepted: true, expired: false }),
    []
  );
});
test("checkoutBlockers eksikleri Türkçe sayar", () => {
  const empty = computeQuote(S, [], { leadTier: "standard", addonKeys: [] });
  const noParts = checkoutBlockers(empty, [], { termsAccepted: true, expired: false });
  assert.equal(noParts.length, 1);
  assert.match(noParts[0]!, /parça/i);

  const pendingParts = [part({ analysisStatus: "queued", geometry: null })];
  const pending = computeQuote(S, pendingParts, { leadTier: "standard", addonKeys: [] });
  const pendingList = checkoutBlockers(pending, pendingParts, {
    termsAccepted: true,
    expired: false,
  });
  assert.ok(pendingList.some((s) => /analiz/i.test(s)));

  const manualParts = [part({}, { finishKey: "boyali", quantity: 10 })];
  const manual = computeQuote(S, manualParts, { leadTier: "standard", addonKeys: [] });
  const manualList = checkoutBlockers(manual, manualParts, {
    termsAccepted: true,
    expired: false,
  });
  assert.ok(manualList.includes("1 parça manuel fiyat bekliyor."));

  const warnParts = [part({ geometry: { ...CUBE_20MM, wallP1: 0.5 } }, { quantity: 10 })];
  const warn = computeQuote(S, warnParts, { leadTier: "standard", addonKeys: [] });
  const warnList = checkoutBlockers(warn, warnParts, { termsAccepted: true, expired: false });
  assert.ok(warnList.some((s) => /onay/i.test(s)), "onaysız uyarı ödemeyi durdurur");
  const acked = [{ ...warnParts[0]!, dfmAckKey: warn.parts[0]!.dfm.warningKey }];
  const ackedComputed = computeQuote(S, acked, { leadTier: "standard", addonKeys: [] });
  assert.deepEqual(
    checkoutBlockers(ackedComputed, acked, { termsAccepted: true, expired: false }),
    []
  );

  const okParts = [part({}, { quantity: 10 })];
  const okComputed = computeQuote(S, okParts, { leadTier: "standard", addonKeys: [] });
  assert.ok(
    checkoutBlockers(okComputed, okParts, { termsAccepted: false, expired: false }).some((s) =>
      /sözleşme/i.test(s)
    )
  );
  assert.ok(
    checkoutBlockers(okComputed, okParts, { termsAccepted: true, expired: true }).some((s) =>
      /süre/i.test(s)
    )
  );
});

console.log(
  failures === 0
    ? "\n✅ quote-core: tüm kontroller geçti"
    : `\n❌ quote-core: ${failures} kontrol başarısız`
);
process.exit(failures === 0 ? 0 : 1);
