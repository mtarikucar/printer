/**
 * BOYACI KAPASİTESİ — tek ölçünün testi (Faz 4).
 *
 * Neden bu testler var: boyacının yükü iki ayrı biçimde sayılıyordu (ham iş
 * sayısı / ağırlıklı birim) ve iade yalnız birinde düşülüyordu. İki yön de
 * canlıda ölçüldü: tek işi İADE EDİLMİŞ boyacı ekranlarda "uygun" görünüp üç
 * yazma ucundan da 409/400 yiyordu; tersinden, tek bir PARTİ işi tutan boyacı
 * ekranlarda kapalı görünürken uçlar onu kabul ediyordu. Buradaki testler üç
 * şeyi kilitler:
 *   1. iade edilmiş iş HİÇBİR ZAMAN kapasite doldurmaz;
 *   2. kapı ile ekranlar AYNI fonksiyonu okur (tek eşik, tek boolean);
 *   3. kimse kendi kapasite sorgusunu kurmaz (kaynak tarayıcısı).
 *
 * DB YOK, Redis YOK: saf yarı çalıştırılır, geri kalanı kaynak denetimidir.
 *
 * Çalıştır: npx tsx scripts/test-painter-capacity.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  PAINTER_CAPACITY_FULL_ERROR,
  PAINTER_NOT_FOUND_ERROR,
  emptyPainterCapacity,
  foldPainterBench,
  painterHasRoom,
  painterLoadLabel,
  type PainterBenchRow,
} from "../src/lib/services/painter-capacity";
import { painterLoadUnits } from "../src/lib/config/painter-scoring";
import {
  scorePainters,
  type PainterScoringRow,
} from "../src/lib/services/painter-assignment";

const ROOT = join(__dirname, "..");
const OWNER = "src/lib/services/painter-capacity.ts";
const ownerSrc = readFileSync(join(ROOT, OWNER), "utf8");

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log("  ok  ", name);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.error("  FAIL", name, detail ?? "");
  }
}

/**
 * Yorumları at: yargı KODA bakmalı, kodun anlatısına değil. Bu dosyadaki
 * açıklamalar "count(*)" ya da "paymentStatus" gibi dizeleri ANLATTIĞI için
 * tarama, yorumları koddan saymazsa kendi anlatısını kod sanardı.
 * (scripts/test-painter-auto-assign.ts'teki kanıtlanmış yardımcının aynısı.)
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const ownerCode = stripComments(ownerSrc);

// ─── 1. SAF KAPI: tek eşik ──────────────────────────────────────────────────
console.log("\nsaf kapı (painterHasRoom)");

check("boş tezgâhta yer var", painterHasRoom({ loadUnits: 0, maxConcurrentOrders: 5 }));
check("sınırın altında yer var", painterHasRoom({ loadUnits: 4, maxConcurrentOrders: 5 }));
check("sınıra gelince yer YOK", !painterHasRoom({ loadUnits: 5, maxConcurrentOrders: 5 }));
check("sınırı aşınca yer YOK", !painterHasRoom({ loadUnits: 6, maxConcurrentOrders: 5 }));
// Kapasitesini sıfır beyan eden boyacı iş almaz; "0 < 0" yanlış olduğu için bu
// kural ayrı bir dal gerektirmez — ama sessizce tersine dönmesin diye pinlenir.
check(
  "kapasitesi sıfır beyan eden boyacı iş ALMAZ",
  !painterHasRoom({ loadUnits: 0, maxConcurrentOrders: 0 })
);
// Tek bir PARTİ işi (60 adet = 4 birim) kapasitesi 1 olan boyacıyı DOLDURUR.
// Ölçülen kusurun ayna yüzü buydu: uçlar iş SAYISI saydığı için bu boyacıyı
// kabul ediyordu.
check(
  "tek parti iş (60 adet) kapasitesi 1 olan boyacıyı doldurur",
  !painterHasRoom({ loadUnits: painterLoadUnits(60), maxConcurrentOrders: 1 })
);

// ─── 2. KAPI İLE EKRANLAR AYNI CEVABI VERİR ─────────────────────────────────
//
// Sıralayıcı (`scorePainters`) ekranların "uygun değil" dediği yerdir; kapı ise
// uçların reddettiği yer. İkisi ayrıştığı için kullanıcıya YAPILAMAYACAK bir
// seçim sunuluyordu. Burada davranışsal parite pinlenir: aynı yük/kapasite
// çiftinde ekranın `eligible`ı ile kapının `hasRoom`u aynı olmak ZORUNDA.
console.log("\nkapı ile ekran aynı eşiği okur");

function scoringRow(loadUnits: number, maxConcurrentOrders: number): PainterScoringRow {
  return {
    painterId: `p-${loadUnits}-${maxConcurrentOrders}`,
    companyName: "Test Boya",
    il: "İzmir",
    status: "active",
    acceptingOrders: true,
    maxConcurrentOrders,
    loadUnits,
    reliability: { good: 0, bad: 0 },
    qcQuality: { jobs: 0, reworkJobs: 0 },
    onTimeSpansDays: [],
  };
}

const grid: Array<[number, number]> = [
  [0, 1],
  [1, 1],
  [2, 1],
  [0, 5],
  [4, 5],
  [5, 5],
  [7, 5],
  [painterLoadUnits(60), 1],
  [painterLoadUnits(60), 5],
];
for (const [loadUnits, max] of grid) {
  const [candidate] = scorePainters({
    order: { manufacturerIl: "İzmir", customerIl: "İzmir" },
    painters: [scoringRow(loadUnits, max)],
  });
  const gate = painterHasRoom({ loadUnits, maxConcurrentOrders: max });
  check(
    `yük ${loadUnits}/${max}: ekran (${candidate.eligible}) ile kapı (${gate}) aynı`,
    candidate.eligible === gate,
    candidate.ineligibleReason
  );
}

// ─── 3. AĞIRLIKLI KATLAMA ───────────────────────────────────────────────────
console.log("\ntezgâh katlaması (foldPainterBench)");

function bench(rows: Array<[string, string, number | null]>): PainterBenchRow[] {
  return rows.map(([orderId, painterId, units]) => ({ orderId, painterId, units }));
}

const oneBulk = foldPainterBench(bench([["o1", "boyaci-a", 60]]));
check("tek parti iş = 1 iş", oneBulk.get("boyaci-a")?.activeJobs === 1);
check(
  "tek parti iş = ağırlıklı 4 birim",
  oneBulk.get("boyaci-a")?.loadUnits === painterLoadUnits(60),
  String(oneBulk.get("boyaci-a")?.loadUnits)
);

const threeSmall = foldPainterBench(
  bench([
    ["o1", "boyaci-a", 1],
    ["o2", "boyaci-a", 2],
    ["o3", "boyaci-a", 19],
  ])
);
check("üç küçük iş = 3 iş", threeSmall.get("boyaci-a")?.activeJobs === 3);
check("üç küçük iş = 3 birim (19 adet hâlâ tek birim)", threeSmall.get("boyaci-a")?.loadUnits === 3);

const mixed = foldPainterBench(
  bench([
    ["o1", "boyaci-a", 1],
    ["o2", "boyaci-a", 40],
    ["o3", "boyaci-b", 5],
  ])
);
check("boyacılar karışmaz (a)", mixed.get("boyaci-a")?.activeJobs === 2);
check(
  "boyacılar karışmaz (a birim)",
  mixed.get("boyaci-a")?.loadUnits === painterLoadUnits(1) + painterLoadUnits(40)
);
check("boyacılar karışmaz (b)", mixed.get("boyaci-b")?.loadUnits === 1);
check("tezgâhı boş boyacı haritada YOK", mixed.get("boyaci-c") === undefined);

const broken = foldPainterBench(bench([["o1", "boyaci-a", null]]));
check("adedi eksik iş yine de bir birim yer kaplar", broken.get("boyaci-a")?.loadUnits === 1);

// Ağırlık kuralı bu dosyada YENİDEN YAZILMAZ: tek kaynak painterLoadUnits.
const parity = [1, 2, 19, 20, 21, 39, 40, 60, 100].every((q) => {
  const folded = foldPainterBench(bench([["o", "p", q]]));
  return folded.get("p")?.loadUnits === painterLoadUnits(q);
});
check("katlama, painterLoadUnits'ten sapmaz", parity);

// ─── 4. YER YOK CEVABI VE ETİKET TEK KAYNAK ─────────────────────────────────
console.log("\nboş tezgâh satırı ve etiket");

const empty = emptyPainterCapacity("boyaci-x", 3);
check("boş tezgâh: 0 iş / 0 birim", empty.activeJobs === 0 && empty.loadUnits === 0);
check("boş tezgâh: yer var", empty.hasRoom);
check("kapasitesi sıfır olan boş boyacıda bile yer YOK", !emptyPainterCapacity("y", 0).hasRoom);
check(
  "etiket önce BİRİMİ söyler (kapı odur), iş sayısı arkada durur",
  painterLoadLabel({ activeJobs: 1, loadUnits: 4, maxConcurrentOrders: 5 }) === "4/5 birim · 1 iş",
  painterLoadLabel({ activeJobs: 1, loadUnits: 4, maxConcurrentOrders: 5 })
);
check("kapasite reddi Türkçe ve tek cümle", PAINTER_CAPACITY_FULL_ERROR.includes("kapasitesi dolu"));
check("boyacı bulunamadı cevabı Türkçe", PAINTER_NOT_FOUND_ERROR.includes("bulunamadı"));

// ─── 5. İADE EDİLMİŞ İŞ ASLA SAYILMAZ (kaynak) ──────────────────────────────
//
// Saf yarı iadeyi göremez (yalnız kendisine VERİLEN satırları katlar), bu yüzden
// kural SQL'de durur ve burada kaynakla pinlenir.
console.log("\niade edilmiş iş kapasite doldurmaz");

const benchQuery = ownerCode.slice(
  ownerCode.indexOf(".from(orders)"),
  ownerCode.indexOf("const itemUnits")
);
check(
  "tezgâh sorgusu iade edilmiş siparişi DIŞLAR",
  /ne\(\s*orders\.paymentStatus,\s*REFUNDED_PAYMENT_STATUS\s*\)/.test(benchQuery),
  benchQuery.match(/.*paymentStatus.*/)?.[0] ?? "paymentStatus filtresi YOK"
);
check(
  "tezgâh sorgusu ortak durum kümesini kullanır",
  benchQuery.includes("ACTIVE_PAINTER_ORDER_STATUSES")
);
check(
  "durum kümesi bu dosyada YENİDEN YAZILMAZ (import edilir)",
  /import\s*\{[^}]*ACTIVE_PAINTER_ORDER_STATUSES[^}]*\}\s*from/.test(ownerCode) &&
    !/ACTIVE_PAINTER_ORDER_STATUSES\s*=/.test(ownerCode)
);
check(
  "ağırlık kuralı bu dosyada YENİDEN YAZILMAZ (painterLoadUnits import edilir)",
  /import\s*\{[^}]*painterLoadUnits[^}]*\}\s*from/.test(ownerCode) &&
    !/function\s+painterLoadUnits/.test(ownerCode)
);
// Ham count(*) geri gelirse ölçü yeniden ikiye ayrılır: kapı birim sayar,
// biri count(*) eklerse o sayının nereye bağlandığı görünmez.
check(
  "modül siparişleri count(*) ile SAYMAZ (ölçü birimdir)",
  !/count\(\*\)/.test(ownerCode),
  ownerCode.match(/.*count\(\*\).*/)?.[0]
);
check(
  "katlama iade bilgisine hiç bakmaz (yalnız verileni katlar)",
  !stripComments(
    ownerSrc.slice(
      ownerSrc.indexOf("export function foldPainterBench"),
      ownerSrc.indexOf("export async function loadPainterCapacities")
    )
  ).includes("paymentStatus")
);

