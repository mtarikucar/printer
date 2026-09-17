/**
 * Üretici kabul SLA'sı (Faz 5) — saf kural sınamaları + kaynak denetimi.
 *
 * Süpürmenin kendisi DB'ye bağlı, ama asla kaymaması gereken kısım KARARDIR:
 *  • süre dolmadan hiçbir şey olmaz,
 *  • yalnız OTOMATİK atanmış iş kendiliğinden devredilir,
 *  • SATICININ kendi ürünü hiçbir koşulda taşınmaz (pazaryeri mülkiyet kuralı),
 *  • iş yola çıkmışsa taşınmaz (fiziksel parça öksüz kalmasın),
 *  • türün otomatik atama anahtarı kapalıysa koparma da YAPILMAZ,
 *  • bayraklanmış sipariş ikinci kez bayraklanmaz (her saat e-posta yağmaz).
 *
 * Kaynak denetimi üç şeyi ayrıca kilitler — üçü de "ikinci bir kopya" ya da
 * "sessiz bir davranış değişikliği" riski taşıyor:
 *  1. ÜST SINIR TEK SAYIDIR: ret yolunun özel sabiti (manufacturer-decline.ts)
 *     ile flags.ts'teki ortak sabit EŞİT kalmalı. Bugün iki kopya var (ret yolu
 *     başka bir dosyanın sahibi); bu test, kopyanın sessizce ayrışmasını
 *     imkânsız kılar.
 *  2. CEZA YOK: SLA eylem adı sıralayıcının puan kümelerinin DIŞINDA kalmalı.
 *     İçeri girmesi, partner gelirini canlıda kaydıran bir sıralama
 *     değişikliği olurdu (ranker-rollout = B: önce gölge).
 *  3. TEK SÜPÜRME: eski bayrak-only süpürmesi (assignment-sla) ile yenisi aynı
 *     anda zamanlanmamalı — admin tek olay için iki e-posta alırdı.
 *
 * DB YOK, Redis YOK.
 *
 * Çalıştır: npx tsx scripts/test-manufacturer-sla.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MANUFACTURER_ACCEPT_SLA_HOURS,
  planManufacturerAcceptSla,
  type ManufacturerSlaInput,
} from "../src/lib/queue/workers/manufacturer-accept-sla.worker";
import {
  MANUFACTURER_MAX_DECLINES,
  MANUFACTURER_MAX_REPLACEMENTS,
  MANUFACTURER_SLA_TIMEOUT_ACTION,
  manufacturerDeclinesExhausted,
  manufacturerJobInTransit,
} from "../src/lib/config/flags";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Yorumları at: yargı KODA bakmalı, kodun anlatısına değil. Bu dosyaların
 * açıklamaları tam da aradığımız dizeleri ANLATTIĞI için (ör. "sla_timeout"),
 * yorumları saymayan bir tarama kendi anlatısını kod sanardı.
 * (scripts/test-parcel-guard.ts'teki kanıtlanmış yardımcının aynısı.)
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

/** Yeni atanmış, otomatik seçilmiş, sahipsiz, yola çıkmamış bir iş. */
const BASE: ManufacturerSlaInput = {
  ageHours: 1,
  autoAssigned: true,
  inTransit: false,
  sellerOwned: false,
  alreadyFlagged: false,
};

const input = (over: Partial<ManufacturerSlaInput> = {}): ManufacturerSlaInput => ({
  ...BASE,
  ...over,
});

console.log("\n1) üretici kabul SLA kuralları\n");

test("süresi dolmamış iş kımıldamaz", () => {
  assert.deepEqual(planManufacturerAcceptSla(input()), []);
});

test("sınırın bir saat altındaki iş hâlâ kımıldamaz", () => {
  assert.deepEqual(
    planManufacturerAcceptSla(input({ ageHours: MANUFACTURER_ACCEPT_SLA_HOURS - 1 })),
    []
  );
});

test("24 saat sessiz kalan OTOMATİK atama devredilir", () => {
  assert.deepEqual(
    planManufacturerAcceptSla(input({ ageHours: MANUFACTURER_ACCEPT_SLA_HOURS })),
    ["reassign"]
  );
});

test("elle atanmış iş devredilmez, yalnız bayraklanır", () => {
  assert.deepEqual(
    planManufacturerAcceptSla(input({ ageHours: 48, autoAssigned: false })),
    ["flag"]
  );
});

