// Boyacı sıralaması (Phase 4) — SAF mantık testleri. DB YOK, Redis YOK.
//
// Kapsam:
//  1. Ağırlıklar + sürüm damgası + kapasite birimi (config/painter-scoring.ts).
//  2. Rota eğrisi: GERÇEK il çiftleri, iki bacak, ve üretici sıralayıcısındaki
//     sürekli mesafe eğrisiyle PARİTE (eğrinin kopyası olduğu için tripwire).
//  3. Alt skorların sınırları ve nötr varsayılanları.
//  4. Sıralama senaryoları: boştaki UZAK boyacı ile meşgul YAKIN boyacı, her
//     uygunsuzluk sebebi, ve sıranın kararlılığı.
//  5. Kaynak taraması: boyacı rotalarının yazdığı HER eylem dizesi güvenilirlik
//     sözlüğünde sınıflanmış mı (üretici tarafında bir kez yanlış yazılmış ve
//     iyi sayaç sessizce hep 0 kalmıştı).
//
// Çalıştırma: npx tsx scripts/test-painter-scoring.ts

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  PAINTER_AUTO_ASSIGNED_ACTION,
  PAINTER_BAD_ACTIONS,
  PAINTER_GOOD_ACTIONS,
  PAINTER_MIN_HISTORY_SAMPLES,
  PAINTER_NEUTRAL_ACTIONS,
  PAINTER_NEUTRAL_HISTORY_SCORE,
  PAINTER_SLA_TIMEOUT_ACTION,
  PAINTER_UNITS_PER_EXTRA_SLOT,
  PAINTER_WEIGHTS,
  PAINTER_WEIGHTS_BASE_VERSION,
  PAINTER_WEIGHT_ENV,
  PAINT_TURNAROUND_TARGET_DAYS,
  ROUTE_NEAR_UNITS,
  ROUTE_UNKNOWN_SCORE,
  getPainterWeights,
  painterLoadUnits,
  painterWeightsVersion,
  type PainterScoringWeights,
} from "../src/lib/config/painter-scoring";
import {
  PAINTER_EXCLUDED_THIS_ATTEMPT_REASON,
  painterLoadScore,
  onTimeScore,
  qcQualityScore,
  reliabilityScore,
  routeLegScore,
  routeScore,
  scorePainters,
  weightedPainterTotal,
  type PainterScoringRow,
} from "../src/lib/services/painter-assignment";
import {
  PARTNER_MODEL_ACK_ACTION,
  PARTNER_MODEL_REVISION_ACTION,
} from "../src/lib/config/partner-model-ack";
// DB gerekmez: bu modül @/lib/db'yi import eder ama yüklenirken sorgu açmaz
// (scripts/test-province-distance.ts da aynısını yapıyor).
import { distanceScoreContinuous } from "../src/lib/services/manufacturer-assignment";
import { provinceDistanceUnits } from "../src/lib/data/province-distance";

