/**
 * SAHİBİN KUMANDASI: baskı kataloğu doğrulayıcısı, fiyat simülatörü ve admin
 * uçlarının oturum kapısı.
 *
 * Üç soruyu sorar ve üçü de "ekran güzel mi" değil, PARA sorusudur:
 *
 *  1. **Doğrulayıcı** — motoru besleyen her sayının sınırı var mı? Kataloğa
 *     yanlış bir sayı girmek (yüzde yerine baz puan, gram yerine kilo, takvimde
 *     olmayan bir tatil) yayına çıkan bir fiyat hatasıdır; kapı forma değil,
 *     şemaya konur.
 *  2. **Simülatör** — gösterilen döküm birim fiyatla MUTABIK mı? `priceUnitAuto`
 *     dökümü bilerek bilgilendiricidir (taban fiyat devreye girince kalemler
 *     toplamı tutmaz), bu yüzden simülatör kendi mutabakat satırlarını üretir:
 *     kalemlerin toplamı KURUŞU KURUŞUNA birim fiyata eşit olmalı, yoksa sahibi
 *     "niye bu fiyat" sorusuna ekrandan cevap alamaz.
 *  3. **Oturum kapısı** — her admin ucu, admin oturumu olmadan 401 döner ve
 *     hiçbir şey yazmaz.
 *
 * DB yok, ağ yok: doğrulayıcı ve simülatör saftır, rotalarda yalnız
 * `requireAdmin` taklit edilir (kapı ilk satırdadır, arkasına geçilmez).
 *
 * Çalıştırma: npx tsx scripts/test-quote-admin-catalog.ts
 */
import assert from "node:assert/strict";
import Module from "node:module";
import { NextRequest, NextResponse } from "next/server";