test("SATICININ kendi ürünü, otomatik atanmış olsa bile devredilmez", () => {
  // Pazaryeri mülkiyet kuralı (E-C1): sessizlik, satıcının ürününü rakip bir
  // atölyeye verme sebebi değildir.
  assert.deepEqual(
    planManufacturerAcceptSla(input({ ageHours: 48, sellerOwned: true })),
    ["flag"]
  );
});

test("iş yola çıktıysa otomatik atama bile devredilmez", () => {
  assert.deepEqual(
    planManufacturerAcceptSla(input({ ageHours: 48, inTransit: true })),
    ["flag"]
  );
});

test("türün otomatik atama anahtarı kapalıysa KOPARMA da yapılmaz", () => {
  // Koparma yerleştirmenin ilk yarısıdır; yalnız o yarıyı yapmak siparişi
  // sahipsiz bırakırdı. (Atölye seansı siparişi de buraya düşer: anahtarı yok.)
  assert.deepEqual(
    planManufacturerAcceptSla(input({ ageHours: 48, autoAssignEnabled: false })),
    ["flag"]
  );
});

test("anahtar SORULMADIYSA açık sayılır (saf çağıran kilitlenmez)", () => {
  assert.deepEqual(planManufacturerAcceptSla(input({ ageHours: 48 })), ["reassign"]);
});

test("bayraklanmış sipariş ikinci kez bayraklanmaz", () => {
  assert.deepEqual(
    planManufacturerAcceptSla(
      input({ ageHours: 72, autoAssigned: false, alreadyFlagged: true })
    ),
    []
  );
});

test("bayrak, devri ENGELLEMEZ: otomatik iş yine de taşınır", () => {
  assert.deepEqual(
    planManufacturerAcceptSla(input({ ageHours: 48, alreadyFlagged: true })),
    ["reassign"]
  );
});

test("eşik dışarıdan verilebilir (ops ayarı)", () => {
  assert.deepEqual(planManufacturerAcceptSla(input({ ageHours: 6 }), 4), ["reassign"]);
  assert.deepEqual(planManufacturerAcceptSla(input({ ageHours: 3 }), 4), []);
});

console.log("\n2) yola çıkmışlık ölçüsü\n");

const transitBase = {
  shippedAt: null,
  trackingNumber: null,
  sentToPainterAt: null,
  painterHandoffTrackingNumber: null,
};

test("hiçbir iz yoksa iş yolda DEĞİL", () => {
  assert.equal(manufacturerJobInTransit(transitBase), false);
});

test("müşteriye sevk damgası varsa yolda", () => {
  assert.equal(
    manufacturerJobInTransit({ ...transitBase, shippedAt: new Date() }),
    true
  );
});

test("müşteri kargosu takip numarası varsa yolda", () => {
  assert.equal(
    manufacturerJobInTransit({ ...transitBase, trackingNumber: "ABC123" }),
    true
  );
});

test("boyacıya devir damgası varsa yolda", () => {
  assert.equal(
    manufacturerJobInTransit({ ...transitBase, sentToPainterAt: new Date() }),
    true
  );
});

test("boyacı devir takip numarası varsa yolda", () => {
  assert.equal(
    manufacturerJobInTransit({
      ...transitBase,
      painterHandoffTrackingNumber: "XYZ789",
    }),
    true
  );
});

test("yalnız boşluktan ibaret takip numarası kanıt sayılmaz", () => {
  assert.equal(
    manufacturerJobInTransit({ ...transitBase, trackingNumber: "   " }),
    false
  );
});

console.log("\n3) yeniden yerleştirme üst sınırı\n");

test("üst sınırın altındaki sayaç tükenmiş değildir", () => {
  assert.equal(manufacturerDeclinesExhausted(MANUFACTURER_MAX_DECLINES - 1), false);
});

test("üst sınıra ulaşan sayaç admin kuyruğuna gönderir", () => {
  assert.equal(manufacturerDeclinesExhausted(MANUFACTURER_MAX_DECLINES), true);
});

test("yeniden yerleştirme sayısı üst sınırdan TÜRETİLİR", () => {
  // İlk yerleştirme bir "yeniden seçim" değildir: iki sayı bağımsız yazılsaydı
  // birini değiştiren diğerini sessizce yalanlardı.
  assert.equal(MANUFACTURER_MAX_REPLACEMENTS, MANUFACTURER_MAX_DECLINES - 1);
});

console.log("\n4) kaynak denetimi — tek sayı, ceza yok, tek süpürme\n");

const DECLINE = "src/lib/services/manufacturer-decline.ts";
const RANKER = "src/lib/services/manufacturer-assignment.ts";
const START = "workers/start.ts";
const WORKER = "src/lib/queue/workers/manufacturer-accept-sla.worker.ts";
const FLAGS = "src/lib/config/flags.ts";