const ROOT = join(import.meta.dirname, "..");

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name} — ${msg}`);
    console.log(`✗ ${name} — ${msg}`);
  }
}

// ─── 1. Ağırlıklar ve sürüm ─────────────────────────────────────────────────
console.log("\nağırlıklar + sürüm");

for (const name of Object.values(PAINTER_WEIGHT_ENV)) delete process.env[name];

check("varsayılan ağırlıklar planın başlangıç değerleri", () => {
  assert.equal(PAINTER_WEIGHTS.route, 0.35);
  assert.equal(PAINTER_WEIGHTS.load, 0.3);
  assert.equal(PAINTER_WEIGHTS.reliability, 0.15);
  assert.equal(PAINTER_WEIGHTS.qcQuality, 0.15);
  assert.equal(PAINTER_WEIGHTS.onTime, 0.05);
});

check("ağırlıklar 1.0'a toplanır (tüketici normalize etmez)", () => {
  // HER ağırlık toplanır, elle yazılmış bir liste değil: altıncı bir ağırlık
  // eklendiğinde elle yazılmış toplam yeşil kalır, gerçek toplam kayardı.
  const total = Object.values(getPainterWeights()).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 0.0001, `toplam ${total}`);
});

check("her ağırlığın env karşılığı var ve okunuyor", () => {
  for (const [key, env] of Object.entries(PAINTER_WEIGHT_ENV)) {
    process.env[env] = "0.99";
    const tuned = getPainterWeights();
    delete process.env[env];
    assert.equal(tuned[key as keyof PainterScoringWeights], 0.99, key);
  }
});

check("geçersiz env değeri varsayılana düşer (negatif ağırlık olamaz)", () => {
  process.env[PAINTER_WEIGHT_ENV.route] = "-1";
  assert.equal(getPainterWeights().route, PAINTER_WEIGHTS.route);
  process.env[PAINTER_WEIGHT_ENV.route] = "abc";
  assert.equal(getPainterWeights().route, PAINTER_WEIGHTS.route);
  delete process.env[PAINTER_WEIGHT_ENV.route];
});

check("ayarsız sürüm sabit, ayarlı sürüm '+env' ile damgalanır", () => {
  assert.equal(painterWeightsVersion(), PAINTER_WEIGHTS_BASE_VERSION);
  process.env[PAINTER_WEIGHT_ENV.load] = "0.4";
  assert.equal(painterWeightsVersion(), `${PAINTER_WEIGHTS_BASE_VERSION}+env`);
  delete process.env[PAINTER_WEIGHT_ENV.load];
  assert.equal(painterWeightsVersion(), PAINTER_WEIGHTS_BASE_VERSION);
});

// ─── 2. Kapasite birimi ─────────────────────────────────────────────────────
console.log("\nkapasite birimi (sipariş başına 1 + her 20 adette 1)");

check("tekil sipariş 1 birim, 20 adet 2, 60 adet 4", () => {
  assert.equal(painterLoadUnits(1), 1);
  assert.equal(painterLoadUnits(19), 1);
  assert.equal(painterLoadUnits(PAINTER_UNITS_PER_EXTRA_SLOT), 2);
  assert.equal(painterLoadUnits(39), 2);
  assert.equal(painterLoadUnits(40), 3);
  assert.equal(painterLoadUnits(60), 4);
});

check("bozuk/eksik adet en az 1 birim sayılır", () => {
  assert.equal(painterLoadUnits(0), 1);
  assert.equal(painterLoadUnits(null), 1);
  assert.equal(painterLoadUnits(undefined), 1);
  assert.equal(painterLoadUnits(Number.NaN), 1);
  assert.equal(painterLoadUnits(-5), 1);
});

check("kapasite kuralı monoton: adet arttıkça birim azalmaz", () => {
  let prev = 0;
  for (let q = 1; q <= 200; q++) {
    const now = painterLoadUnits(q);
    assert.ok(now >= prev, `adet ${q}: ${now} < ${prev}`);
    prev = now;
  }
});

// ─── 3. Rota ────────────────────────────────────────────────────────────────
console.log("\nrota (iki kargo bacağı)");

// Gerçek il çiftleri (çapa mesafeleri, harita birimi ≈ 1.5 km):
//   İstanbul–Ankara 230.4 | Kocaeli–Düzce 68.9 | İstanbul–Bursa 78.5
//   Ankara–Van 588.6 | Edirne–Hakkari 948.5 (yurt içi en uzak çift)
const REAL_PAIRS: [string, string][] = [
  ["İstanbul", "Ankara"],
  ["Kocaeli", "Düzce"],
  ["İstanbul", "Bursa"],
  ["Ankara", "Van"],
  ["Edirne", "Hakkari"],
  ["İzmir", "Muğla"],
  ["İstanbul", "Gaziantep"],
];

check("tek bacak, üretici sıralayıcısının sürekli eğrisiyle BİREBİR aynı", () => {
  // Eğri burada KOPYA (saf yarı @/lib/db'ye bağlanamaz). Kopyanın bedeli bu
  // testtir: biri kayarsa burada düşer.
  for (const [a, b] of REAL_PAIRS) {
    const mine = routeLegScore(a, b);
    const theirs = distanceScoreContinuous(a, b, null);
    assert.equal(mine.score, theirs.score, `${a}→${b}`);
    assert.equal(mine.units, provinceDistanceUnits(a, b), `${a}→${b} birim`);
  }
});

check("aynı il 100, tanınmayan il nötr (ne 0 ne 100)", () => {
  assert.equal(routeLegScore("İstanbul", "istanbul").score, 100);
  assert.equal(routeLegScore("İstanbul", "Atlantis").score, ROUTE_UNKNOWN_SCORE);
  assert.equal(routeLegScore(null, "İstanbul").score, ROUTE_UNKNOWN_SCORE);
  assert.equal(routeLegScore("İstanbul", null).units, null);
});

check("mesafe arttıkça bacak skoru azalır (gerçek çiftlerle)", () => {
  const ordered = ["Kocaeli", "Bursa", "Ankara", "Gaziantep", "Hakkari"];
  let prev = 101;
  for (const il of ordered) {
    const score = routeLegScore("İstanbul", il).score;
    assert.ok(score < prev, `İstanbul→${il}: ${score} >= ${prev}`);
    prev = score;
  }
});

check("İKİ bacak da sayılır: müşteriye yakın ama üreticiden uzak boyacı kaybeder", () => {
  // Üretici İstanbul, müşteri İstanbul.
  const both = routeScore("İstanbul", "İstanbul", "İstanbul");
  const farFromMfg = routeScore("İstanbul", "Hakkari", "İstanbul");
  // Tek bacağa (teslim) baksaydık Hakkari'deki boyacı da teslimde 30 alırdı;
  // asıl nokta devir bacağının da ölçülmesi: skor iki taraftan birden düşer.
  assert.equal(both.score, 100);
  assert.ok(farFromMfg.score < 40, `uzak boyacı ${farFromMfg.score}`);
  assert.ok(farFromMfg.handoff.score < 30 + 1);
  assert.ok(farFromMfg.delivery.score < 30 + 1);
});

check("iki bacak eşit ağırlıklı: ortalama alınır", () => {
  const v = routeScore("İstanbul", "Bursa", "İstanbul");
  const leg = routeLegScore("İstanbul", "Bursa").score;
  assert.equal(v.score, Math.round(leg * 0.5 + leg * 0.5));
  const mixed = routeScore("İstanbul", "İstanbul", "Ankara");
  assert.equal(
    mixed.score,
    Math.round(100 * 0.5 + routeLegScore("İstanbul", "Ankara").score * 0.5)
  );
});

// ─── 4. Alt skorlar ─────────────────────────────────────────────────────────
console.log("\nalt skorlar");

check("yük skoru: boş 100, dolu 0, aşan 0", () => {
  assert.equal(painterLoadScore(0, 5), 100);
  assert.equal(painterLoadScore(3, 5), 40);
  assert.equal(painterLoadScore(5, 5), 0);
  assert.equal(painterLoadScore(9, 5), 0);
  assert.equal(painterLoadScore(0, 0), 0);
});

check("güvenilirlik: kayıt yoksa nötr, iyi/kötü oranı", () => {
  assert.equal(reliabilityScore({ good: 0, bad: 0 }), PAINTER_NEUTRAL_HISTORY_SCORE);
  assert.equal(reliabilityScore({ good: 10, bad: 0 }), 100);
  assert.equal(reliabilityScore({ good: 5, bad: 5 }), 50);
  assert.equal(reliabilityScore({ good: 0, bad: 3 }), 0);
});

check("QC kalitesi: az örnekte nötr, yeniden yapılan iş oranı", () => {
  assert.equal(
    qcQualityScore({ jobs: PAINTER_MIN_HISTORY_SAMPLES - 1, reworkJobs: 1 }),
    PAINTER_NEUTRAL_HISTORY_SCORE
  );
  assert.equal(qcQualityScore({ jobs: 10, reworkJobs: 0 }), 100);
  assert.equal(qcQualityScore({ jobs: 10, reworkJobs: 5 }), 50);
  assert.equal(qcQualityScore({ jobs: 10, reworkJobs: 10 }), 0);
});

check("zamanında teslim: hedefte 100, iki katında 0, az örnekte nötr", () => {
  const T = PAINT_TURNAROUND_TARGET_DAYS;
  assert.equal(onTimeScore([]), PAINTER_NEUTRAL_HISTORY_SCORE);
  assert.equal(onTimeScore([T, T]), PAINTER_NEUTRAL_HISTORY_SCORE);
  assert.equal(onTimeScore([T, T, T]), 100);
  assert.equal(onTimeScore([T / 2, T / 2, T / 2]), 100);
  assert.equal(onTimeScore([2 * T, 2 * T, 2 * T]), 0);
  assert.equal(onTimeScore([1.5 * T, 1.5 * T, 1.5 * T]), 50);
});

// ─── 5. Sıralama senaryoları ────────────────────────────────────────────────
console.log("\nsıralama");

function row(over: Partial<PainterScoringRow> & { painterId: string }): PainterScoringRow {
  return {
    companyName: `Atölye ${over.painterId}`,
    il: null,
    status: "active",
    acceptingOrders: true,
    maxConcurrentOrders: 5,
    loadUnits: 0,
    iban: "TR000000000000000000000000",
    reliability: { good: 0, bad: 0 },
    qcQuality: { jobs: 0, reworkJobs: 0 },
    onTimeSpansDays: [],
    ...over,
  };
}

const IST_ORDER = { manufacturerIl: "İstanbul", customerIl: "İstanbul" };

check("meşgul YAKIN boyacı, boştaki UZAK boyacıyı geçer", () => {
  const out = scorePainters({
    order: IST_ORDER,
    painters: [
      row({ painterId: "yakin", il: "İstanbul", loadUnits: 3 }),
      row({ painterId: "uzak", il: "Van", loadUnits: 0 }),
    ],
  });
  assert.equal(out[0].painterId, "yakin", JSON.stringify(out.map((c) => [c.painterId, c.score])));
  assert.ok(out[0].score > out[1].score);
});

check("yakın boyacı DOLUYSA uygunsuzdur; iş boştaki uzak boyacıya gider", () => {
  const out = scorePainters({
    order: IST_ORDER,
    painters: [
      row({ painterId: "yakin", il: "İstanbul", loadUnits: 5 }),
      row({ painterId: "uzak", il: "Van", loadUnits: 0 }),
    ],
  });
  assert.equal(out[0].painterId, "uzak");
  assert.equal(out[1].eligible, false);
  assert.equal(out[1].ineligibleReason, "Kapasite dolu");
});

check("kapasite hâlâ konuşur: neredeyse dolu yerel, boştaki ORTA mesafeyi kaybeder", () => {
  const out = scorePainters({
    order: IST_ORDER,
    painters: [
      row({ painterId: "yerel-dolmak-uzere", il: "İstanbul", loadUnits: 4 }),
      row({ painterId: "bursa-bos", il: "Bursa", loadUnits: 0 }),
    ],
  });
  assert.equal(out[0].painterId, "bursa-bos");
});

check("ağırlıklı yük: 60 parçalık tek iş, tek parçalık işten fazla yer kaplar", () => {
  const units = painterLoadUnits(60);
  const out = scorePainters({
    order: IST_ORDER,
    painters: [
      row({ painterId: "toplu-is", il: "İstanbul", loadUnits: units }),
      row({ painterId: "tek-is", il: "İstanbul", loadUnits: painterLoadUnits(1) }),
    ],
  });
  assert.equal(out[0].painterId, "tek-is");
  assert.ok(out[0].parts.load > out[1].parts.load);
});

check("her uygunsuzluk sebebinin Türkçe karşılığı var ve uygun olanların ALTINDA durur", () => {
  const out = scorePainters({
    order: {
      ...IST_ORDER,
      declinedPainterIds: ["reddetti"],
      excludePainterIds: ["geri-alindi"],
    },
    painters: [
      row({ painterId: "geri-alindi", il: "İstanbul" }),
      row({ painterId: "reddetti", il: "İstanbul" }),
      row({ painterId: "pasif", il: "İstanbul", status: "suspended" }),
      row({ painterId: "is-almiyor", il: "İstanbul", acceptingOrders: false }),
      row({ painterId: "dolu", il: "İstanbul", loadUnits: 5 }),
      row({ painterId: "uygun", il: "Van" }),
    ],
  });
  const byId = new Map(out.map((c) => [c.painterId, c]));
  assert.equal(byId.get("geri-alindi")!.ineligibleReason, PAINTER_EXCLUDED_THIS_ATTEMPT_REASON);
  assert.equal(byId.get("reddetti")!.ineligibleReason, "Bu siparişi daha önce reddetti");
  assert.equal(byId.get("pasif")!.ineligibleReason, "Hesap aktif değil");
  assert.equal(byId.get("is-almiyor")!.ineligibleReason, "İş almıyor");
  assert.equal(byId.get("dolu")!.ineligibleReason, "Kapasite dolu");
  // Uzaktaki tek UYGUN aday, yakındaki beş uygunsuzun ÜSTÜNDE.
  assert.equal(out[0].painterId, "uygun");
  for (const c of out.slice(1)) {
    assert.equal(c.eligible, false);
    assert.ok((c.ineligibleReason ?? "").length > 0, c.painterId);
  }
});

check("reddetmiş boyacı, aynı deneme dışlamasının ALTINDA değil ÜSTÜNDE sayılmaz (sıra kuraldır)", () => {
  // Aynı boyacı hem reddetmiş hem bu denemede dışlanmışsa: bugünkü sebep yazılır.
  const out = scorePainters({
    order: { ...IST_ORDER, declinedPainterIds: ["x"], excludePainterIds: ["x"] },
    painters: [row({ painterId: "x", il: "İstanbul" })],
  });
  assert.equal(out[0].ineligibleReason, PAINTER_EXCLUDED_THIS_ATTEMPT_REASON);
});

check("her aday parçalarını taşır ve skor parçalardan yeniden üretilebilir", () => {
  const weights = getPainterWeights();
  const out = scorePainters({
    order: IST_ORDER,
    painters: [
      row({ painterId: "a", il: "Ankara", loadUnits: 1, reliability: { good: 9, bad: 1 } }),
      row({ painterId: "b", il: "İzmir", qcQuality: { jobs: 10, reworkJobs: 2 } }),
    ],
  });
  for (const c of out) {
    const keys: (keyof typeof c.parts)[] = [
      "route",
      "load",
      "reliability",
      "qcQuality",
      "onTime",
    ];
    for (const k of keys) {
      assert.ok(
        Number.isInteger(c.parts[k]) && c.parts[k] >= 0 && c.parts[k] <= 100,
        `${c.painterId}.${k} = ${c.parts[k]}`
      );
    }
    assert.equal(c.score, Math.round(weightedPainterTotal(c.parts, weights)));
  }
});

check("ağırlıklar kararı belirler: yalnız rota sayılırsa en yakın kazanır", () => {
  const onlyRoute: PainterScoringWeights = {
    route: 1,
    load: 0,
    reliability: 0,
    qcQuality: 0,
    onTime: 0,
  };
  const painters = [
    row({ painterId: "yakin", il: "İstanbul", loadUnits: 4 }),
    row({ painterId: "uzak", il: "Van", loadUnits: 0 }),
  ];
  const routeOnly = scorePainters({ order: IST_ORDER, painters, weights: onlyRoute });
  assert.equal(routeOnly[0].painterId, "yakin");
  const onlyLoad: PainterScoringWeights = {
    route: 0,
    load: 1,
    reliability: 0,
    qcQuality: 0,
    onTime: 0,
  };
  const loadOnly = scorePainters({ order: IST_ORDER, painters, weights: onlyLoad });
  assert.equal(loadOnly[0].painterId, "uzak");
});

check("sıra KARARLI: aynı girdi aynı sonuç, giriş sırası sonucu değiştirmez", () => {
  const painters = [
    row({ painterId: "c", companyName: "Cam Atölye", il: "İstanbul" }),
    row({ painterId: "a", companyName: "Ada Atölye", il: "İstanbul" }),
    row({ painterId: "b", companyName: "Boya Atölye", il: "Ankara" }),
    row({ painterId: "d", companyName: "Ada Atölye", il: "İstanbul" }),
  ];
  const first = scorePainters({ order: IST_ORDER, painters }).map((c) => c.painterId);
  const again = scorePainters({ order: IST_ORDER, painters }).map((c) => c.painterId);
  const shuffled = scorePainters({
    order: IST_ORDER,
    painters: [...painters].reverse(),
  }).map((c) => c.painterId);
  assert.deepEqual(again, first);
  assert.deepEqual(shuffled, first, "giriş sırası sonucu değiştirdi");
  // Eşit skorlu ikili unvana, unvan da eşitse id'ye göre ayrılır.
  assert.deepEqual(first.slice(0, 3), ["a", "d", "c"]);
});

check("IBAN eksikse kapı değil ROZET: aday uygun kalır", () => {
  const out = scorePainters({
    order: IST_ORDER,
    painters: [row({ painterId: "ibansiz", il: "İstanbul", iban: null })],
  });
  assert.equal(out[0].eligible, true);
  assert.ok(out[0].reasons.some((r) => r.includes("IBAN")), out[0].reasons.join("|"));
});

check("gerekçeler Türkçe ve yakınlık km olarak yazılıyor", () => {
  const out = scorePainters({
    order: IST_ORDER,
    painters: [row({ painterId: "bursa", il: "Bursa" })],
  });
  const reasons = out[0].reasons.join(" | ");
  assert.ok(reasons.includes("km"), reasons);
  assert.ok(reasons.includes("yakın"), reasons);
  assert.ok(
    routeLegScore("İstanbul", "Bursa").units! <= ROUTE_NEAR_UNITS,
    "Bursa yakın sayılmalı"
  );
});

// ─── 6. Eylem sözlüğü + kaynak taraması ─────────────────────────────────────
console.log("\neylem sözlüğü");

check("iyi / kötü / nötr kümeleri kesişmez", () => {
  const good = new Set(PAINTER_GOOD_ACTIONS);
  for (const a of PAINTER_BAD_ACTIONS) assert.ok(!good.has(a), a);
  for (const a of PAINTER_NEUTRAL_ACTIONS) assert.ok(!good.has(a), a);
  const bad = new Set(PAINTER_BAD_ACTIONS);
  for (const a of PAINTER_NEUTRAL_ACTIONS) assert.ok(!bad.has(a), a);
});

check("yanıtsızlık dizesi kötü eylemler arasında (SLA işi tek sözlükten okur)", () => {
  assert.ok(PAINTER_BAD_ACTIONS.includes(PAINTER_SLA_TIMEOUT_ACTION));
});

/** `src/` altındaki tüm .ts dosyaları. */
function allSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (p: string) => {
    for (const entry of readdirSync(p)) {
      const full = join(p, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) files.push(full);
    }
  };
  walk(join(ROOT, "src"));
  return files;
}

/**
 * `painter_actions`a yazılan eylem dizelerini AST ile toplar.
 *
 * NEDEN AST, NEDEN METİN ARAMASI DEĞİL: ilk sürüm, içinde "painterActions"
 * geçen dosyanın TAMAMINI regex'liyordu ve `on-behalf.ts` üç ayrı tabloya
 * (adminActions / manufacturerActions / painterActions) yazdığı için
 * `admin_actions` enum'una ait `AUDIT_ACTION`ı boyacı eylemi sanıp düştü.
 * Tersi de mümkündü ve sessiz olurdu: gerçek bir boyacı eylemi başka bir
 * tablonun satırı sanılıp hiç denetlenmeyebilirdi. (Aynı gerekçe
 * scripts/test-auto-assign.ts'in AST taramasında da yazılı.)
 *
 * İki yol birden taranır:
 *  1. `db.insert(painterActions).values({ action: ... })` — doğrudan yazım.
 *  2. Gövdesinde böyle bir insert olan YARDIMCI fonksiyonlar (on-behalf.ts'teki
 *     `stampPainterTimeline` gibi, `action` bir PARAMETRE): yardımcının adı
 *     bulunur, sonra o yardımcıya yapılan çağrıların argümanları okunur.
 *     Yalnız 1. yola bakan bir tarama, admin'in boyacı adına yazdığı dört
 *     eylemi (accept/painted/submit_qc/ship) hiç görmezdi.
 */
function painterActionStringsFrom(file: string): { value: string; via: string }[] {
  const src = readFileSync(file, "utf8");
  if (!src.includes("painterActions")) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: { value: string; via: string }[] = [];
  /** Gövdesinde painterActions insert'i olan yardımcıların adları. */
  const helpers = new Set<string>();
  /** Yardımcıda `action` parametresinin kaçıncı sırada olduğu. */
  const helperActionArgIndex = new Map<string, number>();

  const insertsPainterActions = (node: ts.Node): boolean =>
    /\.insert\(\s*painterActions\s*\)/.test(node.getText(sf));

  // `action` özelliğini bir nesne literalinden çöz: "dize" ya da SABİT.
  const readActionProp = (obj: ts.ObjectLiteralExpression, via: string) => {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (prop.name.getText(sf) !== "action") continue;
      const init = prop.initializer;
      if (ts.isStringLiteral(init)) out.push({ value: init.text, via });
      else if (ts.isIdentifier(init)) out.push({ value: `#${init.text}`, via });
      // Başka bir ifade (ör. koşullu) çıkarsa sessiz kalmayalım:
      else out.push({ value: `?${init.getText(sf)}`, via });
    }
  };

  const visit = (node: ts.Node) => {
    // 1. Doğrudan insert: .insert(painterActions).values({ ... })
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "values" &&
      /\.insert\(\s*painterActions\s*\)/.test(node.expression.expression.getText(sf))
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) readActionProp(arg, file);
    }
    // 2. Yardımcı fonksiyon tanımı (painterActions yazan + action parametreli)
    if (ts.isFunctionDeclaration(node) && node.name && node.body && insertsPainterActions(node.body)) {
      const idx = node.parameters.findIndex((p) => p.name.getText(sf) === "action");
      if (idx >= 0) {
        helpers.add(node.name.text);
        helperActionArgIndex.set(node.name.text, idx);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Yardımcı çağrıları (tanımlar bulunduktan sonra ikinci geçiş).
  if (helpers.size > 0) {
    const visitCalls = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (helpers.has(name)) {
          const arg = node.arguments[helperActionArgIndex.get(name)!];
          if (arg && ts.isStringLiteral(arg)) out.push({ value: arg.text, via: `${file}:${name}()` });
          else if (arg && ts.isIdentifier(arg)) out.push({ value: `#${arg.text}`, via: `${file}:${name}()` });
        }
      }
      ts.forEachChild(node, visitCalls);
    };
    visitCalls(sf);
  }
  return out;
}

