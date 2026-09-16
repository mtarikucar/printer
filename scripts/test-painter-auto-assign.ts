/**
 * Otomatik boyacı ataması (Faz 4) — saf kural testleri + kaynak taraması.
 * DB YOK, Redis YOK.
 *
 * Üç katman:
 *  1. Saf kapı (src/lib/config/flags.ts): bir siparişe otomatik boyacı atanır mı,
 *     atanmıyorsa SEBEBİ nedir. Kapının SIRASI kuralın kendisidir ve BUGÜNKÜ sıra
 *     şudur: iade → boyama yok → üretici kendi boyuyor → zaten boyacıda → baskı
 *     QC onayından geçmedi → anahtar EN SON. Anahtar sona alındı, çünkü en başta
 *     sorulduğunda boyacı İSTEMEYEN siparişlerin QC onayı bile admin'e "otomatik
 *     atama anahtarı kapalı, elle boyacı atayın" alarmı yazdırıyordu; sebep o
 *     sıradan çıktığı için sıra yanlışsa admin'e yazılan cümle de yanlış olur.
 *  2. Kaynak taraması: tetikleyici DOĞRU yerde mi, ret yolu işi üreticiye geri
 *     GÖNDERMİYOR mu ve üreticinin baskı hakedişi ret sırasında DURUYOR mu.
 *     Sonuncusu bir para kuralıdır: eski ret yolu hakedişi geri alıyordu, yani
 *     hiçbir hatası olmayan üreticinin parası siliniyordu.
 *  3. MODÜL GRAFİĞİ (çalışma zamanı DEĞİL): iki rota modülü ile servis tsx/Node
 *     altında import edilip tetikleyiciyi çağrılabilir buluyor mu.
 *
 *     BU KATMAN NE DEĞİLDİR: ölçülen arızanın kanıtı. O arızada (rota bağlamında
 *     `painterAssignRowGate is not a function`, QC onayı kimseyi atamıyor, ret 500)
 *     kıran şey Next/Turbopack'in [app-route] grafiğiydi; buradaki dinamik import
 *     tam da o sırada YEŞİL kalan tsx bağlamında koşar. Yani bu satırlar yalnız
 *     "import zinciri kopmuş/döngüye girmiş mi" sorusunu cevaplar — üretim rota
 *     grafiğinin ayakta olduğunu SÖYLEYEMEZ. Onun tek kanıtı çalışan bir sunucuya
 *     atılmış gerçek bir istektir (QA turları).
 *
 * Çalıştırma: npx tsx scripts/test-painter-auto-assign.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_ASSIGN_FLAG_KEYS,
  AI_SPEND_FLAG_KEYS,
  FLAG_DEFAULTS,
  FLAG_KEYS,
  FLAG_LABELS_TR,
  PAINTER_ASSIGN_FAILURE_LABELS_TR,
  PAINTER_ASSIGN_SKIP_LABELS_TR,
  PAINTER_MAX_DECLINES,
  PAINTER_MAX_REPLACEMENTS,
  isPainterAssignSkip,
  painterAssignReasonTr,
  painterAssignRowGate,
  painterDeclinesExhausted,
  painterParcelOnTheWay,
  painterUnplacedNeedsAdmin,
  type PainterAssignOutcomeReason,
  type PainterAssignOrderShape,
} from "../src/lib/config/flags";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Kaynağın YORUMSUZ hâli.
 *
 * Para kuralları "bu çağrı dosyada geçmiyor" diye sınanıyor ve yorumlar bu
 * soruyu kirletir: kaldırılan bir çağrının NEDEN kaldırıldığını anlatan yorum
 * (reverseEarning'in geçtiği açıklama bloğu) taramaya çağrının kendisi gibi
 * görünüyordu. Yargı KODA bakmalı, kodun anlatısına değil.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  ok  ", name);
  else {
    failed++;
    console.error("  FAIL", name, extra ?? "");
  }
}

// ─── Anahtar ────────────────────────────────────────────────────────────────
console.log("anahtar");

ok("boyacı ataması bir anahtara bağlı", (FLAG_KEYS as readonly string[]).includes("auto_assign_painter"));
ok("anahtar AÇIK doğar (yeni para harcamaz)", FLAG_DEFAULTS.auto_assign_painter === true);
ok(
  "anahtarın Türkçe etiketi var",
  (FLAG_LABELS_TR.auto_assign_painter ?? "").trim().length > 0
);
ok(
  "anahtar YÖNLENDİRME kümesinde (kill switch onu kapatmaz)",
  (AUTO_ASSIGN_FLAG_KEYS as readonly string[]).includes("auto_assign_painter") &&
    !(AI_SPEND_FLAG_KEYS as readonly string[]).includes("auto_assign_painter")
);

// ─── Kapı ───────────────────────────────────────────────────────────────────
console.log("uygunluk kapısı");

const base: PainterAssignOrderShape = {
  paymentStatus: "succeeded",
  needsPainting: true,
  manufacturerStatus: "qc_approved",
  painterId: null,
  painterStatus: null,
  manufacturerPaintsInHouse: false,
};
const gate = (o: Partial<PainterAssignOrderShape>, flagEnabled = true) =>
  painterAssignRowGate({ ...base, ...o }, flagEnabled);

ok("QC onaylı + boyamalı + boşta → atanır", gate({}) === null);
ok("anahtar kapalıysa atanmaz", gate({}, false) === "flag_off");
ok("iade edilmiş sipariş atanmaz", gate({ paymentStatus: "refunded" }) === "refunded");
ok(
  "iade kontrolü, işin durumundan ÖNCE gelir",
  gate({ paymentStatus: "refunded", needsPainting: false }) === "refunded"
);
ok("boyama kalemi yoksa atanmaz", gate({ needsPainting: false }) === "not_needed");
ok(
  "üretici kendi boyuyorsa boyacı atanmaz",
  gate({ manufacturerPaintsInHouse: true }) === "paints_in_house"
);
ok(
  "boyama yoksa 'kendi boyuyor' cevabı verilmez (sıra korunur)",
  gate({ needsPainting: false, manufacturerPaintsInHouse: true }) === "not_needed"
);
ok("zaten bir boyacıdaysa yeniden atanmaz", gate({ painterId: "p1" }) === "already_assigned");
ok(
  "boyacı kimliği boş ama durum doluysa da atanmaz",
  gate({ painterStatus: "assigned" }) === "already_assigned"
);
ok(
  "koparılmış (unassigned) sipariş yeniden atanabilir",
  gate({ painterStatus: "unassigned" }) === null
);
ok(
  "QC onayından önce atanmaz (ortada devredilecek parça yok)",
  gate({ manufacturerStatus: "printing" }) === "not_needed"
);
ok(
  "QC beklemedeki sipariş de atanmaz",
  gate({ manufacturerStatus: "qc_pending" }) === "not_needed"
);

// ── SEBEP DOĞRU OLMALI: anahtar EN SON sorulur ────────────────────────────
//
// Ölçülen kusur: anahtar en başta sorulduğu için boyacı İSTEMEYEN bir siparişin
// QC onayı bile admin'e "otomatik boyacı atama anahtarı kapalı… elle boyacı
// atayın" alarmı yazıyordu. Boyamasız her sipariş bir yanlış alarm demekti ve
// gerçek arıza o gürültünün altında kalırdı. Anahtar yalnız GERÇEKTEN boyacıya
// gidecek bir sipariş durdurulduğunda cevap olmalı.
ok(
  "anahtar kapalı + boyama yok → sebep 'boyama yok'",
  gate({ needsPainting: false }, false) === "not_needed"
);
ok(
  "anahtar kapalı + üretici kendi boyuyor → sebep 'kendi boyuyor'",
  gate({ manufacturerPaintsInHouse: true }, false) === "paints_in_house"
);
ok(
  "anahtar kapalı + iş zaten bir boyacıda → sebep 'zaten atanmış'",
  gate({ painterId: "p1" }, false) === "already_assigned"
);
ok(
  "anahtar kapalı + baskı QC'den geçmemiş → sebep 'hazır değil'",
  gate({ manufacturerStatus: "printing" }, false) === "not_needed"
);
ok(
  "anahtar kapalı + iade → sebep 'iade'",
  gate({ paymentStatus: "refunded" }, false) === "refunded"
);
ok(
  "anahtar kapalı + gerçekten boyacı bekleyen sipariş → 'flag_off' (alarm DOĞRU)",
  gate({}, false) === "flag_off"
);
ok(
  "yanlış alarm ölçüsü: yalnız flag_off insana çıkar, diğer üç sebep susar",
  painterUnplacedNeedsAdmin("flag_off", { painterDetached: false }) &&
    !painterUnplacedNeedsAdmin("not_needed", { painterDetached: false }) &&
    !painterUnplacedNeedsAdmin("paints_in_house", { painterDetached: false }) &&
    !painterUnplacedNeedsAdmin("already_assigned", { painterDetached: false })
);

// ─── Ret üst sınırı ─────────────────────────────────────────────────────────
console.log("ret üst sınırı");

// SAHİBİN CÜMLESİ: "bir ret ÜÇ KEZ yeniden seçer, sonra admin kuyruğuna gider".
// Ölçülen davranış iki yeniden seçimdi (ret #3 doğrudan admin kuyruğuna
// düşüyordu), çünkü sayaç redleri sayıyor ve işlenmekte olan ret de sayıya
// giriyor: ilk yerleştirme bir "yeniden seçim" değildir. Sayı burada çivilenir
// ki bir daha sessizce eksilmesin.
ok("kural ÜÇ yeniden yerleştirmedir", PAINTER_MAX_REPLACEMENTS === 3);
ok(
  "ret üst sınırı yeniden yerleştirme sayısından TÜRETİLİR",
  PAINTER_MAX_DECLINES === PAINTER_MAX_REPLACEMENTS + 1
);
ok("1. ret → yeniden yerleştirilir", !painterDeclinesExhausted(1));
ok("2. ret → yeniden yerleştirilir", !painterDeclinesExhausted(2));
ok("3. ret → yeniden yerleştirilir (üçüncü ve son deneme)", !painterDeclinesExhausted(3));
ok("4. ret → admin kuyruğu", painterDeclinesExhausted(4));
ok("üst sınırın üstü de admin kuyruğu", painterDeclinesExhausted(5));


// ─── Boyacısız kalan sipariş bir İNSANA çıkar ───────────────────────────────
//
// Ölçülen kusur: yalnız "aday yok" dalı admin'e not+e-posta yazıyordu. Anahtar
// kapalıyken ya da üretici kendi boyuyorken sipariş boyacısız kalıyor, üreticiye
// "sizden bir işlem beklenmiyor" deniyor ve kimse bakmıyordu.
console.log("atlama sessiz kalmaz");

const ALL_REASONS: PainterAssignOutcomeReason[] = [
  "flag_off",
  "not_needed",
  "paints_in_house",
  "already_assigned",
  "refunded",
  "no_candidate",
  "unexpected_error",
  "parcel_in_transit",
];
const needsAdmin = (r: PainterAssignOutcomeReason, painterDetached: boolean) =>
  painterUnplacedNeedsAdmin(r, { painterDetached });

ok("QC onayı: anahtar kapalıysa admin haber alır", needsAdmin("flag_off", false));
ok("QC onayı: uygun boyacı yoksa admin haber alır", needsAdmin("no_candidate", false));
ok("QC onayı: beklenmeyen hata admin'e çıkar", needsAdmin("unexpected_error", false));
ok("QC onayı: yoldaki paket admin'e çıkar", needsAdmin("parcel_in_transit", false));
ok("QC onayı: boyaması olmayan sipariş admin'i meşgul etmez", !needsAdmin("not_needed", false));
ok(
  "QC onayı: kendi boyayan üretici olağan akıştır, admin'e yazılmaz",
  !needsAdmin("paints_in_house", false)
);
ok("QC onayı: iade edilmiş sipariş kimseyi meşgul etmez", !needsAdmin("refunded", false));
ok(
  "boyacı KOPARILDIYSA her sebep admin'e çıkar (zaten atanmış hariç)",
  ALL_REASONS.filter((r) => r !== "already_assigned").every((r) => needsAdmin(r, true))
);
ok(
  "zaten başka boyacıdaysa iki bağlamda da sessiz kalınır",
  !needsAdmin("already_assigned", true) && !needsAdmin("already_assigned", false)
);

// Cevap HER ZAMAN Türkçe bir sebep taşır: "atanmadı" ile "neden atanmadı" aynı
// cümlede olmalı.
ok(
  "her sebebin Türkçe karşılığı var",
  ALL_REASONS.every((r) => painterAssignReasonTr(r).trim().length > 0),
  ALL_REASONS.filter((r) => !painterAssignReasonTr(r).trim())
);
ok(
  "sözlükler kapalı kümeyi tam kapsar",
  Object.keys(PAINTER_ASSIGN_SKIP_LABELS_TR).length === 6 &&
    Object.keys(PAINTER_ASSIGN_FAILURE_LABELS_TR).length === 2
);
// Arıza sebepleri sözleşmenin kapalı kümesine SIZMAMALI: SLA süpürmesi gibi
// kümeye tiplenmiş çağıranlar onları hiç görmemeli.
ok(
  "arıza sebepleri `skipped` kümesine sızmaz",
  !isPainterAssignSkip("unexpected_error") &&
    !isPainterAssignSkip("parcel_in_transit") &&
    isPainterAssignSkip("flag_off") &&
    isPainterAssignSkip("no_candidate")
);

// ─── Yoldaki paket ──────────────────────────────────────────────────────────
console.log("fiziksel paket kuralı");

ok(
  "takip numarası varsa paket yolda",
  painterParcelOnTheWay({ painterHandoffTrackingNumber: "1234567", receivedByPainterAt: null })
);
ok(
  "boyacı teslim aldıysa paket yolda",
  painterParcelOnTheWay({ painterHandoffTrackingNumber: null, receivedByPainterAt: new Date() })
);
ok(
  "izi olmayan sipariş devredilebilir",
  !painterParcelOnTheWay({ painterHandoffTrackingNumber: null, receivedByPainterAt: null })
);
ok(
  "boşluktan ibaret takip numarası kanıt sayılmaz",
  !painterParcelOnTheWay({ painterHandoffTrackingNumber: "   ", receivedByPainterAt: null })
);

// ─── Kaynak taraması ────────────────────────────────────────────────────────
console.log("kaynak taraması");

const SERVICE = "src/lib/services/painter-auto-assign.ts";
const DECLINE = "src/app/api/painter/orders/[id]/decline/route.ts";
const QC_APPROVE = "src/app/api/admin/orders/[id]/qc-approve/route.ts";
const ASSIGN = "src/app/api/admin/orders/[id]/assign-painter/route.ts";

const serviceSrc = read(SERVICE);
const declineSrc = read(DECLINE);
const qcSrc = read(QC_APPROVE);
const assignSrc = read(ASSIGN);

// Servis SLA süpürmesinden (standalone Node worker) de çağrılabilir olmalı.
ok(
  `${SERVICE}: server-only importu yok (worker zinciri)`,
  !/^\s*import\s+["']server-only["']/m.test(serviceSrc)
);
ok(
  `${QC_APPROVE}: QC onayı boyacı atamasını tetikler`,
  qcSrc.includes("assignPainterAutomatically(")
);
ok(
  `${QC_APPROVE}: tetik, QC kararı KAYDEDİLDİKTEN sonra çalışır`,
  qcSrc.indexOf("qcReviews") < qcSrc.indexOf("assignPainterAutomatically(")
);
ok(
  `${DECLINE}: ret sıradaki boyacıyı otomatik seçer`,
  declineSrc.includes("repickPainterAfterDecline(")
);

// PARA KURALI: ret, üreticinin baskı hakedişini geri ALMAZ. Üretici işi
// yapmıştır; boyacının işi bırakması onun parasını silemez. Yargı yalnız KODA
// bakar — kaldırılan çağrıyı anlatan yorum, çağrının kendisi sayılmamalı.
const declineCode = stripComments(declineSrc);
ok(
  `${DECLINE}: üreticinin baskı hakedişi ret sırasında geri alınmaz`,
  !declineCode.includes("reverseEarning("),
  declineCode.match(/.*reverseEarning.*/)?.[0]
);
ok(
  `${DECLINE}: hakediş satırı silinmez`,
  !/delete\(manufacturerEarnings\)/.test(declineCode),
  declineCode.match(/.*manufacturerEarnings.*/)?.[0]
);
// İŞ ÜRETİCİYE GERİ DÖNMEZ: üreticiden yeni bir boyacı seçmesi istenmemeli.
ok(
  `${DECLINE}: üreticiden başka bir boyacı seçmesi İSTENMEZ`,
  !/[Ll]ütfen başka bir boyacıya gönderin/.test(declineCode),
  declineCode.match(/.*başka bir boyacıya gönderin.*/)?.[0]
);