// ─── 6. TEK BOOLEAN: hasRoom yalnız saf kapıdan doğar ───────────────────────
console.log("\ntek boolean");

const hasRoomAssignments = ownerCode
  .split("\n")
  .filter((l) => /hasRoom\s*:/.test(l) && !/hasRoom\s*:\s*boolean/.test(l));
check("hasRoom en az bir yerde üretiliyor", hasRoomAssignments.length > 0);
check(
  "her hasRoom değeri painterHasRoom'dan gelir (elle eşik yok)",
  hasRoomAssignments.every((l) => l.includes("painterHasRoom(")),
  hasRoomAssignments.find((l) => !l.includes("painterHasRoom("))
);

// Eşik KARŞILAŞTIRMASI yalnız saf kapının içinde olmalı: ikinci bir
// "loadUnits >= max" satırı, sessizce ayrışan ikinci bir kural demektir.
const comparisonLines = ownerCode
  .split("\n")
  .map((l, i) => ({ l, i: i + 1 }))
  .filter(({ l }) => /maxConcurrentOrders\s*(<|>|<=|>=)|(<|>|<=|>=)\s*[\w.]*maxConcurrentOrders/.test(l));
const gateStart = ownerCode.indexOf("export function painterHasRoom");
const gateEnd = ownerCode.indexOf("export function emptyPainterCapacity");
const gateBody = ownerCode.slice(gateStart, gateEnd);
check(
  "kapasite eşiği YALNIZ painterHasRoom içinde karşılaştırılır",
  comparisonLines.every(({ l }) => gateBody.includes(l.trim())),
  comparisonLines.map(({ l, i }) => `${i}: ${l.trim()}`).join(" | ")
);

