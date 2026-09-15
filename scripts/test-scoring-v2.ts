// Q7 scoring v2 — pure-logic tests for src/lib/config/manufacturer-scoring.ts
//
// Covers: weights config, env tuning, weightsVersion stamping, the
// shouldUseV2 modulo gate (determinism + distribution + boundary).
// Pure functions only — no DB required.
//
// Run: npx tsx scripts/test-scoring-v2.ts

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getAssignmentWeights,
  getCanaryPercent,
  getDistanceModel,
  getDistanceShadowPercent,
  shouldRunDistanceShadow,
  shouldUseV2,
  V1_WEIGHTS,
  V3_WEIGHTS,
  weightsVersion,
  type ScoringWeights,
} from "../src/lib/config/manufacturer-scoring";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Sum EVERY weight, not a hand-written list of the ones that existed when this
// test was written. Adding a sixth weight with a hand-written sum would leave
// this assertion passing while the effective total silently drifted off 1.0 —
// and consumers do not normalize, so every score would shift.
const sumWeights = (w: ScoringWeights) =>
  Object.values(w).reduce((a, b) => a + b, 0);

// ─── V1_WEIGHTS shape ────────────────────────────────────────────
const v1 = getAssignmentWeights("v1");
check("v1 weights match V1_WEIGHTS constant", v1 === V1_WEIGHTS);
check("v1.distance === 0.35", v1.distance === 0.35);
check("v1.load === 0.30", v1.load === 0.3);
check("v1.reliability === 0.18", v1.reliability === 0.18);
check("v1.onTimeDelivery === 0 (signal disabled)", v1.onTimeDelivery === 0);
check("v1.compliance === 0.05", v1.compliance === 0.05);
check("v1.batchAffinity === 0.12 (toplu üretim batching, live)", v1.batchAffinity === 0.12);

const v1Sum = sumWeights(v1);
check(
  "v1 weights sum to 1.0",
  Math.abs(v1Sum - 1) < 0.0001,
  `actual: ${v1Sum}`
);

// ─── v2 default weights ──────────────────────────────────────────
// Make sure none of MFG_W2_* env vars are set first.
delete process.env.MFG_W2_DISTANCE;
delete process.env.MFG_W2_LOAD;
delete process.env.MFG_W2_RELIABILITY;
delete process.env.MFG_W2_OTD;
delete process.env.MFG_W2_COMPLIANCE;
delete process.env.MFG_W2_BATCH;

const v2Default = getAssignmentWeights("v2");
check("v2.distance default 0.25", v2Default.distance === 0.25);
check("v2.load default 0.22", v2Default.load === 0.22);
check("v2.reliability default 0.14", v2Default.reliability === 0.14);
check("v2.onTimeDelivery default 0.22", v2Default.onTimeDelivery === 0.22);
check("v2.compliance default 0.05", v2Default.compliance === 0.05);
check("v2.batchAffinity default 0.12", v2Default.batchAffinity === 0.12);

const v2DefaultSum = sumWeights(v2Default);
check(
  "v2 default weights sum to 1.0",
  Math.abs(v2DefaultSum - 1) < 0.0001,
  `actual: ${v2DefaultSum}`
);

// Every weight must be env-tunable, or an operator can't dial a signal down
// in production without a deploy.
check(
  "every v2 weight has an env override",
  (() => {
    const envNames: Record<keyof ScoringWeights, string> = {
      distance: "MFG_W2_DISTANCE",
      load: "MFG_W2_LOAD",
      reliability: "MFG_W2_RELIABILITY",
      onTimeDelivery: "MFG_W2_OTD",
      compliance: "MFG_W2_COMPLIANCE",
      batchAffinity: "MFG_W2_BATCH",
    };
    for (const [key, envName] of Object.entries(envNames)) {
      process.env[envName] = "0.99";
      const tuned = getAssignmentWeights("v2");
      delete process.env[envName];
      if (tuned[key as keyof ScoringWeights] !== 0.99) return false;
    }
    return true;
  })()
);

