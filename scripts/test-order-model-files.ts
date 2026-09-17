// Çok parçalı sipariş modeli + boyama kalemi ekleme — saf mantık testleri (DB gerekmez).
//
// Kapsam: dosya türü/adı kuralları, başlık (magic byte) doğrulaması, ZIP
// taraması (sipariş biçimleri + ürün editörünün eski davranışı), boyacı payı
// ayırma aritmetiği ve worker/istemci güvenlik nöbetçileri.
//
// Çalıştırma: npx tsx scripts/test-order-model-files.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
  MAX_ORDER_MODEL_FILES,
  dedupeFileNames,
  fallbackModelKey,
  formatModelSize,
  orderModelKindOf,
  safeModelFileName,
  verifyModelHead,
  mergeRevisionFiles,
  resolveCurrentRevision,
  revisionLockedByStage,
  unlinkableKeys,
  zipSizeProblem,
  REVISION_LOCKED_STAGES,
  ZIP_LIMIT_BYTES,
  type RevisionFileLike,
} from "../src/lib/config/order-model";
import { modelUploadStage } from "../src/lib/config/order-model-policy";
import { modelAckState } from "../src/lib/config/partner-model-ack";
import { extractModelEntriesFromZip, scanModelZip } from "../src/lib/services/model-bundle";
import {
  carvePaintingShare,
  manufacturerBaseKurus,
  orderNeedsPainting,
  painterBaseKurus,
} from "../src/lib/services/earning-base";

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
const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// ─── Örnek baytlar ──────────────────────────────────────────────────────────
function binaryStl(triangles: number, extraBytes = 0): Uint8Array {
  const buf = new Uint8Array(84 + triangles * 50 + extraBytes);
  new DataView(buf.buffer).setUint32(80, triangles, true);
  return buf;
}
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 20, 0, 0, 0]);
const ASCII_STL = strToU8("solid cube\nfacet normal 0 0 1\nendsolid cube\n");
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

// ─── Tür ve ad ──────────────────────────────────────────────────────────────
check("uzantıdan tür: STL/GLB kabul, diğerleri değil (büyük/küçük harf duyarsız)", () => {
  assert.equal(orderModelKindOf("Gövde.STL"), "stl");
  assert.equal(orderModelKindOf("kafa.glb"), "glb");
  assert.equal(orderModelKindOf("parca.obj"), null);
  assert.equal(orderModelKindOf("set.zip"), null);
  assert.equal(orderModelKindOf("uzantisiz"), null);
});

check("görünen ad: yol atılır, uzantı küçülür, Türkçe korunur", () => {
  assert.equal(safeModelFileName("klasör/alt/gövde sağ.STL"), "gövde sağ.stl");
  assert.equal(safeModelFileName("..\\..\\evil.stl"), "evil.stl");
  assert.equal(safeModelFileName('a<>:"|?*.stl'), "a.stl");
  assert.equal(safeModelFileName(".stl"), "model.stl");
  assert.equal(safeModelFileName("parça\u0007adı.stl"), "parçaadı.stl", "kontrol karakterleri atılır");
  assert.equal(safeModelFileName("v2-kafa_01.stl"), "v2-kafa_01.stl", "rakam, tire, alt çizgi korunur");
  assert.equal(safeModelFileName("x".repeat(300) + ".stl").length, 104);
});

check("aynı adlar tekilleşir, ilk ad değişmez (büyük/küçük harf duyarsız)", () => {
  const out = dedupeFileNames(["a.stl", "A.STL", "a.stl", "a (2).stl", "b.stl"]);
  assert.equal(out[0], "a.stl");
  assert.equal(out[4], "b.stl");
  assert.equal(new Set(out.map((n) => n.toLocaleLowerCase("tr"))).size, out.length);
  assert.match(out[1], /\(2\)/);
});

check("dosya tavanı işin gerçek boyutunu (12-13 parça) rahat karşılar", () => {
  assert.ok(MAX_ORDER_MODEL_FILES >= 13);
});

check("boyut etiketi okunur", () => {
  assert.equal(formatModelSize(512), "512 B");
  assert.match(formatModelSize(5 * 1024 * 1024), /MB$/);
  assert.equal(formatModelSize(null), "");
});

// ─── Başlık doğrulaması ─────────────────────────────────────────────────────
check("GLB: glTF imzası şart", () => {
  assert.equal(verifyModelHead("glb", GLB, GLB.length).ok, true);
  assert.equal(verifyModelHead("glb", ASCII_STL, ASCII_STL.length).ok, false);
});

check("STL: ASCII ve tam binary kabul", () => {
  assert.equal(verifyModelHead("stl", ASCII_STL, ASCII_STL.length).ok, true);
  const bin = binaryStl(3);
  assert.equal(verifyModelHead("stl", bin.subarray(0, 84), bin.length).ok, true);
});

