/**
 * Anlık teklif motoru: sahnelenmiş (staged) dosya doğrulaması.
 *
 * Burada test edilen şey bir ZIP okuyucusu DEĞİL, bir KAPIDIR: müşteri
 * sunucuya 100 MB'lık bir paket bırakır ve biz o paketi AÇMADAN — yalnız
 * merkezi dizini okuyarak — güvenli olup olmadığına karar veririz. Açmak
 * zorunda kalsaydık bir "zip bombası" tek istekte belleği bitirebilirdi.
 *
 * Bu yüzden testler bozuk paketleri `fflate` ile ÜRETİR (üretim kodu fflate
 * kullanmaz, kullanmamalıdır) ve bayt bayt bozar: şifreli bayrak, ZIP64
 * işaretçisi, bilinmeyen sıkıştırma yöntemi, 1000:1 oran. Her biri kendi
 * makine-okur kodunu döndürmeli ki arayüz doğru cümleyi gösterebilsin.
 *
 * Fikstürler Task 0.1'den gelir (`scripts/fixtures/quote/`, üreteci
 * `make_quote_fixtures.py`). DB, Redis, ağ yok: `UPLOAD_DIR` geçici bir dizine
 * çevrilir ve modül ONDAN SONRA import edilir (staging yolu modül yüklenirken
 * çözülür).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

const FIXTURES = join(import.meta.dirname, "fixtures", "quote");

// UPLOAD_DIR modül yüklenirken okunur → import'lardan ÖNCE ayarla.
const uploadRoot = mkdtempSync(join(tmpdir(), "quote-validation-"));
process.env.UPLOAD_DIR = uploadRoot;
const STAGING = join(uploadRoot, "staging");

let failures = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗   ${name}\n      ${(err as Error).message}`);
  }
}

let seq = 0;
/** Bir tamponu staging dizinine yazar ve upload id'sini döndürür. */
async function stage(bytes: Uint8Array): Promise<string> {
  seq++;
  const id = `stagedUpload${String(seq).padStart(12, "0")}`;
  await mkdir(STAGING, { recursive: true });
  await writeFile(join(STAGING, id), bytes);
  return id;
}

// ─── 3MF paket parçaları ────────────────────────────────────────────────────

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
  "</Types>";

const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rel0" Target="/3D/3dmodel.model" ' +
  'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
  "</Relationships>";

