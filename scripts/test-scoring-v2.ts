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
import {
  NO_SIGNALS,
  PAINT_IN_HOUSE_BONUS,
  PHASE5_DISTANCE_MODEL,
  PHASE5_MIN_HISTORY_SAMPLES,
  PHASE5_SIGNAL_ENV,
  PHASE5_SIGNAL_KEYS,
  PHASE5_SIGNAL_LABELS_TR,
  PHASE5_WEIGHTS,
  PHASE5_WEIGHTS_VERSION,
  QC_REJECTION_PENALTY_MAX,
  STRIKE_PENALTY_CAP,
  STRIKE_PENALTY_PER,
  anySignalOn,
  applyReliabilityPenalties,
  explainShadowDivergence,
  isPhase5ShadowEnabled,
  liveSignalSet,
  manufacturerLoadUnits,
  paintInHouseBonus,
  phase5Weights,
  shadowSignalSet,
  signalsForProfile,
  type Phase5SignalKey,
} from "../src/lib/config/scoring";
import { painterLoadUnits } from "../src/lib/config/painter-scoring";
import { largeFormatPlacementBlocked } from "../src/lib/services/manufacturer-assign";
// DB gerekmez: bu modül @/lib/db'yi import eder ama yüklenirken sorgu açmaz
// (test-province-distance.ts ve test-painter-scoring.ts da aynısını yapıyor).
import {
  scoreManufacturers,
  type ManufacturerScoringOrder,
  type ManufacturerScoringRow,
} from "../src/lib/services/manufacturer-assignment";

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
  /rankManufacturersDetailed\(orderId, profiles, \{\s*excludeManufacturerIds,/.test(
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
  shadowSrc.includes("rankManufacturersDetailed(orderId, profiles,")
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

/* ══════════════════════════════════════════════════════════════════════════
 * FAZ 5 — YENİ SIRALAMA SİNYALLERİ (config/scoring.ts)
 *
 * Fazın bağlayıcı sözü: BU SİNYALLERİN HİÇBİRİ BUGÜN KİMİN İŞ ALDIĞINI
 * DEĞİŞTİRMEZ (ranker-rollout = B). Aşağıdaki bölümün ASIL işi o sözü SAYISAL
 * olarak çivilemek — "canlı yola sinyal sızdı mı?" sorusu yoruma değil, iki
 * çıktının derin eşitliğine bakılarak yanıtlanır.
 * ════════════════════════════════════════════════════════════════════════ */
console.log("\n— Faz 5: yeni sinyaller —");

/** Env'i bilinen bir hâle getirir: canlı anahtarlar KAPALI, gölge İSTEĞE bağlı. */
function setSignalEnv(opts: { live?: Phase5SignalKey[]; shadow?: Phase5SignalKey[] }) {
  for (const k of PHASE5_SIGNAL_KEYS) {
    delete process.env[PHASE5_SIGNAL_ENV[k].live];
    delete process.env[PHASE5_SIGNAL_ENV[k].shadow];
  }
  for (const k of opts.live ?? []) process.env[PHASE5_SIGNAL_ENV[k].live] = "1";
  // Gölge varsayılanı zaten AÇIK; kapatmak için açıkça "0" yazılır.
  for (const k of PHASE5_SIGNAL_KEYS) {
    if (!(opts.shadow ?? PHASE5_SIGNAL_KEYS).includes(k)) {
      process.env[PHASE5_SIGNAL_ENV[k].shadow] = "0";
    }
  }
}
function clearSignalEnv() {
  for (const k of PHASE5_SIGNAL_KEYS) {
    delete process.env[PHASE5_SIGNAL_ENV[k].live];
    delete process.env[PHASE5_SIGNAL_ENV[k].shadow];
  }
}

// ─── Varsayılanlar: canlı KAPALI, gölge AÇIK ─────────────────────
clearSignalEnv();
check(
  "varsayılanda HİÇBİR sinyal canlı skora girmez",
  PHASE5_SIGNAL_KEYS.every((k) => liveSignalSet()[k] === false),
  JSON.stringify(liveSignalSet())
);
check(
  "varsayılanda HER sinyal gölgede ölçülür",
  PHASE5_SIGNAL_KEYS.every((k) => shadowSignalSet()[k] === true)
);
check("signalsForProfile('live') varsayılanda boş", !anySignalOn(signalsForProfile("live")));
check("signalsForProfile('shadow') varsayılanda dolu", anySignalOn(signalsForProfile("shadow")));
check("NO_SIGNALS donmuş (kazara true yazılamaz)", Object.isFrozen(NO_SIGNALS));
check(
  "her sinyalin Türkçe etiketi var",
  PHASE5_SIGNAL_KEYS.every((k) => (PHASE5_SIGNAL_LABELS_TR[k] ?? "").trim().length > 0)
);
check(
  "her sinyalin AYRI canlı ve gölge anahtarı var",
  new Set(
    PHASE5_SIGNAL_KEYS.flatMap((k) => [
      PHASE5_SIGNAL_ENV[k].live,
      PHASE5_SIGNAL_ENV[k].shadow,
    ])
  ).size ===
    PHASE5_SIGNAL_KEYS.length * 2
);
check("gölge kaydı varsayılanda açık", isPhase5ShadowEnabled());
process.env.MFG_PHASE5_SHADOW = "0";
check("gölge kaydı tek anahtarla kapanır", !isPhase5ShadowEnabled());
delete process.env.MFG_PHASE5_SHADOW;

// Anahtar okuması KATI: tanınmayan değer varsayılana düşer, "açık" saymaz.
process.env[PHASE5_SIGNAL_ENV.strikes.live] = "evet";
check("canlı anahtar tanınmayan değerde AÇILMAZ", liveSignalSet().strikes === false);
process.env[PHASE5_SIGNAL_ENV.strikes.live] = "true";
check("canlı anahtar açıkça 'true' ile açılır", liveSignalSet().strikes === true);
clearSignalEnv();

// ─── Ağırlıklar ve damga ─────────────────────────────────────────
const p5Sum = Object.values(PHASE5_WEIGHTS).reduce((a, b) => a + b, 0);
check("Faz 5 ağırlıkları 1.0 toplar", Math.abs(p5Sum - 1) < 0.0001, `actual: ${p5Sum}`);
check(
  "zamanında teslim gölgede GERÇEKTEN ağırlık taşır (canlı v1'de 0)",
  PHASE5_WEIGHTS.onTimeDelivery > 0 && V1_WEIGHTS.onTimeDelivery === 0
);
check(
  "onTime sinyali KAPALIYKEN gölge, canlının ağırlıklarını aynen kullanır",
  phase5Weights({ ...NO_SIGNALS }, V1_WEIGHTS) === V1_WEIGHTS
);
check(
  "onTime sinyali AÇIKKEN gölge yeni ağırlık kümesine geçer",
  phase5Weights({ ...NO_SIGNALS, onTime: true }, V1_WEIGHTS) === PHASE5_WEIGHTS
);
check(
  "Faz 5 damgası canlı ve mesafe damgalarından AYRI",
  new Set([
    weightsVersion("v1"),
    weightsVersion("v2"),
    weightsVersion("v3"),
    PHASE5_WEIGHTS_VERSION,
  ]).size === 4
);
check(
  "Faz 5 gölgesi CANLIYLA AYNI mesafe modelini kullanır (tek değişken kalsın)",
  PHASE5_DISTANCE_MODEL === getDistanceModel("v1")
);

// ─── Kapasite birimi: TEK kural ──────────────────────────────────
check(
  "ağırlıklı yük kuralı Faz 4'ünkiyle AYNI FONKSİYON (ikinci kopya yok)",
  manufacturerLoadUnits === painterLoadUnits
);
check(
  "1 adet → 1 birim, 20 adet → 2, 60 adet → 4 (sahibin kuralı)",
  manufacturerLoadUnits(1) === 1 &&
    manufacturerLoadUnits(19) === 1 &&
    manufacturerLoadUnits(20) === 2 &&
    manufacturerLoadUnits(60) === 4
);

// ─── Saf ceza matematiği ─────────────────────────────────────────
const ALL_ON = Object.fromEntries(
  PHASE5_SIGNAL_KEYS.map((k) => [k, true])
) as Record<Phase5SignalKey, boolean>;

check(
  "sinyaller kapalıyken güvenilirlik TABANI aynen geçer",
  applyReliabilityPenalties(70, { jobs: 10, rejectedJobs: 10, strikeCount: 3 }, NO_SIGNALS)
    .score === 70
);
check(
  "QC reddi güvenilirliği oranla düşürür",
  applyReliabilityPenalties(100, { jobs: 10, rejectedJobs: 5, strikeCount: 0 }, ALL_ON)
    .qcPenalty === Math.round(0.5 * QC_REJECTION_PENALTY_MAX)
);
check(
  `QC cezası ${PHASE5_MIN_HISTORY_SAMPLES} örneğin altında YAZILMAZ (yeni atölye cezalandırılmaz)`,
  applyReliabilityPenalties(100, { jobs: 2, rejectedJobs: 2, strikeCount: 0 }, ALL_ON)
    .qcPenalty === 0
);
check(
  "ceza puanı sabit düşer ve TAVANI var",
  applyReliabilityPenalties(100, { jobs: 0, rejectedJobs: 0, strikeCount: 1 }, ALL_ON)
    .strikePenalty === STRIKE_PENALTY_PER &&
    applyReliabilityPenalties(100, { jobs: 0, rejectedJobs: 0, strikeCount: 99 }, ALL_ON)
      .strikePenalty === STRIKE_PENALTY_CAP
);
check(
  "güvenilirlik 0'ın altına inmez",
  applyReliabilityPenalties(10, { jobs: 10, rejectedJobs: 10, strikeCount: 9 }, ALL_ON)
    .score === 0
);
check(
  "boyamasız siparişte 'kendi boyuyor' bir üstünlük DEĞİLDİR",
  paintInHouseBonus(ALL_ON, { orderNeedsPainting: false, paintsInHouse: true }) === 0
);
check(
  "boyamalı siparişte kendi boyayan atölye bonus alır",
  paintInHouseBonus(ALL_ON, { orderNeedsPainting: true, paintsInHouse: true }) ===
    PAINT_IN_HOUSE_BONUS
);
check(
  "sinyal kapalıyken bonus tam olarak 0",
  paintInHouseBonus(NO_SIGNALS, { orderNeedsPainting: true, paintsInHouse: true }) === 0
);

/* ──────────────────────────────────────────────────────────────────────────
 * PARA KORUMASI — bu fazın ASIL çivisi.
 *
 * Bütün GÖLGE anahtarları AÇIKken canlı sıralamanın çıktısı, hiç sinyal
 * olmadığındakiyle ALAN ALAN aynı olmak zorunda. Bu kontrol düşerse bir sinyal
 * canlı skor yoluna sızmış demektir — yani partner geliri, kimse karar
 * vermeden oynamıştır.
 * ────────────────────────────────────────────────────────────────────────── */
const mfgRow = (over: Partial<ManufacturerScoringRow> = {}): ManufacturerScoringRow => ({
  manufacturerId: "m-a",
  companyName: "Atölye A",
  il: "İstanbul",
  ilce: null,
  phone: null,
  email: "a@example.com",
  iban: "TR000000000000000000000000",
  capabilities: null,
  coverageProvinces: null,
  requiresManualTaxReview: false,
  acceptingOrders: true,
  paintsInHouse: false,
  strikeCount: 0,
  maxConcurrentOrders: 5,
  currentLoad: 1,
  loadUnits: 1,
  loadUnitsMeasured: true,
  reliability: 80,
  onTimeDelivery: 90,
  qcJobs: 0,
  qcRejectedJobs: 0,
  sameProductUnits: 0,
  ...over,
});

// Her sinyalin gerçekten OYNAYACAĞI bir aday havuzu: biri kendi boyuyor, biri
// QC'den dönüyor, biri cezalı, biri adet ağırlıklı yüzünden doluyor, biri büyük
// format beyan etmemiş.
const POOL: ManufacturerScoringRow[] = [
  mfgRow({ manufacturerId: "m-a", companyName: "A", paintsInHouse: true }),
  mfgRow({ manufacturerId: "m-b", companyName: "B", qcJobs: 10, qcRejectedJobs: 6 }),
  mfgRow({ manufacturerId: "m-c", companyName: "C", strikeCount: 2 }),
  mfgRow({
    manufacturerId: "m-d",
    companyName: "D",
    currentLoad: 1,
    loadUnits: 6,
    maxConcurrentOrders: 5,
  }),
  // YÖNLENDİRME etiketi taşıyor (style_*), yani "değerlendirilmiş" atölye:
  // large_format beyan etmediği için büyük format işi ona GİTMEZ. Yalnız
  // `material_*` taşısaydı K2'nin istisnası gereği muaf olurdu — testin bu
  // ayrımı bilerek kurması gerekiyor, yoksa kuralın yanlış yarısını doğrular.
  mfgRow({
    manufacturerId: "m-e",
    companyName: "E",
    capabilities: ["material_resin", "style_anime"],
  }),
];
// `standart` preset 150 mm ≥ 120 mm → büyük format ISTER (services/capability.ts).
const PAINT_ORDER: ManufacturerScoringOrder = {
  city: "İstanbul",
  material: "resin",
  needsPainting: true,
  style: "realistic",
  figurineSize: "standart",
};
const scoreWith = (signals: Parameters<typeof scoreManufacturers>[0]["signals"]) =>
  scoreManufacturers({
    order: PAINT_ORDER,
    manufacturers: POOL,
    weights: V1_WEIGHTS,
    distanceModel: "tiered",
    signals,
    // Kuralın TEK sahibi K2'nin saf fonksiyonu; test kendi kopyasını yazmaz.
    largeFormatBlocked: largeFormatPlacementBlocked,
  });

const BASELINE = JSON.stringify(scoreWith(undefined));

// (a) Bütün gölge anahtarları açık, canlı anahtarların hiçbiri açık değil.
setSignalEnv({ live: [], shadow: [...PHASE5_SIGNAL_KEYS] });
check(
  "PARA KORUMASI: gölge anahtarlarının hepsi AÇIKken canlı skor DEĞİŞMEZ",
  JSON.stringify(scoreWith(signalsForProfile("live"))) === BASELINE
);
// (b) Sinyal başına tek tek — biri sızarsa hangisi olduğu isimle görünsün.
for (const key of PHASE5_SIGNAL_KEYS) {
  setSignalEnv({ live: [], shadow: [key] });
  check(
    `PARA KORUMASI: '${key}' yalnız gölgede açıkken canlı skor değişmez`,
    JSON.stringify(scoreWith(signalsForProfile("live"))) === BASELINE
  );
}
// (c) DENETLEYİCİ KÖRELMEMİŞ: aynı sinyaller gölge yolunda çalıştırıldığında
//     sonuç GERÇEKTEN değişmeli. Değişmiyorsa yukarıdaki (a)/(b) kontrolleri
//     boş yere yeşil yanıyor demektir (sinyal hiç bağlanmamış olabilir).
setSignalEnv({ live: [], shadow: [...PHASE5_SIGNAL_KEYS] });
check(
  "denetleyici körelmemiş: aynı sinyaller GÖLGE yolunda sonucu değiştirir",
  JSON.stringify(scoreWith(signalsForProfile("shadow"))) !== BASELINE
);
// (d) Sinyal başına: gölgede açıldığında ölçülebilir bir etkisi var mı?
const EFFECTIVE: Phase5SignalKey[] = [
  "paintInHouse",
  "qcRejections",
  "strikes",
  "weightedLoad",
  "largeFormat",
];
for (const key of EFFECTIVE) {
  setSignalEnv({ live: [], shadow: [key] });
  check(
    `'${key}' gölgede açıldığında sıralamayı gerçekten etkiler (ölü sinyal değil)`,
    JSON.stringify(scoreWith(signalsForProfile("shadow"))) !== BASELINE
  );
}
// (e) CANLI anahtar açıldığında canlı skor DEĞİŞİR — koruma "her şeyi dondur"
//     değil, "yalnız izin verilmeden değişmesin" demek.
setSignalEnv({ live: ["strikes"], shadow: [] });
check(
  "canlı anahtar bilinçli açıldığında canlı skor değişir (koruma vakum değil)",
  JSON.stringify(scoreWith(signalsForProfile("live"))) !== BASELINE
);
clearSignalEnv();

// ─── Sinyallerin ANLAMI doğru mu ─────────────────────────────────
{
  const on = scoreWith(ALL_ON);
  const byId = new Map(on.map((c) => [c.manufacturerId, c]));
  check(
    "ağırlıklı yük sınırı aşan atölye gölgede ELENİR",
    byId.get("m-d")?.eligible === false &&
      byId.get("m-d")?.ineligibleReason === "Kapasite dolu"
  );
  check(
    "büyük format beyan etmemiş atölye gölgede ELENİR",
    byId.get("m-e")?.eligible === false &&
      byId.get("m-e")?.ineligibleReason === "Büyük format yeteneği beyan edilmemiş"
  );
  check(
    "QC reddi olan atölyenin güvenilirliği düşer",
    (byId.get("m-b")?.scores.reliability ?? 100) < 80
  );
  check(
    "cezalı atölyenin güvenilirliği düşer",
    (byId.get("m-c")?.scores.reliability ?? 100) < 80
  );
  check(
    "kendi boyayan atölye boyamalı siparişte gerekçe rozeti alır",
    byId.get("m-a")?.reasons.includes("Kendi boyuyor") === true
  );
  check(
    "açıklama alanı yalnız sinyaller açıkken dolar",
    !!byId.get("m-a")?.shadow &&
      scoreWith(undefined).every((c) => c.shadow === undefined)
  );
  check(
    "açıklama, yürürlükteki sinyalleri adıyla taşır",
    (byId.get("m-a")?.shadow?.signals.length ?? 0) === PHASE5_SIGNAL_KEYS.length
  );
  check(
    "ölçülemeyen ağırlıklı yük DÜRÜSTÇE işaretlenir",
    scoreManufacturers({
      order: PAINT_ORDER,
      manufacturers: [mfgRow({ loadUnitsMeasured: false })],
      weights: V1_WEIGHTS,
      distanceModel: "tiered",
      signals: ALL_ON,
    })[0]?.shadow?.loadUnitsMeasured === false
  );
  check(
    "büyük format kuralı TAKILI DEĞİLSE sinyal susar (kimse elenmez)",
    scoreManufacturers({
      order: PAINT_ORDER,
      manufacturers: POOL,
      weights: V1_WEIGHTS,
      distanceModel: "tiered",
      signals: ALL_ON,
    }).every((c) => c.ineligibleReason !== "Büyük format yeteneği beyan edilmemiş")
  );
  check(
    "yalnız malzeme etiketi olan atölye büyük formatta ELENMEZ (K2 istisnası)",
    scoreWith(ALL_ON).find((c) => c.manufacturerId === "m-b")?.ineligibleReason !==
      "Büyük format yeteneği beyan edilmemiş"
  );
  check(
    "kapsama kaynağı damgalanır (fiş takılı değilse 'typed')",
    byId.get("m-a")?.shadow?.coverageSource === "typed"
  );
  check(
    "hesaplanan kapsama fişi takılınca kaynak 'computed' olur",
    scoreManufacturers({
      order: PAINT_ORDER,
      manufacturers: [mfgRow()],
      weights: V1_WEIGHTS,
      distanceModel: "tiered",
      signals: ALL_ON,
      coverageOf: () => ["Ankara"],
    })[0]?.shadow?.coverageSource === "computed"
  );
}

// ─── Farkın AÇIKLAMASI ───────────────────────────────────────────
{
  const live = scoreWith(undefined);
  const shadow = scoreWith(ALL_ON);
  const cmp = explainShadowDivergence(live, shadow, ALL_ON);
  check("karşılaştırma her aday için satır üretir", cmp.deltas.length === POOL.length);
  check(
    "en çok oynayan aday üstte",
    cmp.deltas.every((d, i) =>
      i === 0
        ? true
        : Math.abs(d.delta ?? 0) <= Math.abs(cmp.deltas[i - 1].delta ?? 0)
    )
  );
  check(
    "gölgede elenen aday GEREKÇESİYLE görünür",
    cmp.deltas
      .find((d) => d.manufacturerId === "m-d")
      ?.reasons.some((r) => r.includes("Gölgede ELENİYOR")) === true
  );
  check("özet cümlesi Türkçe ve dolu", cmp.summaryTr.trim().length > 20);
  check("yürürlükteki sinyaller karşılaştırmada taşınır", cmp.signals.length > 0);

  // ── P5B-04: DÖKÜM TEK BİRİMDE VE TAM TOPLANIR ────────────────────
  // Regresyon nöbetçisi. Gerekçeler eskiden İKİ birimi yan yana yazıyordu:
  // bonus TOPLAM puandaydı ("Kendi boyuyor +4"), yük/zamanında teslim/mesafe
  // ise ALT SKOR farkındaydı ("Ağırlıklı yük +5" — toplamdaki karşılığı ~1,4
  // puan). Rakamlar toplanmıyordu; ağırlık kümesi değişiminin payı hiç
  // yazılmadığı için puanı ARTAN bir adayın tek gerekçesi EKSİ görünebiliyordu.
  // Doğrulanan şey ekranda GÖRÜNEN metnin kendisi: sözleşme "admin bunları
  // toplayıp aynı sonuca varabilmeli" olduğuna göre, ayrıştırılacak olan da
  // admin'in okuduğu satırlar olmalı.
  const reasonTenths = (reason: string): number | null => {
    const m = reason.match(/([+−])(\d+)(?:,(\d))? puan/);
    if (!m) return null;
    return (Number(m[2]) * 10 + Number(m[3] ?? 0)) * (m[1] === "−" ? -1 : 1);
  };
  const pointTenths = (d: { reasons: string[] }) =>
    d.reasons.map(reasonTenths).filter((t): t is number => t !== null);
  const sumTenths = (d: { reasons: string[] }) =>
    pointTenths(d).reduce((a, b) => a + b, 0);
  const unbalanced = cmp.deltas.filter(
    (d) => d.delta !== null && sumTenths(d) !== Math.round(d.delta * 10)
  );
  check(
    "gerekçelerin puanları gösterilen farkı TAM toplar (tek birim: puan)",
    unbalanced.length === 0,
    unbalanced
      .map((d) => `${d.companyName}: fark ${d.delta}, satırlar ${sumTenths(d) / 10}`)
      .join(" | ")
  );
  check(
    "puanı ARTAN adayın gerekçeleri yalnız EKSİ olamaz",
    cmp.deltas.every(
      (d) => d.delta === null || d.delta <= 0 || pointTenths(d).some((t) => t > 0)
    )
  );
  check(
    "ağırlık kümesi değişiminin payı KENDİ satırını yazar",
    cmp.deltas.some((d) => d.reasons.some((r) => r.startsWith("Ağırlık kümesi")))
  );
  // Puan taşımayan satır (uygunluk, "ölçülemedi") çıplak rakam da taşımamalı:
  // karışık birim tam olarak oradan sızıyordu.
  check(
    "puansız gerekçe satırında çıplak ±rakam kalmaz",
    cmp.deltas.every((d) =>
      d.reasons.every((r) => reasonTenths(r) !== null || !/[+−]\d/.test(r))
    )
  );
  // Ağırlık kümesi canlıyla AYNIYSA (onTime sinyali kapalı) kalem payları
  // ayrıştırılamaz: canlının ağırlıkları açıklayıcıya geçmiyor. O hâlde
  // uydurulmuş pay YAZILMAZ — tek puan satırı yazılır ve o da toplamın kendisi.
  const OTD_OFF = { ...ALL_ON, onTime: false };
  const cmpNoOtd = explainShadowDivergence(live, scoreWith(OTD_OFF), OTD_OFF);
  check(
    "ağırlık kümesi aynıyken tek puan satırı yazılır, o da toplamdır",
    cmpNoOtd.deltas.every((d) => {
      const t = pointTenths(d);
      if (d.delta === null) return true;
      if (d.delta === 0) return t.length === 0;
      return t.length === 1 && t[0] === Math.round(d.delta * 10);
    })
  );
  const same = explainShadowDivergence(live, live, NO_SIGNALS);
  check("aynı iki sıralamada 'fark yok' denir", same.differs === false);
  check(
    "fark yokken özet bunu açıkça söyler",
    same.summaryTr.includes("Yeni sinyaller kazananı değiştirmiyor")
  );
  const none = explainShadowDivergence([], [], NO_SIGNALS);
  check(
    "iki tarafta da aday yoksa uydurma bir kazanan yazılmaz",
    none.liveWinnerId === null && none.shadowWinnerId === null && !none.differs
  );
}

// ─── Gölge hattı: yapısal kilitler ───────────────────────────────
// Faz 5 sıralaması HİÇBİR ZAMAN otorite olamaz ve salt-okunur önizleme
// HİÇBİR ZAMAN kayıt yazamaz. İkisi de "yanlışlıkla" bozulabilecek şeyler.
check(
  "Faz 5 gölgesi ayrı bir damgayla kaydedilir",
  shadowSrc.includes("rowWeightsVersion: PHASE5_WEIGHTS_VERSION")
);
check(
  "Faz 5 satırında canlı taraf profilin KENDİ sütununda durur (okuyucuyla uyumlu)",
  /rowWeightsVersion: PHASE5_WEIGHTS_VERSION,[\s\S]{0,400}?livePlacement: "profile"/.test(
    shadowSrc
  )
);
check(
  "Faz 5 satırı yürürlükteki sinyalleri damgalar",
  /signals: activeSignals\(ranked\.phase5Signals\)/.test(shadowSrc)
);
check(
  "otorite hâlâ YALNIZ v1/v2 arasından seçilir (Faz 5 otorite olamaz)",
  /const authoritativeProfile: ScoringProfile = useV2 \? "v2" : "v1";/.test(shadowSrc)
);
check(
  "gölge sıralaması hiçbir yerde döndürülen CANLI listeye karışmaz",
  /return authoritative;/.test(shadowSrc) && !/return .*phase5Shadow;/.test(shadowSrc)
);
check(
  "salt-okunur Faz 5 önizlemesi var",
  shadowSrc.includes("export async function rankForOrderShadowPreview(")
);
check(
  "Faz 5 önizlemesi kayıt makinesine hiç girmez",
  !/export async function rankForOrderShadowPreview\([\s\S]*?\n}/
    .exec(shadowSrc)![0]
    .includes("stashPending")
);
check(
  "gölge bağlamı hata durumunda atamayı DÜŞÜRMEZ (asla fırlatmaz)",
  /async function phase5Context\(\)[\s\S]*?catch \(err\)[\s\S]*?phase5Ctx = \{\};/.test(
    shadowSrc
  )
);

// Sıralayıcı env OKUMAZ: sinyalleri yalnız verilen kümeden alır. Bu kilit,
// "kapalı bir bayrak canlı skora sızdı" hatasının en olası yolunu kapatır.
const rankerSrc = fs.readFileSync(
  path.join(__dirname, "../src/lib/services/manufacturer-assignment.ts"),
  "utf8"
);
check(
  "sıralayıcı sinyal anahtarlarını KENDİ okumaz (process.env yok)",
  !/process\.env\.MFG_SIGNAL/.test(rankerSrc)
);
check(
  "sıralayıcı ağırlıklı yükü KENDİ hesaplamaz (tek ölçü dışarıdan gelir)",
  !/painterLoadUnits\(|1 \+ Math\.floor\(/.test(rankerSrc)
);
check(
  "sıralayıcı kapsama hesabının İKİNCİ bir kopyasını taşımaz",
  !/computeCoveragePlan\(/.test(rankerSrc)
);

// ─── Summary ─────────────────────────────────────────────────────
console.log(`\n${pass}/${pass + fail} scoring-v2 checks passed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