check("painter_actions'a YAZILAN her eylem dizesi sınıflanmış (AST taraması)", () => {
  const known = new Set([
    ...PAINTER_GOOD_ACTIONS,
    ...PAINTER_BAD_ACTIONS,
    ...PAINTER_NEUTRAL_ACTIONS,
  ]);
  // Sabit üzerinden yazılanlar: sabit adı → değeri.
  const constants: Record<string, string> = {
    PAINTER_SLA_TIMEOUT_ACTION,
    PAINTER_AUTO_ASSIGNED_ACTION,
    PARTNER_MODEL_ACK_ACTION,
    PARTNER_MODEL_REVISION_ACTION,
  };
  let seen = 0;
  for (const file of allSourceFiles()) {
    if (file.endsWith("painter-scoring.ts") || file.endsWith("schema.ts")) continue;
    for (const hit of painterActionStringsFrom(file)) {
      seen++;
      if (hit.value.startsWith("#")) {
        const name = hit.value.slice(1);
        const value = constants[name];
        assert.ok(value !== undefined, `${hit.via} → ${name} sabiti bu teste tanıtılmamış`);
        assert.ok(known.has(value), `${hit.via} → ${name} ("${value}") sınıflanmamış`);
      } else {
        assert.ok(!hit.value.startsWith("?"), `${hit.via} → çözülemeyen ifade: ${hit.value}`);
        assert.ok(known.has(hit.value), `${hit.via} → "${hit.value}" sınıflanmamış`);
      }
    }
  }
  // Bugün bilinen yazım noktaları: boyacının 6 rotası + admin atama/geri alma/
  // takas + on-behalf'ın 4 çağrısı + otomatik atama + SLA + model duyurusu.
  assert.ok(seen >= 15, `beklenenden az eylem tarandı: ${seen}`);
});

