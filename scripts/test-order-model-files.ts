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
  formatModelSize,
  orderModelKindOf,
  safeModelFileName,
  verifyModelHead,
  mergeRevisionFiles,
  zipSizeProblem,
  ZIP_LIMIT_BYTES,
  type RevisionFileLike,
} from "../src/lib/config/order-model";
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
check("atölye siparişine boyama eklenemez: route (kontrol + atomik WHERE) ve ekran", () => {
  const route = read("src/app/api/admin/orders/[id]/add-painting/route.ts");
  assert.match(route, /if \(order\.workshopSessionId\)/);
  assert.match(route, /isNull\(orders\.workshopSessionId\)/);
  assert.match(read("src/app/admin/orders/[id]/page.tsx"), /order\.workshopSessionId\s*\?\s*"Atölye/);
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

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail > 0) {
  console.log("\nBaşarısızlar:");


  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