test("ret yolunun üst sınırı ile ortak sabit EŞİT", () => {
  const src = stripComments(read(DECLINE));
  const m = src.match(/MAX_DECLINES_BEFORE_ADMIN\s*=\s*(\d+)/);
  assert.ok(m, "manufacturer-decline.ts içinde MAX_DECLINES_BEFORE_ADMIN bulunamadı");
  assert.equal(
    Number(m![1]),
    MANUFACTURER_MAX_DECLINES,
    `ret yolu ${m![1]} diyor, flags.ts ${MANUFACTURER_MAX_DECLINES} diyor — iki kopya ayrıştı`
  );
});

test("SLA eylem adı sıralayıcının puan kümelerinde YOK (ceza uygulanmaz)", () => {
  const src = stripComments(read(RANKER));
  const good = src.match(/GOOD_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  const bad = src.match(/BAD_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(good && bad, "GOOD_ACTIONS / BAD_ACTIONS okunamadı");
  assert.ok(
    !good![1].includes(MANUFACTURER_SLA_TIMEOUT_ACTION),
    "SLA eylem adı GOOD_ACTIONS'a girmiş"
  );
  assert.ok(
    !bad![1].includes(MANUFACTURER_SLA_TIMEOUT_ACTION),
    `SLA eylem adı BAD_ACTIONS'a girmiş: yanıtsızlık artık güvenilirlik puanını ` +
      `düşürüyor. Bu, gölge şeridinden geçmeden yapılan canlı bir sıralama ` +
      `değişikliğidir (ranker-rollout = B) ve sahibin "ceza yok" kararını çiğner.`
  );
});

test("süpürme CEZA yazmıyor (strikeCount'a dokunmuyor)", () => {
  const src = stripComments(read(WORKER));
  assert.ok(!/strikeCount/.test(src), "süpürme strikeCount'a yazıyor");
  assert.ok(
    !/applyStrike/.test(src),
    "süpürme applyStrike çağırıyor — sahibin kararı yanıtsızlığa ceza yasaklıyor"
  );
});

test("koparmadan ÖNCE anahtar okunuyor", () => {
  // Faz 4'te ölçülen kusur: önce koparıp sonra yerleştirmeyi denemek, kapalı bir
  // anahtarda siparişi hem üreticisiz hem yerleştirilmemiş bırakıyordu.
  const src = stripComments(read(WORKER));
  const flagsRead = src.indexOf("await getAllFlags()");
  const detach = src.indexOf("detachStaleManufacturer(stale");
  assert.ok(flagsRead > 0, "getAllFlags çağrısı bulunamadı");
  assert.ok(detach > 0, "koparma çağrısı bulunamadı");
  assert.ok(
    flagsRead < detach,
    "anahtar okuması koparmadan SONRA yapılıyor"
  );
});

test("iade edilmiş sipariş ortak korumayla süzülüyor", () => {
  const src = stripComments(read(WORKER));
  assert.ok(
    /notRefundedGuard\(\)/.test(src),
    "süpürme notRefundedGuard kullanmıyor — iade edilmiş sipariş taşınabilir"
  );
});

test("eski bayrak-only süpürmesi ile yenisi AYNI ANDA zamanlanmıyor", () => {
  const src = stripComments(read(START));
  assert.ok(
    !/upsertJobScheduler\(\s*"assignment-sla-hourly"/.test(src),
    "assignment-sla-hourly hâlâ zamanlanıyor: admin tek olay için iki e-posta alır"
  );
  assert.ok(
    /removeJobScheduler\("assignment-sla-hourly"\)/.test(src),
    "Redis'teki eski zamanlayıcı kaldırılmıyor — çağrıyı silmek onu durdurmaz"
  );
  assert.ok(
    /upsertJobScheduler\(\s*"manufacturer-accept-sla-hourly"/.test(src),
    "yeni süpürme zamanlanmıyor"
  );
});

test("süpürme zinciri server-only IMPORT ETMİYOR", () => {
  // Worker standalone Node'da koşuyor; o import zinciri onu crash-loop'a sokar
  // (2026-06-13'te yaşandı).
  for (const rel of [WORKER, FLAGS, "src/lib/services/order-confirm.ts"]) {
    assert.ok(
      !/^\s*import\s+"server-only"/m.test(read(rel)),
      `${rel} server-only import ediyor`
    );
  }
});

if (failures > 0) {
  console.error(`\n${failures} sınama başarısız`);
  process.exit(1);
}
console.log("\nhepsi geçti");
