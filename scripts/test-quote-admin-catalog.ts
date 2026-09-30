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
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { computeQuote } from "../src/lib/config/quote-compute";
import { SEED_SNAPSHOT } from "../src/lib/config/quote-seed";
import type { PartGeometry, PricingPartInput } from "../src/lib/config/quote-types";
import {
  addonCreateSchema,
  CATALOG_LIMITS,
  finishCreateSchema,
  firstIssueMessage,
  materialCreateSchema,
  materialPatchSchema,
  pricingSettingsUpdateSchema,
  simulateSchema,
  technologyCreateSchema,
  technologyPatchSchema,
} from "../src/lib/validators/print-catalog";
import {
  ADDON_FIELDS,
  FINISH_FIELDS,
  KEY_FIELD,
  MATERIAL_FIELDS,
  TECHNOLOGY_FIELDS,
  toDraft,
  toPayload,
  type ColorDraft,
  type Field,
  type PropertiesDraft,
} from "../src/app/admin/baski-katalogu/form-values";
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

/**
 * Reddin EKRANA çıkacak cümlesi. Panel Türkçe ve tek kullanıcısı sahibi:
 * zod'un kendi İngilizce cümlesi ("Too small: expected string to have >=1
 * characters") bir alandan bile sızarsa, yanlış bir fiyatı düzeltmeye çalışan
 * yönetici anlamadığı bir dilde tip hatası görür.
 */
type ParsableSchema = {
  safeParse: (v: unknown) => { success: boolean; error?: unknown };
};

function messageOf(schema: ParsableSchema, value: unknown, why: string): string {
  const parsed = schema.safeParse(value) as {
    success: boolean;
    error?: Parameters<typeof firstIssueMessage>[0];
  };
  assert.equal(parsed.success, false, `kabul edilmemeliydi: ${why}`);
  return firstIssueMessage(parsed.error!);
}

/** Zod'un İngilizce kalıpları — biri bile geçerse mesaj çevrilmemiş demektir. */
const ENGLISH_ZOD =
  /too (small|big)|invalid input|invalid uuid|expected|received|characters|elements|at least|at most|greater than|less than/i;