check("mirror'lanan auto_assigned sabiti, sahibindeki tanımla aynı", () => {
  // `painter-auto-assign.ts` @/lib/db import ettiği için saf yapılandırmadan
  // import EDİLEMEZ; kopyanın bedeli bu tripwire'dır.
  const src = readFileSync(join(ROOT, "src/lib/services/painter-auto-assign.ts"), "utf8");
  const m = src.match(/PAINTER_AUTO_ASSIGNED_ACTION\s*=\s*"([a-z_]+)"/);
  assert.ok(m, "sahibindeki tanım bulunamadı (isim değişmiş olabilir)");
  assert.equal(
    m![1],
    PAINTER_AUTO_ASSIGNED_ACTION,
    "otomatik atama eylemi iki yerde farklı yazılıyor"
  );
});

check("SLA worker'ı yanıtsızlık dizesini BU sözlükten import ediyor", () => {
  // Worker kendi dizesini yazsaydı, güvenilirlik sinyali hiç ateşlenmezdi
  // (üretici sıralayıcısında bir kez yaşanan hata: iyi sayaç hep 0 kaldı).
  const src = readFileSync(
    join(ROOT, "src/lib/queue/workers/painter-accept-sla.worker.ts"),
    "utf8"
  );
  assert.ok(
    /import\s*\{[^}]*PAINTER_SLA_TIMEOUT_ACTION[^}]*\}\s*from\s*["'][^"']*painter-scoring["']/.test(src),
    "worker sabiti painter-scoring'ten import etmiyor"
  );
  assert.ok(
    src.includes("action: PAINTER_SLA_TIMEOUT_ACTION"),
    "worker sabiti YAZMIYOR (başka bir dize yazıyor olabilir)"
  );
});

