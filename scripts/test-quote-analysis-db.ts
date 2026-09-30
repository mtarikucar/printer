/**
 * Analiz servisinin GERÇEK yoluyla testi: izole 55433 şeması + tek kullanımlık
 * UPLOAD_DIR + gerçek python (MESH_PYTHON). Taklit yok — koşullu güncellemeler,
 * dosya yazımı ve önbellek yeniden hesabı diskte ve veritabanında doğrulanır.
 *
 * Kullanıcının dev veritabanına (5432) ya da dev Redis'ine (6379) ASLA
 * bağlanmaz: her ikisi de açıkça QA adreslerine sabitlenir.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { PartGeometry } from "../src/lib/config/quote-types";
// Küçük resim yazımı sınavı GERÇEK bir PNG ister: sharp dönüştürmeyi başarmazsa
// test yazım yolunu hiç denemeden "geçer".
import sharp from "sharp";

const connectionString = process.env.QA_QUOTE_DB_URL;
if (!connectionString) throw new Error("QA_QUOTE_DB_URL required");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55433") {
  throw new Error("Refusing non-QA database");
}
const redisUrl = process.env.QA_REDIS_URL;
if (!redisUrl) throw new Error("QA_REDIS_URL required");
if (!new URL(redisUrl).port.startsWith("56")) throw new Error("Refusing non-QA redis");
if (!process.env.MESH_PYTHON) throw new Error("MESH_PYTHON required");
// Kuyruk ve gerçek zamanlı yayın aynı bağlantıyı kullanır; ikisi de QA'ya bağlansın.
process.env.REDIS_URL = redisUrl;

const root = path.resolve(import.meta.dirname, "..");
const namespace = `quote_analysis_${Date.now()}_${process.pid}`;
const ddlOut = fs.mkdtempSync(path.join(os.tmpdir(), "quote-analysis-ddl-"));
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "quote-analysis-uploads-"));
process.env.UPLOAD_DIR = uploads;

/**
 * Depolama katmanının GERÇEKTEN çağırdığı `fs/promises` nesnesi.
 *
 * `src/lib/services/storage.ts` tsx altında CJS'e çevrilir, yani `copyFile` /
 * `writeFile` her çağrıda bu modül nesnesinden OKUNUR. Tek bir yazımı yarıda
 * öldürmek için gereken tutamak bu: ENOSPC/EIO'yu (hedefi açıp yarım bırakıp
 * düşmek) başka hiçbir yolla diskte üretemeyiz — kaynak tarafı hataları
 * (okunamayan dosya, dizin olan kaynak) hedefi HİÇ oluşturmaz, yani tam da
 * sızdıran artığı üretmezler. Her taklit kendi `finally`sinde geri alınır.
 */
const fsPromises = createRequire(import.meta.url)("fs/promises") as {
  copyFile: typeof import("fs/promises").copyFile;
  writeFile: typeof import("fs/promises").writeFile;
};

/** Yazımın ORTASINDA ölen depolama çağrısı: hedefi YARIM bırakıp fırlatır. */
async function dyingWrite(dst: fs.PathLike): Promise<never> {
  fs.writeFileSync(dst, Buffer.alloc(64, 7));
  const err = new Error("ENOSPC: no space left on device, write") as Error & { code: string };
  err.code = "ENOSPC";
  throw err;
}

const admin = new pg.Client({ connectionString });
let pool: pg.Pool | undefined;
let checks = 0;
const test = async (name: string, run: () => Promise<void>) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};

const rowOf = async (partId: string) =>
  (
    await admin.query(
      `SELECT analysis_status, analysis_attempt, analysis_error, geometry, units,
              canonical_stl_key, preview_glb_key, thumbnail_key
         FROM quote_parts WHERE id = $1`,
      [partId]
    )
  ).rows[0] as {
    analysis_status: string;
    analysis_attempt: number;
    analysis_error: string | null;
    // Tam tip: STEP iddiaları `tessellation`/`solidCount`/`sourceUnits` de
    // okuyor ve kolon zaten `$type<PartGeometry>()` ile tiplenmiş.
    geometry: PartGeometry | null;
    units: string;
    canonical_stl_key: string | null;
    preview_glb_key: string | null;
    thumbnail_key: string | null;
  };

/**
 * İkili STL kutusu (12 üçgen, dışa bakan sarım): fikstür dosyası yazmadan
 * baskı zarfını dolduran, su geçirmez ve gerçekten fiyatlanabilen bir parça.
 */
function stlBox(x: number, y: number, z: number): Buffer {
  const v: Array<[number, number, number]> = [
    [0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0],
    [0, 0, z], [x, 0, z], [x, y, z], [0, y, z],
  ];
  const tris: Array<[number, number, number]> = [
    [0, 2, 1], [0, 3, 2], // alt (−z)
    [4, 5, 6], [4, 6, 7], // üst (+z)
    [0, 1, 5], [0, 5, 4], // ön (−y)
    [1, 2, 6], [1, 6, 5], // sağ (+x)
    [2, 3, 7], [2, 7, 6], // arka (+y)
    [3, 0, 4], [3, 4, 7], // sol (−x)
  ];
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((tri, i) => {
    const off = 84 + i * 50; // 0..11 normal (0,0,0 — okuyucu sarımdan türetir)
    tri.forEach((index, corner) => {
      const p = v[index]!;
      buf.writeFloatLE(p[0], off + 12 + corner * 12);
      buf.writeFloatLE(p[1], off + 16 + corner * 12);
      buf.writeFloatLE(p[2], off + 20 + corner * 12);
    });
  });
  return buf;
}