// ─── v2 env tuning ───────────────────────────────────────────────
process.env.MFG_W2_DISTANCE = "0.5";
process.env.MFG_W2_OTD = "0.1";
const v2Tuned = getAssignmentWeights("v2");
check("v2 picks up env override (distance)", v2Tuned.distance === 0.5);
check("v2 picks up env override (otd)", v2Tuned.onTimeDelivery === 0.1);
check(
  "v2 keeps default for non-overridden (load still 0.22)",
  v2Tuned.load === 0.22
);

// Clean up env for next tests
delete process.env.MFG_W2_DISTANCE;
delete process.env.MFG_W2_OTD;

// Malformed env → fallback
process.env.MFG_W2_DISTANCE = "not-a-number";
const v2Bad = getAssignmentWeights("v2");
check(
  "v2 malformed env falls back to default (NaN → 0.25)",
  v2Bad.distance === 0.25,
  `actual: ${v2Bad.distance}`
);
delete process.env.MFG_W2_DISTANCE;

process.env.MFG_W2_DISTANCE = "-1";
const v2Negative = getAssignmentWeights("v2");
check(
  "v2 negative env rejected, falls back to default",
  v2Negative.distance === 0.25,
  `actual: ${v2Negative.distance}`
);
delete process.env.MFG_W2_DISTANCE;

// ─── weightsVersion ──────────────────────────────────────────────
// v1.2 / v2.2 SABİT kalmalı: sürekli mesafe canlı skoru değiştirmiyor. Bu iki
// satır kırılıyorsa ya canlı algoritma gerçekten değişmiştir (o zaman sürüm
// bump'ı doğrudur) ya da yanlışlıkla canlı yol oynatılmıştır.
check("weightsVersion('v1') === 'v1.2'", weightsVersion("v1") === "v1.2");
check("weightsVersion('v2') === 'v2.2'", weightsVersion("v2") === "v2.2");
check("weightsVersion('v3') === 'v3.0'", weightsVersion("v3") === "v3.0");
check(
  "her profil ayrı bir weights_version üretir (değerlendirme satırları karışamaz)",
  new Set([weightsVersion("v1"), weightsVersion("v2"), weightsVersion("v3")])
    .size === 3
);

// ─── v3: sürekli mesafe gölge profili ────────────────────────────
// v3'te TEK değişken oynar: mesafe alt-skorunun nasıl hesaplandığı. Ağırlıklar
// da kaysaydı gölge kaydında farklı çıkan bir kazananı sürekli mesafeye
// atfedemezdik.
const v3 = getAssignmentWeights("v3");
check("v3 ağırlıkları v1 ile AYNI nesne", v3 === V1_WEIGHTS);
check("V3_WEIGHTS de aynı nesne", V3_WEIGHTS === V1_WEIGHTS);
const v3Sum = sumWeights(v3);
check("v3 ağırlıkları 1.0 toplar", Math.abs(v3Sum - 1) < 0.0001, `actual: ${v3Sum}`);

check("getDistanceModel: canlı profiller kademeli", getDistanceModel("v1") === "tiered");
check("getDistanceModel: v2 de kademeli", getDistanceModel("v2") === "tiered");
check("getDistanceModel: v3 sürekli", getDistanceModel("v3") === "continuous");

// Yapısal kilit: v3 GÖLGEDİR. Bu iki kontrol, birinin v3'ü sessizce canlı
// otoriteye terfi ettirmesini engeller (ranker-rollout: yüzdeyle açma ayrı bir
// karardır, bu fazda kimin iş aldığı değişmemeli).
const shadowSrc = fs.readFileSync(
  path.join(__dirname, "../src/lib/services/manufacturer-assignment-shadow.ts"),
  "utf8"
);
check(
  "otorite yalnız v1/v2 arasından seçilir",
  /const authoritativeProfile: ScoringProfile = useV2 \? "v2" : "v1";/.test(
    shadowSrc
  )
);
check(
  "v3 tek bir gölge sabiti üzerinden kullanılır",
  shadowSrc.includes('const SHADOW_DISTANCE_PROFILE: ScoringProfile = "v3";')
);
check(
  "salt-okunur aday listesi için kayıt yazmayan bir yol var",
  shadowSrc.includes("export async function rankForOrderPreview(")
);
check(
  "önizleme yolu kayıt makinesine hiç girmez",
  !/export async function rankForOrderPreview\([\s\S]*?\n}/
    .exec(shadowSrc)![0]
    .includes("stashPending")
);