// ─── 6. Panel ve üretici bildirimi — KAYNAK TARAMASI (çalışma zamanı DEĞİL) ──
//
// NE SINANIR: dosyadaki METİN. Bu bölüm ne bir istek atar, ne bir React ağacı
// çizer, ne de rotayı çalıştırır. Bu yüzden "panel cezayı gerçekten yazıyor" ya
// da "üreticiye doğru cümle gidiyor" diye OKUNAMAZ — yalnız şunu söyler: cezayı
// yazacak alan hâlâ gönderiliyor, iki kapısı yerinde duruyor ve bildirim cümlesi
// sebebe göre dallanıyor. DAVRANIŞ kanıtı yalnız açık bir tarayıcıdan/HTTP'den
// alınır (QA turları); buradaki satırlar o kanıtın yerine geçmez, yalnız bu üç
// düzeltmenin sessizce geri alınmasını engeller.
//
// Üçü de ÖLÇÜLMÜŞ kusurlardır:
//  • panel `strike` alanını hiç göndermiyordu → boyacı cezası hiç ateşlenmedi;
//  • kendi boyayan üreticiye "yönetici boyacı atayacak, bekleyin" deniyordu →
//    o atama hiç gelmeyecekti (kapı sonsuza kadar paints_in_house ile atlar);
//  • gerekçe kartı, iade edilmiş siparişte ekranda OLMAYAN atama kutusunu adres
//    gösteriyordu.
const ADMIN_ORDER_CLIENT = join(ROOT, "src/app/admin/orders/[id]/client.tsx");
const PAINTER_DECLINE_ROUTE = join(
  ROOT,
  "src/app/api/painter/orders/[id]/decline/route.ts"
);
const SLA_WORKER = join(ROOT, "src/lib/queue/workers/painter-accept-sla.worker.ts");
const SEND_TO_PAINTER_PANEL = join(
  ROOT,
  "src/components/manufacturer/send-to-painter-panel.tsx"
);
const PAINTER_EVAL_WRITER = join(ROOT, "src/lib/services/painter-evaluation.ts");
const PAINTER_EVAL_VIEW = join(
  ROOT,
  "src/app/admin/scoring-evaluations/painter-evaluation-view.ts"
);
const EVALUATIONS_PAGE = join(ROOT, "src/app/admin/scoring-evaluations/page.tsx");