async function main() {
  await admin.connect();
  try {
    execFileSync("npx", ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"], {
      env: { ...process.env, SCRATCH_OUT: ddlOut },
      stdio: "ignore",
    });
    const ddl = fs
      .readFileSync(path.join(ddlOut, fs.readdirSync(ddlOut).find((f) => f.endsWith(".sql"))!), "utf8")
      .replace(/"public"\./g, "");
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await admin.query(`SET search_path TO ${namespace}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter((s) => s.trim())) {
      await admin.query(statement);
    }
    url.searchParams.set("options", `-c search_path=${namespace}`);
    process.env.DATABASE_URL = url.toString();

    const { db } = await import("../src/lib/db");
    pool = (db as typeof db & { $client: pg.Pool }).$client;
    const {
      analyzeQuotePart,
      requeueStuckQuoteParts,
      storeAnalysisOutputs,
      MAX_ANALYSIS_ATTEMPTS,
      ANALYZING_GRACE_FACTOR,
    } = await import("../src/lib/services/quote-analysis");
    const { ANALYSIS_GIVE_UP_ERROR } = await import("../src/lib/config/quote-types");
    const { STUCK_QUEUED_MS } = await import(
      "../src/lib/queue/workers/quote-part-analysis.worker"
    );
    const { recomputeQuoteCache } = await import("../src/lib/services/quote-cache");
    const { getQuoteAnalysisQueue } = await import("../src/lib/queue/quote-queues");
    const { sql } = await import("drizzle-orm");
    const { SEED_SNAPSHOT } = await import("../src/lib/config/quote-seed");

    const queue = getQuoteAnalysisQueue();
    // Paylaşılan QA Redis'i: önceki koşuların artıkları bu testin iddialarını
    // kirletmesin.
    await queue.obliterate({ force: true }).catch(() => {});

    const quoteId = (
      await admin.query(
        `INSERT INTO quotes(anonymous_id, pricing_snapshot, expires_at)
         VALUES('anon-analysis', $1, now() + interval '30 days') RETURNING id, version`,
        [JSON.stringify(SEED_SNAPSHOT)]
      )
    ).rows[0].id as string;

    /** Kaynağı UPLOAD_DIR'e koyar ve parça satırını açar (varsayılan: sırada). */
    const makePart = async (fixture: string | Buffer, overrides: Record<string, unknown> = {}) => {
      const key = `quote-sources/${randomUUID()}.bin`;
      fs.mkdirSync(path.join(uploads, "quote-sources"), { recursive: true });
      const bytes =
        typeof fixture === "string" ? fs.readFileSync(path.join(root, fixture)) : fixture;
      fs.writeFileSync(path.join(uploads, key), bytes);
      const columns = {
        quote_id: quoteId,
        name: "Parça",
        file_name: typeof fixture === "string" ? path.basename(fixture) : "bozuk.stl",
        source_key: key,
        source_format: "stl",
        source_bytes: bytes.length,
        source_sha256: randomUUID().replaceAll("-", ""),
        technology_key: "fdm",
        material_key: "pla",
        color_key: "beyaz",
        finish_key: "ham",
        ...overrides,
      };
      const names = Object.keys(columns);
      const result = await admin.query(
        `INSERT INTO quote_parts(${names.join(",")}) VALUES(${names
          .map((_, i) => `$${i + 1}`)
          .join(",")}) RETURNING id`,
        Object.values(columns)
      );
      return result.rows[0].id as string;
    };

    const cube = await makePart("scripts/fixtures/quote/cube20.stl");

    await test("sıradaki parça analiz edilir: geometri, üç dosya ve hazır durumu", async () => {
      assert.equal(await analyzeQuotePart(cube), "ready");
      const row = await rowOf(cube);
      assert.equal(row.analysis_status, "ready");
      assert.equal(row.analysis_attempt, 1);
      assert.equal(row.analysis_error, null);
      assert.ok(row.geometry, "geometri yazıldı");
      // 20 mm küp: hacim 8000 birim³ (dosya biriminde, ölçeksiz).
      assert.ok(Math.abs(row.geometry!.volume! - 8000) < 1, `volume=${row.geometry!.volume}`);
      assert.equal(row.geometry!.bodyCount, 1);
      for (const key of [row.canonical_stl_key, row.preview_glb_key, row.thumbnail_key]) {
        assert.ok(key, "anahtar yazıldı");
        assert.ok(key!.startsWith(`quote-parts/${cube}/`), `anahtar parça dizininde: ${key}`);
        assert.ok(fs.existsSync(path.join(uploads, key!)), `dosya diskte: ${key}`);
      }
      assert.ok(fs.readFileSync(path.join(uploads, row.thumbnail_key!)).subarray(8, 12).toString() === "WEBP");
    });

    await test("teklif önbelleği yeniden hesaplanır (sürüm, tutar, iş günü)", async () => {
      const quote = (
        await admin.query("SELECT version, total_kurus, lead_days FROM quotes WHERE id = $1", [quoteId])
      ).rows[0];
      assert.equal(quote.version, 2, "sürüm bir arttı");
      assert.ok(quote.total_kurus > 0, `total_kurus=${quote.total_kurus}`);
      assert.ok(quote.lead_days > 0, `lead_days=${quote.lead_days}`);
    });

    await test("ikinci çağrı iş yapmaz: 'queued' olmayan parça atlanır", async () => {
      const before = await rowOf(cube);
      assert.equal(await analyzeQuotePart(cube), "skipped");
      assert.deepEqual(await rowOf(cube), before, "satır hiç değişmedi");
    });

    await test("yumuşak silinmiş parçaya dokunulmaz", async () => {
      const deleted = await makePart("scripts/fixtures/quote/cube20.stl", { deleted_at: new Date() });
      assert.equal(await analyzeQuotePart(deleted), "skipped");
      const row = await rowOf(deleted);
      assert.equal(row.analysis_status, "queued");
      assert.equal(row.analysis_attempt, 0);
      assert.equal(row.canonical_stl_key, null);
    });

    await test("analiz sürerken silinen parçanın sonucu yazılmaz, dosyaları atılır", async () => {
      const raced = await makePart("scripts/fixtures/quote/cube20.stl");
      const running = analyzeQuotePart(raced);
      // İş parçayı ÜSTLENDİKTEN sonra sil: kaybeden kopya hiçbir şeye dokunmamalı.
      let claimed = false;
      for (let i = 0; i < 400 && !claimed; i++) {
        claimed = (await rowOf(raced)).analysis_status === "analyzing";
        if (!claimed) await new Promise((r) => setTimeout(r, 5));
      }
      assert.ok(claimed, "iş parçayı üstlendi");
      await admin.query("UPDATE quote_parts SET deleted_at = now() WHERE id = $1", [raced]);
      assert.equal(await running, "skipped");
      const row = await rowOf(raced);
      assert.equal(row.analysis_status, "analyzing", "durum kaybeden iş tarafından yazılmadı");
      assert.equal(row.canonical_stl_key, null);
      assert.equal(row.geometry, null);
      const dir = path.join(uploads, "quote-parts", raced);
      assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], [], "öksüz dosya kalmadı");
    });

    await test("yeniden analiz ESKİ çıktı dosyalarını siler, paylaşılanı korur", async () => {
      // Kurtarma süpürmesi `analyzing`de takılan bir parçayı `queued`a geri alır
      // ve iş yeniden koşar: ikinci tur üç anahtarı da YENİ adlarla yazar
      // (`nanoid`). Eski dosyalar silinmezse diskte sonsuza dek kalırlar —
      // hiçbir satır onları göstermediği için saklama süpürmesi de bulamaz.
      const again = await makePart("scripts/fixtures/quote/cube20.stl");
      assert.equal(await analyzeQuotePart(again), "ready");
      const first = await rowOf(again);
      assert.ok(first.canonical_stl_key && first.preview_glb_key && first.thumbnail_key);

      // `duplicatePart` kopyaya AYNI anahtarları verir: paylaşılan bir dosyayı
      // silmek ÖTEKİ satırı dosyasız bırakırdı.
      const twin = await makePart("scripts/fixtures/quote/cube20.stl", {
        preview_glb_key: first.preview_glb_key,
      });

      await admin.query("UPDATE quote_parts SET analysis_status='queued' WHERE id = $1", [again]);
      assert.equal(await analyzeQuotePart(again), "ready");
      const second = await rowOf(again);

      assert.notEqual(second.canonical_stl_key, first.canonical_stl_key, "yeni anahtar yazıldı");
      for (const key of [second.canonical_stl_key, second.preview_glb_key, second.thumbnail_key]) {
        assert.ok(fs.existsSync(path.join(uploads, key!)), `yeni dosya diskte: ${key}`);
      }
      assert.equal(
        fs.existsSync(path.join(uploads, first.canonical_stl_key!)),
        false,
        "üzerine yazılan kanonik STL diskten silinmeli"
      );
      assert.equal(
        fs.existsSync(path.join(uploads, first.thumbnail_key!)),
        false,
        "üzerine yazılan küçük resim diskten silinmeli"
      );
      assert.equal(
        fs.existsSync(path.join(uploads, first.preview_glb_key!)),
        true,
        "BAŞKA bir parçanın gösterdiği önizleme KORUNUR"
      );
      // Paylaşan satırın anahtarı da olduğu yerde: silici satıra dokunmaz.
      assert.equal((await rowOf(twin)).preview_glb_key, first.preview_glb_key);
    });

    await test("yarıda kalan GLB kopyası diskte artık bırakmaz", async () => {
      // `storeAnalysisOutputs` üç dosyayı SIRAYLA yazar. Kanonik STL yazıldıktan
      // SONRA gelen bir depolama hatası (ENOSPC/EIO) yukarı fırlar ve parça
      // `failed` olur. İKİ dosya öksüz kalır: yazılan kanonik kopya hiçbir
      // satırda görünmez, YARIM KALAN GLB ise hiç görünmez — ve parçanın satırı
      // DURDUĞU için yetim dizin süpürmesi o dizine hiç dokunmaz. Anahtar
      // yazımdan ÖNCE deftere girmezse, yarım GLB sonsuza dek diskte kalır.
      // Hata HEDEF tarafında: `copyFile` dosyayı açıp yarım bırakıp düşer.
      const orphanPartId = randomUUID();
      const work = fs.mkdtempSync(path.join(os.tmpdir(), "quote-store-outputs-"));
      const realCopyFile = fsPromises.copyFile;
      let copies = 0;
      try {
        fs.writeFileSync(path.join(work, "canonical.stl"), stlBox(10, 10, 10));
        fs.writeFileSync(path.join(work, "preview.glb"), Buffer.alloc(2048, 3));
        fsPromises.copyFile = (async (src: fs.PathLike, dst: fs.PathLike) => {
          copies++;
          // Kanonik kopya GERÇEKTEN yazılır: ikinci yazım, diskin yazılabilir
          // olduğu kanıtlandıktan sonra ölen yazımdır.
          if (copies === 1) return realCopyFile(src, dst);
          return dyingWrite(dst);
        }) as typeof realCopyFile;
        await assert.rejects(() => storeAnalysisOutputs(orphanPartId, work), /ENOSPC/);
      } finally {
        fsPromises.copyFile = realCopyFile;
        fs.rmSync(work, { recursive: true, force: true });
      }
      assert.equal(copies, 2, "kanonik yazıldı, GLB kopyası yarıda öldü");
      const dir = path.join(uploads, "quote-parts", orphanPartId);
      assert.deepEqual(
        fs.existsSync(dir) ? fs.readdirSync(dir) : [],
        [],
        "kanonik VE yarım kalan GLB silinmeli"
      );
    });

    await test("yarıda kalan küçük resim yazımı yutulmaz, o da toplanır", async () => {
      // Küçük resimde KOZMETİK olan yalnız DÖNÜŞTÜRMEDİR (sharp). Yazım hatası
      // içteki `try`a alınırsa yutulur: parça `ready` olur, yarım webp'yi ise
      // hiçbir satır göstermez ve hiç kimse silmez. Bu yüzden `saveFile` içteki
      // `try`ın DIŞINDA durur ve hatası dıştaki toplayıcıya ulaşır.
      const orphanPartId = randomUUID();
      const work = fs.mkdtempSync(path.join(os.tmpdir(), "quote-store-thumb-"));
      const realWriteFile = fsPromises.writeFile;
      let writes = 0;
      try {
        fs.writeFileSync(path.join(work, "canonical.stl"), stlBox(10, 10, 10));
        // Gerçek PNG: sharp dönüştürmeyi BAŞARMALI, yoksa yazıma hiç gelinmez.
        fs.writeFileSync(
          path.join(work, "thumb.png"),
          await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ff0000" } })
            .png()
            .toBuffer()
        );
        // `preview.glb` yok: kanonik kopya gerçek `copyFile` ile yazılır.
        fsPromises.writeFile = (async (dst: fs.PathLike) => {
          writes++;
          return dyingWrite(dst);
        }) as typeof realWriteFile;
        await assert.rejects(() => storeAnalysisOutputs(orphanPartId, work), /ENOSPC/);
      } finally {
        fsPromises.writeFile = realWriteFile;
        fs.rmSync(work, { recursive: true, force: true });
      }
      assert.equal(writes, 1, "sharp dönüştürdü, webp yazımı yarıda öldü");
      const dir = path.join(uploads, "quote-parts", orphanPartId);
      assert.deepEqual(
        fs.existsSync(dir) ? fs.readdirSync(dir) : [],
        [],
        "kanonik VE yarım kalan webp silinmeli"
      );
    });

    await test("bozuk dosya: hata koduyla 'failed'", async () => {
      const broken = await makePart(Buffer.from("bu bir mesh degil, sadece bayt"));
      assert.equal(await analyzeQuotePart(broken), "failed");
      const row = await rowOf(broken);
      assert.equal(row.analysis_status, "failed");
      assert.equal(row.analysis_error, "exit_nonzero");
      assert.equal(row.analysis_attempt, 1);
      assert.equal(row.canonical_stl_key, null);
      assert.equal(row.geometry, null);
    });

    await test("3MF birimini beyan eder: varsayılan 'mm' düzeltilir", async () => {
      const inch = await makePart("scripts/fixtures/quote/cube1in.3mf", { source_format: "3mf" });
      assert.equal(await analyzeQuotePart(inch), "ready");
      const row = await rowOf(inch);
      assert.equal(row.units, "in", "dosyanın beyan ettiği birim alındı");
      // 1 inçlik küp: ölçüm DOSYA BİRİMİNDE, yani 1 birim³.
      assert.ok(Math.abs(row.geometry!.volume! - 1) < 0.01, `volume=${row.geometry!.volume}`);
    });

    await test("STEP: ölçüm biter, tessellation ve solidCount yazılır, birim mm KALIR", async () => {
      const { STEP_TESSELLATION } = await import("../src/lib/config/quote-step");
      const step = await makePart("scripts/fixtures/quote/cube20.step", {
        source_format: "step",
      });
      assert.equal(await analyzeQuotePart(step), "ready");
      const row = await rowOf(step);
      assert.equal(row.units, "mm");
      assert.equal(row.geometry!.sourceUnits, "mm", "çekirdek parçayı mm'ye uyguladı");
      // 20 mm küp, çekirdekten: hacim mm³ (metre ölçeğinden çevrim kanıtı S3'te).
      assert.ok(Math.abs(row.geometry!.volume! - 8000) < 10, `volume=${row.geometry!.volume}`);
      // Anlaşmazlık savunmasının kaynağı: parça HANGİ sapmayla üçgenlendi.
      assert.deepEqual(row.geometry!.tessellation, { ...STEP_TESSELLATION });
      assert.equal(row.geometry!.solidCount, 1, "gövde sayısı çekirdek raporundan gelmedi");
      assert.ok(row.canonical_stl_key, "üreticinin basacağı STL yazılmadı");
    });

    await test("STEP: satırda 'cm' dursa bile analiz mm'yi ZORLAR", async () => {
      // §3'ün tuzağı: bugünkü `CASE WHEN units='mm' …` müşterinin seçimini
      // KORUR. STEP'te korumak, bu UPDATE'i 0070'in CHECK'ine çarptırıp 23514
      // ile düşürür; parça `MAX_ANALYSIS_ATTEMPTS` turu döner ve `failed` olur.
      //
      // CHECK, satırın 'cm' olmasına hiç izin vermediği için tuzağı kurmak onu
      // GEÇİCİ olarak düşürmeyi gerektiriyor. Bedeli yok, kazancı büyük:
      // `unitsPatch`in STEP dalı kaldırılırsa bu iddia KIRMIZI olur (korunan
      // 'cm' satırda kalır) — kilidin gerçekten ZORLADIĞININ tek kanıtı.
      const step = await makePart("scripts/fixtures/quote/cube20.step", {
        source_format: "step",
      });
      await admin.query(
        "ALTER TABLE quote_parts DROP CONSTRAINT quote_parts_step_units_chk"
      );
      try {
        await admin.query("UPDATE quote_parts SET units='cm' WHERE id = $1", [step]);
        assert.equal(await analyzeQuotePart(step), "ready");
        assert.equal((await rowOf(step)).units, "mm", "müşterinin 'cm'si korundu");
      } finally {
        // Kısıt geri kurulur ki BUNDAN SONRAKİ testler gerçek şemaya karşı
        // koşsun. Onarma satırı yalnız iddia düştüğünde iş yapar: kısıt 'cm'
        // kalmış bir satırla kurulamaz ve `finally`nin hatası yukarıdaki
        // GERÇEK iddiayı gizlerdi.
        await admin.query(
          "UPDATE quote_parts SET units='mm' WHERE source_format='step' AND units <> 'mm'"
        );
        await admin.query(
          `ALTER TABLE quote_parts ADD CONSTRAINT quote_parts_step_units_chk
             CHECK (source_format <> 'step' OR units = 'mm')`
        );
      }
    });

    await test("müşteri birimi seçtiyse analiz onu ezmez", async () => {
      const chosen = await makePart("scripts/fixtures/quote/cube1in.3mf", {
        source_format: "3mf",
        units: "cm",
      });
      assert.equal(await analyzeQuotePart(chosen), "ready");
      assert.equal((await rowOf(chosen)).units, "cm");
    });

    await test("takılan parçalar geri kuyruğa alınır, tazeler bırakılır", async () => {
      const stuck = await makePart("scripts/fixtures/quote/cube20.stl");
      const fresh = await makePart("scripts/fixtures/quote/cube20.stl");
      await admin.query(
        `UPDATE quote_parts SET analysis_status='analyzing', analysis_attempt=1,
            updated_at = now() - interval '30 minutes' WHERE id = $1`,
        [stuck]
      );
      assert.deepEqual(await requeueStuckQuoteParts(10 * 60_000), { requeued: 1, gaveUp: 0 });
      assert.equal((await rowOf(stuck)).analysis_status, "queued");
      assert.equal((await rowOf(stuck)).analysis_attempt, 2, "süpürme deneme sayacını artırdı");
      assert.equal((await rowOf(fresh)).analysis_status, "queued", "taze parça zaten sırada");
      assert.equal((await rowOf(fresh)).analysis_attempt, 0, "taze parçaya dokunulmadı");
      // Yeniden kuyruğa alma GERÇEKTEN iş ekler: kimlik artan deneme sayacını taşır.
      const job = await queue.getJob(`quote-part-analysis-${stuck}-r2`);
      assert.equal(job?.data.partId, stuck);
    });

    await test("silinmiş parça takılmış görünse de kuyruğa alınmaz", async () => {
      const ghost = await makePart("scripts/fixtures/quote/cube20.stl", { deleted_at: new Date() });
      await admin.query(
        `UPDATE quote_parts SET analysis_status='analyzing',
            updated_at = now() - interval '90 minutes' WHERE id = $1`,
        [ghost]
      );
      assert.deepEqual(await requeueStuckQuoteParts(10 * 60_000), { requeued: 0, gaveUp: 0 });
      assert.equal((await rowOf(ghost)).analysis_status, "analyzing");
    });

    await test("üst üste süpürme her turda TAZE iş kimliği üretir", async () => {
      const idle = await makePart("scripts/fixtures/quote/cube20.stl");
      const age = () =>
        admin.query(
          "UPDATE quote_parts SET updated_at = now() - interval '30 minutes' WHERE id = $1",
          [idle]
        );

      await age();
      assert.deepEqual(await requeueStuckQuoteParts(10 * 60_000), { requeued: 1, gaveUp: 0 });
      assert.equal((await rowOf(idle)).analysis_attempt, 1);
      assert.equal(
        (await queue.getJob(`quote-part-analysis-${idle}-r1`))?.data.partId,
        idle,
        "birinci tur işi ekledi"
      );

      // İkinci tur KRİTİK: iş hâlâ kuyrukta duruyor (çalıştıracak worker yok) ve
      // bullmq aynı özel kimlikle gelen eklemeyi sessizce yutar. Sayaç artmasaydı
      // ikinci tur yine `-r1` derdi, hiçbir iş eklenmezdi, ama süpürme yine
      // "1 kurtarıldı" derdi — parça sonsuza dek 'queued' kalırdı.
      await age();
      assert.deepEqual(await requeueStuckQuoteParts(10 * 60_000), { requeued: 1, gaveUp: 0 });
      assert.equal((await rowOf(idle)).analysis_attempt, 2);
      assert.equal(
        (await queue.getJob(`quote-part-analysis-${idle}-r2`))?.data.partId,
        idle,
        "ikinci tur YENİ kimlikle iş ekledi"
      );
    });

    await test("deneme tavanını aşan parça failed olur, sonsuza dek denenmez", async () => {
      // Sürekli çöken parçanın döngüsü: worker işi alır, python'un altında ölür,
      // kilit düşer, süpürme `queued`a geri alır, yeniden çöker… Tavan olmasaydı
      // bu döngü sonsuza kadar sürer, müşteri de fiyatını sonsuza dek beklerdi.
      const doomed = await makePart("scripts/fixtures/quote/cube20.stl");
      // ÖNCE: `analyzing` penceresi (eşiğin iki katı = 20 dk) DOLMADAN tavan
      // tek başına vazgeçirmez — worker hâlâ python'un altında olabilir.
      await admin.query(
        `UPDATE quote_parts SET analysis_status='analyzing', analysis_attempt=$2,
            updated_at = now() - interval '15 minutes' WHERE id = $1`,
        [doomed, MAX_ANALYSIS_ATTEMPTS]
      );
      assert.deepEqual(
        await requeueStuckQuoteParts(10 * 60_000),
        { requeued: 0, gaveUp: 0 },
        "pencere dolmadan vazgeçilmez"
      );
      assert.equal((await rowOf(doomed)).analysis_status, "analyzing");

      await admin.query(
        `UPDATE quote_parts SET updated_at = now() - interval '600 minutes' WHERE id = $1`,
        [doomed]
      );
      const swept = await requeueStuckQuoteParts(10 * 60_000);
      assert.deepEqual(swept, { requeued: 0, gaveUp: 1 }, "tavanı aşan parça kurtarılmaz");
      const row = await rowOf(doomed);
      assert.equal(row.analysis_status, "failed", "vazgeçilen parça NİHAİ durumda");
      assert.equal(row.analysis_error, ANALYSIS_GIVE_UP_ERROR);
      assert.equal(row.analysis_attempt, MAX_ANALYSIS_ATTEMPTS, "vazgeçince sayaç artmaz");
      assert.equal(
        await queue.getJob(`quote-part-analysis-${doomed}-r${MAX_ANALYSIS_ATTEMPTS + 1}`),
        undefined,
        "tavanı aşan parça için YENİ iş eklenmedi"
      );
      // İkinci tur onu bir daha almaz: `failed` süpürmenin hedefi değil.
      assert.deepEqual(await requeueStuckQuoteParts(10 * 60_000), { requeued: 0, gaveUp: 0 });

      // Müşteri ne yapacağını bilmeli. `failed` parçanın DfM kodu
      // `analysis_failed` (scripts/test-quote-core.ts kanıtlıyor), cümlesi de
      // sözlükte duruyor — kod müşteriye hiç gitmez.
      const { default: tr } = await import("../src/lib/i18n/dictionaries/tr");
      assert.match(tr["instantQuote.dfm.analysis_failed"], /yeniden yükle/i);
    });

    await test("kuyrukta bekleyen parça, sayacı ne olursa olsun VAZGEÇİLMEZ", async () => {
      // İncelemenin bulduğu hata buydu: tavan, hiç açılmamış — yalnızca sırası
      // gelmemiş — parçayı da sayıyordu. Kuyruğun KÜRESEL uzunluğunu hiçbir şey
      // sınırlamaz (`maxPartsPerQuote` tek yüklemeyi sınırlar, aynı anda kaç
      // müşterinin yüklediğini değil), yani bu senaryo tek bir yüklemenin
      // ÖTESİNDEDİR: burada bir yüklemenin taşıyabileceğinden fazla parça,
      // tavanın çok üstünde sayaçlarla ve 10 saat beklemiş olarak sırada duruyor.
      // Eski davranış hepsine `failed` + "Dosya okunamadı" yazardı.
      const backlog: string[] = [];
      for (let i = 0; i < 25; i++) backlog.push(await makePart(stlBox(20, 20, 20)));
      await admin.query(
        `UPDATE quote_parts SET analysis_status='queued', analysis_attempt=$2,
            updated_at = now() - interval '600 minutes' WHERE id = ANY($1)`,
        [backlog, MAX_ANALYSIS_ATTEMPTS + 5]
      );

      const swept = await requeueStuckQuoteParts(10 * 60_000, backlog.length);
      assert.deepEqual(
        swept,
        { requeued: backlog.length, gaveUp: 0 },
        "bekleyen parçaların HEPSİ kurtarılır, hiçbirinden vazgeçilmez"
      );
      for (const id of backlog) {
        const row = await rowOf(id);
        assert.equal(row.analysis_status, "queued", "parça sırada kaldı");
        assert.equal(row.analysis_error, null, "okunabilir dosyaya hata yazılmadı");
        assert.equal(
          row.analysis_attempt,
          MAX_ANALYSIS_ATTEMPTS + 6,
          "sayaç tavanın üstünde olsa da artar: her turda TAZE iş kimliği"
        );
      }
      // Tavanın üstündeki sayaçla GERÇEKTEN iş eklendi: kurtarma bir sayma
      // egzersizi değil.
      assert.equal(
        (await queue.getJob(`quote-part-analysis-${backlog[0]}-r${MAX_ANALYSIS_ATTEMPTS + 6}`))
          ?.data.partId,
        backlog[0]
      );
    });

    await test("eşikler tek bir MEŞRU analizi 'takılmış' saymaz", async () => {
      // Eşiğin tek ölçüsü: concurrency 1'de tek bir parçanın worker'ı meşgul
      // edebileceği en uzun MEŞRU süre — python'un 5 dk'lık sert tavanı
      // (`mesh-runner` ANALYZE_TIMEOUT_MS) × kuyruğun `attempts: 2` varsayılanı.
      // Kuyruğun uzunluğu artık bu karara GİRMEZ: bekleyen parçadan vazgeçilmiyor
      // (bir üstteki test), yani ufuk kuyruk derinliğine karşı savunulmak zorunda
      // değil.
      const worstPartMs = 2 * 5 * 60_000;
      assert.ok(STUCK_QUEUED_MS > worstPartMs, `eşik ${STUCK_QUEUED_MS} ms`);
      // Vazgeçme kapısı `analyzing` penceresidir; o pencere de aynı süreden
      // uzun olmalı, yoksa çalışan meşru bir analiz `failed` yazılabilirdi.
      assert.ok(
        STUCK_QUEUED_MS * ANALYZING_GRACE_FACTOR > worstPartMs,
        `analyzing penceresi ${STUCK_QUEUED_MS * ANALYZING_GRACE_FACTOR} ms`
      );
    });

    await test("bir süpürme en çok verilen kadar parça alır: en eskiler önce", async () => {
      // LIMIT'siz süpürme, biriken bir artıkta tek turda binlerce iş eklerdi.
      const older = await makePart("scripts/fixtures/quote/cube20.stl");
      const newer = await makePart("scripts/fixtures/quote/cube20.stl");
      await admin.query(
        `UPDATE quote_parts SET updated_at = now() - interval '90 minutes' WHERE id = $1`,
        [older]
      );
      await admin.query(
        `UPDATE quote_parts SET updated_at = now() - interval '30 minutes' WHERE id = $1`,
        [newer]
      );

      assert.deepEqual(await requeueStuckQuoteParts(10 * 60_000, 1), { requeued: 1, gaveUp: 0 });
      assert.equal((await rowOf(older)).analysis_attempt, 1, "en eski parça önce alınır");
      assert.equal((await rowOf(newer)).analysis_attempt, 0, "sınırın dışında kalan beklemede");
      assert.deepEqual(await requeueStuckQuoteParts(10 * 60_000, 1), { requeued: 1, gaveUp: 0 });
      assert.equal((await rowOf(newer)).analysis_attempt, 1, "kalanı bir sonraki tur alır");
    });

    // Kayıp güncelleme tuzağı: yeniden hesap PARÇALARI kilidi ALDIKTAN SONRA
    // okumazsa, kilit bırakılırken arada değişen parçaları göremez ve bayat
    // toplamı yazar. Kilit tutulurken parçaları değiştirip sonucu ölçüyoruz.
    await test("yeniden hesap parçaları kilidi aldıktan SONRA okur", async () => {
      const cacheOf = async () =>
        (
          await admin.query("SELECT version, total_kurus FROM quotes WHERE id = $1", [quoteId])
        ).rows[0] as { version: number; total_kurus: number | null };
      const before = await cacheOf();
      assert.equal(before.total_kurus, null, "hazır olmayan parçalar yüzünden tutar yok");

      const locker = new pg.Client({ connectionString });
      await locker.connect();
      try {
        await locker.query(`SET search_path TO ${namespace}`);
        await locker.query("BEGIN");
        await locker.query("SELECT id FROM quotes WHERE id = $1 FOR UPDATE", [quoteId]);

        let settled = false;
        let failure: unknown;
        const pending = recomputeQuoteCache(quoteId)
          .then((r) => {
            settled = true;
            return r;
          })
          .catch((err: unknown) => {
            settled = true;
            failure = err;
            return null;
          });
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(settled, false, "kilit tutulurken yeniden hesap BEKLER");
        assert.equal((await cacheOf()).version, before.version, "bekleyen hesap yazmadı");

        // Kilit BEKLENİRKEN teklif fiyatlanabilir hâle geliyor: geriye yalnız
        // 'ready' parçalar kalıyor. Parçaları önceden okumuş bir hesap bunu
        // göremez ve NULL tutarı yazar.
        await admin.query(
          `UPDATE quote_parts SET deleted_at = now()
             WHERE quote_id = $1 AND deleted_at IS NULL AND analysis_status <> 'ready'`,
          [quoteId]
        );
        await locker.query("COMMIT");

        const result = await pending;
        if (failure) throw failure;
        assert.ok(result, "kilit bırakılınca tamamlanır");
        const after = await cacheOf();
        assert.equal(after.version, before.version + 1);
        assert.ok(
          after.total_kurus !== null && after.total_kurus > 0,
          `kilitten sonraki okuma taze parçaları gördü: total_kurus=${after.total_kurus}`
        );
        assert.equal(result!.totalKurus, after.total_kurus, "dönen sonuç kolonla aynı");
      } finally {
        await locker.query("ROLLBACK").catch(() => {});
        await locker.end();
      }
    });

    await test("çağıranın işlemine katılır: kendi kilidine takılmaz", async () => {
      const before = (
        await admin.query("SELECT version FROM quotes WHERE id = $1", [quoteId])
      ).rows[0].version as number;
      const joined = db.transaction(async (tx) => {
        // Task 2.4'ün yapacağı şey: teklifi KENDİ işleminde kilitle, sonra
        // önbelleği aynı işlemde yeniden hesapla. Yeniden hesap ikinci bir
        // bağlantı açsaydı çağıranın kilidine takılır, işlem kendini beklerdi.
        await tx.execute(sql`SELECT id FROM quotes WHERE id = ${quoteId} FOR UPDATE`);
        return recomputeQuoteCache(quoteId, tx);
      });
      // Kendini bekleyen bir işlem testi sonsuza dek astığı için süre sınırı:
      // arıza "takıldı" diye görünsün, sessizce beklemesin.
      let hangTimer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        joined,
        new Promise<never>((_, reject) => {
          hangTimer = setTimeout(
            () => reject(new Error("yeniden hesap çağıranın kilidine takıldı")),
            15_000
          );
        }),
      ]).finally(() => clearTimeout(hangTimer));
      assert.ok(result, "çağıranın işleminde hesap yapıldı");
      const after = (
        await admin.query("SELECT version FROM quotes WHERE id = $1", [quoteId])
      ).rows[0].version as number;
      assert.equal(after, before + 1, "yazım çağıranın commit'iyle geldi");
    });

    // `quotes.total_kurus` int4'tür, motor ise 2^31 üstü bir toplam
    // hesaplayabilir: iki SLA parçası baskı zarfında (210×118×214) ve her biri
    // otomatik üst sınır olan 1000 adette → 3.707.748.000 kuruş. Kıstırma
    // olmadan Postgres 22003 verir, yeniden hesabın İŞLEMİ ÇÖKER ve en kötü
    // düşüş noktası analiz worker'ıdır: parça `ready` olarak commit edilmiştir,
    // `failed` yazımı `analysis_status='analyzing'` koşuluna takılıp hiçbir
    // satırı tutmaz, iş "skipped" deyip BAŞARIYLA biter. Müşterinin sayfası
    // "analiz sürüyor"da kalır, `total_kurus` NULL kalır ve o tekliffe yapılan
    // HER yazım (admin manuel fiyat, müşteri PATCH, "teklif iste") 500 verir.
    await test("2^31 üstü toplam analizi düşürmez: önbellek NULL kalır, sonraki yazım geçer", async () => {
      const bigQuoteId = (
        await admin.query(
          `INSERT INTO quotes(anonymous_id, pricing_snapshot, expires_at)
           VALUES('anon-overflow', $1, now() + interval '30 days') RETURNING id`,
          [JSON.stringify(SEED_SNAPSHOT)]
        )
      ).rows[0].id as string;

      const sla = {
        quote_id: bigQuoteId,
        technology_key: "sla",
        material_key: "standard_resin",
        color_key: "gri",
        finish_key: "ham",
        layer_um: 50,
        quantity: 1000,
      };
      const cacheOfBig = async () =>
        (
          await admin.query("SELECT total_kurus, lead_days FROM quotes WHERE id = $1", [
            bigQuoteId,
          ])
        ).rows[0] as { total_kurus: number | null; lead_days: number | null };

      // (1) Ödenebilir teklif: önbellek GERÇEK toplamı yazmaya devam eder.
      const small = await makePart("scripts/fixtures/quote/cube20.stl", {
        quote_id: bigQuoteId,
        name: "Numune",
      });
      assert.equal(await analyzeQuotePart(small), "ready");
      const afterSmall = await cacheOfBig();
      assert.ok(
        afterSmall.total_kurus !== null && afterSmall.total_kurus > 0,
        `ödenebilir toplam yazılır: total_kurus=${afterSmall.total_kurus}`
      );
      assert.ok(afterSmall.lead_days !== null);

      // (2) Ödeme tavanının (₺2.000.000) üstü ama int4'ün altı: yazım
      // patlamazdı, ama ödenemeyecek bir tutarı listede göstermenin anlamı yok.
      const box = stlBox(210, 118, 214);
      const first = await makePart(box, { ...sla, name: "Kasa A" });
      assert.equal(await analyzeQuotePart(first), "ready");
      const afterFirst = await cacheOfBig();
      assert.equal(
        afterFirst.total_kurus,
        null,
        "ödeme tavanının üstündeki tutar GÖSTERİM önbelleğinde durmaz"
      );
      assert.equal(afterFirst.lead_days, null, "tutar yoksa iş günü de yazılmaz");

      // (3) İkinci kasa toplamı 2^31'in üstüne çıkarır: kıstırma olmasa
      // Postgres 22003 verir ve iş sessizce "skipped" derdi.
      const second = await makePart(box, { ...sla, name: "Kasa B" });
      assert.equal(
        await analyzeQuotePart(second),
        "ready",
        "taşan toplam analizi 'skipped'e düşürmemeli — iş sessizce başarılı olurdu"
      );
      const row = await rowOf(second);
      assert.equal(row.analysis_status, "ready");
      assert.equal(row.analysis_error, null);
      assert.equal((await cacheOfBig()).total_kurus, null);

      // Teklife yapılan sonraki yazımlar (mutateQuote hepsini bununla bitirir)
      // artık patlamıyor: ne kendi işleminde ne de çağıranın işleminde.
      const own = await recomputeQuoteCache(bigQuoteId);
      assert.ok(own, "kendi işleminde yeniden hesap tamamlandı");
      assert.equal(own!.totalKurus, null);
      const joined = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM quotes WHERE id = ${bigQuoteId} FOR UPDATE`);
        return recomputeQuoteCache(bigQuoteId, tx);
      });
      assert.ok(joined, "çağıranın işleminde yeniden hesap tamamlandı");
      assert.equal(joined!.totalKurus, null);
      // Hesap gerçekten taşan tutarı BULDU, sadece yazmadı: aksi hâlde bu test
      // "fiyatlanamayan teklif" hâlini ölçüyor olurdu.
      assert.equal(joined!.computed.totals.allPriced, true, "teklif fiyatlanabilir");
      assert.ok(
        joined!.computed.totals.totalKurus > 2 ** 31,
        `toplam gerçekten 2^31 üstü: ${joined!.computed.totals.totalKurus}`
      );
    });

    await queue.obliterate({ force: true }).catch(() => {});
    console.log(`${checks} quote analysis DB checks passed`);
  } finally {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end();
    fs.rmSync(ddlOut, { recursive: true, force: true });
    fs.rmSync(uploads, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