// ─── 7. SÖZLEŞME: dört düzelticinin kodlayacağı adlar ───────────────────────
//
// Bu adlar dört ayrı dosyadan import edilecek; biri yeniden adlandırılırsa
// düzelticiler soru soramadan kırılır. Ad kümesi burada pinlenir.
console.log("\ndışa verilen sözleşme");

for (const name of [
  "PainterCapacity",
  "PainterCapacityGate",
  "PAINTER_CAPACITY_FULL_ERROR",
  "PAINTER_NOT_FOUND_ERROR",
  "painterHasRoom",
  "emptyPainterCapacity",
  "painterLoadLabel",
  "foldPainterBench",
  "loadPainterCapacities",
  "loadPainterCapacity",
  "painterCapacityGate",
]) {
  check(
    `dışa veriliyor: ${name}`,
    new RegExp(`export\\s+(async\\s+)?(function|const|interface|type)\\s+${name}\\b`).test(ownerCode)
  );
}

// ─── 8. WORKER ZİNCİRİ GÜVENLİĞİ ────────────────────────────────────────────
//
// Otomatik yerleştirici bu modülü import ediyor ve o zincir BullMQ worker'ından
// da yürüyor: "server-only" import eden bir modül standalone Node worker'ını
// crash-loop'a sokar.
console.log("\nworker zinciri");