/** Bir metnin gövdesi: `firstIssueMessage` alan adını başa ekler (alan: cümle). */
function sentenceOf(message: string): string {
  const colon = message.indexOf(": ");
  return colon === -1 ? message : message.slice(colon + 2);
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

  await test("her ret cümlesi TÜRKÇE (zod'un İngilizcesi hiçbir alandan sızmaz)", () => {
    const longText = (n: number) => "a".repeat(n);
    const colors = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...COLOR, key: `renk_${i}` }));
    const settingsWith = (patch: Record<string, unknown>) => ({
      ...SETTINGS,
      settings: { ...SETTINGS.settings, ...patch },
    });

    const cases: Array<[string, ParsableSchema, unknown, string]> = [
      // İnceleme tam da bu yolu ölçtü: "+ Teknoloji ekle" formunda boş bırakılan
      // tolerans metni İngilizce bir tip hatası döndürüyordu.
      ["boş tolerans metni", technologyCreateSchema, { ...TECHNOLOGY, toleranceText: "" }, "Tolerans metni yazılmalı (örn. ±0,5 mm)."],
      ["metin olmayan tolerans", technologyCreateSchema, { ...TECHNOLOGY, toleranceText: 42 }, "Tolerans metni yazılmalı (örn. ±0,5 mm)."],
      ["çok uzun tolerans metni", technologyCreateSchema, { ...TECHNOLOGY, toleranceText: longText(121) }, "Tolerans metni en çok 120 karakter olabilir."],
      ["çok uzun ad", technologyCreateSchema, { ...TECHNOLOGY, name: longText(121) }, "Ad en çok 120 karakter olabilir."],
      ["çok uzun açıklama", technologyCreateSchema, { ...TECHNOLOGY, description: longText(601) }, "Açıklama en çok 600 karakter olabilir."],
      ["13 katman seçeneği", technologyCreateSchema, { ...TECHNOLOGY, layerOptionsUm: Array.from({ length: 13 }, (_, i) => 100 + i) }, "En çok 12 katman seçeneği olabilir."],
      ["boş doluluk listesi", technologyCreateSchema, { ...TECHNOLOGY, infillOptionsPct: [], defaultInfillPct: 20 }, "Doluluk listesi boş olamaz; katı baskı için alanı tamamen boş bırakın."],
      ["evet/hayır olmayan aktiflik", technologyCreateSchema, { ...TECHNOLOGY, active: "evet" }, "Evet/hayır (true/false) değeri girilmeli."],
      ["nesne olmayan gövde", technologyCreateSchema, "teknoloji", "Geçerli bir istek gövdesi (JSON nesnesi) gönderilmeli."],
      ["çok uzun renk adı", materialCreateSchema, { ...MATERIAL, colors: [{ ...COLOR, name: longText(61) }] }, "Renk adı en çok 60 karakter olabilir."],
      ["41 renk", materialCreateSchema, { ...MATERIAL, colors: colors(41) }, "En çok 40 renk tanımlanabilir."],
      ["11 kullanım alanı", materialCreateSchema, { ...MATERIAL, properties: { uses: Array.from({ length: 11 }, (_, i) => `alan ${i}`) } }, "En çok 10 kullanım alanı yazılabilir."],
      ["uuid olmayan teknoloji", materialCreateSchema, { ...MATERIAL, technologyId: "fdm" }, "Teknoloji geçersiz; listeden seçin."],
      ["uuid olmayan yüzey teknolojisi", finishCreateSchema, { technologyId: "fdm", key: "zimpara", name: "Zımpara", description: "", fixedKurus: 0, perCm2Kurus: 0, leadDaysExtra: 0, requiresManual: false, costLineKind: "production", sortOrder: 0 }, "Teknoloji geçersiz; listeden seçin ya da boş bırakın (tüm teknolojiler)."],
      ["13 adet kademesi", pricingSettingsUpdateSchema, settingsWith({ qtyBreaks: Array.from({ length: 13 }, (_, i) => ({ minQty: i + 1, discountBps: 0 })) }), "En çok 12 adet kademesi tanımlanabilir."],
      ["11 fiyat kademesi", pricingSettingsUpdateSchema, settingsWith({ priceBreakQuantities: Array.from({ length: 11 }, (_, i) => i + 1) }), "En çok 10 fiyat kademesi gösterilebilir."],
      ["401 tatil", pricingSettingsUpdateSchema, settingsWith({ holidays: Array.from({ length: 401 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)) }), "En çok 400 tatil tarihi tanımlanabilir."],
      ["çok uzun kademe adı", pricingSettingsUpdateSchema, settingsWith({ leadTiers: [SETTINGS.settings.leadTiers[0], SETTINGS.settings.leadTiers[1], { ...SETTINGS.settings.leadTiers[2], name: longText(61) }] }), "Kademe adı en çok 60 karakter olabilir."],
      ["geometri nesnesi değil", simulateSchema, { technologyKey: "fdm", materialKey: "pla", colorKey: "beyaz", finishKey: "ham", quantity: 1, leadTier: "standard", geometry: "20x20x20" }, "Geometri ölçüleri eksik ya da hatalı."],
    ];

    for (const [why, schema, value, expected] of cases) {
      const message = messageOf(schema, value, why);
      assert.equal(sentenceOf(message), expected, `${why} → beklenmeyen cümle: ${message}`);
      assert.ok(!ENGLISH_ZOD.test(message), `${why} → İngilizce mesaj sızdı: ${message}`);
    }
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
      // Simülatörde dosya da çevrim de yok: üçgen ağ parametresi ölçülmemiştir.
      tessellation: null,
      solidCount: null,
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

  /**
   * Toplamın birim fiyata eşit olması TEK BAŞINA bir şey kanıtlamaz: son satır
   * (`rounding = unitKurus − (preTier + tierKurus)`) farkı tanımı gereği emer,
   * yani kalemlerin sırası, işareti ya da formülü bozulsa bile toplam tutar.
   * Asıl kapı ARTIĞIN KENDİSİDİR: `priceUnitAuto` ile aynı sırayı izleyen bir
   * model yalnız yuvarlama kadar (≤ 2 kuruş) sapabilir; daha büyük bir artık,
   * "Yuvarlama ve kuruş farkı" satırının ekranda uydurma bir dökümü
   * kapattığı anlamına gelir.
   */
  const ROUNDING_TOLERANCE_KURUS = 2;

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

      const rounding = result.unitLines.find((l) => l.key === "rounding")?.kurus ?? 0;
      assert.ok(
        Math.abs(rounding) <= ROUNDING_TOLERANCE_KURUS,
        `mutabakat modeli priceUnitAuto'dan ayrıştı: artık ${rounding} kuruş — ` +
          `döküm ${JSON.stringify(result.unitLines)}`
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

  // ─── 4) Formun değer katmanı: taslak ⇄ gövde ────────────────────────────────

  console.log("\n4) Formun değer katmanı");

  /**
   * Ekranın gövdeyi nasıl kurduğu bir görünüm ayrıntısı DEĞİL, para yoludur:
   * boş bırakılan "Malzeme fiyatı (₺/gram)" alanı `Number("")` yüzünden sessizce
   * 0 kuruş kaydediliyordu ve şema bunu yakalayamaz (0 meşru bir fiyattır).
   * Bu yüzden dönüşüm saf bir modülde (`form-values.ts`) durur ve burada
   * GERÇEK alan tanımlarıyla GERÇEK şemaya karşı koşar.
   */
  const MATERIAL_ROW: Record<string, unknown> = {
    name: "PLA",
    description: "Sert, kolay basılan",
    densityGCm3: 1.24,
    priceKurusPerGram: 90,
    supportFactor: 1.15,
    capabilityTag: null,
    properties: { tensileMpa: 48, uses: ["prototip", "maket"] },
    colors: [{ key: "beyaz", name: "Beyaz", hex: "#F5F5F5", surchargeKurus: 0 }],
    leadDaysExtra: 0,
    sortOrder: 1,
    active: true,
  };

  /** Gövdenin TELDEN geçmiş hâli: `NaN` → `null`, `undefined` → alan yok. */
  const wire = (payload: Record<string, unknown>) =>
    JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;

  const STAMP = { expectedUpdatedAt: "2026-09-22T00:00:00.000Z" };

  await test("yeni teknoloji formu, başlangıç değerleriyle geçerli bir gövde üretir", () => {
    const fields = [KEY_FIELD("teknoloji"), ...TECHNOLOGY_FIELDS];
    const draft = toDraft(fields, null);
    // Sahibinin elle yazacağı üç alan; gerisi formun başlangıç değerleri.
    draft.key = "sls";
    draft.name = "SLS (Toz)";
    draft.capabilityTag = "material_resin";
    accepts(technologyCreateSchema, wire(toPayload(fields, draft)), "açılışta dolu gelen form");
  });

  await test("boş bırakılan sayı alanı 0 DEĞİL, reddedilen bir boşluktur", () => {
    const lists: Array<[string, Field[]]> = [
      ["teknoloji", TECHNOLOGY_FIELDS],
      ["malzeme", MATERIAL_FIELDS],
      ["yüzey işlemi", FINISH_FIELDS],
      ["ek hizmet", ADDON_FIELDS],
    ];
    let checked = 0;
    for (const [label, fields] of lists) {
      for (const field of fields) {
        if (field.kind !== "money" && field.kind !== "int" && field.kind !== "float") continue;
        if (field.nullable) continue; // boşluğu MEŞRU: açıkça null gider
        const draft = toDraft(fields, null);
        draft[field.name] = "";
        assert.equal(
          wire(toPayload(fields, draft))[field.name],
          null,
          `${label}.${field.name} boşken 0'a değil null'a dönmeli`
        );
        checked++;
      }
    }
    assert.ok(checked >= 15, `beklenenden az sayı alanı tarandı: ${checked}`);
  });

  await test("boş malzeme fiyatı Türkçe cümleyle reddedilir (sessiz 'bedava' yok)", () => {
    const draft = toDraft(MATERIAL_FIELDS, MATERIAL_ROW);
    assert.equal(draft.priceKurusPerGram, "0.90", "kuruş ekrana ₺ olarak gelmeli");
    draft.priceKurusPerGram = "";
    const body: Record<string, unknown> = { ...wire(toPayload(MATERIAL_FIELDS, draft)), ...STAMP };
    assert.equal(body.priceKurusPerGram, null);
    const message = messageOf(materialPatchSchema, body, "boş gram fiyatı");
    assert.equal(message, "priceKurusPerGram: Sayı girilmeli (boş bırakılamaz).");
    assert.ok(!ENGLISH_ZOD.test(message), message);

    // 0 hâlâ MEŞRU: kural "boş" ile "sıfır"ı ayırmak, sıfırı yasaklamak değil.
    draft.priceKurusPerGram = "0";
    accepts(
      materialPatchSchema,
      { ...wire(toPayload(MATERIAL_FIELDS, draft)), ...STAMP },
      "bilerek sıfırlanan gram fiyatı"
    );
  });

  await test("renk ek ücreti ondalık girilebilir; ham metin kaydederken çevrilir", () => {
    const draft = toDraft(MATERIAL_FIELDS, MATERIAL_ROW);
    const colors = draft.colors as ColorDraft[];
    assert.equal(colors[0]!.surcharge, "0.00", "ek ücret taslakta METİN olmalı");

    const withSurcharge = (typed: string) => {
      const next = { ...draft, colors: [{ ...colors[0]!, surcharge: typed }] };
      const body = wire(toPayload(MATERIAL_FIELDS, next)) as {
        colors: Array<{ surchargeKurus: number | null }>;
      };
      return body.colors[0]!.surchargeKurus;
    };

    // Yazım sırası: "7" → "7." → "7.5" → "7.50". Hiçbir ara adım NaN üretmez.
    assert.equal(withSurcharge("7"), 700);
    assert.equal(withSurcharge("7."), 700);
    assert.equal(withSurcharge("7.5"), 750);
    assert.equal(withSurcharge("7.50"), 750);
    assert.equal(withSurcharge("7,50"), 750, "virgüllü giriş de kabul edilmeli");
    assert.equal(withSurcharge("0"), 0);
    assert.equal(withSurcharge(""), null, "boş ek ücret sessizce 0 olmamalı");

    const cleared = {
      ...draft,
      colors: [{ ...colors[0]!, surcharge: "" }],
    };
    const message = messageOf(
      materialPatchSchema,
      { ...wire(toPayload(MATERIAL_FIELDS, cleared)), ...STAMP },
      "boş renk ek ücreti"
    );
    assert.ok(!ENGLISH_ZOD.test(message), message);
  });

  await test("teknik özellikler taslakta metin, gövdede sayıdır", () => {
    const draft = toDraft(MATERIAL_FIELDS, MATERIAL_ROW);
    const properties = draft.properties as PropertiesDraft;
    assert.equal(properties.tensileMpa, "48");
    assert.equal(properties.uses, "prototip, maket");
    assert.equal(properties.flexible, false);

    // Nokta yazılırken yutulmamalı: "48." geçerli bir ARA durumdur.
    const typing = { ...draft, properties: { ...properties, tensileMpa: "48." } };
    const midBody = wire(toPayload(MATERIAL_FIELDS, typing)) as {
      properties: { tensileMpa: number };
    };
    assert.equal(midBody.properties.tensileMpa, 48);

    const done = { ...draft, properties: { ...properties, tensileMpa: "48,5", uses: "" } };
    const body = wire(toPayload(MATERIAL_FIELDS, done)) as {
      properties: Record<string, unknown>;
    };
    assert.equal(body.properties.tensileMpa, 48.5);
    assert.equal("uses" in body.properties, false, "boş kullanım alanı hiç gönderilmemeli");
    accepts(materialPatchSchema, { ...body, ...STAMP }, "ondalıklı teknik özellik");
  });

  await test("ekran para/sayı alanını her tuşta çevirmiyor (ham taslak korunur)", () => {
    const client = readFileSync(
      path.join(import.meta.dirname, "..", "src/app/admin/baski-katalogu/catalog-client.tsx"),
      "utf8"
    );
    for (const pattern of [/toKurus\(e\.target\.value\)/, /numberOf\(e\.target\.value\)/]) {
      assert.ok(
        !pattern.test(client),
        `girdi her tuşta sayıya çevriliyor (${pattern}); ondalık yazılamaz, alan NaN'da takılır`
      );
    }
    assert.ok(
      /value=\{color\.surcharge\}/.test(client),
      "renk ek ücreti ham metin taslağına bağlı olmalı"
    );
  });

  /**
   * Katalog ekranı okuma arızasını GÜNLÜĞE yazmalı ve HAM mesajı basmamalı.
   *
   * Panel kabuğundaki `displayRead` deseni: arıza yutulmaz (etiketiyle günlüğe
   * geçer) ama ekrana çıkan cümle yalnız BEKLENEN retlerin kendi Türkçe
   * cümlesidir. Ham `message` (bağlantı dizgisi, SQL parçası) yöneticinin
   * ekranına ait değildir ve hiç loglanmayan bir arıza sunucuda iz bırakmaz.
   */
  await test("katalog ekranı okuma arızasını loglar, ham mesajı basmaz", () => {
    const page = readFileSync(
      path.join(import.meta.dirname, "..", "src/app/admin/baski-katalogu/page.tsx"),
      "utf8"
    );
    assert.match(page, /console\.error\(/, "okuma arızası günlüğe yazılmıyor");
    assert.match(page, /ADMIN_READ_FAILED_ERROR/, "beklenmeyen arıza için ev cümlesi yok");
    assert.ok(
      !/e instanceof Error \? e\.message/.test(page),
      "her hatanın ham mesajı ekrana basılıyor"
    );
  });

  /**
   * Bayrak ekranı grupları `FLAG_KEY_GROUPS`tan TÜRETMELİ.
   *
   * Elle yazılmış bir grup listesi, dördüncü bir grup eklendiği gün o grubun
   * ekranda hiç görünmemesi demekti; görünmeyen bir anahtar ise kimsenin
   * açamadığı bir özelliktir. Sıra tercihi kalabilir, KAYNAK kalamaz.
   */
  await test("bayrak ekranı grup listesini FLAG_KEY_GROUPS'tan türetiyor", () => {
    const client = readFileSync(
      path.join(import.meta.dirname, "..", "src/app/admin/ayarlar/flags-client.tsx"),
      "utf8"
    );
    assert.match(
      client,
      /Object\.keys\(FLAG_KEY_GROUPS\)/,
      "grup listesi FLAG_KEY_GROUPS'tan türetilmiyor"
    );
    const order = /const GROUP_ORDER[^=]*=\s*\[([\s\S]*?)\];/.exec(client);
    assert.ok(order, "GROUP_ORDER bulunamadı");
    assert.match(
      order[1]!,
      /Object\.keys\(FLAG_KEY_GROUPS\)/,
      "GROUP_ORDER elle yazılmış bir listeyle sınırlı"
    );
  });

  /**
   * Veritabanı kısıtları (migration 0066) ile `CATALOG_LIMITS` AYNI sayıları
   * söylemeli.
   *
   * Kısıtlar savunma derinliğidir, zod'un yerine geçmez; ama veritabanı zod'dan
   * DAHA DAR olursa panelin kabul ettiği bir değer kaydedilemez ve yönetici
   * beklenmeyen bir 500 görür. Sayılar iki dosyada ayrı durduğu için (şema
   * dosyası zod'u içe aktaramaz: drizzle-kit `@/` takma adını çözemez) eşitlik
   * burada KAYNAK üzerinden sınanır. Davranışın kendisi
   * `scripts/test-quote-admin-catalog-db.ts`te gerçek satırlarla koşar.
   */
  await test("şemadaki aralık kısıtları CATALOG_LIMITS ile aynı sayıları taşıyor", () => {
    const schema = readFileSync(
      path.join(import.meta.dirname, "..", "src/lib/db/schema.ts"),
      "utf8"
    );
    const L = CATALOG_LIMITS;
    const expected: Array<[string, string]> = [
      ["print_technologies_build_mm_chk", `BETWEEN ${L.buildMm.min} AND ${L.buildMm.max}`],
      ["print_technologies_money_chk", `BETWEEN 0 AND ${L.maxPriceKurus}`],
      ["print_technologies_lead_days_chk", "BETWEEN 1 AND 60"],
      ["print_materials_density_chk", `BETWEEN ${L.densityGCm3.min} AND ${L.densityGCm3.max}`],
      ["print_materials_support_factor_max_chk", `<= ${L.supportFactor.max}`],
      ["print_materials_money_chk", `BETWEEN 0 AND ${L.maxPriceKurus}`],
      ["print_materials_lead_days_chk", `BETWEEN ${L.leadDaysExtra.min} AND ${L.leadDaysExtra.max}`],
      ["print_finishes_money_chk", `BETWEEN 0 AND ${L.maxPriceKurus}`],
      ["print_finishes_lead_days_chk", `BETWEEN ${L.leadDaysExtra.min} AND ${L.leadDaysExtra.max}`],
      ["print_addons_money_chk", `BETWEEN 0 AND ${L.maxPriceKurus}`],
      ["print_addons_lead_days_chk", `BETWEEN ${L.leadDaysExtra.min} AND ${L.leadDaysExtra.max}`],
      ["quote_pricing_settings_money_chk", `BETWEEN 0 AND ${L.maxPriceKurus}`],
      ["quote_pricing_settings_days_chk", "BETWEEN 1 AND 365"],
      ["quote_pricing_settings_bps_chk", `@ > ${L.multiplierBps.max}`],
    ];
    /** Kısıdın YALNIZ kendi gövdesi: adından bir sonraki kısıt/tablo sonuna kadar. */
    const constraintBody = (name: string): string => {
      const at = schema.indexOf(`"${name}"`);
      assert.notEqual(at, -1, `${name} kısıdı schema.ts'te yok`);
      const rest = schema.slice(at);
      const stops = ['check("', "]);"]
        .map((stop) => rest.indexOf(stop, name.length + 2))
        .filter((i) => i !== -1);
      return stops.length > 0 ? rest.slice(0, Math.min(...stops)) : rest;
    };
    for (const [name, fragment] of expected) {
      assert.ok(
        constraintBody(name).includes(fragment),
        `${name} kısıdı "${fragment}" sınırını taşımıyor (CATALOG_LIMITS ile kaymış)`
      );
    }
    // Baz puan kısıdı İKİ listeyi de kapsamalı: yalnız biri kapatılırsa öteki
    // sessizce sınırsız kalır.
    const bps = constraintBody("quote_pricing_settings_bps_chk");
    for (const field of ["qtyBreaks", "leadTiers"]) {
      assert.ok(bps.includes(field), `baz puan kısıdı ${field} listesini denetlemiyor`);
    }
  });

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