check("STL: sona dolgu eklenmiş binary kabul (bazı dışa aktarıcılar ekliyor)", () => {
  const bin = binaryStl(3, 7);
  assert.equal(verifyModelHead("stl", bin.subarray(0, 84), bin.length).ok, true);
});

check("STL: yarım yüklenmiş binary reddedilir", () => {
  const bin = binaryStl(10);
  assert.equal(verifyModelHead("stl", bin.subarray(0, 84), bin.length - 1).ok, false);
});

check("STL: sıfır üçgen, boş dosya, kılık değiştirmiş GLB ve ZIP reddedilir", () => {
  const zero = binaryStl(0);
  assert.equal(verifyModelHead("stl", zero.subarray(0, 84), zero.length).ok, false);
  assert.equal(verifyModelHead("stl", new Uint8Array(0), 0).ok, false);
  assert.equal(verifyModelHead("stl", GLB, GLB.length).ok, false);
  assert.equal(verifyModelHead("stl", ZIP_MAGIC, 5000).ok, false);
});

// ─── ZIP taraması ───────────────────────────────────────────────────────────
const zip = zipSync({
  "parcalar/govde.stl": binaryStl(2),
  "parcalar/kafa.GLB": GLB,
  "parcalar/alt/base.stl": binaryStl(1),
  "readme.txt": strToU8("okuyun"),
  "render.png": new Uint8Array([1, 2, 3]),
  "__MACOSX/parcalar/._govde.stl": new Uint8Array([9]),
  ".DS_Store": new Uint8Array([9]),
  "bos-klasor/": new Uint8Array(0),
});

check("sipariş ZIP'i: STL + GLB alınır, klasör yolları düzleşir", () => {
  const { entries } = scanModelZip(zip, ["stl", "glb"]);
  const names = entries.map((e) => e.name).sort();
  assert.deepEqual(names, ["base.stl", "govde.stl", "kafa.GLB"]);
});

check("sipariş ZIP'i: yabancı dosyalar ATLANANLAR listesinde, gürültü değil", () => {
  const { skipped } = scanModelZip(zip, ["stl", "glb"]);
  assert.ok(skipped.includes("readme.txt"));
  assert.ok(skipped.includes("render.png"));
  assert.ok(!skipped.some((n) => n.startsWith("._") || n === ".DS_Store"), "macOS artıkları bildirilmez");
});

check("ürün editörünün eski davranışı değişmedi (varsayılan STL/OBJ, GLB yok)", () => {
  const names = extractModelEntriesFromZip(zip).map((e) => e.name).sort();
  assert.deepEqual(names, ["base.stl", "govde.stl"]);
});

check("bozuk ZIP fırlatır (yükleyici bunu 'ZIP açılamadı' diye gösterir)", () => {
  assert.throws(() => scanModelZip(new Uint8Array([1, 2, 3, 4]), ["stl"]));
});

// ─── Boyacı payı ayırma ─────────────────────────────────────────────────────
check("kırılımsız eski sipariş: tutar üretim tabanıdır, toplam korunur", () => {
  const r = carvePaintingShare({ amountKurus: 100_000, productionBaseKurus: null, paintingPriceKurus: 0 }, 30_000);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.productionBefore, 100_000);
  assert.equal(r.productionAfter, 70_000);
  assert.equal(r.paintingAfter, 30_000);
  assert.equal(r.productionAfter + r.paintingAfter, 100_000);
});

check("kalemli sipariş: iki taban toplamı ayırmadan önceki toplama eşit kalır", () => {
  const before = { amountKurus: 250_000, productionBaseKurus: 250_000, paintingPriceKurus: 0 };
  const r = carvePaintingShare(before, 45_050);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.productionAfter + r.paintingAfter, before.productionBaseKurus + before.paintingPriceKurus);
});

check("üretim payı sıfıra inemez; geçersiz tutar reddedilir", () => {
  const o = { amountKurus: 10_000, productionBaseKurus: 10_000, paintingPriceKurus: 0 };
  assert.deepEqual(carvePaintingShare(o, 10_000), { ok: false, reason: "exceeds_production" });
  assert.deepEqual(carvePaintingShare(o, 0), { ok: false, reason: "invalid_amount" });
  assert.deepEqual(carvePaintingShare(o, 12.5), { ok: false, reason: "invalid_amount" });
  assert.deepEqual(carvePaintingShare(o, Number.NaN), { ok: false, reason: "invalid_amount" });
});

check("ayırma sonrası hakediş tabanları route'un yazacağıyla tutarlı", () => {
  const o = { amountKurus: 100_000, productionBaseKurus: null, paintingPriceKurus: 0 };
  const r = carvePaintingShare(o, 30_000);
  assert.ok(r.ok);
  if (!r.ok) return;
  const after = { amountKurus: 100_000, productionBaseKurus: r.productionAfter, paintingPriceKurus: r.paintingAfter };
  assert.equal(orderNeedsPainting(after.paintingPriceKurus), true, "boyacı hattı açılmalı");
  assert.equal(manufacturerBaseKurus({ ...after, painterId: "p1", paintsInHouse: false }), 70_000);
  assert.equal(painterBaseKurus(after), 30_000);
});