// Yargı KODA bakar: `order-status-policy.ts`in başlığı bu dizeyi tam da
// YASAKLAMAK için anıyor ("server-only" EKLEMEYİN), ve yorumu koddan saymayan
// bir tarama o uyarıyı ihlal sanırdı.
for (const f of [
  OWNER,
  "src/lib/services/painter-qc.ts",
  "src/lib/config/order-status-policy.ts",
  "src/lib/config/painter-scoring.ts",
]) {
  check(
    `${f}: "server-only" import etmiyor`,
    !/["']server-only["']/.test(stripComments(readFileSync(join(ROOT, f), "utf8")))
  );
}

// ─── 9. TARAYICI: kimse kendi kapasite sorgusunu kurmasın ───────────────────
//
// TEK ÖLÇÜNÜN KİLİDİ. Bir yüzey kendi sorgusunu kurarsa (bugün beş yerde
// olduğu gibi) iade filtresini unutabilir ya da başka bir birim sayabilir; kusur
// aynen geri gelir. Kapasiteyi okuyan HER yüzey painter-capacity.ts'ten
// okumalı.
console.log("\ntarayıcı: tek kapasite sorgusu");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// "KAPASİTE SAYAN SORGU" NEDİR: aktif iş kümesini kullanan VE yükü boyacı
// boyunca ölçen sorgu. TEK BİR SİPARİŞİN DURUM KAPISI bu değildir — örn.
// painter/orders/[id]/painted ve /received rotalarındaki
// `UPDATE ... WHERE orders.id = <sipariş> AND painterStatus IN (...)`, ya da
// revoke-after-painter'daki koparma kilidi. Onlar hiçbir şey saymaz ve kapasite
// modülünden GEÇMEMELİ; tarayıcı ikisini bilerek ayırır, yoksa düzelticiler bir
// durum kapısını kapasite sorgusuna çevirmeye çalışırdı.
const USES_ACTIVE_SET = /ACTIVE_PAINTER_ORDER_STATUSES/;
const MEASURES_LOAD: RegExp[] = [
  /count\(\*\)/, // ham iş sayımı
  /groupBy\(\s*orders\.painterId\s*\)/, // boyacı başına yük
  /isNotNull\(\s*orders\.painterId\s*\)/, // "tezgâhtaki tüm işler" taraması
  /\$\{orders\.painterId\}\s*IS NOT NULL/,
];
const offenders: string[] = [];
const clientImporters: string[] = [];
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  const code = stripComments(src);
  if (rel !== OWNER && USES_ACTIVE_SET.test(code) && MEASURES_LOAD.some((r) => r.test(code))) {
    const lines = src.split("\n");
    const hit = lines.findIndex((l) => MEASURES_LOAD.some((r) => r.test(l))) + 1;
    offenders.push(`${rel}:${hit}`);
  }
  // İstemci bileşeni bu modülü import EDEMEZ: `pg`yi paketine sürükler.
  if (/^\s*["']use client["']/m.test(src) && src.includes("services/painter-capacity")) {
    clientImporters.push(rel);
  }
}

check(
  "istemci bileşeni painter-capacity'yi import etmiyor",
  clientImporters.length === 0,
  clientImporters.join(", ")
);
check(
  `kapasite sorgusu YALNIZ ${OWNER} içinde kuruluyor`,
  offenders.length === 0,
  offenders.length
    ? `GEÇİŞ SÖZLEŞMESİ — bu ${offenders.length} yüzey hâlâ kendi sayımını yapıyor, painter-capacity.ts'e taşınmalı: ${offenders.join(", ")}`
    : undefined
);

// ─── Sonuç ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} geçti, ${fail} düştü`);
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