// Değerlendirme satırı = GERÇEKLEŞEN atama. Sıralama anında yazılan satır,
// (order_id, weights_version) tekil indeksini işgal edip siparişin gerçek
// atamasını düşürüyordu; aşağıdaki kilitler o davranışın geri gelmesini
// engeller.
check(
  "sıralama anında satır YAZILMAZ, beklemeye alınır",
  // Çağrı dışlama listesini de taşıyor; kilit ARGÜMAN sayısına değil, satırın
  // sıralama anında YAZILMAYIP beklemeye alınmasına bakar.
  /stashPending\(orderId, rankedAt, rows[,)]/.test(shadowSrc) &&
    !/export async function rankForOrderWithShadow\([\s\S]*?\n}/
      .exec(shadowSrc)![0]
      .includes("writeEvaluationRows(")
);
check(
  "yerleştirme sonrası yazım için açık bir kanca var",
  shadowSrc.includes("export async function commitAssignmentEvaluation(")
);
check(
  "yerleştirme OLMADIYSA taslağı düşüren bir yol var",
  shadowSrc.includes("export function discardAssignmentEvaluation(")
);

// Karar GEÇMİŞİ (migration 0054). Satırlar EKLENİR: tekil indeks kalktığı için
// bir çakışma çözümü yazmak artık ikinci kararı sessizce yutardı — ki bu tam
// olarak "Önceki atama kararları" bölümünü hiç doldurmayan eski davranıştı.
// Metni değil KODU arıyoruz: dosyanın yorumları bu kararın NEDENİNİ anlatmak
// için eski çağrının adını anıyor, kilit ona takılmamalı.
check(
  "değerlendirme satırı EKLENİR, üzerine yazılmaz",
  !/\.onConflictDoUpdate\(/.test(shadowSrc) &&
    !/\.onConflictDoNothing\(/.test(shadowSrc)
);
check(
  "created_at TEK saatten gelir (DB varsayılanı; uygulama saati yazılmaz)",
  !/createdAt: new Date\(\)/.test(shadowSrc)
);

// Dışlama SIRALAMANIN İÇİNDE. Sonradan süzülen bir dışlama, kayda
// seçilemeyecek bir kazanan bırakıyor ve sipariş sayfası o ayrışmayı "iş elle
// atanmış olabilir" diye açıklıyordu — hiç yapılmamış bir insan kararı.
check(
  "gölge sarmalayıcısı dışlamayı sıralayıcıya GEÇİRİR",
  /rankManufacturersForProfiles\(orderId, profiles, \{\s*excludeManufacturerIds,/.test(
    shadowSrc
  )
);
check(
  "tek profile düşen yedek yol da dışlamayı taşır",
  (shadowSrc.match(/rankManufacturersForOrder\([\s\S]{0,120}?excludeManufacturerIds/g) ?? [])
    .length === 2
);
check(
  "dışlama satıra da damgalanır (sebep ekranda okunabilsin)",
  /excludedManufacturerIds: \[\.\.\.excludedManufacturerIds\]/.test(shadowSrc)
);
check(
  "satır, işi GERÇEKTEN alan atölyeyi kaydeder",
  /function sideJson\([\s\S]*?\n {4}assignedManufacturerId,/.test(shadowSrc)
);
check(
  "gölge karşılaştırmaları tek ortak veri yüklemesinden beslenir",
  shadowSrc.includes("rankManufacturersForProfiles(orderId, profiles,")
);
check(
  "mesafe gölgesi tek ayarla örneklenebilir",
  shadowSrc.includes("shouldRunDistanceShadow(orderId)")
);

// ─── Mesafe gölgesi örnekleme oranı ──────────────────────────────
// Varsayılan %100: gölge döneminin amacı veri toplamak. Ama tek bir ayarla
// kısılabilmeli — maliyet (atama başına üç sıralama, tarama ekranında onlarca
// sipariş) kod değişikliği gerektirmeden dizginlenebilsin.
delete process.env.MANUFACTURER_DISTANCE_SHADOW_PERCENT;
check(
  "getDistanceShadowPercent varsayılanı 100 (her atamada)",
  getDistanceShadowPercent() === 100
);
check(
  "varsayılanda her sipariş mesafe gölgesine girer",
  ["FIG-A", "FIG-B", "FIG-C"].every((id) => shouldRunDistanceShadow(id))
);

process.env.MANUFACTURER_DISTANCE_SHADOW_PERCENT = "0";
check("örnekleme %0 → gölge kapanır", getDistanceShadowPercent() === 0);
check(
  "%0'da hiçbir sipariş gölgeye girmez",
  ["FIG-A", "FIG-B", "FIG-C"].every((id) => !shouldRunDistanceShadow(id))
);

process.env.MANUFACTURER_DISTANCE_SHADOW_PERCENT = "20";
check("örnekleme env'den okunur (20)", getDistanceShadowPercent() === 20);
let sampled = 0;
for (let i = 0; i < 1000; i++) {
  if (shouldRunDistanceShadow(crypto.randomBytes(8).toString("hex"), 20)) {
    sampled++;
  }
}
check(
  `%20 örnekleme gerçekten ~%20 (${(sampled / 1000).toFixed(3)})`,
  Math.abs(sampled / 1000 - 0.2) < 0.05
);
delete process.env.MANUFACTURER_DISTANCE_SHADOW_PERCENT;

check(
  "aynı sipariş için karar kararlı (yeniden sıralama deneyi bozmaz)",
  (() => {
    const id = "FIG-STABLE-SHADOW";
    const first = shouldRunDistanceShadow(id, 50);
    for (let i = 0; i < 10; i++) {
      if (shouldRunDistanceShadow(id, 50) !== first) return false;
    }
    return true;
  })()
);

// İki deneyin kovaları AYRI olmalı: aynı hash kullanılsaydı v2 kanaryasına
// giren siparişler mesafe gölgesine de birebir aynı şekilde girer/girmezdi,
// yani iki ölçüm birbirinin yanlılığını taşırdı.
check(
  "mesafe gölgesi kovası, v2 kanarya kovasından bağımsız",
  (() => {
    let differs = 0;
    for (let i = 0; i < 500; i++) {
      const id = crypto.randomBytes(8).toString("hex");
      if (shouldUseV2(id, 50) !== shouldRunDistanceShadow(id, 50)) differs++;
    }
    // Bağımsız iki kova için beklenen ~%50; aynı hash olsaydı 0 çıkardı.
    return differs > 150;
  })()
);


// ─── D-C1: karar kimliği damgası ─────────────────────────────────
// Bir yerleştirme kararı tabloya birden çok satır yazıyor (ağırlık
// karşılaştırması + mesafe gölgesi) ve İKİ AYRI karar birbirine saniyeler kadar
// yaklaşabiliyor (arka arkaya iki geri alma, otomatik atamanın hemen ardından
// tarama uygulaması). Okuyucu satırları bu damgayla grupluyor; damga yoksa 5
// sn'lik pencereye düşüyor ve o pencere iki gerçek kararı tek karara katlayıp
// öncekinin kazananını da işi alan atölyesini de ekrandan siliyordu.
const writeFn = /async function writeEvaluationRows\([\s\S]*?\n}/.exec(shadowSrc)![0];
check(
  "yazıcı karar kimliğini uuid üreticisinden alır",
  /import \{ randomUUID \} from "node:crypto";/.test(shadowSrc)
);
check("yazıcı her yazımda bir karar kimliği üretir", /const decisionId = randomUUID\(\);/.test(writeFn));
check(
  "kimlik satır döngüsünün DIŞINDA üretilir (karar başına TEK kimlik)",
  writeFn.indexOf("const decisionId = randomUUID()") > -1 &&
    writeFn.indexOf("const decisionId = randomUUID()") <
      writeFn.indexOf("for (const row of pending.rows)")
);
check(
  "kimlik satırın İKİ jsonb tarafına da damgalanır",
  (writeFn.match(/sideJson\(\s*row\.v[12],\s*decisionId,/g) ?? []).length === 2,
  String((writeFn.match(/sideJson\(\s*row\.v[12],\s*decisionId,/g) ?? []).length)
);
check(
  "damga jsonb'de okuyucunun aradığı adla durur (`decisionId`)",
  /function sideJson\([\s\S]*?\n {4}decisionId,/.test(shadowSrc)
);
// Aynı taslak iki kez yazılamaz (`takePending` onu alır), yani bir kimlik iki
// karara dağılamaz; yeniden sıralanan sipariş yeni taslak ve yeni kimlik alır.
check(
  "taslağı yazan iki yol da onu bellekten ALIR (aynı kimlik iki kez yazılamaz)",
  (shadowSrc.match(/takePending\(orderId\)/g) ?? []).length >= 2
);

// ─── getCanaryPercent ────────────────────────────────────────────
delete process.env.MANUFACTURER_SCORING_V2_PERCENT;
check(
  "getCanaryPercent defaults to 0 (shadow mode)",
  getCanaryPercent() === 0
);

process.env.MANUFACTURER_SCORING_V2_PERCENT = "25";
check("getCanaryPercent reads env (25)", getCanaryPercent() === 25);
delete process.env.MANUFACTURER_SCORING_V2_PERCENT;

// ─── shouldUseV2 — boundary cases ────────────────────────────────
const sampleId = "FIG-ABC123_";
check(
  "shouldUseV2(_, 0) always false",
  shouldUseV2(sampleId, 0) === false
);
check(
  "shouldUseV2(_, 100) always true",
  shouldUseV2(sampleId, 100) === true
);
check(
  "shouldUseV2(_, -10) treated as 0",
  shouldUseV2(sampleId, -10) === false
);
check(
  "shouldUseV2(_, 200) treated as 100",
  shouldUseV2(sampleId, 200) === true
);

// ─── shouldUseV2 — determinism ───────────────────────────────────
// Critical for N12 decline retry: same orderId must land in same bucket
// across retries so the algorithm choice doesn't flip mid-flight.
let determinismOk = true;
for (let i = 0; i < 10; i++) {
  const a = shouldUseV2("FIG-DETERMINISM-TEST", 50);
  const b = shouldUseV2("FIG-DETERMINISM-TEST", 50);
  if (a !== b) {
    determinismOk = false;
    break;
  }
}
check("shouldUseV2 is deterministic for same id", determinismOk);

// ─── shouldUseV2 — distribution ──────────────────────────────────
// 1000 random ids with percent=50 should split roughly 50/50.
// Allow ±5pp tolerance.
let v2Count = 0;
const TOTAL = 1000;
for (let i = 0; i < TOTAL; i++) {
  const id = crypto.randomBytes(8).toString("hex");
  if (shouldUseV2(id, 50)) v2Count++;
}
const ratio = v2Count / TOTAL;
check(
  `shouldUseV2(_, 50) distribution close to 0.5 (got ${ratio.toFixed(3)})`,
  Math.abs(ratio - 0.5) < 0.05
);

// Same test at 10% — should be roughly 10%.
let v2Count10 = 0;
for (let i = 0; i < TOTAL; i++) {
  const id = crypto.randomBytes(8).toString("hex");
  if (shouldUseV2(id, 10)) v2Count10++;
}
const ratio10 = v2Count10 / TOTAL;
check(
  `shouldUseV2(_, 10) distribution close to 0.1 (got ${ratio10.toFixed(3)})`,
  Math.abs(ratio10 - 0.1) < 0.04
);

// ─── Summary ─────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} scoring-v2 checks passed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
