/**
 * Partner model-sürümü onayı + QC sürüm damgası — saf mantık ve KAYNAK
 * taraması. Veritabanı gerektirmez.
 *
 * Kaynak taraması neden var: bu fazın garantisi ("eski modelin baskısı QC'den
 * geçemez, onaylanmamış sürümle üretim ilerleyemez") tek bir saf fonksiyonda
 * değil, uçların o fonksiyonu ÇAĞIRMASINDA yaşıyor. Kural bir kez daha
 * yalnızca ekranda kalırsa (bu fazın ilk hâli tam olarak öyleydi) testler
 * yeşil kalırdı. Bu yüzden uçların gerçekten kapıyı okuduğu dosya üzerinden
 * doğrulanır.
 *
 * Çalıştırma: npx tsx scripts/test-partner-model-ack.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PARTNER_MODEL_ACK_ACTION,
  PARTNER_MODEL_REVISION_ACTION,
  MANUFACTURER_ACK_BLOCKED_ACTIONS,
  MODEL_ACK_REQUIRED_ERROR,
  PAINTER_ACK_BLOCKED_ACTIONS,
  STALE_QC_OVERRIDE_REASON_ERROR,
  STALE_QC_OVERRIDE_REASON_MIN,
  STALE_QC_REVISION_CODE,
  formatModelRevisionNote,
  modelAckState,
  modelRevisionNoticeTr,
  parseModelRevisionNote,
  partnerAckTargets,
  staleQcRevisionErrorTr,
  type PartnerActionRow,
} from "../src/lib/config/partner-model-ack";
import {
  modelUploadSideEffects,
  type ModelUploadStage,
} from "../src/lib/config/order-model-policy";

const REPO_ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** Üreticinin ileri adım uçları: engellenen eylem adı → rota dosyası. */
const MANUFACTURER_ROUTES: Record<string, string> = {
  "start-printing": "src/app/api/manufacturer/orders/[id]/start-printing/route.ts",
  "finish-printing": "src/app/api/manufacturer/orders/[id]/finish-printing/route.ts",
  "submit-qc": "src/app/api/manufacturer/orders/[id]/submit-qc/route.ts",
  ship: "src/app/api/manufacturer/orders/[id]/ship/route.ts",
  "send-to-painter": "src/app/api/manufacturer/orders/[id]/send-to-painter/route.ts",
};
const PAINTER_ROUTES: Record<string, string> = {
  "submit-qc": "src/app/api/painter/orders/[id]/submit-qc/route.ts",
  ship: "src/app/api/painter/orders/[id]/ship/route.ts",
};
/**
 * Kapının REDDİ nereden geliyor?
 *
 * DOĞRUSU `modelAckRefusal(ack)`: gerekçeyi ve HTTP kodunu tek yerden üretir.
 * Onay bekleyen sürüm 409 + ortak cümle, onay günlüğü OKUNAMADIYSA 503 + "geçici
 * arıza" cümlesi. Eski biçim (`if (ack.pending)` + elle yazılan ortak cümle)
 * arıza dalını YUTAR: partner, sistemin bilmediği bir yüklemeyi ("yeni bir model
 * sürümü yüklendi") okur, o cümlenin gösterdiği onay düğmesine basar ve boş
 * gövdeli bir 500 alır.
 *
 * LİSTE BOŞ VE BÖYLE KALMALI. Önceki turda yalnız iki kargo ucu bağlıydı;
 * üreticinin üç üretim adımı, boyacıya devir ve boyacının QC ucu da artık
 * modelAckRefusal'dan geçiyor. Yeni bir uç eklenirse varsayılan BAĞLI biçimdir
 * — buraya bir satır eklemek, o uçta partnere yanlış gerekçe göstermeyi bilerek
 * kabul etmek demektir.
 */
const ACK_REFUSAL_NOT_WIRED_YET = new Set<string>();