/** Kaynaktan iki kilometre taşı arasını kes (yoksa testi düşür). */
function sliceBetween(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `kaynakta bulunamadı: ${from}`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `kaynakta bulunamadı: ${to}`);
  return src.slice(a, b);
}

check("panel, boyacıdan geri almada `strike` alanını GÖNDERİYOR", () => {
  const src = readFileSync(ADMIN_ORDER_CLIENT, "utf8");
  const payload = sliceBetween(src, "revoke-painter`, {", "const data = await res.json()");
  assert.ok(
    /strike:/.test(payload),
    "revoke-painter yükünde `strike` yok — rota alanı kabul ediyor ama panel göndermiyorsa boyacı cezası HİÇ yazılmaz"
  );
  assert.ok(
    /strike:\s*canStrikePainter\s*&&\s*revokePainterStrike/.test(payload),
    "`strike` kapısız gönderiliyor: iade/cevapsız kapıları yükün kendisinde de durmalı"
  );
});

check("ceza İKİ kapıdan geçer: iade edilmiş sipariş ve cevapsız iş", () => {
  const src = readFileSync(ADMIN_ORDER_CLIENT, "utf8");
  assert.ok(
    /const painterJobUnanswered =\s*order\.painterStatus === "assigned";/.test(src),
    "cevapsız iş tanımı kayıp: boyacının kabul etmediği hâl `painterStatus === \"assigned\"`"
  );
  assert.ok(
    /const canStrikePainter =\s*!refunded && !painterJobUnanswered;/.test(src),
    "ceza kapısı iki koşulu da taşımıyor (iade + cevapsızlık)"
  );
  assert.ok(
    src.includes("{canStrikePainter && ("),
    "ceza kutusu koşulsuz render ediliyor: cevapsız işte ekranda GÖRÜNMEMELİ"
  );
});

check("gerekçe kartı, EKRANDA OLMAYAN atama kutusunu adres göstermiyor", () => {
  const src = readFileSync(ADMIN_ORDER_CLIENT, "utf8");
  const para = sliceBetween(src, 'placement.kind === "unrecorded"', "{divergence && (");
  assert.ok(para.includes("refunded"), "kart iade hâlini hiç ayırmıyor");
  assert.ok(
    para.includes("assignBoxOnScreen"),
    "kart, kutunun ekranda olup olmadığına bakmıyor"
  );
  const gateAt = para.indexOf("assignBoxOnScreen");
  const adviceAt = para.indexOf("Boyacı ata");
  assert.ok(
    adviceAt > gateAt,
    "‘Boyacı ata kutusundan atayın’ tavsiyesi koşuldan ÖNCE geliyor: koşulsuz adres verilmiş olur"
  );
  // Kutunun kendi koşullarının kopyası: ikisi ayrışırsa kart yine yanlış yeri
  // gösterir, bu yüzden hesap kutunun beş koşulunu da anmak zorunda.
  const gate = sliceBetween(src, "const painterAssignBoxOnScreen =", ";\n");
  for (const needle of [
    "!refunded",
    'painterStatus === "unassigned"',
    'manufacturerStatus === "qc_approved"',
    "readFailures?.painterCandidates",
    "candidates.length",
  ]) {
    assert.ok(gate.includes(needle), `kutu koşulu eksik: ${needle}`);
  }
  assert.ok(
    /<PainterEvaluationCard[\s\S]{0,400}assignBoxOnScreen=\{painterAssignBoxOnScreen\}/.test(src),
    "kart, ekranın gerçeğini prop olarak almıyor"
  );
  assert.ok(
    /<PainterEvaluationCard[\s\S]{0,400}refunded=\{refunded\}/.test(src),
    "karta iade bilgisi geçilmiyor"
  );
});