import { computeQuote } from "../src/lib/config/quote-compute";
import { SEED_SNAPSHOT } from "../src/lib/config/quote-seed";
import type { PartGeometry, PricingPartInput } from "../src/lib/config/quote-types";
import {
  addonCreateSchema,
  materialCreateSchema,
  materialPatchSchema,
  pricingSettingsUpdateSchema,
  simulateSchema,
  technologyCreateSchema,
  technologyPatchSchema,
} from "../src/lib/validators/print-catalog";
import {
  simulateQuotePrice,
  type QuoteSimulationInput,
} from "../src/lib/services/quote-catalog-admin";

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗   ${name}\n      ${(err as Error).message}`);
  }
}

/** Şema bu gövdeyi REDDETMELİ; hangi alanda düştüğü de yazılır. */
function rejects(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown, why: string) {
  const parsed = schema.safeParse(value);
  assert.equal(parsed.success, false, `kabul edilmemeliydi: ${why}`);
}

function accepts(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown, why: string) {
  const parsed = schema.safeParse(value);
  assert.equal(parsed.success, true, `reddedilmemeliydi: ${why} — ${JSON.stringify(parsed.error)}`);
}

// ─── Geçerli gövde şablonları ───────────────────────────────────────────────

const TECHNOLOGY = {
  key: "sls",
  name: "SLS (Toz)",
  description: "Toz yataklı",
  orderMaterial: "resin" as const,
  capabilityTag: "material_resin",
  buildXMm: 300,
  buildYMm: 300,
  buildZMm: 300,
  minWallMm: 0.8,
  minFeatureMm: 0.5,
  toleranceText: "±%0,3",
  layerOptionsUm: [100, 120],
  defaultLayerUm: 100,
  infillOptionsPct: null,
  defaultInfillPct: null,
  shellMm: 0,
  setupFeeKurus: 3000,
  machineRateKurusPerHour: 8000,
  throughputCm3PerHour: 20,
  heightHoursPerMm: 0.01,
  minUnitPriceKurus: 9900,
  baseLeadDays: 5,
  sortOrder: 2,
  active: true,
};

const COLOR = { key: "beyaz", name: "Beyaz", hex: "#F5F5F5", surchargeKurus: 0 };

const MATERIAL = {
  technologyId: "11111111-1111-4111-8111-111111111111",
  key: "pa12",
  name: "PA12",
  description: "Naylon",
  properties: { tensileMpa: 48, uses: ["fonksiyonel parça"] },
  densityGCm3: 1.01,
  priceKurusPerGram: 400,
  supportFactor: 1,
  capabilityTag: "pmat_pa12",
  colors: [COLOR],
  leadDaysExtra: 1,
  sortOrder: 7,
  active: true,
};

const SETTINGS = {
  expectedUpdatedAt: "2026-09-22T00:00:00.000Z",
  settings: {
    qtyBreaks: [
      { minQty: 1, discountBps: 0 },
      { minQty: 10, discountBps: 1000 },
    ],
    leadTiers: [
      { key: "economy", name: "Ekonomik", multiplierBps: 9000, daysDelta: 3, minDays: 5 },
      { key: "standard", name: "Standart", multiplierBps: 10000, daysDelta: 0, minDays: 3 },
      { key: "express", name: "Ekspres", multiplierBps: 14000, daysDelta: -2, minDays: 2 },
    ],
    minOrderKurus: 20000,
    maxAutoTotalKurus: 10000000,
    maxAutoQtyPerPart: 1000,
    maxPartsPerQuote: 20,
    maxFileBytes: 104857600,
    quoteValidDays: 30,
    retentionDaysAfterExpiry: 90,
    priceBreakQuantities: [1, 5, 10],
    holidays: ["2026-01-01", "2026-04-23"],
    cutoffHour: 14,
    havaleDiscountApplies: true,
  },
};

async function main() {
  // ─── 1) Doğrulayıcı ─────────────────────────────────────────────────────────

  console.log("\n1) Katalog doğrulayıcısı");

  await test("geçerli teknoloji / malzeme / ek hizmet / ayar gövdesi kabul edilir", () => {
    accepts(technologyCreateSchema, TECHNOLOGY, "tam teknoloji");
    accepts(materialCreateSchema, MATERIAL, "tam malzeme");
    accepts(
      addonCreateSchema,
      {
        key: "hizli_kargo",
        name: "Hızlı kargo",
        description: "",
        priceType: "fixed",
        priceKurus: 15000,
        leadDaysExtra: 0,
        sortOrder: 4,
        active: true,
      },
      "tam ek hizmet"
    );
    accepts(pricingSettingsUpdateSchema, SETTINGS, "tam ayar");
  });

  await test("para alanları 0 ile 10.000.000 kuruş arasında", () => {
    rejects(technologyCreateSchema, { ...TECHNOLOGY, setupFeeKurus: -1 }, "negatif kurulum ücreti");
    rejects(
      technologyCreateSchema,
      { ...TECHNOLOGY, minUnitPriceKurus: 10_000_001 },
      "üst sınırı aşan taban fiyat"
    );
    rejects(technologyCreateSchema, { ...TECHNOLOGY, setupFeeKurus: 12.5 }, "kuruş kesri");
    accepts(technologyCreateSchema, { ...TECHNOLOGY, minUnitPriceKurus: 10_000_000 }, "tam sınır");
  });

  await test("yoğunluk 0,5–3 ve destek katsayısı 1–3 arasında", () => {
    rejects(materialCreateSchema, { ...MATERIAL, densityGCm3: 0.4 }, "çok düşük yoğunluk");
    rejects(materialCreateSchema, { ...MATERIAL, densityGCm3: 3.1 }, "çok yüksek yoğunluk");
    rejects(materialCreateSchema, { ...MATERIAL, supportFactor: 0.9 }, "1'in altında destek katsayısı");
    rejects(materialCreateSchema, { ...MATERIAL, supportFactor: 3.5 }, "3'ün üstünde destek katsayısı");
    accepts(materialCreateSchema, { ...MATERIAL, densityGCm3: 0.5, supportFactor: 3 }, "sınır değerler");
  });

  await test("baskı hacmi kenarı 10–2000 mm", () => {
    rejects(technologyCreateSchema, { ...TECHNOLOGY, buildXMm: 9 }, "9 mm baskı hacmi");
    rejects(technologyCreateSchema, { ...TECHNOLOGY, buildZMm: 2001 }, "2001 mm baskı hacmi");
    accepts(technologyCreateSchema, { ...TECHNOLOGY, buildXMm: 10, buildZMm: 2000 }, "sınır değerler");
  });

  await test("renk en az bir tane ve #RRGGBB", () => {
    rejects(materialCreateSchema, { ...MATERIAL, colors: [] }, "renksiz malzeme");
    rejects(materialCreateSchema, { ...MATERIAL, colors: [{ ...COLOR, hex: "#FFF" }] }, "3 haneli hex");
    rejects(materialCreateSchema, { ...MATERIAL, colors: [{ ...COLOR, hex: "beyaz" }] }, "hex olmayan renk");
    rejects(materialCreateSchema, { ...MATERIAL, colors: [{ ...COLOR, hex: "#GGGGGG" }] }, "hex olmayan harf");
    rejects(
      materialCreateSchema,
      { ...MATERIAL, colors: [COLOR, { ...COLOR, name: "Beyaz 2" }] },
      "yinelenen renk anahtarı"
    );
    accepts(materialCreateSchema, { ...MATERIAL, colors: [{ ...COLOR, hex: "#0a0B0c" }] }, "karışık kutu hex");
  });

  await test("tatiller gerçek ISO tarihi olmalı", () => {
    const bad = (holidays: string[]) => ({
      ...SETTINGS,
      settings: { ...SETTINGS.settings, holidays },
    });
    rejects(pricingSettingsUpdateSchema, bad(["2026-13-01"]), "13. ay");
    rejects(pricingSettingsUpdateSchema, bad(["2026-02-30"]), "şubat 30");
    rejects(pricingSettingsUpdateSchema, bad(["01.01.2026"]), "TR biçimi");
    rejects(pricingSettingsUpdateSchema, bad(["2026-1-1"]), "sıfırsız gün/ay");
    rejects(pricingSettingsUpdateSchema, bad(["2027-02-29"]), "artık olmayan yılda 29 şubat");
    rejects(pricingSettingsUpdateSchema, bad(["2026-01-01", "2026-01-01"]), "yinelenen tatil");
    accepts(pricingSettingsUpdateSchema, bad(["2028-02-29"]), "artık yıl 29 şubat");
  });

  await test("adet kademeleri 1'den başlar ve kesin artar", () => {
    const withBreaks = (qtyBreaks: Array<{ minQty: number; discountBps: number }>) => ({
      ...SETTINGS,
      settings: { ...SETTINGS.settings, qtyBreaks },
    });
    rejects(
      pricingSettingsUpdateSchema,
      withBreaks([
        { minQty: 5, discountBps: 0 },
        { minQty: 10, discountBps: 1000 },
      ]),
      "1'den başlamayan kademe"
    );
    rejects(
      pricingSettingsUpdateSchema,
      withBreaks([
        { minQty: 1, discountBps: 0 },
        { minQty: 1, discountBps: 500 },
      ]),
      "artmayan kademe"
    );
    rejects(
      pricingSettingsUpdateSchema,
      withBreaks([
        { minQty: 1, discountBps: 0 },
        { minQty: 10, discountBps: 9001 },
      ]),
      "9000 bps üstü indirim"
    );
    rejects(pricingSettingsUpdateSchema, withBreaks([]), "boş kademe listesi");
  });

  await test("teslim kademeleri üç anahtarın üçünü de taşır", () => {
    const tiers = SETTINGS.settings.leadTiers;
    const withTiers = (leadTiers: unknown) => ({
      ...SETTINGS,
      settings: { ...SETTINGS.settings, leadTiers },
    });
    rejects(pricingSettingsUpdateSchema, withTiers(tiers.slice(0, 2)), "ekspres kademesi eksik");
    rejects(
      pricingSettingsUpdateSchema,
      withTiers([tiers[0], tiers[1], { ...tiers[2], key: "economy" }]),
      "yinelenen kademe anahtarı"
    );
    rejects(
      pricingSettingsUpdateSchema,
      withTiers([tiers[0], tiers[1], { ...tiers[2], multiplierBps: 4999 }]),
      "5000 bps altı çarpan"
    );
    rejects(
      pricingSettingsUpdateSchema,
      withTiers([tiers[0], tiers[1], { ...tiers[2], multiplierBps: 30001 }]),
      "30000 bps üstü çarpan"
    );
    rejects(
      pricingSettingsUpdateSchema,
      withTiers([tiers[0], tiers[1], { ...tiers[2], minDays: 0 }]),
      "0 iş günü alt sınırı"
    );
    rejects(
      pricingSettingsUpdateSchema,
      withTiers([tiers[0], tiers[1], { ...tiers[2], minDays: 61 }]),
      "61 iş günü alt sınırı"
    );
  });

  await test("anahtar biçimi ve değiştirilemezliği", () => {
    rejects(technologyCreateSchema, { ...TECHNOLOGY, key: "SLS" }, "büyük harfli anahtar");
    rejects(technologyCreateSchema, { ...TECHNOLOGY, key: "s" }, "tek harfli anahtar");
    rejects(technologyCreateSchema, { ...TECHNOLOGY, key: "sls baskı" }, "boşluklu anahtar");
    const patched = technologyPatchSchema.safeParse({
      expectedUpdatedAt: "2026-09-22T00:00:00.000Z",
      key: "yeni_anahtar",
      name: "Yeni ad",
    });
    assert.equal(patched.success, true);
    assert.ok(
      patched.success && !("key" in patched.data),
      "anahtar yamada taşınmamalı (açık teklifler o anahtara bakıyor)"
    );
  });

  await test("yama expectedUpdatedAt olmadan geçmez", () => {
    rejects(technologyPatchSchema, { name: "Yeni ad" }, "damgasız yama");
    rejects(materialPatchSchema, { name: "Yeni ad" }, "damgasız malzeme yaması");
    rejects(
      technologyPatchSchema,
      { expectedUpdatedAt: "dün", name: "Yeni ad" },
      "tarih olmayan damga"
    );
    accepts(
      technologyPatchSchema,
      { expectedUpdatedAt: "2026-09-22T00:00:00.000Z", active: false },
      "yalnız pasifleştirme"
    );
  });

  await test("katman ve doluluk listeleri varsayılanı içermeli", () => {
    rejects(
      technologyCreateSchema,
      { ...TECHNOLOGY, layerOptionsUm: [100, 120], defaultLayerUm: 200 },
      "listede olmayan varsayılan katman"
    );
    rejects(
      technologyCreateSchema,
      { ...TECHNOLOGY, infillOptionsPct: [20, 50], defaultInfillPct: null },
      "doluluk listesi var ama varsayılan yok"
    );
    rejects(
      technologyCreateSchema,
      { ...TECHNOLOGY, infillOptionsPct: null, defaultInfillPct: 20 },
      "katı baskıda doluluk varsayılanı"
    );
    accepts(
      technologyCreateSchema,
      { ...TECHNOLOGY, infillOptionsPct: [20, 50], defaultInfillPct: 20 },
      "tutarlı doluluk"
    );
  });

  await test("simülatör gövdesi şekli tutar", () => {
    const body = {
      technologyKey: "fdm",
      materialKey: "pla",
      colorKey: "beyaz",
      finishKey: "ham",
      layerUm: 200,
      infillPct: 20,
      quantity: 1,
      leadTier: "standard",
      geometry: { volumeCm3: 8, areaCm2: 24, x: 20, y: 20, z: 20 },
    };
    accepts(simulateSchema, body, "tam simülatör gövdesi");
    rejects(simulateSchema, { ...body, quantity: 0 }, "sıfır adet");
    rejects(simulateSchema, { ...body, leadTier: "yarin" }, "bilinmeyen kademe");
    rejects(
      simulateSchema,
      { ...body, geometry: { ...body.geometry, volumeCm3: 0 } },
      "sıfır hacim"
    );
    rejects(
      simulateSchema,
      { ...body, geometry: { ...body.geometry, x: 0 } },
      "sıfır kenar"
    );
  });

  // ─── 2) Simülatör: G1 paritesi ve mutabakat ─────────────────────────────────

  console.log("\n2) Fiyat simülatörü");

  const G1_INPUT: QuoteSimulationInput = {
    technologyKey: "fdm",
    materialKey: "pla",
    colorKey: "beyaz",
    finishKey: "ham",
    layerUm: 200,
    infillPct: 20,
    quantity: 1,
    leadTier: "standard",
    geometry: { volumeCm3: 8, areaCm2: 24, x: 20, y: 20, z: 20 },
  };

  /** Simülatörün ürettiği parçanın `computeQuote` ikizi (aynı 20 mm küp). */
  function equivalentPart(input: QuoteSimulationInput): PricingPartInput {
    const geometry: PartGeometry = {
      volume: input.geometry.volumeCm3 * 1000,
      area: input.geometry.areaCm2 * 100,
      extents: { x: input.geometry.x, y: input.geometry.y, z: input.geometry.z },
      bodyCount: 1,
      isWatertight: true,
      isVolume: true,
      volumeEstimated: false,
      faceCount: 12,
      wallP1: null,
      wallP5: null,
      overhangArea: 0,
      sourceUnits: null,
      objectCount: 1,
    };
    return {
      id: "sim",
      analysisStatus: "ready",
      geometry,
      sourceSha256: null,
      manualUnitPriceKurus: null,
      manualPriceKey: null,
      dfmAckKey: null,
      config: {
        technologyKey: input.technologyKey,
        materialKey: input.materialKey,
        colorKey: input.colorKey,
        finishKey: input.finishKey,
        layerUm: input.layerUm,
        infillPct: input.infillPct,
        quantity: input.quantity,
        units: "mm",
        scale: 1,
        criticalTolerance: false,
      },
    };
  }

  function sumLines(lines: Array<{ kurus: number }>): number {
    return lines.reduce((sum, l) => sum + l.kurus, 0);
  }

  await test("G1 — 20 mm PLA küp, adet 1, standart: birim 7400", () => {
    const result = simulateQuotePrice(SEED_SNAPSHOT, G1_INPUT);
    assert.ok(result.ok, "G1 fiyatlanmalı");
    assert.equal(result.unitKurus, 7400);
    assert.equal(result.lineKurus, 7400);
    assert.equal(result.leadDays, 3);
    assert.equal(result.totals.totalKurus, 20000);
    assert.equal(result.totals.minOrderTopUpKurus, 12600);
  });

  await test("simülatör computeQuote ile BİT BİT aynı sonucu verir", () => {
    for (const input of [
      G1_INPUT,
      { ...G1_INPUT, quantity: 10 },
      { ...G1_INPUT, leadTier: "express" as const, quantity: 10 },
      { ...G1_INPUT, technologyKey: "sla", materialKey: "standard_resin", colorKey: "gri", layerUm: 50, infillPct: null },
      { ...G1_INPUT, geometry: { volumeCm3: 900, areaCm2: 1200, x: 150, y: 100, z: 60 } },
    ] as QuoteSimulationInput[]) {
      const result = simulateQuotePrice(SEED_SNAPSHOT, input);
      const computed = computeQuote(SEED_SNAPSHOT, [equivalentPart(input)], {
        leadTier: input.leadTier,
        addonKeys: [],
      });
      const price = computed.parts[0]!.price;
      assert.ok(price.ok, "ikiz parça fiyatlanmalı");
      assert.ok(result.ok, "simülatör fiyatlamalı");
      assert.equal(result.unitKurus, price.unitKurus);
      assert.equal(result.lineKurus, price.lineKurus);
      assert.equal(result.leadDays, price.leadDays);
      assert.deepEqual(result.totals, computed.totals);
    }
  });

  await test("mutabakat: kalemlerin toplamı KURUŞU KURUŞUNA birim fiyat", () => {
    for (const input of [
      G1_INPUT,
      { ...G1_INPUT, quantity: 10 },
      { ...G1_INPUT, quantity: 60 },
      { ...G1_INPUT, leadTier: "express" as const, quantity: 10 },
      { ...G1_INPUT, leadTier: "economy" as const, quantity: 25 },
      { ...G1_INPUT, finishKey: "zimpara" },
      { ...G1_INPUT, technologyKey: "sla", materialKey: "standard_resin", colorKey: "seffaf", layerUm: 50, infillPct: null },
      { ...G1_INPUT, geometry: { volumeCm3: 900, areaCm2: 1200, x: 150, y: 100, z: 60 } },
    ] as QuoteSimulationInput[]) {
      const result = simulateQuotePrice(SEED_SNAPSHOT, input);
      assert.ok(result.ok);
      assert.equal(
        sumLines(result.unitLines),
        result.unitKurus,
        `mutabakat tutmadı: ${JSON.stringify(result.unitLines)} ≠ ${result.unitKurus}`
      );
    }
  });

  await test("taban fiyat devreye girdiğinde ayrı satır olarak görünür", () => {
    const small = simulateQuotePrice(SEED_SNAPSHOT, G1_INPUT);
    assert.ok(small.ok);
    assert.equal(small.floorApplied, true, "20 mm küpte FDM taban fiyatı bağlar");
    const floor = small.unitLines.find((l) => l.key === "floor");
    assert.ok(floor, "taban fiyat satırı yok");
    assert.ok(floor.kurus > 0);
    assert.equal(small.minUnitPriceKurus, 4900);

    const big = simulateQuotePrice(SEED_SNAPSHOT, {
      ...G1_INPUT,
      geometry: { volumeCm3: 900, areaCm2: 1200, x: 150, y: 100, z: 60 },
    });
    assert.ok(big.ok);
    assert.equal(big.floorApplied, false, "büyük parçada taban fiyat bağlamaz");
    assert.equal(
      big.unitLines.some((l) => l.key === "floor"),
      false,
      "bağlamayan taban fiyat satırı yazılmamalı"
    );
  });

  await test("kurulum ücreti adede bölünmüş olarak görünür", () => {
    const one = simulateQuotePrice(SEED_SNAPSHOT, G1_INPUT);
    const ten = simulateQuotePrice(SEED_SNAPSHOT, { ...G1_INPUT, quantity: 10 });
    assert.ok(one.ok && ten.ok);
    assert.equal(one.setupPerUnitKurus, 2500);
    assert.equal(ten.setupPerUnitKurus, 250);
    assert.equal(ten.unitLines.find((l) => l.key === "setup")?.kurus, 250);
    const discount = ten.unitLines.find((l) => l.key === "qty_discount");
    assert.ok(discount && discount.kurus < 0, "adet indirimi eksi satır olmalı");
  });

  await test("fiyatlanamayan yapılandırma gerekçesiyle döner", () => {
    const manual = simulateQuotePrice(SEED_SNAPSHOT, { ...G1_INPUT, finishKey: "boyali" });
    assert.equal(manual.ok, false);
    assert.ok(!manual.ok && manual.dfm.some((i) => i.code === "finish_manual"));

    const tooLarge = simulateQuotePrice(SEED_SNAPSHOT, {
      ...G1_INPUT,
      geometry: { volumeCm3: 8000, areaCm2: 2400, x: 900, y: 900, z: 900 },
    });
    assert.equal(tooLarge.ok, false);
    assert.ok(!tooLarge.ok && tooLarge.dfm.some((i) => i.code === "too_large"));

    const unknown = simulateQuotePrice(SEED_SNAPSHOT, { ...G1_INPUT, materialKey: "yok" });
    assert.equal(unknown.ok, false);
    assert.ok(!unknown.ok && unknown.reason === "config_invalid");
  });

  // ─── 3) Admin uçları: oturum kapısı ─────────────────────────────────────────

  console.log("\n3) Admin uçlarının oturum kapısı");

  const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  let authorized = false;

  loader._load = function (name, ...args) {
    if (name === "@/lib/auth/require-admin") {
      return {
        requireAdmin: async () =>
          authorized
            ? { session: { user: { email: "sahip@test.invalid", role: "admin" } } }
            : {
                response: NextResponse.json(
                  { error: "Bu işlem için admin oturumu gerekiyor." },
                  { status: 401 }
                ),
              },
      };
    }
    return originalLoad.call(this, name, ...args);
  };

  type AnyHandler = (req: NextRequest, ctx?: unknown) => Promise<{ status: number }>;

  function req(method: string, body: unknown = {}): NextRequest {
    return new NextRequest("http://localhost/api/admin/print-catalog/test", {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
  }

  const idContext = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };

  try {
    const technologies = await import("../src/app/api/admin/print-catalog/technologies/route");
    const technologyById = await import("../src/app/api/admin/print-catalog/technologies/[id]/route");
    const materials = await import("../src/app/api/admin/print-catalog/materials/route");
    const materialById = await import("../src/app/api/admin/print-catalog/materials/[id]/route");
    const finishes = await import("../src/app/api/admin/print-catalog/finishes/route");
    const finishById = await import("../src/app/api/admin/print-catalog/finishes/[id]/route");
    const addons = await import("../src/app/api/admin/print-catalog/addons/route");
    const addonById = await import("../src/app/api/admin/print-catalog/addons/[id]/route");
    const settings = await import("../src/app/api/admin/print-catalog/settings/route");
    const simulate = await import("../src/app/api/admin/print-catalog/simulate/route");
    const flags = await import("../src/app/api/admin/flags/route");

    const guarded: Array<[string, AnyHandler, boolean]> = [
      ["GET /technologies", technologies.GET as unknown as AnyHandler, false],
      ["POST /technologies", technologies.POST as unknown as AnyHandler, false],
      ["PATCH /technologies/[id]", technologyById.PATCH as unknown as AnyHandler, true],
      ["GET /materials", materials.GET as unknown as AnyHandler, false],
      ["POST /materials", materials.POST as unknown as AnyHandler, false],
      ["PATCH /materials/[id]", materialById.PATCH as unknown as AnyHandler, true],
      ["GET /finishes", finishes.GET as unknown as AnyHandler, false],
      ["POST /finishes", finishes.POST as unknown as AnyHandler, false],
      ["PATCH /finishes/[id]", finishById.PATCH as unknown as AnyHandler, true],
      ["GET /addons", addons.GET as unknown as AnyHandler, false],
      ["POST /addons", addons.POST as unknown as AnyHandler, false],
      ["PATCH /addons/[id]", addonById.PATCH as unknown as AnyHandler, true],
      ["GET /settings", settings.GET as unknown as AnyHandler, false],
      ["PUT /settings", settings.PUT as unknown as AnyHandler, false],
      ["POST /simulate", simulate.POST as unknown as AnyHandler, false],
      ["GET /flags", flags.GET as unknown as AnyHandler, false],
      ["PUT /flags", flags.PUT as unknown as AnyHandler, false],
    ];

    await test("admin oturumu olmayan her uç 401 döner", async () => {
      authorized = false;
      for (const [label, handler, hasId] of guarded) {
        const method = label.split(" ")[0]!;
        const response = hasId
          ? await handler(req(method), idContext)
          : await handler(req(method));
        assert.equal(response.status, 401, `${label} kapıyı geçti`);
      }
    });

    await test("uçların tamamı yazılı (GET/POST/PATCH/PUT dışa aktarılmış)", () => {
      for (const [label, handler] of guarded) {
        assert.equal(typeof handler, "function", `${label} dışa aktarılmamış`);
      }
    });
  } finally {
    loader._load = originalLoad;
  }

  console.log(
    failures === 0
      ? "\n✅ quote-admin-catalog: tüm kontroller geçti"
      : `\n❌ quote-admin-catalog: ${failures} kontrol başarısız`
  );
  process.exit(failures === 0 ? 0 : 1);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