function assertAckRefusal(rel: string, src: string, label: string) {
  if (ACK_REFUSAL_NOT_WIRED_YET.has(rel)) {
    assert.match(src, /MODEL_ACK_REQUIRED_ERROR/, `${label}: ortak Türkçe mesaj kullanılmıyor`);
    assert.match(src, /ack\.pending/, `${label}: bekleyen onay kontrol edilmiyor`);
    return;
  }
  assert.match(
    src,
    /modelAckRefusal\(/,
    `${label}: ret tek kaynaktan gelmiyor — modelAckRefusal(ack) kullanın`
  );
  assert.doesNotMatch(
    src,
    /if \(ack\.pending\)/,
    `${label}: arıza dalını yutan eski kapı geri gelmiş (pending tek başına)`
  );
}

const QC_PHOTOS_ROUTE = "src/app/api/manufacturer/orders/[id]/qc-photos/route.ts";
const QC_APPROVE_ROUTE = "src/app/api/admin/orders/[id]/qc-approve/route.ts";
const ADMIN_ORDER_PAGE = "src/app/admin/orders/[id]/client.tsx";

let passed = 0;
const cases: Array<[string, () => void]> = [];

function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

const announce = (rev: number, note?: string): PartnerActionRow => ({
  action: PARTNER_MODEL_REVISION_ACTION,
  notes: formatModelRevisionNote(rev, note),
});
const ack = (rev: number): PartnerActionRow => ({
  action: PARTNER_MODEL_ACK_ACTION,
  notes: formatModelRevisionNote(rev),
});

// ─── Not biçimi: yazan ve okuyan aynı yerde ─────────────────────
test("format → rev:3", () => {
  assert.equal(formatModelRevisionNote(3), "rev:3");
});

test("format, not ile → rev:3 — kaide düzeltildi", () => {
  assert.equal(formatModelRevisionNote(3, "kaide düzeltildi"), "rev:3 — kaide düzeltildi");
});

test("format boş notu yok sayar", () => {
  assert.equal(formatModelRevisionNote(2, "   "), "rev:2");
});

test("parse rev:7 → 7", () => {
  assert.equal(parseModelRevisionNote("rev:7"), 7);
});

test("parse rev:12 — açıklama → 12", () => {
  assert.equal(parseModelRevisionNote("rev:12 — yeniden dilimlendi"), 12);
});

test("parse elle yazılmış not → null", () => {
  assert.equal(parseModelRevisionNote("[Admin geri aldı] sebep"), null);
});

test("parse null/boş → null", () => {
  assert.equal(parseModelRevisionNote(null), null);
  assert.equal(parseModelRevisionNote(""), null);
});

test("parse rev:0 → null (sürüm 1'den başlar)", () => {
  assert.equal(parseModelRevisionNote("rev:0"), null);
});

// ─── Onay durumu ────────────────────────────────────────────────
test("duyuru yoksa onay beklenmez (eski siparişler etkilenmez)", () => {
  const s = modelAckState([{ action: "accept", notes: null }]);
  assert.equal(s.pending, false);
  assert.equal(s.announcedRevision, null);
});

test("duyuru var, onay yok → bekliyor", () => {
  const s = modelAckState([announce(2)]);
  assert.equal(s.pending, true);
  assert.equal(s.announcedRevision, 2);
  assert.equal(s.acknowledgedRevision, null);
});

test("aynı sürüm onaylandı → beklemiyor", () => {
  const s = modelAckState([announce(2), ack(2)]);
  assert.equal(s.pending, false);
  assert.equal(s.acknowledgedRevision, 2);
});

test("onaydan SONRA yeni sürüm → yeniden bekliyor", () => {
  const s = modelAckState([announce(2), ack(2), announce(3)]);
  assert.equal(s.pending, true);
  assert.equal(s.announcedRevision, 3);
  assert.equal(s.acknowledgedRevision, 2);
});

test("eski sürümün onayı yeni duyuruyu kapatmaz", () => {
  const s = modelAckState([announce(4), ack(2)]);
  assert.equal(s.pending, true);
});

test("ileri sürüm onayı (iki sekme) duyuruyu kapatır", () => {
  // Savunma amaçlı: onay numarası duyurudan büyükse bekleme biter.
  const s = modelAckState([announce(3), ack(5)]);
  assert.equal(s.pending, false);
});

test("satır sırası önemsiz (en büyük sürüm kazanır)", () => {
  const s = modelAckState([ack(3), announce(3), announce(1)]);
  assert.equal(s.announcedRevision, 3);
  assert.equal(s.pending, false);
});

test("diğer eylem satırları (accept/ship) durumu bozmaz", () => {
  const s = modelAckState([
    { action: "accept", notes: null },
    { action: "ship", notes: "Tracking: 123" },
    announce(2),
  ]);
  assert.equal(s.pending, true);
  assert.equal(s.announcedRevision, 2);
});

// ─── Kapatılan adımlar ──────────────────────────────────────────
test("üreticide kabul/ret engellenmez, üretim adımları engellenir", () => {
  const blocked = [...MANUFACTURER_ACK_BLOCKED_ACTIONS] as string[];
  assert.ok(blocked.includes("start-printing"));
  assert.ok(blocked.includes("finish-printing"));
  assert.ok(blocked.includes("submit-qc"));
  assert.ok(blocked.includes("ship"));
  assert.ok(blocked.includes("send-to-painter"));
  assert.ok(!blocked.includes("accept"));
  assert.ok(!blocked.includes("decline"));
  assert.ok(!blocked.includes("cancel"));
});

test("boyacıda yalnız QC ve kargo engellenir", () => {
  const blocked = [...PAINTER_ACK_BLOCKED_ACTIONS] as string[];
  assert.deepEqual(blocked, ["submit-qc", "ship"]);
  assert.ok(!blocked.includes("accept"));
  assert.ok(!blocked.includes("received"));
});

// ─── Uyarı metinleri ────────────────────────────────────────────
test("her aşama Türkçe ve boş olmayan bir uyarı verir", () => {
  for (const stage of [
    "before_production",
    "printing",
    "printed_or_qc",
    "painting",
    "awaiting_customer_approval",
    "shipped_or_delivered",
    "blocked",
    null,
    "bilinmeyen_asama",
  ]) {
    for (const partner of ["manufacturer", "painter"] as const) {
      const msg = modelRevisionNoticeTr(partner, stage);
      assert.ok(msg.length > 10, `${partner}/${stage} uyarısı boş`);
    }
  }
});

test("boyacı, baskı aşamasında elindeki parçanın eski olabileceğini okur", () => {
  assert.match(modelRevisionNoticeTr("painter", "painting"), /ESKİ sürüme ait olabilir/);
});

test("üretici, baskı sırasında yeni dosyayla basması gerektiğini okur", () => {
  assert.match(modelRevisionNoticeTr("manufacturer", "printing"), /yeni sürümle/);
});

// ─── Onay KİMDEN istenir (aşama başına) ─────────────────────────
test("boyama aşamasında onay yalnız BOYACIDAN istenir", () => {
  // Parça boyacıda; üreticinin işi bitmiştir. Üreticiye onay satırı yazmak,
  // onu send-to-painter/ship adımlarından sebepsiz kilitliyordu.
  assert.deepEqual(partnerAckTargets("painting"), { manufacturer: false, painter: true });
});

test("baskı ve baskı sonrası QC'de onay yalnız ÜRETİCİDEN istenir", () => {
  assert.deepEqual(partnerAckTargets("printing"), { manufacturer: true, painter: false });
  assert.deepEqual(partnerAckTargets("printed_or_qc"), { manufacturer: true, painter: false });
});

test("üretim başlamadıysa / müşteri onayı beklerken / kargodan sonra kimseden istenmez", () => {
  for (const stage of [
    "before_production",
    "awaiting_customer_approval",
    "shipped_or_delivered",
    "blocked",
  ]) {
    assert.deepEqual(
      partnerAckTargets(stage),
      { manufacturer: false, painter: false },
      `${stage} onay istememeli`
    );
  }
});

test("requireAck=false her aşamada kapıyı kapatır (kayıt amaçlı yükleme)", () => {
  for (const stage of ["printing", "printed_or_qc", "painting", null]) {
    assert.deepEqual(partnerAckTargets(stage, false), { manufacturer: false, painter: false });
  }
});

test("tanınmayan aşamada TEMKİNLİ davranılır: ikisinden de onay istenir", () => {
  assert.deepEqual(partnerAckTargets(null), { manufacturer: true, painter: true });
  assert.deepEqual(partnerAckTargets("bilinmeyen_asama"), { manufacturer: true, painter: true });
});

test("onay hedefleri aşama tablosundan türer (iki liste ayrışamaz)", () => {
  const stages: ModelUploadStage[] = [
    "before_production",
    "printing",
    "printed_or_qc",
    "painting",
    "awaiting_customer_approval",
    "shipped_or_delivered",
    "blocked",
  ];
  for (const stage of stages) {
    const effects = modelUploadSideEffects(stage);
    assert.deepEqual(partnerAckTargets(stage), {
      manufacturer: effects.needsManufacturerAck,
      painter: effects.notifiesPainter,
    });
  }
});

test("duyurucu servis tek bayrak yerine partner başına hedef kullanır", () => {
  const src = read("src/lib/services/order-model-revision.ts");
  assert.match(src, /partnerAckTargets\(/, "partnerAckTargets çağrılmıyor");
  assert.match(src, /if \(ackTargets\.manufacturer\)/, "üretici satırı hedefe bağlı değil");
  assert.match(src, /if \(ackTargets\.painter\)/, "boyacı satırı hedefe bağlı değil");
  assert.ok(
    !/if \(requireAck\) \{/.test(src),
    "tek requireAck bayrağı geri gelmiş: boyama aşamasında üretici yine kilitlenir"
  );
});

// ─── Kapı GERÇEKTEN uçlarda mı (yalnız ekranda değil) ───────────
test("üreticinin BEŞ ileri adım ucu da onay kapısını sunucuda okur", () => {
  for (const action of MANUFACTURER_ACK_BLOCKED_ACTIONS) {
    const rel = MANUFACTURER_ROUTES[action];
    assert.ok(rel, `${action} için rota dosyası eşlenmemiş`);
    const src = read(rel);
    assert.match(src, /readPartnerModelAck\(/, `${action}: readPartnerModelAck çağrılmıyor`);
    assert.match(src, /kind: "manufacturer"/, `${action}: kapı üretici olarak sorulmuyor`);
    assertAckRefusal(rel, src, action);
  }
});

test("kapı, durumu DEĞİŞTİREN yazmadan ÖNCE okunur", () => {
  // Kapı UPDATE'ten sonra okunsaydı iş çoktan ilerlemiş olurdu.
  for (const [action, rel] of Object.entries(MANUFACTURER_ROUTES)) {
    const src = read(rel);
    const gate = src.indexOf("readPartnerModelAck(");
    const write = src.indexOf(".update(orders)");
    assert.ok(gate >= 0 && write >= 0, `${action}: kapı ya da UPDATE bulunamadı`);
    assert.ok(gate < write, `${action}: onay kapısı UPDATE'ten SONRA okunuyor`);
  }
});

test("boyacının engellenen adımları da sunucuda kapalı", () => {
  for (const action of PAINTER_ACK_BLOCKED_ACTIONS) {
    const rel = PAINTER_ROUTES[action];
    const src = read(rel);
    assert.match(src, /readPartnerModelAck\(/, `painter ${action}: kapı yok`);
    assert.match(src, /kind: "painter"/, `painter ${action}: kapı boyacı olarak sorulmuyor`);
    assertAckRefusal(rel, src, `painter ${action}`);
  }
});

test("ortak onay mesajı Türkçe ve eyleme dönük", () => {
  assert.match(MODEL_ACK_REQUIRED_ERROR, /onaylayın/);
});

// ─── QC fotoğrafı sürüm damgası (migration 0055) ────────────────
test("QC fotoğrafı yüklenirken güncel model sürümüyle damgalanır", () => {
  const src = read(QC_PHOTOS_ROUTE);
  assert.match(
    src,
    /currentOrderModelRevision\(/,
    "güncel sürüm okunmuyor: damga NULL kalır ve 0055 atıl olur"
  );
  // Biçime DEĞİL, yazılan alana bakılır: damga qcPhotos INSERT'inin değerleri
  // arasında olmalı. (Satır kaydırması/prettier bu testi kırmasın; kıran şey
  // yalnız damganın kaybolması olsun.)
  assert.match(
    src,
    /\.insert\(qcPhotos\)[\s\S]{0,260}modelRevision/,
    "insert damgayı yazmıyor: fotoğraf hangi sürümün baskısı olduğunu taşımaz"
  );
  // Tek tur, tek damga: sürüm döngünün İÇİNDE okunsaydı aynı turun fotoğrafları
  // farklı sürümlerle damgalanabilirdi.
  const revRead = src.indexOf("currentOrderModelRevision(");
  const loop = src.indexOf("for (const file of files)");
  assert.ok(revRead >= 0 && loop >= 0 && revRead < loop, "damga döngü içinde okunuyor");
});

test("damgasız yazıma düşüş DAR ve GÖRÜNÜR (kapıyı sessizce indirmez)", () => {
  // 0055 uygulanmamış bir veritabanında yükleme 500 vermesin diye damgasız
  // yazıma düşülüyor. Bunun bedeli gerçek: damgasız satır "eski değil" sayılır
  // (qcPhotosMatchCurrentRevision), yani o kurulumda eski baskı QC'den geçer.
  // Düşüş yolu varsa en azından (1) YALNIZ kolon/tablo yokluğunda yaşanmalı ve
  // (2) kayda geçmeli; her hatayı yutan bir catch damgayı sessizce öldürürdü.
  const src = read(QC_PHOTOS_ROUTE);
  if (!/isMissingModelRevisionSchema/.test(src)) return; // düşüş yolu yok: kapı katı
  assert.match(src, /"42703"|42703/, "kolon-yok (42703) daraltması yok");
  assert.match(src, /"42P01"|42P01/, "tablo-yok (42P01) daraltması yok");
  assert.match(
    src,
    /if \(!isMissingModelRevisionSchema\(e\)\) throw e/,
    "catch her hatayı yutuyor: gerçek arıza damgasız yazıma dönüşür"
  );
  assert.match(src, /console\.error\(/, "düşüş sessiz: hiçbir yere yazılmıyor");
});

test("QC damgasının okuduğu 'güncel sürüm' TEK karar merciinden gelir", () => {
  // Bu kapının damgası ile silme nöbetçisinin koruduğu sürüm AYNI soruya
  // verilen cevaptır. İki ayrı tarama yazıldığında ikisi ayrışmıştı: biri
  // artan sırada ilk eşleşeni ('önceki parçaları koru' ile paylaşılan dosya
  // anahtarı yüzünden ESKİ sürüm), diğeri en yükseği seçiyordu; karşılaştırma
  // `>=` olduğu için kapı sessizce gevşiyordu. Cevap artık tek yerde.
  const src = read("src/lib/services/order-model-revision.ts");
  const fn = src.slice(
    src.indexOf("export async function currentOrderModelRevision"),
    src.indexOf("export async function currentOrderModelRevision") + 400
  );
  assert.match(fn, /currentModelRevision\(/, "kendi kopyasını çalıştırıyor");
  assert.doesNotMatch(fn, /\.select\(/, "ikinci bir sürüm taraması geri gelmiş");
  // Tek merci de saf yardımcıya düşer: karar kuralı config'te, sorgu serviste.
  const svc = read("src/lib/services/order-model.ts");
  const decide = svc.slice(svc.indexOf("export async function currentModelRevision"));
  assert.match(decide, /resolveCurrentRevision\(/, "karar saf yardımcıdan gelmiyor");
});

// ─── QC onayı eski sürümü geçirmez ──────────────────────────────
test("qc-approve turun fotoğraflarını güncel sürümle karşılaştırır", () => {
  const src = read(QC_APPROVE_ROUTE);
  assert.match(src, /qcPhotosMatchCurrentRevision\(/, "sürüm karşılaştırması yok");
  assert.match(src, /currentOrderModelRevision\(/, "güncel sürüm okunmuyor");
  assert.match(src, /qcPhotos\.modelRevision/, "fotoğrafların damgası okunmuyor");
});

test("eski sürüm turu, gerekçesiz onaylanamaz ve 409 ile reddedilir", () => {
  const src = read(QC_APPROVE_ROUTE);
  assert.match(src, /STALE_QC_REVISION_CODE/, "istemciye makine-okur kod dönmüyor");
  assert.match(src, /overrideStaleRevision !== true/, "bilinçli istisna kapısı yok");
  assert.match(src, /STALE_QC_OVERRIDE_REASON_MIN/, "gerekçe uzunluğu zorunlu değil");
  const refusal = src.indexOf("staleQcRevisionErrorTr(");
  const write = src.indexOf(".update(orders)");
  assert.ok(refusal >= 0 && write >= 0 && refusal < write, "ret, UPDATE'ten sonra");
});

test("geçersiz kılma KİM ve NEDEN olarak denetim kaydına yazılır", () => {
  const src = read(QC_APPROVE_ROUTE);
  assert.match(src, /staleOverrideNote/, "geçersiz kılma notu üretilmiyor");
  assert.match(src, /reason: staleOverrideNote/, "QC turu kaydına gerekçe yazılmıyor");
  assert.match(src, /notes: staleOverrideNote/, "admin eylem günlüğüne gerekçe yazılmıyor");
  assert.match(src, /Onaylayan: \$\{adminEmail\}/, "onaylayanın kimliği not edilmiyor");
});

test("uyuşmazlık mesajı iki sürümü de söyler, gerekçe mesajı Türkçe", () => {
  const msg = staleQcRevisionErrorTr(3, 1);
  assert.match(msg, /v1/);
  assert.match(msg, /v3/);
  assert.match(msg, /ESKİ modelin baskısı/);
  // Sürüm bilinmiyorsa cümle yine kurulmalı (0055 öncesi kayıtlar).
  assert.ok(staleQcRevisionErrorTr(null, null).length > 20);
  assert.ok(STALE_QC_OVERRIDE_REASON_MIN >= 10);
  assert.match(STALE_QC_OVERRIDE_REASON_ERROR, /Gerekçe zorunludur/);
  assert.equal(STALE_QC_REVISION_CODE, "stale_model_revision");
});

// ─── Modül güvenliği ────────────────────────────────────────────
test("saf modül worker ve istemci için güvenli kalır", () => {
  const src = read("src/lib/config/partner-model-ack.ts");
  // Modül başlığı bu iki adı ANLATIYOR; aranan şey gerçek bir import satırı,
  // metinde geçmesi değil.
  assert.ok(
    !/^\s*import\s[^\n]*["']@\/lib\/db["']/m.test(src),
    "@/lib/db import edilmiş: istemci paketine veritabanı girer"
  );
  assert.ok(
    !/^\s*import\s[^\n]*["']server-only["']/m.test(src),
    "server-only import edilmiş: worker crash-loop"
  );
});

// ─── İstisna EKRANDAN da ulaşılabilir ───────────────────────────
//
// Kapının yönü doğru olsa bile (ekran sunucudan KATI) tek çıkışı qc-reject
// olan bir tur, tek bir yanlış damgalanmış fotoğraf yüzünden üreticiye
// yeniden baskı yaptırır. Karar (late-model-upload) denetimli istisnaya izin
// veriyor; uç onu destekliyorsa panel de göndermek ZORUNDA, yoksa istisna
// yalnız bir API istemcisi için var olur.
test("panel, eski sürüm turunu gerekçeyle onaylayabilir (istisna yalnız API'de kalmaz)", () => {
  const ui = read(ADMIN_ORDER_PAGE);
  assert.match(ui, /overrideStaleRevision: true/, "panel geçersiz kılmayı hiç göndermiyor");
  assert.match(ui, /overrideReason:/, "gerekçe gövdede gitmiyor");
  assert.match(
    ui,
    /STALE_QC_OVERRIDE_REASON_MIN/,
    "panel gerekçe barajını sunucunun sabitinden almıyor (iki sayı ayrışır)"
  );
  // İstisna AYRI bir yol olmalı: normal onay düğmesi uyuşmazlıkta gerekçesiz
  // gönderirse sunucu 409 döner ve admin sebebini ekranda göremez.
  assert.match(ui, /performAction\("qc-approve", \{/, "istisna ayrı bir çağrı değil");
});

// ─── Yeni bir partner ucu kapıyı sessizce atlayamaz ─────────────
//
// Kapı, uçların KENDİSİNDE yaşıyor: listede olmayan yeni bir ileri adım ucu
// eklenirse hiçbir test kırılmadan garanti delinir. Bu yüzden partnerin TÜM
// uçları sınıflandırılmak zorunda — ya kapıyı uygular ya da "ileri adım
// değildir" gerekçesiyle burada yazılıdır.
const MANUFACTURER_NON_FORWARD: Record<string, string> = {
  accept: "işi kabul etmek ileri bir üretim adımı değil; kapatılırsa üretici yeni sürümü göremeden işi bırakamaz",
  decline: "işi reddetmek ileri adım değil",
  cancel: "işi bırakmak ileri adım değil",
  "ack-model": "kapının KENDİSİ: onay burada verilir",
  "download-glb": "dosya okuma — yeni sürümü indirmek zaten istenen şey",
  "download-obj": "dosya okuma",
  "download-stl": "dosya okuma",
  "download-upload": "müşterinin yüklediği dosyayı okuma",
  "model-files": "sürüm dosyalarını okuma",
  "product-files": "ürün dosyalarını okuma",
  messages: "yazışma",
  "qc-photos": "fotoğraf YÜKLEME: sürüm damgası burada basılır, karar submit-qc'de verilir",
};
const PAINTER_NON_FORWARD: Record<string, string> = {
  accept: "işi kabul etmek ileri adım değil",
  decline: "işi reddetmek ileri adım değil",
  "ack-model": "kapının KENDİSİ",
  received: "paketi teslim almak ileri bir boyama adımı değil",
  painted: "boyamanın bitişi: boyacının engellenen adımları yalnız QC ve kargo (bkz. on-behalf PARTNER_ROUTE_ACTION)",
  messages: "yazışma",
  "qc-photos": "fotoğraf yükleme; karar submit-qc'de",
};

test("üretici ve boyacının HER ucu sınıflandırılmış (yeni uç kapıyı atlayamaz)", () => {
  const cases2: Array<[string, string, readonly string[], Record<string, string>]> = [
    [
      "üretici",
      "src/app/api/manufacturer/orders/[id]",
      MANUFACTURER_ACK_BLOCKED_ACTIONS,
      MANUFACTURER_NON_FORWARD,
    ],
    ["boyacı", "src/app/api/painter/orders/[id]", PAINTER_ACK_BLOCKED_ACTIONS, PAINTER_NON_FORWARD],
  ];
  for (const [label, dir, blocked, allowed] of cases2) {
    const entries = readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const name of entries) {
      if ((blocked as readonly string[]).includes(name)) {
        const src = read(`${dir}/${name}/route.ts`);
        assert.match(src, /readPartnerModelAck\(/, `${label}/${name}: engellenen adımda kapı yok`);
        continue;
      }
      assert.ok(
        allowed[name],
        `${label}/${name} sınıflandırılmamış: ya onay kapısını uygulayın (engellenen adımlar ` +
          `listesine ekleyin) ya da NEDEN ileri bir adım olmadığını bu teste yazın`
      );
    }
  }
});

// ─── Onay YAZIMI arızası: boş 500 değil, kapının 503'ü ─────────
//
// Partner önce kapının dürüst 503'ünü okur ("birkaç dakika sonra tekrar
// deneyin") ve o cümlenin gösterdiği TEK düğmeye basar. recordPartnerModelAck
// aynı arızada tasarım gereği fırlatır; yakalanmazsa Next bunu BOŞ GÖVDELİ bir
// 500'e çevirir ve panel "İşlem tamamlanamadı (HTTP 500)" der: kısa ve çıkışsız
// bir döngü. İki onay ucu da aynı arızayı aynı cümleye çevirmek zorundadır.
const ACK_WRITE_ROUTES: Record<string, string> = {
  üretici: "src/app/api/manufacturer/orders/[id]/ack-model/route.ts",
  boyacı: "src/app/api/painter/orders/[id]/ack-model/route.ts",
};

test("onay ucu, günlük okunamazken boş gövdeli 500 değil ortak 503 döner", () => {
  for (const [label, rel] of Object.entries(ACK_WRITE_ROUTES)) {
    const src = read(rel);
    assert.match(src, /ackWriteFailureRefusal\(/, `${label}: yazma arızası ortak cevaba çevrilmiyor`);
    const call = src.indexOf("recordPartnerModelAck(");
    assert.ok(call >= 0, `${label}: onay hiç yazılmıyor`);
    const tryIdx = src.lastIndexOf("try {", call);
    const catchIdx = src.indexOf("} catch", call);
    assert.ok(tryIdx >= 0 && tryIdx < call, `${label}: onay yazımı try bloğunun dışında`);
    assert.ok(catchIdx > call, `${label}: yazma arızası yakalanmıyor`);
    const handler = src.slice(catchIdx, catchIdx + 400);
    assert.match(handler, /status: refusal\.status/, `${label}: arızada kapının kodu dönmüyor`);
    // Yutulmuş bir hata geçici arıza gibi gösterilmez: bu arızaya ait olmayan
    // hata yeniden fırlatılır.
    assert.match(handler, /if \(!refusal\) throw e/, `${label}: her hata 503'e çevriliyor`);
  }
});

// ─── Hangi kapı durdurdu: İADE, onay kapısından ÖNCE ───────────
//
// İade edilmiş bir siparişte duyurulmuş sürüm varsa (ya da günlük okunamıyorsa)
// kapı önce okunduğunda partner "yeni model sürümünü onaylayın" diye
// yönlendiriliyordu — üstelik onay ucu iade yüzünden 409 verdiği için uyulması
// İMKÂNSIZ bir talimat. Reddin gerekçesi, işi gerçekten durduran kapı olmalı.
test("iade, onay kapısından ÖNCE sorulur (partner doğru gerekçeyi okur)", () => {
  for (const rel of [...Object.values(MANUFACTURER_ROUTES), ...Object.values(PAINTER_ROUTES)]) {
    const src = read(rel);
    const refund = src.indexOf("isRefunded(");
    const gate = src.indexOf("readPartnerModelAck(");
    assert.ok(refund >= 0, `${rel}: iade durumu hiç okunmuyor`);
    assert.ok(gate >= 0, `${rel}: onay kapısı yok`);
    assert.ok(
      refund < gate,
      `${rel}: onay kapısı iadeden önce okunuyor — iade edilmiş siparişte partnere ` +
        `yapamayacağı bir onay talimatı verilir`
    );
  }
});

// ─── Admin "partner adına" yolu: sekizinci tüketici ─────────────
test("admin partner adına yolu arıza dalını ayırt eder (olmayan yüklemeyi anlatmaz)", () => {
  const src = read("src/lib/services/on-behalf.ts");
  const gate = src.slice(
    src.indexOf("async function modelAckGate"),
    src.indexOf("export interface OnBehalfPreflight")
  );
  assert.match(gate, /modelAckRefusal\(/, "ret tek kaynaktan gelmiyor");
  assert.doesNotMatch(
    gate,
    /if \(!ack\.pending\) return null/,
    "arıza dalını yutan eski kapı geri gelmiş: okunamayan günlükte admin'e OLMAYAN bir yükleme anlatılır"
  );
  assert.match(gate, /ack_log_unreadable/, "geçici arıza, kural ihlalinden ayrılmıyor");
  assert.match(src, /\| "ack_log_unreadable"/, "ret kodu birleşime eklenmemiş");
});

// ─── Kapının UYARISI görünebilsin: partner ekranları ayakta kalmalı ──
//
// Uçların dürüst 503'ü ile panelin uyarısı aynı arızanın iki yüzüdür. Ekran o
// arızada AÇILMIYORSA uyarı yalnız ölü koddur: partner boş bir hata sayfası
// görür ve neyin durduğunu hiçbir yerde okuyamaz.
test("üretici ekranı, onay günlüğü okunamazken ayakta kalır", () => {
  const src = read("src/app/manufacturer/orders/[id]/page.tsx");
  assert.doesNotMatch(
    src,
    /manufacturerActions: \{/,
    "günlük hâlâ sipariş sorgusunun with cümlesinde: tablo okunamazsa SORGUNUN TAMAMI fırlar ve sayfa 500 verir"
  );
  const sel = src.indexOf(".from(manufacturerActions)");
  assert.ok(sel >= 0, "günlük ayrı okunmuyor");
  assert.match(src.slice(sel, sel + 600), /\.catch\(/, "ayrı okuma korumasız: arıza yine sayfayı düşürür");
});

test("boyacı ekranı ayakta kalır, kapı KAPALI tarafa düşer ve sebep ekranda yazar", () => {
  const src = read("src/app/painter/jobs/page.tsx");
  const sel = src.indexOf(".from(painterActions)");
  assert.ok(sel >= 0, "eylem günlüğü okunmuyor");
  assert.match(src.slice(sel, sel + 700), /\.catch\(/, "okuma korumasız: sayfanın tamamı 500 verir");
  // Fail closed: hatayı yutup BOŞ liste geçmek modelAckState'e "duyuru yok"
  // dedirtir ve boyacının QC/kargo kapıları sessizce açılır.
  const ackBlock = src.slice(src.indexOf("const ackByOrder"), src.indexOf("const actionsByOrder"));
  assert.match(ackBlock, /actionLogUnreadable/, "arızada kapı yine satırlardan türetiliyor");
  assert.match(ackBlock, /pending: true/, "arızada kapı açık kalıyor");
  assert.match(ackBlock, /announcedRevision: null/, "bilinmeyen sürüm numarası uyduruluyor");
  assert.match(
    src,
    /okunamıyor \(geçici sistem arızası\)/,
    "boyacı, işini neyin durdurduğunu ekranda okumuyor"
  );
});

// ─── Admin model yüklemesi: iade cevabı gövdeye bağlı olmamalı ──
test("model yükleme iade reddini GÖVDEYE BAKMADAN verir", () => {
  const src = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  const refund = src.indexOf("if (isRefunded(order)) return fail(409");
  const body = src.indexOf("request.formData()");
  assert.ok(refund >= 0, "iade kapısı yok");
  assert.ok(body >= 0, "gövde hiç okunmuyor");
  assert.ok(
    refund < body,
    "gövde ayrıştırma iade kapısından önce: multipart olmayan bir gövde boş gövdeli 500'e döner ve " +
      "iade edilmiş siparişte yönetici tek Türkçe iade cümlesini göremez"
  );
  assert.match(src, /request\.formData\(\)\.catch\(/, "gövde ayrıştırma korumasız");
});

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log(`\n${passed}/${cases.length} passed`);
