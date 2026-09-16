/**
 * Dosya silme nöbetçisi — saf mantık ve KAYNAK taraması. Veritabanı gerektirmez.
 *
 * Buradaki garanti tek cümle: BİR DOSYA, ONU GÖSTEREN SON KAYIT DA GİTMEDEN
 * SİLİNMEZ; ve "silindi" denen müşteri fotoğrafı diskte KALMAZ (asıl görsel de
 * küçük görsel de). İkisi de ancak siliciler referans sayımını GERÇEKTEN
 * çağırırsa doğru olur — o yüzden saf yardımcıların yanında çağrı yerleri de
 * dosya üzerinden doğrulanır.
 *
 * Çalıştırma: npx tsx scripts/test-photo-file-retention.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DONE_MARK,
  KEPT_MARK,
  PENDING_MARK,
  PHOTO_FILE_GRACE_DAYS,
  applySweepOutcome,
  pendingDeletionMark,
  pendingKeysFromNote,
} from "../src/lib/services/photo-file-retention";

const REPO_ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

const WORKER = "src/lib/queue/workers/preview-cleanup.worker.ts";
const ORDER_MODEL = "src/lib/services/order-model.ts";
const MODEL_REVISION = "src/lib/services/order-model-revision.ts";
const AUTO_ASSIGN_TEST = "scripts/test-auto-assign.ts";
const PACKAGE_JSON = "package.json";
const PHOTOS_ROUTE = "src/app/api/admin/orders/[id]/photos/route.ts";
const QC_PHOTOS_ROUTE = "src/app/api/manufacturer/orders/[id]/qc-photos/route.ts";
const REVOKE_PAINTER_ROUTE = "src/app/api/admin/orders/[id]/revoke-painter/route.ts";
const RETENTION = "src/lib/services/photo-file-retention.ts";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
  }
}

// ─── Saf mantık: not içindeki işaretler ─────────────────────────────────────
test("tek not birden çok bekleyen anahtar taşır (asıl + küçük görsel)", () => {
  const notes =
    `Referans fotoğrafı kaldırıldı (p1). 2 dosya ${PHOTO_FILE_GRACE_DAYS} gün sonra silinecek. ` +
    `${pendingDeletionMark("photos/a.jpg")} ${pendingDeletionMark("photos/a-thumb.jpg")}`;
  assert.deepEqual(pendingKeysFromNote(notes), ["photos/a.jpg", "photos/a-thumb.jpg"]);
});

test("kapatılmış işaretler bekleyen sayılmaz (süpürme listesi tıkanmaz)", () => {
  const notes = `${DONE_MARK}photos/a.jpg] ${KEPT_MARK}photos/b.jpg]`;
  assert.deepEqual(pendingKeysFromNote(notes), []);
  assert.equal(pendingKeysFromNote(null).length, 0);
});

test("aynı anahtar iki kez sayılmaz", () => {
  const notes = `${pendingDeletionMark("photos/a.jpg")} ${pendingDeletionMark("photos/a.jpg")}`;
  assert.deepEqual(pendingKeysFromNote(notes), ["photos/a.jpg"]);
});

test("sonuçlandırma YALNIZ adı geçen anahtarı kapatır, ötekini bekletir", () => {
  const notes = `${pendingDeletionMark("photos/a.jpg")} ${pendingDeletionMark("photos/b.jpg")}`;
  const after = applySweepOutcome(notes, "photos/a.jpg", DONE_MARK);
  assert.deepEqual(pendingKeysFromNote(after), ["photos/b.jpg"]);
  assert.ok(after.includes(`${DONE_MARK}photos/a.jpg]`), "silindi işareti yazılmadı");
  const both = applySweepOutcome(after, "photos/b.jpg", KEPT_MARK);
  assert.deepEqual(pendingKeysFromNote(both), [], "not kapanmadı: satır turlarca seçilir");
});

test("anahtardaki $ dizileri değiştirme deseni olarak yorumlanmaz", () => {
  // String.replace kullanılsaydı "$&" tüm eşleşmeyi geri yapıştırırdı ve not
  // bozulurdu — bozuk not, kapanmayan bir silme demektir.
  const key = "photos/a$&b_$1.jpg";
  const after = applySweepOutcome(pendingDeletionMark(key), key, DONE_MARK);
  assert.equal(after, `${DONE_MARK}${key}]`);
  assert.deepEqual(pendingKeysFromNote(after), []);
});

// ─── Önizleme temizliği: referans sayımı olmadan silme yok ──────────────────
test("temizlik işçisi, silmeden ÖNCE referans sayımı yapar", () => {
  const src = read(WORKER);
  assert.match(src, /storageKeyReferencedBy\(/, "referans sayımı hiç çağrılmıyor");
  const check = src.indexOf("storageKeyReferencedBy(");
  const del = src.indexOf("await deleteFile(key)");
  assert.ok(check >= 0 && del >= 0, "sayım ya da silme bulunamadı");
  assert.ok(check < del, "silme, sayımdan ÖNCE yapılıyor");
  assert.match(src, /if \(referencedBy\)/, "sayımın sonucu bir karara bağlanmıyor");
});

test("işçi kendi sildiği önizlemeyi referans saymaz, ötekileri sayar", () => {
  const src = read(WORKER);
  assert.match(src, /countPreviews: true/, "öteki önizlemeler sayılmıyor");
  assert.match(src, /ignorePreviewId: preview\.id/, "kendi satırı referans sayılıyor");
});

test("işçi, bekleyen fotoğraf dosyalarını da süpürür (takvim işler)", () => {
  assert.match(read(WORKER), /sweepExpiredPhotoFiles\(/, "saatlik süpürme çağrılmıyor");
});

test("işçi zinciri standalone Node'da koşar: server-only importu yok", () => {
  for (const rel of [WORKER, RETENTION]) {
    assert.doesNotMatch(read(rel), /^\s*import\s+["']server-only["']/m, rel);
  }
  assert.doesNotMatch(read(RETENTION), /from "next\//, "nöbetçi Next'e bağlanmış");
});

// ─── KVKK: kaldırılan fotoğrafın İKİ dosyası da işaretlenir ─────────────────
test("fotoğraf kaldırma, küçük görseli de silinmeye işaretler", () => {
  const src = read(PHOTOS_ROUTE);
  assert.match(src, /thumbnailUrl: orderPhotos\.thumbnailUrl/, "küçük görsel okunmuyor");
  assert.match(
    src,
    /\[removed\.originalUrl, removed\.thumbnailUrl\]/,
    "işaretlenecek adresler tek listeden üretilmiyor"
  );
  assert.match(src, /keys\.map\(pendingDeletionMark\)/, "her anahtar işaretlenmiyor");
  assert.match(src, /new Set\(/, "aynı anahtar iki kez işaretlenebilir");
});

test("bekleme süresi ve işaretler tek kaynaktan gelir", () => {
  const src = read(PHOTOS_ROUTE);
  assert.match(src, /from "@\/lib\/services\/photo-file-retention"/, "kural kopyalanmış");
  assert.ok(PENDING_MARK.endsWith("key="), "işaret biçimi değişmiş");
});

// ─── QC damgası: ölü yedek yol yok, çöp dosya kalmıyor ──────────────────────
test("QC yüklemesinde çalışamayan yedek yazma yolu kalmadı", () => {
  const src = read(QC_PHOTOS_ROUTE);
  assert.doesNotMatch(src, /modelRevisionColumnMissing/, "süreç ömrü bayrağı duruyor");
  assert.doesNotMatch(src, /\.values\(base\)/, "damgasız ikinci INSERT duruyor");
  assert.match(src, /\.insert\(qcPhotos\)[\s\S]{0,260}modelRevision/, "damga yazılmıyor");
});

test("dağıtım sırası koda yazılı (migration'lar app'ten önce koşar)", () => {
  const src = read(QC_PHOTOS_ROUTE);
  assert.match(src, /deploy\.sh/, "dağıtım sırası anlatılmamış");
  assert.match(src, /0055/, "gereken migration adı geçmiyor");
});

test("satır açılamazsa diske yazılan QC dosyaları ortada kalmaz", () => {
  const src = read(QC_PHOTOS_ROUTE);
  assert.match(src, /discardSavedFiles/, "başarısız INSERT'ten sonra temizlik yok");
  // Dilim INSERT bloğuyla sınırlı: dosyada artık başka bir `throw e;` daha var
  // (asıl görsel yazılamadığında küçük görseli silen dal), sınırsız arama onu
  // yakalayıp yanlış yeri sınardı.
  const insertBlock = src.slice(src.indexOf("let row:"));
  const cleanup = insertBlock.indexOf("await discardSavedFiles();");
  const rethrow = insertBlock.indexOf("throw e;");
  assert.ok(cleanup >= 0 && rethrow >= 0 && cleanup < rethrow, "hata yutuluyor ya da temizlik yok");
  // Temizlik İKİ dosyayı da alır: asıl görsel ve küçük görsel.
  const helper = src.slice(src.indexOf("const discardSavedFiles"), src.indexOf("let row:"));
  assert.match(helper, /deleteFile\(storageKey\)/, "asıl görsel temizlikte yok");
  assert.match(helper, /deleteFile\(thumbnailKey\)/, "küçük görsel temizlikte yok");
});

test("asıl görsel yazılamazsa küçük görsel diskte kalmaz", () => {
  // Küçük görsel ÖNCE diske yazılıyor; asıl görselin yazımı patlarsa onu hiçbir
  // satır göstermez ve hiçbir temizlik ona bakmaz (önizleme temizliği yalnız
  // previews'a bakar), yani her yeniden deneme bir çöp dosya daha bırakırdı.
  const src = read(QC_PHOTOS_ROUTE);
  const thumbWrite = src.indexOf("const thumbnailKey = await saveFile(");
  const mainWrite = src.indexOf("storageKey = await saveFile(mainBuffer");
  const guard = src.indexOf("const discardSavedFiles");
  assert.ok(thumbWrite >= 0 && mainWrite > thumbWrite, "yazma sırası değişmiş");
  const between = src.slice(thumbWrite, guard);
  assert.match(between, /catch \(e\)/, "asıl görselin yazımı korumasız");
  assert.match(between, /await deleteFile\(thumbnailKey\)/, "küçük görsel ortada kalıyor");
  assert.match(between, /throw e;/, "hata yutuluyor: üretici satırsız 'başarılı' sanır");
});

test("model sürümü okunamazsa üretici NE OLDUĞUNU okur (boş 500 değil)", () => {
  const src = read(QC_PHOTOS_ROUTE);
  const read_ = src.indexOf("modelRevision = await currentOrderModelRevision(id)");
  assert.ok(read_ >= 0, "sürüm okuması bulunamadı");
  const after = src.slice(read_, src.indexOf("for (const file of files)"));
  assert.match(after, /catch \(e\)/, "arıza yakalanmıyor: uç boş gövdeli 500 döner");
  assert.match(after, /status: 503/, "geçici arıza kalıcı hata gibi dönüyor");
  assert.match(after, /MODEL_REVISION_UNAVAILABLE_ERROR/, "Türkçe gerekçe yok");
  // Fail-closed kalmalı: damgasız satır "eski değil" sayılır.
  assert.doesNotMatch(after, /modelRevision = null/, "arıza damgasız yazıma çevrilmiş");
});

// ─── Denetim kaydı olanı anlatır ────────────────────────────────────────────
test("boyacıdan geri alma, üretici ataması gibi kaydedilmez", () => {
  const src = read(REVOKE_PAINTER_ROUTE);
  assert.doesNotMatch(src, /action: "assign_manufacturer"/, "hiç olmamış üretici ataması");
  assert.match(src, /action: "edit"/, "nötr eylem değeri yazılmıyor");
  assert.match(src, /Boyacıdan geri alındı/, "notta gerçek eylem anlatılmıyor");
});

// ─── Model dosyası: silme, BAŞKA siparişin gösterdiği dosyaya dokunmaz ──────
test("sürüm silme, dosyayı BAŞKA bir siparişin gösterip göstermediğini sorar", () => {
  // Fotoğraf tarafındaki kural (storageKeyReferencedBy: kaydın sahibi kim olursa
  // olsun sayılır) model tarafında yoktu: sayım yalnız AYNI siparişe bakıyordu,
  // yani aynı depolama anahtarını gösteren ikinci bir sipariş varken dosya
  // diskten kaldırılabiliyordu — boş görüntüleyici ve "not_ready" indirme.
  const src = read(ORDER_MODEL);
  const fn = src.slice(
    src.indexOf("export async function deleteModelRevision"),
    src.indexOf("export interface QcResetResult")
  );
  assert.match(fn, /ne\(orderModelFiles\.orderId, orderId\)/, "öteki siparişin dosya satırı sayılmıyor");
  assert.match(fn, /ne\(orderModelRevisions\.orderId, orderId\)/, "öteki siparişin sürüm başlığı sayılmıyor");
  assert.match(fn, /ne\(orders\.id, orderId\)/, "öteki siparişin canlı kolonu sayılmıyor");
  // Sayım, silinebilir listesi kurulmadan ÖNCE yapılmalı.
  const cross = fn.indexOf("ne(orderModelFiles.orderId, orderId)");
  const decide = fn.indexOf("unlinkableKeys(");
  assert.ok(cross >= 0 && decide >= 0 && cross < decide, "çapraz sayım kararın SONRASINDA");
});

// ─── Onay kapısı arızada: kapalı VE dürüst ──────────────────────────────────
test("sürüm okunamazsa duyuru kapıyı KAPALI tarafa çeker", () => {
  const src = read(MODEL_REVISION);
  const fn = src.slice(
    src.indexOf("async function announcementRevisionFor"),
    src.indexOf("export async function notifyOrderModelRevision")
  );
  assert.ok(fn.length > 0, "arıza dalı yardımcısı yok");
  assert.match(fn, /if \(!liveReadFailed\) return revision;/, "arıza ile normal yol ayrılmıyor");
  assert.match(
    fn,
    /\(prior\.acknowledgedRevision \?\? 0\) \+ 1/,
    "duyuru, onaylanan sürümün gerisinde kalabilir: kapı açılır"
  );
  // Duyuru satırı ile bildirim metni AYNI numarayı kullanmalı.
  const notify = src.slice(src.indexOf("export async function notifyOrderModelRevision"));
  assert.match(notify, /announcementRevisionFor\(/, "duyuru numarası arızayı hesaba katmıyor");
  assert.doesNotMatch(
    notify,
    /formatModelRevisionNote\(revision, args\.note\)/,
    "onay satırı hâlâ ham numarayı yazıyor"
  );
});

test("günlük okunamadığında partnere OLMAYAN bir yükleme anlatılmaz", () => {
  const src = read(MODEL_REVISION);
  assert.match(src, /MODEL_ACK_UNAVAILABLE_ERROR/, "arıza için ayrı cümle yok");
  const fn = src.slice(
    src.indexOf("export function modelAckRefusal"),
    src.indexOf("export const ACK_LOG_UNREADABLE")
  );
  assert.match(fn, /ack\.readFailed/, "arıza dalı kapının cevabında görünmüyor");
  assert.match(fn, /status: 503/, "geçici arıza 409 kural hatası gibi dönüyor");
  assert.match(fn, /MODEL_ACK_REQUIRED_ERROR/, "gerçek onay beklemesi ortak cümleyi bırakmış");
  assert.ok(
    fn.indexOf("ack.readFailed") < fn.indexOf("ack.pending"),
    "arıza, kural kontrolünden sonra bakılıyor: yanlış cümle kazanır"
  );
  // Onay YAZIMININ arızası da rotadan ayırt edilebilmeli (boş 500 yerine 503).
  assert.match(src, /export function isAckLogUnreadable/, "arıza işareti dışa açık değil");
  assert.match(src, /throw new Error\(ACK_LOG_UNREADABLE\)/, "fırlatılan hata işaretsiz");
});

// ─── CI gerçekten koşuyor mu ────────────────────────────────────────────────
test("bu dosya birim zincirinde kayıtlı (yoksa güvenceler hiç koşmaz)", () => {
  const pkg = JSON.parse(read(PACKAGE_JSON)) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["test:unit"], /test-photo-file-retention\.ts/, "zincirde yok");
});

test("worker import taraması dosya silme nöbetçisini de kapsar", () => {
  const src = read(AUTO_ASSIGN_TEST);
  const chain = src.slice(src.indexOf("const WORKER_CHAIN = ["), src.indexOf("for (const rel of WORKER_CHAIN)"));
  assert.match(chain, /services\/photo-file-retention\.ts/, "nöbetçi listede yok");
  assert.match(chain, /preview-cleanup\.worker\.ts/, "temizlik işçisi listede yok");
});

if (failures.length > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`${passed} geçti, ${failures.length} kaldı`);
  process.exit(1);
}
console.log(`${passed} geçti, 0 kaldı`);
