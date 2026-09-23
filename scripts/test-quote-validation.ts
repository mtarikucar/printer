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
 * çözülür); `REDIS_URL` ise SİLİNİR — aşağıdaki gerekçeye bak.
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
// Bu bir BİRİM testi: `validateStagedQuoteModel` → `getStagedUploadMeta` yolu
// REDIS_URL varsa gerçek bir Redis'e uzanır. Kabuk ortamı onu taşıyorsa test ya
// kullanıcının geliştirme Redis'ine `upload-meta-*` anahtarı yazar, ya da
// erişilemeyen bir adreste beklemeye girer. Anahtarı burada silmek testi
// ortamdan bağımsız kılar (üretim kodu Redis'siz yola düşer).
delete process.env.REDIS_URL;
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
    readStagedUploadMeta,
    resolveAuthenticatedUploadOwner,
    setStagedUploadMeta,
    getStagedUploadMeta,
    stagedUploadOwnershipAllowed,
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

  console.log("\nreklam edilen tavan ↔ analiz zarfı");

  // Bu üç sayı bir VAAT ile bir KONTEYNER arasındaki sözleşmedir. Açılış
  // sayfası "dosya başına N MB" yazar, müşteri o dosyayı yükler, worker onu
  // `mem_limit` altında ÖLÇMEK zorundadır. Ölçüm (branch'in kendi
  // analiz betiğiyle, /usr/bin/time -v): 327k yüz → 0,51 GiB RSS; 1,31M yüz →
  // 1,50 GiB; 1,99M yüz / 94,7 MB → 2,43 GiB, yani 2 GiB'lik kapta OOM.
  // 32 MiB'lik tavanın zarfı ≈ 0,8 GiB. Tavan büyütülecekse ÖNCE `mem_limit`
  // büyür; bu test ikisinin birbirinden sessizce ayrılmasını engeller.
  await test("tohumdaki maxFileBytes = SEED_MAX_FILE_BYTES ve worker mem_limit ile tutarlı", async () => {
    const { SEED_SNAPSHOT, SEED_MAX_FILE_BYTES, QUOTE_ANALYSIS_MEM_LIMIT_GB } = await import(
      "../src/lib/config/quote-seed"
    );
    assert.equal(SEED_MAX_FILE_BYTES, 32 * 1024 * 1024, "reklam edilen tavan 32 MB değil");
    assert.equal(
      SEED_SNAPSHOT.settings.maxFileBytes,
      SEED_MAX_FILE_BYTES,
      "tohum anlık görüntüsü sabitten ayrılmış"
    );

    const compose = await readFile(
      join(import.meta.dirname, "..", "docker", "docker-compose.production.yml"),
      "utf8"
    );
    const workerBlock = compose.slice(compose.indexOf("\n  worker:"));
    const memLimit = /\n\s+mem_limit:\s*(\d+)g/.exec(workerBlock);
    assert.ok(memLimit, "worker servisinde mem_limit yok");
    assert.equal(
      Number(memLimit[1]),
      QUOTE_ANALYSIS_MEM_LIMIT_GB,
      "worker mem_limit ile ölçülen analiz zarfı ayrışmış: ikisi birlikte değişir"
    );

    // SQL tohumu TypeScript aynasıyla aynı sayıyı yazmalı (DB testi de
    // bakar, ama bu kontrol DB olmadan da kırmızıya döner).
    const sql = await readFile(
      join(import.meta.dirname, "..", "drizzle", "0064_instant_quotes.sql"),
      "utf8"
    );
    const seedRow = sql.slice(sql.indexOf('INSERT INTO "quote_pricing_settings"'));
    assert.ok(
      seedRow.includes(String(SEED_MAX_FILE_BYTES)),
      "0064 tohumu farklı bir max_file_bytes yazıyor"
    );
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

  await test("resolveAuthenticatedUploadOwner: TEK gövde, sabit rol sırası", async () => {
    // Sahnelemeyi KAYDEDEN uç ile onu teklife BAĞLAYAN erişim çözümü aynı
    // gövdeyi çağırır; ikinci bir kopya, bir gün yalnız birinin sırası ya da
    // admin yedeği değiştiğinde her bağlama isteğini 403'e çevirirdi.
    // Panel çerezleri istek dışında okunamaz (`next/headers`) ve okunamayan
    // oturum = OTURUM YOK; kalan iki ekseni çağıran veriyor.
    const admin = await resolveAuthenticatedUploadOwner({
      adminEmail: "yonetici@ornek.test",
      customerUserId: "user-9",
    });
    assert.deepEqual(admin.keys, ["admin:yonetici@ornek.test", "u:user-9"]);
    assert.equal(
      admin.primary,
      "admin:yonetici@ornek.test",
      "sahneleme İLK eşleşen kimlikle kaydedilir"
    );
    assert.deepEqual(await resolveAuthenticatedUploadOwner({ adminEmail: null, customerUserId: "user-9" }), {
      primary: "u:user-9",
      keys: ["u:user-9"],
    });
    assert.deepEqual(await resolveAuthenticatedUploadOwner({ adminEmail: null, customerUserId: null }), {
      primary: null,
      keys: [],
    });
    // E-postasız admin oturumu da anahtarsız kalmaz (`admin` yedeği).
    const fallback = await resolveAuthenticatedUploadOwner({
      adminEmail: "admin",
      customerUserId: null,
    });
    assert.deepEqual(fallback.keys, ["admin:admin"]);
  });

  await test("readStagedUploadMeta: 'kayıt yok' ile 'defter cevap vermedi' ayrı", async () => {
    // Bu testte REDIS_URL yoktur: defter BELLEKTİR ve her zaman cevap verir,
    // yani eksik kayıt gerçekten "kayıt yok"tur (`known: true`).
    assert.deepEqual(await readStagedUploadMeta("stagedUploadYokYokYok00"), {
      known: true,
      meta: null,
    });
    const id = await stage(Buffer.from("x"));
    await setStagedUploadMeta(id, { owner: "a:kimse", expectedSize: 1 });
    assert.deepEqual(await readStagedUploadMeta(id), {
      known: true,
      meta: { owner: "a:kimse", expectedSize: 1 },
    });
  });

  await test("sahiplik kararı: kayıt varsa eşleşme şart, 'bilmiyorum'da yalnız girişli geçer", () => {
    const mine = { known: true, meta: { owner: "u:1", expectedSize: null } };
    const foreign = { known: true, meta: { owner: "a:baska", expectedSize: null } };
    const missing = { known: true, meta: null }; // defter cevap verdi: kayıt YOK
    const unknown = { known: false, meta: null }; // defter CEVAP VERMEDİ
    for (const authenticated of [true, false]) {
      assert.equal(stagedUploadOwnershipAllowed(mine, "u:1", authenticated), true);
      assert.equal(stagedUploadOwnershipAllowed(foreign, "u:1", authenticated), false);
      assert.equal(stagedUploadOwnershipAllowed(missing, "u:1", authenticated), false);
      // Kimliksiz çağıran hiçbir hâlde geçmez.
      assert.equal(stagedUploadOwnershipAllowed(mine, null, authenticated), false);
      assert.equal(stagedUploadOwnershipAllowed(unknown, null, authenticated), false);
    }
    // Redis susarsa 350 MB'lık panel yüklemesi 44. parçada ölmez…
    assert.equal(stagedUploadOwnershipAllowed(unknown, "manufacturer:m-1", true), true);
    // …ama misafir geçmez: bütün kotası aynı deftere bağlıdır.
    assert.equal(stagedUploadOwnershipAllowed(unknown, "a:anon-1", false), false);
  });

  await test("readStagedRange istenen aralığı döndürür, dosya sonunda kırpar", async () => {
    const id = await stage(Buffer.from("0123456789"));
    assert.equal((await readStagedRange(id, 2, 4)).toString(), "2345");
    assert.equal((await readStagedRange(id, 8, 100)).toString(), "89");
    assert.equal((await readStagedRange(id, 50, 4)).length, 0);
  });

  console.log("\nupload-large-file — 413'ün iki anlamı");

  const { uploadLargeFile } = await import("../src/lib/upload-large-file");

  /**
   * `fetch`i sahteler: PUT sahneleme açar, her POST `reply(n)` ile yanıtlanır.
   * Dönen dizi çağrıların fiillerini taşır — kaç deneme yapıldığı budur.
   */
  async function driveUpload(
    reply: (postIndex: number) => Response
  ): Promise<{ calls: string[]; error: Error | null }> {
    const calls: string[] = [];
    const original = globalThis.fetch;
    let posts = 0;
    globalThis.fetch = (async (_input: unknown, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      calls.push(method);
      if (method === "PUT") {
        return Response.json({ uploadId: "u".repeat(24), chunkSize: 8 * 1024 * 1024 });
      }
      return reply(posts++);
    }) as typeof globalThis.fetch;
    try {
      await uploadLargeFile(new File([new Uint8Array(1024)], "buyuk.stl"));
      return { calls, error: null };
    } catch (err) {
      return { calls, error: err as Error };
    } finally {
      globalThis.fetch = original;
    }
  }

  await test("413 + size_exceeded TEK denemede durur, sunucunun cümlesini gösterir", async () => {
    const { calls, error } = await driveUpload(() =>
      Response.json(
        { error: "Dosya bildirilen boyutu aştı.", code: "size_exceeded" },
        { status: 413 }
      )
    );
    assert.equal(error?.message, "Dosya bildirilen boyutu aştı.");
    // Dört deneme + üç geri çekilme beklemesi değil: TEK POST.
    assert.deepEqual(calls, ["PUT", "POST"], `POST ${calls.length - 1} kez denendi`);
  });

  await test("413 + chunk_too_large parçayı küçültüp DEVAM eder", async () => {
    const { calls, error } = await driveUpload((i) =>
      i === 0
        ? Response.json({ error: "Yükleme parçası çok büyük.", code: "chunk_too_large" }, { status: 413 })
        : Response.json({ size: 1024 })
    );
    assert.equal(error, null, `yükleme düştü: ${error?.message}`);
    assert.deepEqual(calls, ["PUT", "POST", "POST"], "vekil 413'ü artık uyarlanmıyor");
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