// ─── Güvenlik nöbetçileri ───────────────────────────────────────────────────
check("saf modüller server-only / DB import etmez (istemci + worker)", () => {
  for (const f of ["src/lib/config/order-model.ts", "src/lib/services/model-bundle.ts", "src/lib/services/earning-base.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /^\s*import\s+"server-only"/m, `${f} server-only içeriyor`);
    assert.doesNotMatch(src, /from "@\/lib\/db"/, `${f} db import ediyor`);
  }
});

check("order-model servisi worker'dan erişilebilir: server-only YOK", () => {
  assert.doesNotMatch(read("src/lib/services/order-model.ts"), /^\s*import\s+"server-only"/m);
});

check("yükleyici bileşeni ve admin ekranı DB modülünü değer olarak import etmez", () => {
  for (const f of ["src/components/admin/order-model-uploader.tsx", "src/app/admin/orders/[id]/client.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /^import\s+(?!type\b)[^;]*from\s+"@\/lib\/services\/order-model"/m, `${f} servisi değer olarak import ediyor`);
    assert.doesNotMatch(src, /from "@\/lib\/db"/, `${f} db import ediyor`);
  }
});

check("yükleme route'u tek bir hatalı parçada TÜM hazırlanmış yüklemeleri siler", () => {
  const src = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.match(src, /stagedIds\.map\(\(id\) => discardStagedUpload\(id\)/);
  // Doğrulama, taşımadan (promote) önce biter.
  assert.ok(src.indexOf("verifyModelHead(") < src.indexOf("promoteStagedUpload(e.uploadId"));
});

check("GLB artık zorunlu değil: route 'Missing glb' ile reddetmiyor", () => {
  const src = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.doesNotMatch(src, /Missing glb/);
});

// ─── Önceki parçaları taşıma (carryForward) ─────────────────────────────────
const part = (name: string, kind: "stl" | "glb", key: string): RevisionFileLike => ({ name, kind, key, sizeBytes: 1 });

check("merge: aynı adlı parça YERİNDE değişir, diğerleri taşınır (büyük/küçük harf duyarsız)", () => {
  const prev = [part("govde.stl", "stl", "o1"), part("kol-sag.stl", "stl", "o2"), part("onizleme.glb", "glb", "o3")];
  const out = mergeRevisionFiles(prev, [part("KOL-SAG.stl", "stl", "n1")]);
  assert.deepEqual(out.map((f) => f.key), ["o1", "n1", "o3"]);
});

check("merge: yeni adlar yükleme sırasıyla sona eklenir, taşınanlar aynı anahtarla kalır", () => {
  const prev = [part("a.stl", "stl", "o1"), part("b.stl", "stl", "o2")];
  const out = mergeRevisionFiles(prev, [part("c.stl", "stl", "n1"), part("a.stl", "stl", "n2"), part("d.glb", "glb", "n3")]);
  assert.deepEqual(out.map((f) => f.key), ["n2", "o2", "n1", "n3"]);
});

check("merge: önceki sürüm yoksa yalnız yüklenenler; tam set yüklenirse hiçbir şey taşınmaz", () => {
  assert.deepEqual(mergeRevisionFiles([], [part("x.stl", "stl", "n1")]).map((f) => f.key), ["n1"]);
  const prev = [part("a.stl", "stl", "o1")];
  assert.deepEqual(mergeRevisionFiles(prev, [part("a.stl", "stl", "n1")]).map((f) => f.key), ["n1"]);
});

// ─── ASCII STL varyantları ──────────────────────────────────────────────────
check("ASCII STL: UTF-8 BOM, baştaki boşluk/satır sonu ve BÜYÜK HARF SOLID kabul", () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8("solid x\nendsolid x\n")]);
  assert.equal(verifyModelHead("stl", bom, bom.length).ok, true);
  const ws = strToU8("  \r\n  solid x\n");
  assert.equal(verifyModelHead("stl", ws, ws.length).ok, true);
  const upper = strToU8("SOLID PART\n");
  assert.equal(verifyModelHead("stl", upper, upper.length).ok, true);
});

// ─── ZIP 4 GiB sınırı ───────────────────────────────────────────────────────
check("ZIP: 4 GiB'ı aşan tek dosya ya da toplam reddedilir, altı geçer", () => {
  assert.equal(zipSizeProblem([10, 20, 30]), null);
  assert.ok(zipSizeProblem([ZIP_LIMIT_BYTES]));
  assert.ok(zipSizeProblem([2 ** 31, 2 ** 31]));
  assert.equal(zipSizeProblem([2 ** 31]), null);
});