function modelXml(unit: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<model unit="${unit}" xml:lang="en-US" ` +
    'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<resources><object id="1" type="model"><mesh><vertices/><triangles/></mesh></object></resources>' +
    '<build><item objectid="1"/></build></model>'
  );
}

/** Tam bir 3MF paketi. `level: 0` = sıkıştırmasız (stored) girdiler. */
function make3mf(opts: { unit?: string; level?: 0 | 6; omitModel?: boolean; omitTypes?: boolean } = {}) {
  const level = opts.level ?? 6;
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  if (!opts.omitTypes) files["[Content_Types].xml"] = [strToU8(CONTENT_TYPES), { level }];
  files["_rels/.rels"] = [strToU8(RELS), { level }];
  if (!opts.omitModel) files["3D/3dmodel.model"] = [strToU8(modelXml(opts.unit ?? "millimeter")), { level }];
  return Buffer.from(zipSync(files, { level }));
}

// ─── ZIP bayt cerrahisi (yalnız test tarafı) ────────────────────────────────

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

function findEocd(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("EOCD bulunamadı");
}

/** Merkezi dizindeki her girdi için geri çağırır (ad + kayıt uzaklığı). */
function eachCentralEntry(buf: Buffer, fn: (off: number, name: string) => void) {
  const eocd = findEocd(buf);
  const entries = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    assert.equal(buf.readUInt32LE(off), CD_SIG, "merkezi dizin imzası");
    const nameLen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    fn(off, name);
    off += 46 + nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
}

// ─── Testler ────────────────────────────────────────────────────────────────

async function main() {
  const {
    inspect3mfCentralDirectory,
    validateStagedQuoteModel,
  } = await import("../src/lib/services/quote-model-validation");
  const {
    readStagedRange,
    setStagedUploadMeta,
    getStagedUploadMeta,
    uploadOwnerKey,
  } = await import("../src/lib/services/chunked-upload");

  const MAX = 100 * 1024 * 1024;

  console.log("\nquote-model-validation — geçerli dosyalar");

  for (const [file, format] of [
    ["cube20.stl", "stl"],
    ["cube20.obj", "obj"],
    ["cube1in.3mf", "3mf"],
  ] as const) {
    await test(`${file} → ok, biçim ${format}`, async () => {
      const bytes = await readFile(join(FIXTURES, file));
      const id = await stage(bytes);
      const res = await validateStagedQuoteModel(id, file, MAX);
      assert.equal(res.ok, true, `beklenmedik ret: ${JSON.stringify(res)}`);
      if (!res.ok) return;
      assert.equal(res.format, format);
      assert.equal(res.size, bytes.length);
      assert.equal(res.sha256, createHash("sha256").update(bytes).digest("hex"));
    });
  }

  await test("ASCII STL de kabul edilir (fikstürden üretilen metin gövde)", async () => {
    const ascii = Buffer.from(
      "solid fixture\n" +
        "facet normal 0 0 1\n outer loop\n" +
        "  vertex 0 0 0\n  vertex 1 0 0\n  vertex 0 1 0\n" +
        " endloop\nendfacet\nendsolid fixture\n"
    );
    const id = await stage(ascii);
    const res = await validateStagedQuoteModel(id, "part.stl", MAX);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.format, "stl");
  });

  console.log("\nquote-model-validation — 3MF paket kuralları");

  await test("3D/*.model girdisi yoksa → 3mf_no_model", async () => {
    const id = await stage(make3mf({ omitModel: true }));
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_no_model");
  });

  await test("[Content_Types].xml yoksa → 3mf_no_content_types", async () => {
    const id = await stage(make3mf({ omitTypes: true }));
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_no_content_types");
  });

  await test("şifreli girdi (bayrak bit 0) → 3mf_encrypted", async () => {
    const zip = make3mf();
    eachCentralEntry(zip, (off) => zip.writeUInt16LE(zip.readUInt16LE(off + 8) | 0x0001, off + 8));
    const id = await stage(zip);
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_encrypted");
  });

  await test("desteklenmeyen sıkıştırma yöntemi (12) → 3mf_method", async () => {
    const zip = make3mf();
    eachCentralEntry(zip, (off) => zip.writeUInt16LE(12, off + 10));
    const id = await stage(zip);
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_method");
  });

  await test("EOCD'de ZIP64 nöbetçisi (0xFFFFFFFF uzaklık) → 3mf_zip64", async () => {
    const zip = make3mf();
    zip.writeUInt32LE(0xffffffff, findEocd(zip) + 16);
    const id = await stage(zip);
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_zip64");
  });

  await test("girdi başına ZIP64 nöbetçisi (0xFFFFFFFF boyut) → 3mf_zip64", async () => {
    const zip = make3mf();
    eachCentralEntry(zip, (off, name) => {
      if (name === "3D/3dmodel.model") zip.writeUInt32LE(0xffffffff, off + 24);
    });
    const id = await stage(zip);
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_zip64");
  });

  await test("sıkıştırma oranı 1000:1'i aşarsa → 3mf_bomb", async () => {
    const zip = make3mf();
    eachCentralEntry(zip, (off, name) => {
      if (name !== "3D/3dmodel.model") return;
      const comp = zip.readUInt32LE(off + 20);
      assert.ok(comp > 0, "sıkıştırılmış boyut > 0 olmalı");
      zip.writeUInt32LE(comp * 1500, off + 24);
    });
    const id = await stage(zip);
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_bomb");
  });

  await test("açılmış toplam 1,5 GB'ı aşarsa → 3mf_bomb (oran masum olsa bile)", async () => {
    const zip = make3mf();
    eachCentralEntry(zip, (off, name) => {
      if (name !== "3D/3dmodel.model") return;
      zip.writeUInt32LE(2_000_000_000, off + 20); // oran 1:1
      zip.writeUInt32LE(2_000_000_000, off + 24);
    });
    const id = await stage(zip);
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_bomb");
  });

  await test("10.000'den fazla girdi → 3mf_cd_entries (dizin okunmadan)", async () => {
    const zip = make3mf();
    zip.writeUInt16LE(20_000, findEocd(zip) + 10);
    const id = await stage(zip);
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_cd_entries");
  });

  await test("merkezi dizin 1 MB'ı aşarsa → 3mf_cd_too_large", async () => {
    const zip = make3mf();
    zip.writeUInt32LE(2 * 1024 * 1024, findEocd(zip) + 12);
    const id = await stage(zip);
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_cd_too_large");
  });

  await test("ZIP başlığı yoksa → 3mf_not_zip", async () => {
    const id = await stage(Buffer.alloc(4096, 0x41));
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_not_zip");
  });

  await test("EOCD kaydı yoksa → 3mf_no_eocd", async () => {
    const zip = make3mf();
    const id = await stage(zip.subarray(0, findEocd(zip)));
    const res = await validateStagedQuoteModel(id, "part.3mf", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "3mf_no_eocd");
  });

  console.log("\ninspect3mfCentralDirectory — birim sezgisi");

  await test("sıkıştırılmamış model girdisinde <model unit> okunur", async () => {
    const zip = make3mf({ unit: "inch", level: 0 });
    const id = await stage(zip);
    const tail = await readStagedRange(id, Math.max(0, zip.length - 65_557), Math.min(65_557, zip.length));
    const res = await inspect3mfCentralDirectory(
      tail,
      (off, len) => readStagedRange(id, off, len),
      zip.length
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.entries, 3);
    assert.equal(res.unit, "in");
  });

  await test("deflate'lenmiş model girdisinde birim okunmaz (AÇMIYORUZ) → null", async () => {
    const bytes = await readFile(join(FIXTURES, "cube1in.3mf"));
    const id = await stage(bytes);
    const tail = await readStagedRange(id, Math.max(0, bytes.length - 65_557), Math.min(65_557, bytes.length));
    const res = await inspect3mfCentralDirectory(
      tail,
      (off, len) => readStagedRange(id, off, len),
      bytes.length
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.entries, 3);
    assert.equal(res.unit, null);
  });

  console.log("\nquote-model-validation — boyut ve biçim kapıları");

  await test("maxBytes aşılırsa → too_large", async () => {
    const bytes = await readFile(join(FIXTURES, "cube20.stl"));
    const id = await stage(bytes);
    const res = await validateStagedQuoteModel(id, "cube20.stl", 100);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.code, "too_large");
      assert.match(res.error, /MB/);
    }
  });

  await test(".stl uzantılı rastgele baytlar reddedilir", async () => {
    const junk = Buffer.alloc(4096);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 37 + 11) & 0xff;
    const id = await stage(junk);
    const res = await validateStagedQuoteModel(id, "part.stl", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "invalid_stl");
  });

  await test("desteklenmeyen uzantı → unsupported_format", async () => {
    const id = await stage(await readFile(join(FIXTURES, "cube20.stl")));
    const res = await validateStagedQuoteModel(id, "part.step", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "unsupported_format");
  });

  await test("sahnelenmiş dosya yoksa → unknown_upload", async () => {
    const res = await validateStagedQuoteModel("stagedUploadYokYokYok00", "part.stl", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "unknown_upload");
  });

  await test("bildirilen boyut tutmuyorsa → size_mismatch", async () => {
    const bytes = await readFile(join(FIXTURES, "cube20.stl"));
    const id = await stage(bytes);
    await setStagedUploadMeta(id, { owner: "a:kimse", expectedSize: bytes.length + 10 });
    const res = await validateStagedQuoteModel(id, "cube20.stl", MAX);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, "size_mismatch");
  });

  await test("bildirilen boyut tutuyorsa geçer", async () => {
    const bytes = await readFile(join(FIXTURES, "cube20.stl"));
    const id = await stage(bytes);
    await setStagedUploadMeta(id, { owner: "a:kimse", expectedSize: bytes.length });
    assert.deepEqual(await getStagedUploadMeta(id), {
      owner: "a:kimse",
      expectedSize: bytes.length,
    });
    const res = await validateStagedQuoteModel(id, "cube20.stl", MAX);
    assert.equal(res.ok, true);
  });

  console.log("\nchunked-upload — sahip anahtarı ve aralık okuma");

  await test("uploadOwnerKey: üye u:, misafir a:, panel rolü <rol>:", () => {
    assert.equal(uploadOwnerKey({ userId: "user-1" }), "u:user-1");
    assert.equal(uploadOwnerKey({ anonymousId: "anon-1" }), "a:anon-1");
    assert.equal(uploadOwnerKey({ userId: "user-1", anonymousId: "anon-1" }), "u:user-1");
    assert.equal(uploadOwnerKey({ role: "manufacturer", userId: "m-1" }), "manufacturer:m-1");
    assert.equal(uploadOwnerKey({ role: "painter", userId: "p-1" }), "painter:p-1");
    assert.equal(uploadOwnerKey({ role: "admin", userId: "admin" }), "admin:admin");
    // Kimliksiz anahtar ÜRETİLMEZ: boş dize her sahibe eşleşirdi.
    assert.throws(() => uploadOwnerKey({}), /kimlik/i);
    assert.throws(() => uploadOwnerKey({ userId: null, anonymousId: null }), /kimlik/i);
  });

  await test("readStagedRange istenen aralığı döndürür, dosya sonunda kırpar", async () => {
    const id = await stage(Buffer.from("0123456789"));
    assert.equal((await readStagedRange(id, 2, 4)).toString(), "2345");
    assert.equal((await readStagedRange(id, 8, 100)).toString(), "89");
    assert.equal((await readStagedRange(id, 50, 4)).length, 0);
  });

  console.log(
    failures === 0
      ? "\n✅ quote-validation: tüm kontroller geçti"
      : `\n❌ quote-validation: ${failures} kontrol başarısız`
  );
}

main()
  .catch((err) => {
    failures++;
    console.error(err);
  })
  .finally(() => {
    rmSync(uploadRoot, { recursive: true, force: true });
    process.exit(failures === 0 ? 0 : 1);
  });