// Devir yazması ve devrin parası TEK kaynaktan gelmeli: admin rotası da
// otomatik yol da aynı hesabı kullanır.
ok(
  `${SERVICE}: devirde üreticinin payı ortak kaynaktan hesaplanır`,
  serviceSrc.includes("manufacturerBaseKurus(") && serviceSrc.includes("accrueEarning(")
);
ok(
  `${SERVICE}: yerleştirme korumalı (iade + QC + boyacısızlık)`,
  serviceSrc.includes("notRefundedGuard()") &&
    serviceSrc.includes('eq(orders.manufacturerStatus, "qc_approved")') &&
    /painterStatus[\s\S]*unassigned/.test(serviceSrc)
);
ok(
  `${SERVICE}: yerleştirme ve gerekçe kaydı AYNI işlemde`,
  /db\.transaction\(async \(tx\) => \{[\s\S]*tx\s*\n?\s*\.update\(orders\)[\s\S]*tx\.insert\(painterActions\)/.test(
    serviceSrc
  )
);
ok(
  `${SERVICE}: boyacının adresi YALNIZ üreticiye gider`,
  serviceSrc.includes("painterHandoffAddressTr(") &&
    serviceSrc.includes("notifyManufacturer({")
);
ok(
  `${ASSIGN}: admin ataması da ortak devir/bildirim yolunu kullanır`,
  assignSrc.includes("from \"@/lib/services/painter-auto-assign\"")
);

// Karar kaydı ORTAK yazıcıdan geçer: ikinci bir yazıcı (ham SQL) sütun eklendiği
// gün sessizce eski sütunları yazmaya devam ederdi.
ok(
  `${SERVICE}: karar kaydı ortak yazıcıdan yazılır`,
  serviceSrc.includes('from "@/lib/services/painter-evaluation"') &&
    !serviceSrc.includes("INSERT INTO painter_assignment_evaluations")
);
// Dışlama SIRALAMANIN İÇİNDE uygulanır: sonradan süzmek, kayda seçilemeyecek
// bir "kazanan" bırakır (üretici tarafında ölçülen hata).
ok(
  `${SERVICE}: dışlama sıralama ÇAĞRISINA geçer, sonradan süzülmez`,
  /rankPaintersForOrder\(orderId, \{\s*excludePainterIds: excluded,?\s*\}\)/.test(
    serviceSrc
  ) && !serviceSrc.includes("excluded.has("),
  serviceSrc.match(/.*excluded\.has\(.*/)?.[0]
);


// ── CEVAP HER ZAMAN SEBEP TAŞIR ────────────────────────────────────────────
//
// Ölçülen kusur: dış catch `{assigned:false}` dönüyordu — `skipped` boş, sebep
// yok, Türkçe mesaj yok. Rota 200 ile "atanmadı" diyordu ve NEDEN atanmadığını
// ne ekran ne admin öğrenebiliyordu.
const serviceCode = stripComments(serviceSrc);

// ── İADE KİMSENİN KAPASİTESİNİ TÜKETMEZ ───────────────────────────────────
//
// Ölçülen kusur: yerleştirmenin kapasite kapısı ham count(*) sayıyordu, oysa
// okuyan yüzeyler (sıralayıcının yükü, üretici seçicisi) iadeyi düşürüyordu.
// Tek işi iade edilmiş bir boyacı ekranlarda "uygun" görünüyor, uç ise onu
// "kapasitesi dolu" diye reddediyordu — kullanıcıya yapılamayacak bir seçim.
//
// İKİ ŞEKİL DE KABUL EDİLİR, çünkü ölçü ORTAK MODÜLE taşınıyor
// (src/lib/services/painter-capacity.ts): kapı ya o modüle DEVREDER, ya da hâlâ
// kendi sorgusunu kurar — ikincisinde iade süzgecini kendisi taşımak zorundadır.
// Devir hâlinde iadenin dışlandığını ortak modülün kendi testi çiviliyor
// (scripts/test-painter-capacity.ts), yani burada kimliklerin aranması yalnız
// göçten ÖNCEKİ şekil için anlamlı.
const placeBody = serviceCode.slice(
  serviceCode.indexOf("export async function placePainterOnOrder"),
  serviceCode.indexOf("export async function flagPainterManualAssignment")
);
const capacityDelegated =
  placeBody.includes("painterCapacityGate(") || placeBody.includes("loadPainterCapacity(");
ok(
  `${SERVICE}: kapasite kapısı iade edilmiş işi SAYMAZ`,
  capacityDelegated ||
    (placeBody.includes("ACTIVE_PAINTER_ORDER_STATUSES") &&
      placeBody.includes("REFUNDED_PAYMENT_STATUS")),
  placeBody.match(/.*ACTIVE_PAINTER_ORDER_STATUSES.*/)?.[0]
);

// ── SLA SÜPÜRMESİ: ÖNCE SOR, SONRA KOPAR ──────────────────────────────────
//
// Ölçülen kusur: süpürme işi boyacıdan koparıyor, anahtarı ancak yerleştirme
// çağrısının içinde soruyordu. Anahtar kapalıyken iş koparılmış ve yerine kimse
// konmamış hâlde kalıyordu — yani anahtarı kapatmak, siparişleri sahipsiz
// bırakan bir şeye dönüşüyordu.
const SLA_WORKER = "src/lib/queue/workers/painter-accept-sla.worker.ts";
const slaCode = stripComments(read(SLA_WORKER));
const idxFlagRead = slaCode.indexOf('isFlagEnabled("auto_assign_painter")');
const idxDetach = slaCode.indexOf("await detachStalePainter(");
ok(
  `${SLA_WORKER}: anahtar KOPARMADAN ÖNCE okunur`,
  idxFlagRead >= 0 && idxDetach >= 0 && idxFlagRead < idxDetach,
  { idxFlagRead, idxDetach }
);
ok(
  `${SLA_WORKER}: anahtar saf kurala geçer (karar tek yerde)`,
  /planPainterAcceptSla\(\{[\s\S]{0,400}?autoAssignEnabled,/.test(slaCode)
);
ok(
  `${SERVICE}: "atanmadı" cevabı sebepsiz dönemez`,
  serviceCode
    .split("assigned: false")
    .slice(1)
    .every((tail) => tail.slice(0, 200).includes("reason")),
  serviceCode.match(/.*assigned: false.*/)?.[0]
);
ok(
  `${SERVICE}: yerleştirilemeyen her dal ORTAK yapıcıdan çıkar`,
  !/return \{ assigned: false/.test(serviceCode),
  serviceCode.match(/.*return \{ assigned: false.*/)?.[0]
);
ok(
  `${SERVICE}: beklenmeyen hata da admin'e çıkar`,
  serviceCode.includes('reason: "unexpected_error"') &&
    /catch \(err\)[\s\S]{0,600}?announceUnplacedPainter\(/.test(serviceCode)
);
ok(
  `${SERVICE}: kapı atlamaları (anahtar kapalı, kendi boyuyor) sessiz kalmaz`,
  /if \(gate\) \{[\s\S]{0,400}?announceUnplacedPainter\(/.test(serviceCode)
);
ok(
  `${SERVICE}: kime haber verileceğine SAF kural karar verir`,
  serviceCode.includes("painterUnplacedNeedsAdmin(")
);

// ── YOLDAKİ PAKET: iş sessizce yeniden yerleştirilmez ──────────────────────
ok(
  `${SERVICE}: paket yoldayken yeniden yerleştirme yapılmaz`,
  /if \(painterParcelOnTheWay\(order\)\) \{[\s\S]{0,600}?return unplacedResult\("parcel_in_transit"\)/.test(
    serviceCode
  )
);
ok(
  `${SERVICE}: paket izi siparişten OKUNUR (kargo + teslim damgası)`,
  serviceCode.includes("painterHandoffTrackingNumber: true") &&
    serviceCode.includes("receivedByPainterAt: true")
);

// ── RET SONRASI YENİDEN YERLEŞTİRME FIRLATMAZ ──────────────────────────────
//
// Sözleşme eskiden yalnız yorumda yazıyordu ve gövde korumasızdı: ilk satırdaki
// saf çağrının fırlaması ret rotasını 500'e düşürüyor, boyacı koparılmış hâlde
// kalıyor, üreticiye tek kelime gitmiyordu.
const repickBody = serviceCode.slice(
  serviceCode.indexOf("export async function repickPainterAfterDecline")
);
ok(
  `${SERVICE}: repickPainterAfterDecline gövdesi try/catch içinde`,
  repickBody.includes("try {") &&
    repickBody.includes("} catch") &&
    repickBody.indexOf("try {") < repickBody.indexOf("painterDeclinesExhausted(")
);
ok(
  `${SERVICE}: ret üst sınırı dolduğunda KARAR KAYDI yazılır`,
  repickBody.includes("recordPainterDeclineCapReached(")
);
ok(
  `${SERVICE}: ret sonrası yerleştirme "boyacı koparıldı" bağlamıyla çağrılır`,
  /assignPainterAutomatically\([\s\S]{0,200}?painterDetached: true/.test(repickBody)
);

// ── RET ROTASI: koparmadan sonra ne 500 ne de sessizlik ────────────────────
const declineHandler = declineCode.slice(
  declineCode.indexOf("progress.detached = true"),
  declineCode.indexOf("export async function POST")
);
ok(
  `${DECLINE}: koparmadan sonrası try/catch ile korunur`,
  /progress\.detached = true;[\s\S]{0,600}?\n  try \{/.test(declineCode)
);
ok(
  `${DECLINE}: koparmadan sonra 500 dönülmez`,
  !declineHandler.includes("status: 500"),
  declineHandler.match(/.*status: 500.*/)?.[0]
);
const idxRepick = declineHandler.indexOf("repickPainterAfterDecline(");
ok(
  `${DECLINE}: üreticiye haber, yeniden yerleştirmenin BAŞARISINA bağlı değil`,
  idxRepick >= 0 &&
    // Yerleştirmeden SONRA gelen bildirim (iade dalınınki daha önce durur) var,
    // üç hâli de bir üçlü ifade ayırıyor ve hiçbiri `if (reassigned)` gibi bir
    // dalın içine gizlenmemiş: patlayan bir yerleştirme üreticiyi susturamaz.
    declineHandler.indexOf("notifyManufacturer(", idxRepick) > idxRepick &&
    declineHandler.includes("parcelInTransit") &&
    !/if \(reassigned\)/.test(declineHandler),
  declineHandler.slice(idxRepick, idxRepick + 120)
);
ok(
  `${DECLINE}: her başarı cevabı Türkçe bir mesaj taşır`,
  declineCode
    .split("success: true")
    .slice(1)
    .every((tail) => tail.slice(0, 900).includes("message")),
  declineCode.match(/.*success: true.*/)?.[0]
);
ok(
  `${DECLINE}: paket yoldayken üreticiden yeni kargo İSTENMEZ`,
  /Yeni bir kargo çıkarmayın/.test(declineCode)
);

// ── QC ONAYI: cevap sebebi ve Türkçesini taşır ─────────────────────────────
ok(
  `${QC_APPROVE}: cevap sebebi ve Türkçe mesajı taşır`,
  qcSrc.includes("painterAssignReason:") && qcSrc.includes("painterAssignMessage:")
);

// ─── MODÜL GRAFİĞİ (tsx/Node) ───────────────────────────────────────────────
//
// NE SINANIR: rota modülleri, servis ve kapı BU çalıştırıcıda (tsx/Node) import
// edilebiliyor ve dışa verdikleri fonksiyonlar çağrılabilir durumda mı. Kopmuş
// bir import, döngüye girmiş bir modül ya da silinmiş bir dışa verim buradan
// geçemez.
//
// NE SINANMAZ: üretimdeki rota grafiği. Ölçülen arızada (rota bağlamında
// `painterAssignRowGate is not a function`, QC onayı kimseyi atamıyor, ret 500)
// kıran şey Next/Turbopack'in [app-route] derlemesiydi ve bu dosya tam o sırada
// YEŞİL kalan bağlamda koşuyordu — yani bu bölüm o arızayı YAKALAMAZDI ve bir
// daha yakalayacağının garantisi de yoktur. Ayrıca kural burada koşmaz (DB
// ister). Çalışma zamanı kanıtı yalnız gerçek bir istektir.
async function routeContextChecks(): Promise<void> {
  const qc = await import("../src/app/api/admin/orders/[id]/qc-approve/route");
  ok(`${QC_APPROVE}: rota modülü yüklenir ve POST verir`, typeof qc.POST === "function");

  const dec = await import("../src/app/api/painter/orders/[id]/decline/route");
  ok(`${DECLINE}: rota modülü yüklenir ve POST verir`, typeof dec.POST === "function");

  const svc = await import("../src/lib/services/painter-auto-assign");
  ok(
    `${SERVICE}: tetikleyiciler rota grafiğinde çağrılabilir`,
    typeof svc.assignPainterAutomatically === "function" &&
      typeof svc.repickPainterAfterDecline === "function"
  );

  // SLA kuralı: anahtar kapalıyken iş KOPARILMAZ, yalnız bayraklanır.
  const sla = await import("../src/lib/queue/workers/painter-accept-sla.worker");
  const slaInput = {
    ageHours: 48,
    autoAssigned: true,
    parcelOnTheWay: false,
    alreadyFlagged: false,
  };
  const plan = (autoAssignEnabled?: boolean) =>
    JSON.stringify(
      sla.planPainterAcceptSla(
        autoAssignEnabled === undefined ? slaInput : { ...slaInput, autoAssignEnabled }
      )
    );
  ok("SLA: anahtar açıkken yanıtsız otomatik iş devredilir", plan(true) === '["reassign"]');
  ok(
    "SLA: anahtar KAPALIYKEN iş koparılmaz, yalnız bayraklanır",
    plan(false) === '["flag"]',
    plan(false)
  );
  ok("SLA: anahtar belirtilmezse açık sayılır (eski çağıranlar bozulmaz)", plan() === '["reassign"]');

  const flags = await import("../src/lib/config/flags");
  ok(
    "saf kapı fonksiyonları aynı grafikte ayakta",
    typeof flags.painterAssignRowGate === "function" &&
      typeof flags.painterDeclinesExhausted === "function" &&
      typeof flags.painterParcelOnTheWay === "function" &&
      typeof flags.painterUnplacedNeedsAdmin === "function"
  );
}

routeContextChecks()
  .catch((e) => {
    failed++;
    console.error("  FAIL", "rota bağlamı sınanamadı", (e as Error)?.message ?? e);
  })
  .finally(() => {
    console.log(failed ? `\n${failed} FAILED` : "\nall passed");
    process.exitCode = failed ? 1 : 0;
  });