// ─── Route nöbetçileri ──────────────────────────────────────────────────────
check("boyama ekleme ortak kilitli bölüşüm servisine devreder; ekran aynı kapıyı kullanır", () => {
  const route = read("src/app/api/admin/orders/[id]/add-painting/route.ts");
  assert.match(route, /await editOrderMoneySplit\(/);
  assert.doesNotMatch(route, /\.update\(orders\)|\.insert\(adminActions\)/);
  assert.match(route, /expectedProductionKurus:\s*productionBefore/);
  assert.match(route, /expectedPaintingKurus:\s*order\.paintingPriceKurus/);
  assert.match(route, /reason:\s*parsed\.data\.reason/);
  const page = read("src/app/admin/orders/[id]/page.tsx");
  assert.match(page, /moneySplitEditBlock\(/);
  assert.doesNotMatch(page, /ne\(manufacturerEarnings\.status, "reversed"\)/);
  const client = read("src/app/admin/orders/[id]/client.tsx");
  assert.match(client, /reason:\s*addPaintingReason/);
  assert.match(client, /addPaintingReason\.trim\(\)\.length < 10/);
});

check("boyama bildirimi 'kendim boyarım' üreticisini ayırt eder ve rakamı tek yerden türetir", () => {
  const route = read("src/app/api/admin/orders/[id]/add-painting/route.ts");
  assert.match(route, /paintsInHouse/);
  assert.match(route, /manufacturerBaseKurus\(/);
});

check("yükleme route'u carryForward'ı okur ve doğrulama SONRASI hatada taşınan dosyaları siler", () => {
  const route = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.match(route, /formData\.get\("carryForward"\) === "1"/);
  assert.match(route, /carryForward,\s*\n\s*source:/);
  assert.match(route, /inputs\.map\(\(f\) => deleteFile\(f\.key\)/);
});

// ─── Hangi sürüm GEÇERLİ ────────────────────────────────────────────────────
// TEK KURAL: en yüksek numaralı sürüm geçerlidir. Anahtar eşlemesi bu soruyu
// cevaplayamaz, çünkü "önceki parçaları koru" taşınan parçayı KOPYALAMAZ: iki
// sürüm başlığı aynı dosya anahtarını taşır. Aşağıdaki ilk test o dizilişi
// (hatayı gizleyen diziliş) gerçek merge çıktısından üretir.
check("geçerli sürüm: EN YÜKSEK sürüm kazanır (sıra karışık gelse de)", () => {
  assert.equal(resolveCurrentRevision([{ revision: 1 }, { revision: 2 }]), 2);
  assert.equal(resolveCurrentRevision([{ revision: 3 }, { revision: 1 }, { revision: 2 }]), 3);
  assert.equal(resolveCurrentRevision([{ revision: 7 }]), 7);
  assert.equal(resolveCurrentRevision([]), null, "sürüm yoksa null");
});

check("carryForward dizilişi: taşınan parça anahtarı PAYLAŞIR, kural yine de yeni sürümü seçer", () => {
  // Sürüm 1: gövde + kol. Sürüm 2 yalnız kolu düzeltir, gövde TAŞINIR.
  const rev1 = [part("govde.stl", "stl", "k-govde"), part("kol.stl", "stl", "k-kol")];
  const rev2 = mergeRevisionFiles(rev1, [part("kol.stl", "stl", "k-kol-v2")]);
  assert.deepEqual(rev2.map((f) => f.key), ["k-govde", "k-kol-v2"]);
  // İki sürümün BİRİNCİL STL'i (ilk STL) aynı anahtar: "k-govde".
  const primary = (files: RevisionFileLike[]) => files.find((f) => f.kind === "stl")!.key;
  assert.equal(primary(rev1), primary(rev2), "taşınan birincil parça anahtarı paylaşılıyor");
  // Anahtar eşlemesi bu yüzden iki sürümü birden gösterirdi; sayı göstermez.
  assert.equal(resolveCurrentRevision([{ revision: 1 }, { revision: 2 }]), 2);
});

check("eski sürüme dönüş: geri getirme en üste yazdığı için kural değişmeden çalışır", () => {
  // Sürüm 1 geri getirildi → dosya kümesi sürüm 3 olarak yeniden yayımlandı.
  // Terk edilen sürüm 2 hâlâ listede, ama geçerli olan 3'tür.
  assert.equal(resolveCurrentRevision([{ revision: 1 }, { revision: 2 }, { revision: 3 }]), 3);
});

// ─── Diskten hangi dosya kaldırılabilir ─────────────────────────────────────
check("unlink: paylaşılan, siparişin gösterdiği ve tekrarlı anahtarlar korunur", () => {
  assert.deepEqual(unlinkableKeys(["a", "b"], ["b"]), ["a"], "başka sürümün taşıdığı dosya kalır");
  assert.deepEqual(unlinkableKeys(["a"], ["a"]), [], "hâlâ gösterilen anahtar silinmez");
  assert.deepEqual(unlinkableKeys(["a", "a", "c"], []), ["a", "c"], "tekrarlar tekilleşir");
  assert.deepEqual(unlinkableKeys(["a"], [null, undefined]), ["a"], "boş referanslar sayılmaz");
  // Asıl kayıp senaryosu: silinen sürüm GEÇERLİ DEĞİL ama siparişin canlı GLB'si
  // onun dosyasını gösteriyor (yalnız-STL sürümden sonra korunan GLB).
  assert.deepEqual(unlinkableKeys(["k-glb", "k-stl"], ["k-glb"]), ["k-stl"]);
});

// ─── Sürüm silme nöbetçisi: "baskıda mı" politikadan gelir ──────────────────
check("silme kilidi: admin'in KENDİ bastığı sipariş (üretici yok) de kilitli", () => {
  const inHouse = modelUploadStage({
    status: "printing",
    manufacturerStatus: null,
    painterStatus: null,
    paymentStatus: "succeeded",
  });
  assert.equal(inHouse, "printing");
  assert.equal(revisionLockedByStage(inHouse), true, "üreticisiz baskı korumasız kalıyor");
  const withMfg = modelUploadStage({
    status: "printing",
    manufacturerStatus: "printing",
    painterStatus: null,
    paymentStatus: "succeeded",
  });
  assert.equal(revisionLockedByStage(withMfg), true);
  // Üretim başlamadan silmek serbesttir: ortada basılmış bir iş yok.
  const before = modelUploadStage({
    status: "approved",
    manufacturerStatus: "accepted",
    painterStatus: null,
    paymentStatus: "succeeded",
  });
  assert.equal(before, "before_production");
  assert.equal(revisionLockedByStage(before), false);
  assert.deepEqual([...REVISION_LOCKED_STAGES], [
    "printing",
    "printed_or_qc",
    "painting",
    "shipped_or_delivered",
  ]);
});

// ─── Sürümün taşımadığı birincil dosya (P2A-1) ──────────────────────────────
check("yalnız-STL sürüm siparişin GLB anahtarını DÜŞÜRMEZ (müşteri onay kapısı)", () => {
  const svc = read("src/lib/services/order-model.ts");
  assert.match(svc, /const liveGlbKey = primaryGlb\?\.key \?\? order\.modelGlbKey/);
  assert.match(svc, /modelGlbKey: liveGlbKey/);
  assert.doesNotMatch(
    svc,
    /modelGlbKey: primaryGlb\?\.key \?\? null/,
    "sürümün taşımadığı GLB null'lanıyor: meshy_auto onay kapısı düşer"
  );
  assert.doesNotMatch(svc, /modelStlKey: primaryStl\?\.key \?\? null/);
  // Sürüm BAŞLIĞI yine de dürüst kalır: sürüm neyi taşıyorsa onu yazar.
  assert.match(svc, /glbKey: primaryGlb\?\.key \?\? null/);
});

check("eski sürümü geçerli yapmak da taşınmayan türü boşaltmaz", () => {
  const svc = read("src/lib/services/order-model.ts");
  const fn = svc.slice(svc.indexOf("export async function setCurrentModelRevision"));
  assert.match(fn, /const liveGlbKey = primaryGlb\?\.fileKey \?\? order\.modelGlbKey/);
  assert.match(fn, /const liveStlKey = primaryStl\?\.fileKey \?\? order\.modelStlKey/);
});

// ─── "Bu sürümü geçerli yap" GERÇEKTEN değiştirmeli ────────────────────────
// Yalnız siparişin canlı kolonlarını oynatmak hiçbir partner yüzeyini
// değiştirmiyordu: hepsi EN YÜKSEK sürümü okur. Geri getirme bu yüzden kaynak
// sürümün kümesini en üste yeniden yayımlar.
check("geri getirme: kaynak sürümün kümesini EN ÜSTE yeni sürüm olarak yayımlar", () => {
  const svc = read("src/lib/services/order-model.ts");
  const fn = svc.slice(
    svc.indexOf("export async function setCurrentModelRevision"),
    svc.indexOf("export interface DeleteRevisionResult")
  );
  assert.match(fn, /const nextRev = current \+ 1/, "yeni sürüm numarası en üstün bir fazlası değil");
  assert.match(fn, /tx\.insert\(orderModelRevisions\)/, "sürüm başlığı yazılmıyor");
  assert.match(fn, /tx\.insert\(orderModelFiles\)/, "dosya satırları yazılmıyor");
  // Disk kopyası YOK: yeni satırlar kaynağın anahtarlarını gösterir.
  assert.match(fn, /fileKey: f\.fileKey/);
  assert.match(fn, /Sürüm \$\{revision\} yeniden geçerli yapıldı/, "geçmiş neden değiştiğini söylemiyor");
  // Zaten geçerli olan sürüme basmak kopya üretmez.
  assert.match(fn, /if \(revision === current\)/);
  assert.match(fn, /newRevision: null/);
  // İade nöbetçisi tutarsa sürüm satırları da geri alınmalı.
  assert.match(fn, /if \(!updated\) throw new Error/);
  // Dosyasız bir sürümü en üste yayımlamak üreticinin parça listesini boşaltır.
  assert.match(fn, /ModelRevisionEmptyError/);
});

check("geçerli sürüm TEK yerde çözülür: numara, anahtar eşlemesi değil", () => {
  const svc = read("src/lib/services/order-model.ts");
  const fn = svc.slice(
    svc.indexOf("export async function currentModelRevision"),
    svc.indexOf("export interface SetCurrentRevisionResult")
  );
  assert.match(fn, /resolveCurrentRevision\(revs\)/, "karar saf kuraldan gelmiyor");
  assert.doesNotMatch(fn, /glbKey/, "hâlâ dosya anahtarı eşleştiriliyor");
  // İkinci uygulama kalmadı: QC ucunun çağırdığı isim buraya devrediyor.
  const rev = read("src/lib/services/order-model-revision.ts");
  const dele = rev.slice(rev.indexOf("export async function currentOrderModelRevision"));
  assert.match(dele, /return currentModelRevision\(orderId\)/);
  assert.doesNotMatch(dele, /orderModelRevisions/, "ikinci bir sorgu hâlâ burada");
});

check("duyuru siparişin GEÇERLİ sürümünü anar (geri getirme onay kapısını açar)", () => {
  const rev = read("src/lib/services/order-model-revision.ts");
  const fn = rev.slice(
    rev.indexOf("export async function notifyOrderModelRevision"),
    rev.indexOf("/** Partnerin bu siparişteki duyuru")
  );
  assert.match(fn, /const revision = Math\.max\(args\.revision, live \?\? args\.revision\)/);
});

check("her partner/müşteri dosya yüzeyi AYNI kuralı okur (latestModelFiles)", () => {
  for (const f of [
    "src/app/manufacturer/orders/[id]/page.tsx",
    "src/app/api/manufacturer/orders/[id]/model-files/[fileId]/route.ts",
    "src/app/api/manufacturer/orders/[id]/model-files/zip/route.ts",
    "src/app/api/customer/orders/[orderNumber]/download/[format]/route.ts",
    "src/app/api/admin/orders/[id]/model-files/zip/route.ts",
  ]) {
    assert.match(read(f), /latestModelFiles\(/, `${f} güncel sürümü başka yoldan çözüyor`);
  }
  // latestModelFiles = dosya satırlarının EN YÜKSEK sürümü; kuralla aynı cevap.
  const svc = read("src/lib/services/order-model.ts");
  const fn = svc.slice(svc.indexOf("export async function latestModelFiles"));
  assert.match(fn, /max\(\$\{orderModelFiles\.revision\}\)/);
});

check("sürüm silme: nöbetçi politikanın aşamasını okur, siparişin dosyası koparılmaz", () => {
  const svc = read("src/lib/services/order-model.ts");
  const fn = svc.slice(svc.indexOf("export async function deleteModelRevision"));
  assert.match(fn, /resolveCurrentRevision\(revs\)/, "geçerli sürüm sayıyla çözülmüyor");
  assert.doesNotMatch(fn, /const currentMatch = revs\.find\(/, "hâlâ anahtar eşlemesi");
  // "Baskıda mı" sorusu üretici durumundan DEĞİL politikadan gelir: admin'in
  // kendi bastığı siparişte manufacturerStatus NULL'dur.
  assert.match(fn, /revisionLockedByStage\(stage\)/);
  assert.doesNotMatch(fn, /order\.manufacturerStatus === "printing"/, "üretici durumu tek başına okunuyor");
  // Veri kaybı: koruma artık GEÇERLİ OLMAYAN sürümün silinmesinde de çalışır.
  assert.match(fn, /unlinkableKeys\(/);
  assert.match(fn, /if \(current !== revision\) stillUsed\.push\(order\.glbKey, order\.stlKey\)/);
  assert.match(fn, /stillUsed\.push\(r\.glbKey, r\.stlKey\)/, "hayatta kalan sürüm başlıkları korunmuyor");
  assert.match(fn, /fallbackModelKey\(/, "silinen dosyaya işaret kalabilir");
  assert.doesNotMatch(fn, /const keep = \(key: string \| null\)/, "eleme kuralının ikinci kopyası");
});

// ─── Geçerli sürüm silinince sipariş neyi gösterir ──────────────────────────
// Dilim fonksiyonun SONUNDA biter: sınırsız dilim dosyanın devamındaki
// resetQcForNewRevision'ın UPDATE'ini yakalayıp yanlış yeri sınıyordu.
const deleteFn = (svc: string) =>
  svc.slice(
    svc.indexOf("export async function deleteModelRevision"),
    svc.indexOf("export interface QcResetResult")
  );

check("fallbackModelKey: sıra dosya → başlık → siparişin canlısı; unlink edilen atlanır", () => {
  const none = new Set<string>();
  assert.equal(fallbackModelKey(["k-dosya", "k-baslik", "k-canli"], none), "k-dosya");
  // ESKİ sürüm (0031 ile 0053 arası): başlığı var, dosya satırı yok.
  assert.equal(fallbackModelKey([undefined, "k-baslik", "k-canli"], none), "k-baslik");
  // Geri düşülen sürüm bu türü hiç taşımıyor (yalnız-STL sürüm): canlı korunur.
  assert.equal(fallbackModelKey([undefined, null, "k-canli"], none), "k-canli");
  // Az önce diskten kaldırılan aday hiçbir sırada seçilemez.
  assert.equal(fallbackModelKey(["k-dosya"], new Set(["k-dosya"])), null);
  assert.equal(fallbackModelKey([undefined, null, "k-canli"], new Set(["k-canli"])), null);
  assert.equal(fallbackModelKey(["k-dosya", "k-baslik"], new Set(["k-dosya"])), "k-baslik");
  assert.equal(fallbackModelKey([], none), null);
});

check("geçerli sürüm silinince DOSYASIZ eski sürüme düşüş siparişi modelsiz bırakmaz", () => {
  // Kayıp senaryosu: geri düşülen sürüm 0053 öncesinden kalma (başlık var,
  // order_model_files satırı yok). Adaylar yalnız "dosya satırı" ve "siparişin
  // canlı anahtarı" olsaydı, canlı anahtar SİLİNEN sürümün dosyasını gösterdiği
  // için az önce unlink edilmiş olur ve sipariş kullanılabilir bir sürüm
  // dururken modelsiz kalırdı.
  const svc = read("src/lib/services/order-model.ts");
  const fn = deleteFn(svc);
  assert.match(fn, /next\.glbKey/, "geri düşülen sürümün BAŞLIK GLB'si aday değil");
  assert.match(fn, /next\.stlKey/, "geri düşülen sürümün BAŞLIK STL'i aday değil");
  const glb = fn.slice(fn.indexOf("glbKey = fallbackModelKey("));
  const adaylar = glb.slice(0, glb.indexOf("]"));
  assert.ok(
    adaylar.indexOf("files.find") < adaylar.indexOf("next.glbKey") &&
      adaylar.indexOf("next.glbKey") < adaylar.indexOf("order.glbKey"),
    "aday sırası bozuk: dosya → başlık → canlı olmalı"
  );
  // setCurrentModelRevision aynı eski biçimi zaten kurtarıyordu; iki yol ayrışmasın.
  const set = svc.slice(
    svc.indexOf("export async function setCurrentModelRevision"),
    svc.indexOf("export interface DeleteRevisionResult")
  );
  assert.match(set, /source\.glbKey/, "geçerli yapma yolu başlıktan kurtarmayı bırakmış");
});

check("sürüm silme: iade yarışında işaret yazılamazsa HER ŞEY geri alınır", () => {
  // İade, bu işlem satırı kilitlemeden hemen önce girebilir. Nöbetçinin sonucu
  // okunmazsa satırlar silinmiş, rota dosyaları diskten kaldırmış ve sipariş
  // kaldırılan dosyaları gösteriyor olurdu — silmenin önlemek için var olduğu
  // kaybın ta kendisi. Kardeş setCurrentModelRevision bunu zaten fırlatarak
  // kapatıyordu; iki dal ayrışmamalı.
  const svc = read("src/lib/services/order-model.ts");
  const fn = deleteFn(svc);
  const repoint = fn.slice(fn.lastIndexOf(".update(orders)"));
  assert.match(repoint, /notRefundedGuard\(\)/, "işaret yazması iade nöbetçisiz");
  assert.match(repoint, /\.returning\(/, "nöbetçinin sonucu hiç okunmuyor");
  assert.match(repoint, /if \(!repointed\)[\s\S]{0,120}throw new Error/, "tutulan nöbetçi sessiz geçiliyor");
  const set = svc.slice(
    svc.indexOf("export async function setCurrentModelRevision"),
    svc.indexOf("export interface DeleteRevisionResult")
  );
  assert.match(set, /if \(!updated\) throw new Error/, "kardeş dal artık fırlatmıyor");
});

// ─── Onay kapısı arızada KAPALI kalır ───────────────────────────────────────
check("onay kapısı: eylem günlüğü OKUNAMAZSA kapı kapalı kalır (fail closed)", () => {
  // Kapının açık kalmasının bedeli: eski modele basılmış iş QC'den geçip
  // kargolanır. Boş satır listesi "duyuru yok" demektir — yani yutulan bir hata
  // kapıyı tam da bu şekilde açardı:
  assert.equal(modelAckState([]).pending, false, "boş liste zaten 'onay gerekmiyor' diyor");
  const rev = read("src/lib/services/order-model-revision.ts");
  const fn = rev.slice(
    rev.indexOf("export async function readPartnerModelAck"),
    rev.indexOf("export type RecordAckResult")
  );
  assert.doesNotMatch(fn, /return \[\] as/, "hata yine boş listeye çevriliyor: kapı açılır");
  const fail = fn.slice(fn.indexOf("catch"));
  assert.match(fail, /pending: true/, "arızada kapı kapanmıyor");
  assert.match(fail, /readFailed: true/, "arıza, karardan ayırt edilemiyor");
  assert.match(fail, /announcedRevision: null/, "bilinmeyen sürüm numarası uyduruluyor");
  // Kapıyı okuyan uçlar durumu ya ortak yardımcıdan (modelAckRefusal — arıza
  // dalını da kapsar, 503) ya da eski biçimde doğrudan `ack.pending`ten okur.
  // İkisi de yoksa kapı o uçta HİÇ yok demektir.
  for (const f of [
    "src/app/api/manufacturer/orders/[id]/start-printing/route.ts",
    "src/app/api/manufacturer/orders/[id]/ship/route.ts",
    "src/app/api/painter/orders/[id]/ship/route.ts",
  ]) {
    assert.match(read(f), /modelAckRefusal\(|ack\.pending/, `${f} kapıyı okumuyor`);
  }
  // Admin'in "partner adına" yolunda BİÇİM değil DAVRANIŞ sabitlenir: kapı
  // okunmalı ve kapalıyken ret dönmeli. Ret ister ortak yardımcıdan
  // (modelAckRefusal — arıza dalını da kapsar, 503) ister eski `ack.pending`
  // biçiminden gelsin, güvence aynıdır. Literal `!ack.pending` beklemek, tam da
  // istenen düzeltmeyi (ortak yardımcıya geçiş) imkânsız kılıyordu: testi
  // düzeltmeden fix yazılamıyordu.
  const onBehalf = read("src/lib/services/on-behalf.ts");
  const gateStart = onBehalf.indexOf("async function modelAckGate");
  const gateEnd = onBehalf.indexOf("export interface OnBehalfPreflight");
  assert.ok(gateStart >= 0 && gateEnd > gateStart, "on-behalf model onay kapısı bulunamadı");
  const gate = onBehalf.slice(gateStart, gateEnd);
  assert.match(gate, /readPartnerModelAck\(/, "admin adına yolu kapıyı hiç sormuyor");
  assert.match(gate, /modelAckRefusal\(|ack\.pending/, "kapı okunuyor ama rette kullanılmıyor");
  assert.match(gate, /fail\(/, "kapı kapalıyken ret dönülmüyor");
});

check("onay YAZIMI da arızada durur: okunamayan günlüğe 'zaten onaylı' denmez", () => {
  const rev = read("src/lib/services/order-model-revision.ts");
  const fn = rev.slice(rev.indexOf("export async function recordPartnerModelAck"));
  const read_ = fn.indexOf("readPartnerModelAck(");
  const guard = fn.indexOf("if (state.readFailed)");
  const insert = fn.indexOf("db.insert(");
  assert.ok(guard > read_ && guard >= 0, "arıza kontrolü yok");
  assert.ok(guard < insert, "onay satırı arıza kontrolünden ÖNCE yazılıyor");
  assert.match(fn.slice(guard, insert), /throw new Error/, "arızada sessizce devam ediliyor");
});

// ─── Yükleme route'u: kimlik, not ve duyuru kuralı ──────────────────────────
check("bozuk sipariş kimliği route'un kendi 404'üne düşer (DB hatası değil)", () => {
  const route = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.match(route, /UUID_RE/);
  assert.ok(
    route.indexOf("UUID_RE.test(orderId)") < route.indexOf("db.query.orders.findFirst"),
    "kimlik denetimi ilk sorgudan sonra"
  );
  // POST'ta `fail` kullanılır: hazırlanmış parçalar da atılır.
  assert.match(route, /if \(!UUID_RE\.test\(orderId\)\) return fail\(404/);
});

check("kargo sonrası: partnerlere duyuru YOK, dijital dosya müşterisine VAR", () => {
  const route = read("src/app/api/admin/orders/[id]/upload-model/route.ts");
  assert.match(route, /const announced = effects\.recordOnly/);
  assert.match(route, /: await notifyOrderModelRevision\(/);
  assert.match(route, /notifyDigitalFilesCustomer\(/);
  assert.match(route, /includes\("digital_files"\)/);
});

check("yükleyici gerekçeyi GÖNDERİR ve sunucunun sonucunu sayfaya geçirir (P2-C2)", () => {
  const ui = read("src/components/admin/order-model-uploader.tsx");
  assert.match(ui, /if \(trimmedNote\) fd\.append\("note", trimmedNote\)/);
  assert.match(ui, /noteRequired && !trimmedNote/, "notsuz yükleme sunucuya gidiyor");
  assert.match(ui, /appliedSideEffects: res\?\.appliedSideEffects/);
  assert.match(ui, /stage: res\?\.stage/);
});

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail > 0) {
  console.log("\nBaşarısızlar:");


  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
