/**
 * ÜRETİCİ KAPASİTESİ — tek ölçünün testi (Faz 5).
 *
 * Neden bu testler var: üreticinin yükü ÜÇ ayrı yerde, üç farklı tanımla
 * sayılıyordu (sıralayıcı + atölye seansı seçicisi: count(*), iade düşülmeden;
 * admin API'si: count(*), iade düşülmeden; /admin/manufacturers sayfası:
 * `status NOT IN ('delivered','rejected')` — bambaşka bir tezgâh tanımı). Ve
 * hepsinin ortak kusuru: 300 adetlik bir TOPLU sipariş TEK slot işgal ediyordu.
 *
 * Buradaki testler dört şeyi kilitler:
 *   1. ölçü AĞIRLIKLI birimdir (1 + her 20 adet için 1) ve ağırlık kuralı
 *      boyacı tarafıyla AYNI fonksiyondan gelir — ikinci bir kopya yok;
 *   2. iade edilmiş iş HİÇBİR ZAMAN kapasite doldurmaz;
 *   3. kapı ile ekranlar AYNI eşiği okur (tek boolean, tek karşılaştırma);
 *   4. kimse kendi kapasite sorgusunu kurmaz (kaynak tarayıcısı).
 *
 * Ayrıca büyük format SERT FİLTRESİNİ pinler: 120 mm üstü iş, yeteneği beyan
 * ETMEMİŞ bir atölyeye atanamaz — ve "hiç değerlendirilmemiş" atölye
 * istisnasının tam olarak nerede bittiğini.
 *
 * DB YOK, Redis YOK: saf yarı çalıştırılır, geri kalanı kaynak denetimidir.
 *
 * Çalıştır: npx tsx scripts/test-manufacturer-capacity.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  MANUFACTURER_CAPACITY_FULL_ERROR,
  MANUFACTURER_NOT_FOUND_ERROR,
  emptyManufacturerCapacity,
  foldManufacturerBench,
  manufacturerHasRoom,
  manufacturerLoadLabel,
  type ManufacturerBenchRow,
} from "../src/lib/services/manufacturer-capacity";
import { painterLoadUnits } from "../src/lib/config/painter-scoring";
import { loadScore } from "../src/lib/services/manufacturer-assignment";
import { largeFormatPlacementBlocked } from "../src/lib/services/manufacturer-assign";
import { SIZE_PRESETS, LEGACY_SIZE_PRESETS } from "../src/lib/config/sizes";
import { LARGE_FORMAT_MIN_MM } from "../src/lib/services/capability";

const ROOT = join(__dirname, "..");
const OWNER = "src/lib/services/manufacturer-capacity.ts";
const GATE = "src/lib/services/manufacturer-assign.ts";
const ownerSrc = readFileSync(join(ROOT, OWNER), "utf8");
const gateSrc = readFileSync(join(ROOT, GATE), "utf8");

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
 * Yorumları at: yargı KODA bakmalı, kodun anlatısına değil. Bu dosyalardaki
 * açıklamalar "count(*)" ya da "paymentStatus" gibi dizeleri ANLATTIĞI için
 * tarama, yorumları koddan saymazsa kendi anlatısını kod sanardı.
 * (scripts/test-painter-capacity.ts'teki kanıtlanmış yardımcının aynısı.)
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const ownerCode = stripComments(ownerSrc);
const gateCode = stripComments(gateSrc);

// ─── 1. SAF KAPI: tek eşik ──────────────────────────────────────────────────
console.log("\nsaf kapı (manufacturerHasRoom)");

check("boş tezgâhta yer var", manufacturerHasRoom({ loadUnits: 0, maxConcurrentOrders: 5 }));
check("sınırın altında yer var", manufacturerHasRoom({ loadUnits: 4, maxConcurrentOrders: 5 }));
check("sınıra gelince yer YOK", !manufacturerHasRoom({ loadUnits: 5, maxConcurrentOrders: 5 }));
check("sınırı aşınca yer YOK", !manufacturerHasRoom({ loadUnits: 6, maxConcurrentOrders: 5 }));
// Kapasitesini sıfır beyan eden atölye iş almaz; "0 < 0" yanlış olduğu için bu
// kural ayrı bir dal gerektirmez — ama sessizce tersine dönmesin diye pinlenir.
check(
  "kapasitesi sıfır beyan eden atölye iş ALMAZ",
  !manufacturerHasRoom({ loadUnits: 0, maxConcurrentOrders: 0 })
);
// FAZIN ÇEKİRDEK KUSURU: 300 parçalık tek bir toplu iş, kapasitesi 5 olan
// atölyeyi DOLDURUR. Bugüne kadar bu iş "1 slot" sayılıyordu ve aynı atölyeye
// dört tane daha yazılabiliyordu (1.500 figür).
check(
  "tek toplu iş (300 adet) kapasitesi 5 olan atölyeyi DOLDURUR",
  !manufacturerHasRoom({ loadUnits: painterLoadUnits(300), maxConcurrentOrders: 5 }),
  `300 adet = ${painterLoadUnits(300)} birim`
);
check(
  "sıradan iş (1 adet) kapasitesi 5 olan atölyeyi doldurmaz",
  manufacturerHasRoom({ loadUnits: painterLoadUnits(1), maxConcurrentOrders: 5 })
);

// ─── 2. KAPI İLE EKRAN AYNI EŞİĞİ OKUR ──────────────────────────────────────
//
// Sıralayıcının yük alt-skoru (`loadScore`) ekranın "yüksek yük / uygun değil"
// dediği yerdir; `manufacturerHasRoom` ise ucun reddettiği yer. İkisi aynı
// sınırda dönmek ZORUNDA: skor 0'a düştüğü anda kapı da kapanmalı. Ayrıştıkları
// gün ekran, ucun kabul ettiği bir atölyeyi kapatır (ya da tersi) — Faz 4'ün
// ölçülen kusuru tam olarak buydu.
console.log("\nkapı ile sıralayıcı aynı eşikte döner");

const grid: Array<[number, number]> = [
  [0, 1],
  [1, 1],
  [2, 1],
  [0, 5],
  [4, 5],
  [5, 5],
  [7, 5],
  [0, 0],
  [painterLoadUnits(300), 5],
  [painterLoadUnits(19), 1],
  [painterLoadUnits(20), 1],
];
for (const [loadUnits, max] of grid) {
  const screenClosed = loadScore(loadUnits, max) === 0;
  const gateClosed = !manufacturerHasRoom({ loadUnits, maxConcurrentOrders: max });
  check(
    `yük ${loadUnits}/${max}: ekran (${screenClosed ? "kapalı" : "açık"}) ile kapı (${gateClosed ? "kapalı" : "açık"}) aynı`,
    screenClosed === gateClosed
  );
}

// ─── 3. AĞIRLIKLI KATLAMA ───────────────────────────────────────────────────
console.log("\ntezgâh katlaması (foldManufacturerBench)");

function bench(rows: Array<[string, string, number | null]>): ManufacturerBenchRow[] {
  return rows.map(([orderId, manufacturerId, units]) => ({
    orderId,
    manufacturerId,
    units,
  }));
}

const oneBulk = foldManufacturerBench(bench([["o1", "atolye-a", 300]]));
check("tek toplu iş = 1 iş (gösterim)", oneBulk.get("atolye-a")?.activeJobs === 1);
check(
  "tek toplu iş = ağırlıklı 16 birim (kapı)",
  oneBulk.get("atolye-a")?.loadUnits === painterLoadUnits(300),
  String(oneBulk.get("atolye-a")?.loadUnits)
);

const threeSmall = foldManufacturerBench(
  bench([
    ["o1", "atolye-a", 1],
    ["o2", "atolye-a", 2],
    ["o3", "atolye-a", 19],
  ])
);
check("üç küçük iş = 3 iş", threeSmall.get("atolye-a")?.activeJobs === 3);
check(
  "üç küçük iş = 3 birim (19 adet hâlâ tek birim)",
  threeSmall.get("atolye-a")?.loadUnits === 3
);

const mixed = foldManufacturerBench(
  bench([
    ["o1", "atolye-a", 1],
    ["o2", "atolye-a", 40],
    ["o3", "atolye-b", 5],
  ])
);
check("atölyeler karışmaz (a)", mixed.get("atolye-a")?.activeJobs === 2);
check(
  "atölyeler karışmaz (a birim)",
  mixed.get("atolye-a")?.loadUnits === painterLoadUnits(1) + painterLoadUnits(40)
);
check("atölyeler karışmaz (b)", mixed.get("atolye-b")?.loadUnits === 1);
check("tezgâhı boş atölye haritada YOK", mixed.get("atolye-c") === undefined);

const broken = foldManufacturerBench(bench([["o1", "atolye-a", null]]));
check("adedi eksik iş yine de bir birim yer kaplar", broken.get("atolye-a")?.loadUnits === 1);

// AĞIRLIK KURALI TEK KAYNAK: boyacı tarafıyla AYNI fonksiyon. Üretici için ayrı
// bir "+1 / 20 adet" uygulaması yazılsaydı, biri 20 öteki 25 olduğu gün kimse
// fark etmezdi (capacity-unit kararı: iki rol için TEK kural).
const parity = [1, 2, 19, 20, 21, 39, 40, 60, 100, 300].every((q) => {
  const folded = foldManufacturerBench(bench([["o", "m", q]]));
  return folded.get("m")?.loadUnits === painterLoadUnits(q);
});
check("katlama, ortak ağırlık kuralından (painterLoadUnits) sapmaz", parity);

// ─── 4. BOŞ TEZGÂH SATIRI VE ETİKET TEK KAYNAK ──────────────────────────────
console.log("\nboş tezgâh satırı ve etiket");

const empty = emptyManufacturerCapacity("atolye-x", 3);
check("boş tezgâh: 0 iş / 0 birim", empty.activeJobs === 0 && empty.loadUnits === 0);
check("boş tezgâh: yer var", empty.hasRoom);
check("kapasitesi sıfır olan boş atölyede bile yer YOK", !emptyManufacturerCapacity("y", 0).hasRoom);
check(
  "etiket önce BİRİMİ söyler (kapı odur), iş sayısı arkada durur",
  manufacturerLoadLabel({ activeJobs: 1, loadUnits: 16, maxConcurrentOrders: 5 }) ===
    "16/5 birim · 1 iş",
  manufacturerLoadLabel({ activeJobs: 1, loadUnits: 16, maxConcurrentOrders: 5 })
);
check(
  "kapasite reddi Türkçe ve tek cümle",
  MANUFACTURER_CAPACITY_FULL_ERROR.includes("kapasitesi dolu")
);
check("üretici bulunamadı cevabı Türkçe", MANUFACTURER_NOT_FOUND_ERROR.includes("bulunamadı"));

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
// İade kuralının TEK kaynağı sabittir. Kapı (`notRefundedGuard`) ile bu modül
// aynı SQL'i üretir ama import döngüsü olmasın diye ayrı yazılır; ikisinin de
// düz "refunded" dizesi YAZMAMASI, tek kaynağın kanıtıdır.
check(
  "kapasite modülü düz 'refunded' dizesi yazmaz (sabitten okur)",
  !/["']refunded["']/.test(ownerCode),
  ownerCode.match(/.*["']refunded["'].*/)?.[0]
);
check(
  "atama kapısı da düz 'refunded' dizesi yazmaz (aynı sabit)",
  !/["']refunded["']/.test(gateCode),
  gateCode.match(/.*["']refunded["'].*/)?.[0]
);
check(
  "tezgâh sorgusu ortak durum kümesini kullanır",
  benchQuery.includes("ACTIVE_MFG_STATUSES")
);
check(
  "tezgâh sorgusu boyacıya devredilmiş işi dışlar (ortak yardımcı)",
  benchQuery.includes("orderStillOnManufacturerBench()")
);
check(
  "durum kümesi bu dosyada YENİDEN YAZILMAZ (import edilir)",
  /import\s*\{[\s\S]*?ACTIVE_MFG_STATUSES[\s\S]*?\}\s*from/.test(ownerCode) &&
    !/ACTIVE_MFG_STATUSES\s*=/.test(ownerCode)
);
check(
  "ağırlık kuralı bu dosyada YENİDEN YAZILMAZ (painterLoadUnits import edilir)",
  /import\s*\{[\s\S]*?painterLoadUnits[\s\S]*?\}\s*from/.test(ownerCode) &&
    !/function\s+painterLoadUnits/.test(ownerCode)
);
// Ham count(*) geri gelirse ölçü yeniden ikiye ayrılır.
check(
  "modül siparişleri count(*) ile SAYMAZ (ölçü birimdir)",
  !/count\(\*\)/.test(ownerCode),
  ownerCode.match(/.*count\(\*\).*/)?.[0]
);
check(
  "katlama iade bilgisine hiç bakmaz (yalnız verileni katlar)",
  !stripComments(
    ownerSrc.slice(
      ownerSrc.indexOf("export function foldManufacturerBench"),
      ownerSrc.indexOf("export async function loadManufacturerCapacities")
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
  "her hasRoom değeri manufacturerHasRoom'dan gelir (elle eşik yok)",
  hasRoomAssignments.every((l) => l.includes("manufacturerHasRoom(")),
  hasRoomAssignments.find((l) => !l.includes("manufacturerHasRoom("))
);

// Eşik KARŞILAŞTIRMASI yalnız saf kapının içinde olmalı: ikinci bir
// "loadUnits >= max" satırı, sessizce ayrışan ikinci bir kural demektir.
const comparisonLines = ownerCode
  .split("\n")
  .map((l, i) => ({ l, i: i + 1 }))
  .filter(({ l }) =>
    /maxConcurrentOrders\s*(<|>|<=|>=)|(<|>|<=|>=)\s*[\w.]*maxConcurrentOrders/.test(l)
  );
const gateStart = ownerCode.indexOf("export function manufacturerHasRoom");
const gateEnd = ownerCode.indexOf("export function emptyManufacturerCapacity");
const gateBody = ownerCode.slice(gateStart, gateEnd);
check(
  "kapasite eşiği YALNIZ manufacturerHasRoom içinde karşılaştırılır",
  comparisonLines.every(({ l }) => gateBody.includes(l.trim())),
  comparisonLines.map(({ l, i }) => `${i}: ${l.trim()}`).join(" | ")
);

// ─── 7. ATAMA KAPISI ORTAK ÖLÇÜYÜ OKUR ──────────────────────────────────────
//
// Siparişe üretici yazan TEK NOKTA burasıdır (admin tek/toplu atama, otomatik
// atama, ret sonrası devir, geri alma sonrası devir, atama taraması — hepsi
// buradan geçer). Kapasite kapısı burada DEĞİLSE, ekranların gösterdiği "dolu"
// hiçbir şeyi engellemez.
console.log("\natama kapısı (manufacturer-assign.ts)");

check(
  "kapı ortak kapasite ölçüsünü çağırır",
  gateCode.includes("manufacturerCapacityGate("),
  "manufacturerCapacityGate çağrısı YOK"
);
check(
  "kapı kendi yük sayımını KURMAZ",
  !/count\(\*\)/.test(gateCode) && !/ACTIVE_MFG_STATUSES/.test(gateCode)
);
check(
  "AssignFailure `capacity_full` üyesini taşır",
  /\|\s*"capacity_full"/.test(gateCode)
);
check(
  "AssignFailure `large_format_required` üyesini taşır",
  /\|\s*"large_format_required"/.test(gateCode)
);
check(
  "kapasite reddinin Türkçe cümlesi ortak sabitten gelir (ikinci kopya yok)",
  /capacity_full:\s*MANUFACTURER_CAPACITY_FULL_ERROR/.test(gateCode),
  gateCode.match(/capacity_full:[^,]*/)?.[0]
);
check(
  "büyük format reddi GERÇEK sebebi söyler (ölçü + beyan)",
  /large_format_required:[\s\S]{0,400}large_format/.test(gateCode) &&
    /large_format_required:[\s\S]{0,400}LARGE_FORMAT_MIN_MM/.test(gateCode)
);
// Kalıcı uyumsuzluk, geçici kapasiteden ÖNCE söylenmeli: "kapasitesi dolu"
// cevabı admin'i yarın tekrar denemeye gönderir, oysa yetenek eksikse hiçbir
// zaman çalışmayacaktır.
check(
  "büyük format kapısı kapasite kapısından ÖNCE gelir",
  gateCode.indexOf("largeFormatPlacementBlocked(") <
    gateCode.indexOf("manufacturerCapacityGate("),
  `${gateCode.indexOf("largeFormatPlacementBlocked(")} / ${gateCode.indexOf("manufacturerCapacityGate(")}`
);
// Her iki kapı da korumalı UPDATE'ten ÖNCE olmalı: sonrasında reddetmek,
// atanmış bir siparişi "atanmadı" diye raporlamak olurdu.
check(
  "iki kapı da korumalı UPDATE'ten ÖNCE çalışır",
  gateCode.indexOf("manufacturerCapacityGate(") < gateCode.indexOf(".update(orders)")
);

// ─── 8. BÜYÜK FORMAT: SERT FİLTRE ───────────────────────────────────────────
//
// Sahibin kararı: 120 mm üstü iş yalnız yeteneği BEYAN EDEN atölyeye gider.
// Bugün bu yetenek tanımlı ve hiçbir yerde kontrol edilmiyordu.
console.log("\nbüyük format sert filtresi");

const SELLABLE = SIZE_PRESETS[0].key; // 150 mm — satılan tek ürün
const SMALL = LEGACY_SIZE_PRESETS.find((p) => p.heightMm < LARGE_FORMAT_MIN_MM)!.key;

check(
  "satılan tek ürün zaten eşiğin üstünde (filtre gerçekten devrede)",
  SIZE_PRESETS[0].heightMm >= LARGE_FORMAT_MIN_MM,
  `${SIZE_PRESETS[0].heightMm}mm / ${LARGE_FORMAT_MIN_MM}mm`
);
check(
  "yeteneği beyan eden atölye engellenmez",
  !largeFormatPlacementBlocked(SELLABLE, ["material_resin", "large_format"])
);
check(
  "yönlendirme etiketi olan ama large_format'ı OLMAYAN atölye ENGELLENİR",
  largeFormatPlacementBlocked(SELLABLE, ["material_resin", "style_anime"])
);
// "Değerlendirilmemiş atölye" istisnası: bugün hiçbir yüzey large_format
// yazamıyor (kayıt formu yalnız malzeme soruyor, admin ve partner formları da
// yalnız material_* etiketine dokunuyor). İstisna olmasaydı sert filtre BUGÜN
// her siparişi her atölyeye kapatırdı — platformda tek bir iş bile atanamazdı.
check(
  "hiç etiketi olmayan (değerlendirilmemiş) atölye bugünkü davranışı korur",
  !largeFormatPlacementBlocked(SELLABLE, [])
);
check(
  "yalnız malzeme etiketi olan atölye de değerlendirilmemiş sayılır",
  !largeFormatPlacementBlocked(SELLABLE, ["material_resin", "material_filament"])
);
check(
  "etiketi null olan atölye de değerlendirilmemiş sayılır",
  !largeFormatPlacementBlocked(SELLABLE, null)
);
check(
  "eşiğin ALTINDAKİ iş hiçbir atölyede engellenmez",
  !largeFormatPlacementBlocked(SMALL, ["style_anime"]),
  SMALL
);
check(
  "serbest ölçü (preset değil) sert filtre doğurmaz",
  !largeFormatPlacementBlocked("17,5 cm", ["style_anime"])
);
check(
  "ölçüsü bilinmeyen sipariş engellenmez",
  !largeFormatPlacementBlocked(null, ["style_anime"])
);
// Kural YENİDEN YAZILMAZ: hangi işin büyük format istediğini orderRequirements,
// beyanın yeterliliğini capabilityMatch söyler.
check(
  "büyük format kuralı saf yeteneğin kendi fonksiyonlarından okunur",
  gateCode.includes("orderRequirements(") && gateCode.includes("capabilityMatch("),
);
check(
  "eşik (120 mm) kapıda YENİDEN YAZILMAZ",
  !/\b120\b/.test(gateCode),
  gateCode.match(/.*\b120\b.*/)?.[0]
);

// ─── 9. DIŞA VERİLEN SÖZLEŞME ───────────────────────────────────────────────
//
// Bu adlar başka dosyalardan import edilecek (admin listesi, admin API'si, atama
// kapısı ve —taşındığında— sıralayıcı); biri yeniden adlandırılırsa çağıranlar
// soru soramadan kırılır.
console.log("\ndışa verilen sözleşme");

for (const name of [
  "ManufacturerCapacity",
  "ManufacturerCapacityGate",
  "MANUFACTURER_CAPACITY_FULL_ERROR",
  "MANUFACTURER_NOT_FOUND_ERROR",
  "manufacturerHasRoom",
  "emptyManufacturerCapacity",
  "manufacturerLoadLabel",
  "foldManufacturerBench",
  "loadManufacturerCapacities",
  "loadManufacturerCapacity",
  "manufacturerCapacityGate",
]) {
  check(
    `dışa veriliyor: ${name}`,
    new RegExp(`export\\s+(async\\s+)?(function|const|interface|type)\\s+${name}\\b`).test(
      ownerCode
    )
  );
}

// ─── 10. WORKER ZİNCİRİ GÜVENLİĞİ ───────────────────────────────────────────
//
// Atama kapısı bu modülü import ediyor ve o zincir BullMQ worker'ından da
// yürüyor: "server-only" import eden bir modül standalone Node worker'ını
// crash-loop'a sokar (2026-06-13).
console.log("\nworker zinciri");

for (const f of [
  OWNER,
  GATE,
  "src/lib/services/manufacturer-assignment.ts",
  "src/lib/services/capability.ts",
  "src/lib/config/order-status-policy.ts",
  "src/lib/config/painter-scoring.ts",
]) {
  check(
    `${f}: "server-only" import etmiyor`,
    !/["']server-only["']/.test(stripComments(readFileSync(join(ROOT, f), "utf8")))
  );
}

// ─── 11. TARAYICI: kimse kendi kapasite sorgusunu kurmasın ──────────────────
//
// TEK ÖLÇÜNÜN KİLİDİ. Bir yüzey kendi sorgusunu kurarsa iade filtresini
// unutabilir ya da ham iş sayısı sayabilir; kusur aynen geri gelir.
//
// GEÇİŞ SÖZLEŞMESİ: aşağıdaki iki dosya HÂLÂ kendi sayımını yapıyor ve bu
// düzelticinin mülkiyetinde DEĞİL (bkz. crossOwnerRequest). Onlar UYARI üretir,
// testi düşürmez — ama listede OLMAYAN yeni bir sayım testi DÜŞÜRÜR. Liste
// sıfıra inmelidir: bir dosya taşındığında son adım, onu bu listeden silmektir.
console.log("\ntarayıcı: tek kapasite sorgusu");

const TRANSITION: Record<string, string> = {
  "src/lib/services/manufacturer-assignment.ts":
    "sıralayıcı: currentLoad hâlâ count(*) — ağırlıklı ölçüye taşınmalı (ranker sahibi)",
  "src/app/admin/workshops/[venueId]/page.tsx":
    "atölye seansı üretici seçicisi: kendi count(*) sayımı (atölye seansı sahibi)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// "KAPASİTE SAYAN SORGU" NEDİR: üreticinin aktif iş kümesini kullanan VE yükü
// atölye boyunca ölçen sorgu. TEK BİR SİPARİŞİN durum kapısı bu değildir
// (örn. `UPDATE ... WHERE orders.id = <sipariş> AND manufacturerStatus IN (...)`):
// o hiçbir şey saymaz ve kapasite modülünden geçmemeli.
const USES_ACTIVE_SET = /ACTIVE_MFG_STATUSES/;
const MEASURES_LOAD: RegExp[] = [
  /count\(\*\)/, // ham iş sayımı
  /groupBy\(\s*orders\.manufacturerId\s*\)/, // atölye başına yük
  /\$\{orders\.manufacturerId\}\s*IS NOT NULL/, // "tezgâhtaki tüm işler" taraması
  /isNotNull\(\s*orders\.manufacturerId\s*\)/,
];
const offenders: string[] = [];
const warned: string[] = [];
const clientImporters: string[] = [];
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  const code = stripComments(src);
  if (rel !== OWNER && USES_ACTIVE_SET.test(code) && MEASURES_LOAD.some((r) => r.test(code))) {
    const lines = src.split("\n");
    const hit = lines.findIndex((l) => MEASURES_LOAD.some((r) => r.test(l))) + 1;
    if (TRANSITION[rel]) warned.push(`${rel}:${hit} — ${TRANSITION[rel]}`);
    else offenders.push(`${rel}:${hit}`);
  }
  // İstemci bileşeni bu modülü import EDEMEZ: `pg`yi paketine sürükler.
  if (/^\s*["']use client["']/m.test(src) && src.includes("services/manufacturer-capacity")) {
    clientImporters.push(rel);
  }
}

for (const w of warned) console.log("  UYARI", w);

check(
  "istemci bileşeni manufacturer-capacity'yi import etmiyor",
  clientImporters.length === 0,
  clientImporters.join(", ")
);
check(
  `kapasite sorgusu YALNIZ ${OWNER} içinde kuruluyor (geçiş listesi hariç)`,
  offenders.length === 0,
  offenders.length
    ? `bu ${offenders.length} yüzey kendi sayımını yapıyor, manufacturer-capacity.ts'e taşınmalı: ${offenders.join(", ")}`
    : undefined
);

// Düzeltilen iki yüzey GERİ DÖNMESİN: ikisi de artık ortak ölçüyü import eder.
for (const rel of [
  "src/app/admin/manufacturers/page.tsx",
  "src/app/api/admin/manufacturers/route.ts",
]) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  check(
    `${rel}: yükü ortak ölçüden okur`,
    src.includes("loadManufacturerCapacities("),
    "kendi sayımına geri dönmüş olabilir"
  );
}

// Ekran, ucun uygulamadığı bir ölçüyle kimseyi kapatamaz: admin listesi kapının
// ETİKETİNİ ve BOOLEAN'ını gösterir, kendi eşiğini kurmaz.
{
  const rel = "src/app/admin/manufacturers/manufacturers-client.tsx";
  const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
  check(
    `${rel}: yük etiketi kapının ölçüsünden gelir`,
    src.includes("loadLabel"),
    "ham activeOrders gösteriyor olabilir"
  );
  check(
    `${rel}: doluluk kararını kendi eşiğiyle vermez`,
    !/activeOrders\s*>=?\s*[\w.]*maxConcurrentOrders/.test(src) &&
      !/loadUnits\s*>=?\s*[\w.]*maxConcurrentOrders/.test(src),
    "ekranda elle eşik var"
  );
}

// ─── Sonuç ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} geçti, ${fail} düştü`);
if (warned.length > 0) {
  console.log(`${warned.length} geçiş uyarısı (sahibi başka düzelticide):`);
  for (const w of warned) console.log(`  - ${w}`);
}
if (fail > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
