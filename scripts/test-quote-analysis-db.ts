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
import os from "node:os";
import path from "node:path";
import pg from "pg";

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
    geometry: { volume: number | null; bodyCount: number } | null;
    units: string;
    canonical_stl_key: string | null;
    preview_glb_key: string | null;
    thumbnail_key: string | null;
  };

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
    const { analyzeQuotePart, requeueStuckQuoteParts } = await import(
      "../src/lib/services/quote-analysis"
    );
    const { getQuoteAnalysisQueue } = await import("../src/lib/queue/quote-queues");
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
      assert.equal(await requeueStuckQuoteParts(10 * 60_000), 1);
      assert.equal((await rowOf(stuck)).analysis_status, "queued");
      assert.equal((await rowOf(fresh)).analysis_status, "queued", "taze parça zaten sırada");
      assert.equal((await rowOf(fresh)).analysis_attempt, 0, "taze parçaya dokunulmadı");
      // Yeniden kuyruğa alma GERÇEKTEN iş ekler: kimlik bir sonraki denemeyi taşır.
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
      assert.equal(await requeueStuckQuoteParts(10 * 60_000), 0);
      assert.equal((await rowOf(ghost)).analysis_status, "analyzing");
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