check("ret bildirimi: KENDİ BOYAYAN üreticiye gelmeyecek bir atama vaat edilmiyor", () => {
  const src = readFileSync(PAINTER_DECLINE_ROUTE, "utf8");
  const notice = sliceBetween(
    src,
    "function manufacturerDeclineNotice(args: {",
    "type DeclineProgress"
  );
  assert.ok(
    notice.includes('reason === "paints_in_house"'),
    "bildirim, üreticinin kendi boyadığı hâli hiç ayırmıyor — o siparişe boyacı ATANMAYACAK"
  );
  const inHouse = sliceBetween(
    notice,
    'reason === "paints_in_house"',
    'reason === "already_assigned"'
  );
  assert.ok(
    inHouse.includes("ATANMAYACAK"),
    "kendi boyayan üreticiye atama yapılmayacağı SÖYLENMİYOR"
  );
  for (const wrong of ["beklemede kalın", "yönetici tarafından yapılacak"]) {
    assert.ok(
      !inHouse.includes(wrong),
      `kendi boyayan üreticiye hâlâ bekleme talimatı veriliyor: "${wrong}"`
    );
  }
  assert.ok(
    src.includes("body: manufacturerDeclineNotice({"),
    "rota bildirimi bu yardımcıdan almıyor (metin yine iki dala sıkışmış olabilir)"
  );
  assert.ok(
    /reason:\s*repick\.action === "admin_queue" \? repick\.reason : null/.test(src),
    "sebep yardımcıya taşınmıyor: cümle yine yalnız reassigned/parcelInTransit ikilisine bakar"
  );
});

check("ret bildirimi: BOYACIYA da gelmeyecek bir atama vaat edilmiyor", () => {
  // Ölçülen kusur: aynı rotanın ÜRETİCİ yarısı düzeltilmiş, BOYACI yarısı
  // düzeltilmemişti — yeniden yerleştirilmeyen her hâlde boyacıya "Yeni
  // boyacıyı yönetici atayacak" deniyordu, üreticisi boyamayı kendi yapan
  // siparişte de. O siparişte kapı sonsuza dek paints_in_house ile atlar.
  const src = readFileSync(PAINTER_DECLINE_ROUTE, "utf8");
  const notice = sliceBetween(src, "function painterDeclineNotice(args: {", "type DeclineProgress");
  assert.ok(
    notice.includes('reason === "paints_in_house"'),
    "boyacıya giden cümle, üreticinin kendi boyadığı hâli hiç ayırmıyor"
  );
  const inHouse = sliceBetween(
    notice,
    'reason === "paints_in_house"',
    'reason === "already_assigned"'
  );
  assert.ok(inHouse.includes("ATANMAYACAK"), "boyacıya atama yapılmayacağı SÖYLENMİYOR");
  assert.ok(
    !inHouse.includes("yönetici atayacak"),
    "boyacıya hâlâ gelmeyecek bir yönetici ataması vaat ediliyor"
  );
  assert.ok(
    /message: painterDeclineNotice\(\{/.test(src),
    "rota, boyacıya dönen cümleyi bu yardımcıdan almıyor (metin yine üç dala sıkışmış olabilir)"
  );
  assert.ok(
    /reason: repick\.action === "admin_queue" \? repick\.reason : null,\s*\}\),/.test(src),
    "sebep boyacı yardımcısına taşınmıyor: cümle yine yalnız reassigned/parcelInTransit ikilisine bakar"
  );
});

check("24 saat cevapsızlık: ÜRETİCİYE sebebe göre yazılır", () => {
  // Ölçülen kusur: tek sabit cümle, kendi boyayan üreticiye de "baz baskıyı
  // HENÜZ göndermeyin, yeni boyacı atandığında bilgilendirileceksiniz" diyordu.
  // O siparişe boyacı hiç atanmayacağı için bekleme hiç bitmezdi.
  const src = readFileSync(SLA_WORKER, "utf8");
  assert.ok(
    src.includes("function manufacturerSlaNotice("),
    "süpürmenin üretici cümlesi hâlâ tek parça (sebebe göre dallanmıyor)"
  );
  const notice = sliceBetween(src, "function manufacturerSlaNotice(", "interface StaleJob");
  const inHouse = sliceBetween(notice, 'skip === "paints_in_house"', 'skip === "already_assigned"');
  assert.ok(inHouse.includes("ATANMAYACAK"), "kendi boyayan üreticiye atama yapılmayacağı söylenmiyor");
  assert.ok(
    !inHouse.includes("HENÜZ göndermeyin"),
    "kendi boyayan üreticiye hâlâ baskıyı bekletme talimatı veriliyor"
  );
  assert.ok(
    src.includes("body: manufacturerSlaNotice(stale.orderNumber, skipCode)"),
    "bildirim bu yardımcıdan alınmıyor"
  );
  assert.ok(
    /let skipCode: PainterAssignSkip \| null = null;/.test(src),
    "atlama KODU tutulmuyor: cümle Türkçe metni parçalayarak seçilemez"
  );
});

check("24 saat cevapsızlık: ADMIN'e yapılmayacak bir atama söylenmiyor", () => {
  const src = readFileSync(SLA_WORKER, "utf8");
  const dict = sliceBetween(src, "const ADMIN_NEXT_STEP_TR: Record<PainterAssignSkip, string> = {", "};");
  const inHouse = sliceBetween(dict, "paints_in_house:", "not_needed:");
  assert.ok(inHouse.includes("ATANMAYACAK"), "admin'e boyacı atanmayacağı söylenmiyor");
  assert.ok(
    !inHouse.includes("sipariş sayfasından elle boyacı atayın"),
    "admin hâlâ yapılmaması gereken bir atamaya çağrılıyor"
  );
  assert.ok(
    src.includes("${adminReason}. ${adminNextStepTr(skipCode)}"),
    "sipariş notu sonraki adımı sebepten türetmiyor (sabit cümle geri gelmiş olabilir)"
  );
});

check("[BOYACI-SLA] admin notu TARİHLİ yazılır (ikiziyle aynı damga)", () => {
  // Ölçülen kusur: bu süpürmenin notları tarihsizdi, aynı siparişteki [BOYACI]
  // notları tarihliydi; iş iki dakika sonra gerçekten devredilince admin hangi
  // notun güncel olduğunu okuyamadı.
  const src = readFileSync(SLA_WORKER, "utf8");
  const fn = sliceBetween(src, "async function appendAdminNote(", "async function staleJobs(");
  assert.ok(
    fn.includes("formatAdminNoteLine(note)"),
    "not ham dize olarak yazılıyor: tarih damgası yok"
  );
  assert.ok(
    /import \{[^}]*formatAdminNoteLine[^}]*\} from "\.\.\/\.\.\/config\/order-status-policy"/.test(src),
    "damga ortak yardımcıdan gelmiyor (ikinci bir tarih biçimi doğar)"
  );
});

check("başarı gövdesindeki UYARI üç panelde de gösteriliyor", () => {
  // Ölçülen kusur: uçlar 200 + Türkçe `warning` dönüyordu ("karar kaydı
  // yazılamadı"), üç panel de gövdeyi yalnız hata dalında okuyordu. Uyarının
  // yazıldığı [BOYACI KAYDI] notu ADMIN notlarına gittiği için üretici hiçbir
  // yerden öğrenemiyordu.
  const admin = readFileSync(ADMIN_ORDER_CLIENT, "utf8");
  assert.ok(
    admin.includes("const [actionWarning, setActionWarning]"),
    "admin panelinde uyarı için ayrı bir hâl yok (kırmızı hata kutusu işlemi başarısız gösterirdi)"
  );
  const assign = sliceBetween(admin, "const handleAssignPainter = async () => {", "// ─── Refund");
  assert.ok(
    assign.includes("setActionWarning(responseWarning(data))"),
    "atama, başarı gövdesindeki uyarıyı yere düşürüyor"
  );
  const swap = sliceBetween(admin, "const swapPainter = async () => {", "// ─── Reference photo");
  assert.ok(
    swap.includes("setActionWarning(responseWarning(data))"),
    "devir, runApi'nin data argümanını hâlâ yok sayıyor"
  );
  assert.ok(
    /actionWarning && \(/.test(admin),
    "uyarı hiçbir yerde render edilmiyor"
  );

  const panel = readFileSync(SEND_TO_PAINTER_PANEL, "utf8");
  assert.ok(panel.includes("data.warning"), "üretici paneli uyarıyı hiç okumuyor");
  const send = sliceBetween(panel, "const send = async () => {", "return (");
  const warnAt = send.indexOf("setWarning(warn)");
  const refreshAt = send.indexOf("router.refresh()", warnAt);
  assert.ok(warnAt > 0, "üretici paneli uyarıyı bir hâle yazmıyor");
  assert.ok(
    send.slice(warnAt, refreshAt).includes("return;"),
    "uyarı gösterilmeden router.refresh() çağrılıyor: kart ekrandan kalkar ve uyarı okunmadan kaybolur"
  );
});

check("tetikleyicinin TEK Türkçe adı var (not ile ekran ayrışamaz)", () => {
  // Ölçülen kusur: iki sözlük ayrışmıştı — sipariş notu "Yönetici seçimi"
  // derken karar listesi aynı kararı "Admin elle atadı" diye gösteriyordu.
  const writer = readFileSync(PAINTER_EVAL_WRITER, "utf8");
  const view = readFileSync(PAINTER_EVAL_VIEW, "utf8");
  assert.ok(
    /export \{ PAINTER_TRIGGER_LABELS_TR as PAINTER_ASSIGNMENT_TRIGGER_LABELS_TR \}/.test(writer),
    "yazıcı sözlüğü ekrandan almıyor: ikinci bir kopya doğmuş olabilir"
  );
  assert.ok(
    !/admin_manual:\s*"/.test(writer),
    "yazıcıda hâlâ kendi etiket sözlüğü var (iki ad, tek karar)"
  );
  assert.strictEqual(
    (view.match(/admin_manual:\s*"/g) ?? []).length,
    1,
    "ekran tarafında etiket birden çok yerde tanımlı"
  );
});

check("'insan yerleştirdi' sayacı ÜÇ insan yolunu birden sayar", () => {
  // Ölçülen kusur: sayaç yalnız `admin_manual` filtreliyordu, oysa insan
  // yolları üç tanedir (admin ataması, admin devri, üreticinin kendi devri) —
  // tam da bunu saydığını iddia eden bir başlığın altında eksik sayıyordu.
  const src = readFileSync(EVALUATIONS_PAGE, "utf8");
  const counter = sliceBetween(src, "const painterManualCount =", ";");
  assert.ok(
    counter.includes("painterTriggerIsHuman("),
    "sayaç ortak ayrımı (PAINTER_HUMAN_TRIGGERS) kullanmıyor"
  );
  assert.ok(
    !counter.includes('"admin_manual"'),
    "sayaç hâlâ tek tetikleyiciye bakıyor"
  );
});

check("iki boyacı seçici de KAPININ ölçüsünü gösteriyor", () => {
  // Ölçülen kusur (P4F-2): ekranlar "1/5 iş" yazarken uçlar AĞIRLIKLI yükle
  // reddediyordu — bir parti işi tek "iş"tir ama tezgâhın tamamını doldurur.
  // Ortak ölçü taşındıktan sonra tek yük etiketi `loadLabel`dır ("6/2 birim ·
  // 1 iş"); iş sayısını tek başına basmak, uçların uygulamadığı bir ölçüyü
  // ekranda kapı gibi göstermek olur.
  const admin = readFileSync(ADMIN_ORDER_CLIENT, "utf8");
  const panel = readFileSync(SEND_TO_PAINTER_PANEL, "utf8");
  for (const [name, src] of [
    ["admin sipariş sayfası", admin],
    ["üretici boyacı seçicisi", panel],
  ] as [string, string][]) {
    assert.ok(src.includes("loadLabel"), `${name}: ortak yük etiketi hiç okunmuyor`);
    assert.ok(
      !/\{c\.currentLoad\}\/\{c\.maxConcurrentOrders\} iş/.test(src) &&
        !/\{p\.currentLoad\}\/\{p\.maxConcurrentOrders\} iş/.test(src),
      `${name}: yük hâlâ İŞ SAYISI olarak basılıyor (kapı ağırlıklı yükü uygular)`
    );
  }
});

// ─── Sonuç ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} geçti, ${fail} düştü`);
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
