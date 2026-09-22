/**
 * Teklif servisinin GERÇEK yoluyla testi: izole 55433 şeması + tek kullanımlık
 * UPLOAD_DIR + QA Redis. Taklit yok — kilitler, tekil indeksler, yumuşak silme
 * ve önbellek yeniden hesabı diskte ve veritabanında doğrulanır.
 *
 * İlk iddia en önemlisi: SQL TOHUMU ile `quote-seed.ts` AYNI ŞEY Mİ? İkisi
 * ayrı görevlerde, ayrı ellerle yazıldı; biri ötekinden kayarsa birim
 * testleri (TS tohumuyla) yeşil kalır ama CANLI fiyat başka çıkar.
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
process.env.REDIS_URL = redisUrl;
// Turnstile/analytics gibi dış çağrılar bu testte yok; yalnız depolama kökü.
const root = path.resolve(import.meta.dirname, "..");
const namespace = `quote_service_${Date.now()}_${process.pid}`;
const ddlOut = fs.mkdtempSync(path.join(os.tmpdir(), "quote-service-ddl-"));
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "quote-service-uploads-"));
process.env.UPLOAD_DIR = uploads;

const admin = new pg.Client({ connectionString });
let pool: pg.Pool | undefined;
let checks = 0;

const test = async (name: string, run: () => Promise<void>) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};

/** Aynı küpün her kopyası ayrı bir dosyadır: 80 baytlık STL başlığı serbesttir. */
function stlFixture(tag: string): Buffer {
  const bytes = Buffer.from(fs.readFileSync(path.join(root, "scripts/fixtures/quote/cube20.stl")));
  bytes.write(tag.padEnd(80, " ").slice(0, 80), 0, 80, "latin1");
  return bytes;
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

    // GERÇEK migration'ın tohumu — şema `schema.ts`'ten, veri 0064'ten gelir.
    const migration = fs.readFileSync(path.join(root, "drizzle/0064_instant_quotes.sql"), "utf8");
    const seedStatements = migration
      .split("--> statement-breakpoint")
      .filter((s) => /\bINSERT INTO\b/.test(s));
    assert.equal(seedStatements.length, 5, "0064 beş tohum ifadesi taşır");
    for (const statement of seedStatements) {
      await admin.query(statement.replace(/"public"\./g, ""));
    }

    url.searchParams.set("options", `-c search_path=${namespace}`);
    process.env.DATABASE_URL = url.toString();

    const { db } = await import("../src/lib/db");
    pool = (db as typeof db & { $client: pg.Pool }).$client;
    const { eq } = await import("drizzle-orm");
    const { quoteParts, quotes } = await import("../src/lib/db/schema");
    const { SEED_SNAPSHOT } = await import("../src/lib/config/quote-seed");
    const { loadActiveSnapshot } = await import("../src/lib/services/quote-catalog");
    const {
      addPartFromUpload,
      bulkUpdateParts,
      claimQuote,
      createQuote,
      deletePart,
      duplicatePart,
      listCustomerParts,
      listCustomerQuotes,
      loadPresentedQuote,
      loadQuoteParts,
      QuoteServiceError,
      repriceQuote,
      setDrawing,
      updatePart,
      updateQuote,
    } = await import("../src/lib/services/quote-service");
    const { createStagedUpload, appendChunk, setStagedUploadMeta } = await import(
      "../src/lib/services/chunked-upload"
    );
    const { getQuoteAnalysisQueue } = await import("../src/lib/queue/quote-queues");

    const queue = getQuoteAnalysisQueue();
    // Paylaşılan QA Redis'i: önceki koşuların artıkları bu testin iddialarını
    // kirletmesin.
    await queue.obliterate({ force: true }).catch(() => {});

    const viewerFor = (isOwnerWithPrices: boolean) => ({
      canSeePrices: isOwnerWithPrices,
      canEdit: true,
      isOwner: true,
      isShare: false,
      isAdmin: false,
    });
    async function loadAccess(quoteId: string, sessionUserId: string | null) {
      const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
      assert.ok(quote, "teklif satırı okunabildi");
      return { quote, viewer: viewerFor(sessionUserId !== null), sessionUserId };
    }

    /** Sahnelenmiş yükleme: dosyayı diske koyar ve sahibini deftere yazar. */
    async function stage(tag: string, owner: string): Promise<string> {
      const uploadId = await createStagedUpload();
      const bytes = stlFixture(tag);
      const written = await appendChunk(uploadId, new Response(new Uint8Array(bytes)).body, 0);
      assert.equal(written.ok, true, "parça diske yazıldı");
      await setStagedUploadMeta(uploadId, { owner, expectedSize: bytes.length });
      return uploadId;
    }

    const livePartCount = async (quoteId: string) =>
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM quote_parts WHERE quote_id = $1 AND deleted_at IS NULL",
          [quoteId]
        )
      ).rows[0].n as number;

    // ─── Tohum eşitliği (Yönerge R1) ────────────────────────────────────────

    await test("SQL tohumu ile quote-seed.ts BİREBİR aynı kataloğu verir", async () => {
      const snapshot = await loadActiveSnapshot();
      assert.equal(typeof snapshot.takenAt, "string");
      assert.deepEqual({ ...snapshot, takenAt: SEED_SNAPSHOT.takenAt }, SEED_SNAPSHOT);
    });

    // ─── Teklif açma ────────────────────────────────────────────────────────

    const anonId = `anon-${randomUUID()}`;
    let quoteA = { id: "", number: "" };
    await test("createQuote anonim teklifi aktif katalogla dondurur", async () => {
      quoteA = await createQuote({ userId: null, anonymousId: anonId, termsAccepted: true });
      assert.match(quoteA.number, /^T-\d{6,}$/);
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteA.id)).limit(1);
      assert.equal(row.status, "draft");
      assert.equal(row.anonymousId, anonId);
      assert.equal(row.userId, null);
      assert.ok(row.termsAcceptedAt, "sözleşme onayı damgalandı");
      assert.deepEqual(
        { ...row.pricingSnapshot, takenAt: SEED_SNAPSHOT.takenAt },
        SEED_SNAPSHOT
      );
      assert.ok(
        row.expiresAt.getTime() > Date.now() + 29 * 86_400_000,
        "geçerlilik süresi katalogdan geldi"
      );
    });

    // ─── 20'lik tavan ───────────────────────────────────────────────────────

    const ownerKeyA = `a:${anonId}`;
    let firstUploadId = "";
    await test("yirmi eşzamanlı yükleme geçer, yirmi birincisi TÜRKÇE reddedilir", async () => {
      const access = await loadAccess(quoteA.id, null);
      const uploads20 = await Promise.all(
        Array.from({ length: 20 }, (_, i) => stage(`fixture-${i}`, ownerKeyA))
      );
      firstUploadId = uploads20[0];
      await Promise.all(
        uploads20.map((uploadId, i) =>
          addPartFromUpload(access, { uploadId, fileName: `parca-${i}.stl` })
        )
      );
      assert.equal(await livePartCount(quoteA.id), 20, "tam yirmi parça yazıldı");

      const extra = await stage("fixture-21", ownerKeyA);
      await assert.rejects(
        addPartFromUpload(access, { uploadId: extra, fileName: "parca-21.stl" }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          err.code === "part_limit" &&
          /en fazla 20 parça olabilir/.test(err.message)
      );
      assert.equal(await livePartCount(quoteA.id), 20, "reddedilen istek satır bırakmadı");
    });

    await test("aynı uploadId ikinci kez gelirse VAR OLAN parça döner", async () => {
      const access = await loadAccess(quoteA.id, null);
      const [existing] = await db
        .select({ id: quoteParts.id })
        .from(quoteParts)
        .where(eq(quoteParts.uploadId, firstUploadId))
        .limit(1);
      const again = await addPartFromUpload(access, {
        uploadId: firstUploadId,
        fileName: "parca-0.stl",
      });
      assert.equal(again.partId, existing.id);
      assert.equal(await livePartCount(quoteA.id), 20, "tekrar yeni satır açmadı");
    });

    await test("başkasının yüklemesi teklife bağlanamaz", async () => {
      const access = await loadAccess(quoteA.id, null);
      const foreign = await stage("fixture-foreign", "a:baska-ziyaretci");
      await assert.rejects(
        addPartFromUpload(access, { uploadId: foreign, fileName: "yabanci.stl" }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 403 &&
          err.code === "upload_not_owned"
      );
    });

    await test("her parça analiz kuyruğuna SIRA ÖNCELİĞİYLE girdi", async () => {
      const jobs = await queue.getJobs(["waiting", "prioritized", "delayed", "active"]);
      assert.equal(jobs.length, 20, "yirmi analiz işi eklendi");
      assert.equal(
        new Set(jobs.map((j) => j.id)).size,
        20,
        "iş kimlikleri tekil (bullmq ikinci eklemeyi yutmadı)"
      );
      await queue.obliterate({ force: true });
    });

    await test("sunulan gövde teklifin tamamını taşır", async () => {
      const access = await loadAccess(quoteA.id, null);
      const view = await loadPresentedQuote(access);
      assert.equal(view.partCount, 20);
      assert.equal(view.unitCount, 20);
      assert.equal(view.number, quoteA.number);
      // Anonim sahip fiyat görmez: gövdede tek bir fiyat anahtarı olmamalı.
      assert.equal(/"price"|"totals"|Kurus"/.test(JSON.stringify(view)), false);
    });

    // ─── Devralma ───────────────────────────────────────────────────────────

    const userId = randomUUID();
    await admin.query(
      `INSERT INTO users (id, email, full_name) VALUES ($1, $2, $3)`,
      [userId, `teklif-${userId}@ornek.test`, "Teklif Müşterisi"]
    );

    await test("devralma YALNIZ eşleşen çerez + sahipsiz teklif ile olur", async () => {
      assert.equal(await claimQuote(quoteA.id, userId, "baska-cerez"), false);
      assert.equal(await claimQuote(quoteA.id, userId, anonId), true);
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteA.id)).limit(1);
      assert.equal(row.userId, userId);
      // İkinci devralma denemesi: teklif artık sahipsiz değil.
      assert.equal(await claimQuote(quoteA.id, randomUUID(), anonId), false);
    });

    // ─── Yapılandırma ───────────────────────────────────────────────────────

    let quoteB = { id: "", number: "" };
    let partB = "";
    await test("ikinci teklif ve tek parça hazırlandı", async () => {
      quoteB = await createQuote({ userId, anonymousId: null, termsAccepted: true });
      const access = await loadAccess(quoteB.id, userId);
      const uploadId = await stage("fixture-b", `u:${userId}`);
      const added = await addPartFromUpload(access, { uploadId, fileName: "braket.stl" });
      partB = added.partId;
      const [part] = await loadQuoteParts(quoteB.id);
      assert.equal(part.technologyKey, "fdm");
      assert.equal(part.materialKey, "pla");
      assert.equal(part.name, "braket");
    });

    await test("teknoloji değişince malzeme/renk/yüzey/katman/doluluk SIFIRLANIR", async () => {
      const access = await loadAccess(quoteB.id, userId);
      await updatePart(access, partB, { technologyKey: "sla" });
      const [part] = await loadQuoteParts(quoteB.id);
      assert.equal(part.technologyKey, "sla");
      assert.equal(part.materialKey, "standard_resin");
      assert.equal(part.colorKey, "gri");
      assert.equal(part.finishKey, "ham");
      assert.equal(part.layerUm, 50);
      assert.equal(part.infillPct, null, "katı baskıda doluluk yoktur");
    });

    await test("katalogda olmayan seçenek 400 'Geçersiz seçenek' alır", async () => {
      const access = await loadAccess(quoteB.id, userId);
      await assert.rejects(
        updatePart(access, partB, { materialKey: "pla" }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 400 &&
          err.message === "Geçersiz seçenek."
      );
    });

    await test("bayat sürümle gelen düzenleme 409 version_conflict alır", async () => {
      const access = await loadAccess(quoteB.id, userId);
      await updateQuote(access, { title: "Braket projesi", expectedVersion: access.quote.version });
      await assert.rejects(
        updateQuote(access, { title: "Tekrar", expectedVersion: access.quote.version }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          err.code === "version_conflict"
      );
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteB.id)).limit(1);
      assert.equal(row.title, "Braket projesi", "reddedilen yazım geçmedi");
    });

    await test("çoğaltma analizi kopyalar, silme yumuşaktır", async () => {
      const access = await loadAccess(quoteB.id, userId);
      const copy = await duplicatePart(access, partB);
      const parts = await loadQuoteParts(quoteB.id);
      assert.equal(parts.length, 2);
      const copied = parts.find((p) => p.id === copy.partId)!;
      assert.equal(copied.sourceKey, parts.find((p) => p.id === partB)!.sourceKey);
      assert.equal(copied.uploadId, null, "tekil yükleme kaydı kopyalanmaz");
      assert.match(copied.name, /\(kopya\)$/);

      await deletePart(await loadAccess(quoteB.id, userId), copy.partId);
      assert.equal((await loadQuoteParts(quoteB.id)).length, 1);
      const [raw] = (
        await admin.query("SELECT deleted_at FROM quote_parts WHERE id = $1", [copy.partId])
      ).rows;
      assert.ok(raw.deleted_at, "satır silinmedi, yalnız işaretlendi");
    });

    await test("teknik çizim yalnız PDF kabul eder", async () => {
      const access = await loadAccess(quoteB.id, userId);
      await assert.rejects(
        setDrawing(access, partB, new File(["MZ sahte"], "cizim.pdf", { type: "application/pdf" })),
        (err: unknown) => err instanceof QuoteServiceError && err.code === "drawing_not_pdf"
      );
      await setDrawing(
        await loadAccess(quoteB.id, userId),
        partB,
        new File(["%PDF-1.7\n%…\n"], "teknik çizim.pdf", { type: "application/pdf" })
      );
      const [part] = await loadQuoteParts(quoteB.id);
      assert.equal(part.drawingName, "teknik çizim.pdf");
      assert.ok(part.drawingKey?.startsWith(`quote-parts/${partB}/drawing-`));
      assert.ok(fs.existsSync(path.join(uploads, part.drawingKey!)), "dosya diske yazıldı");
    });

    // ─── Yeniden fiyatlama ──────────────────────────────────────────────────

    await test("yeniden fiyatlama yeni snapshot verir ve manuel fiyatları DÜŞÜRÜR", async () => {
      await admin.query(
        `UPDATE quote_parts
            SET manual_unit_price_kurus = 45000, manual_price_key = 'elle', manual_priced_at = now(),
                manual_priced_by_email = 'admin@ornek.test'
          WHERE quote_id = $1`,
        [quoteB.id]
      );
      await admin.query(
        `UPDATE quotes SET status = 'quoted', expires_at = now() - interval '1 day' WHERE id = $1`,
        [quoteB.id]
      );

      const access = await loadAccess(quoteB.id, userId);
      await repriceQuote(access);

      const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteB.id)).limit(1);
      assert.equal(row.status, "draft");
      assert.ok(row.expiresAt.getTime() > Date.now(), "süre yeniden açıldı");
      assert.ok(row.snapshotTakenAt.getTime() > Date.now() - 60_000, "snapshot tazelendi");
      const [part] = await loadQuoteParts(quoteB.id);
      assert.equal(part.manualUnitPriceKurus, null);
      assert.equal(part.manualPriceKey, null);
      assert.equal(part.manualPricedAt, null);
      assert.equal(part.manualPricedByEmail, null);
    });

    // ─── Toplu işlem ────────────────────────────────────────────────────────

    await test("toplu güncelleme tek işlemde uygulanır", async () => {
      const access = await loadAccess(quoteB.id, userId);
      const before = access.quote.version;
      await bulkUpdateParts(access, [partB], { quantity: 7, note: "Toplu not" });
      const [part] = await loadQuoteParts(quoteB.id);
      assert.equal(part.quantity, 7);
      assert.equal(part.note, "Toplu not");
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteB.id)).limit(1);
      assert.equal(row.version, before + 1, "tek yeniden hesap, tek sürüm artışı");
    });

    // ─── Müşteri listeleri ──────────────────────────────────────────────────

    await test("teklif listesi parça/adet sayılarıyla gelir", async () => {
      const { items, hasNext } = await listCustomerQuotes(userId, 1);
      assert.equal(hasNext, false);
      assert.equal(items.length, 2);
      const b = items.find((q) => q.number === quoteB.number)!;
      assert.equal(b.partCount, 1);
      assert.equal(b.unitCount, 7);
      assert.equal(b.title, "Braket projesi");
      const a = items.find((q) => q.number === quoteA.number)!;
      assert.equal(a.partCount, 20);
    });

    await test("parça kütüphanesi aynı dosyayı TEK satırda toplar", async () => {
      const sharedSha = (
        await admin.query("SELECT source_sha256 FROM quote_parts WHERE id = $1", [partB])
      ).rows[0].source_sha256 as string;
      // Aynı dosyanın ikinci teklifteki kopyası: kütüphanede tek satır olmalı.
      const third = await createQuote({ userId, anonymousId: null, termsAccepted: true });
      await admin.query(
        `INSERT INTO quote_parts
           (quote_id, name, file_name, source_key, source_format, source_bytes, source_sha256,
            technology_key, material_key, color_key, finish_key)
         VALUES ($1, 'Braket', 'braket.stl', 'quote-parts/x/source.stl', 'stl', 2048, $2,
                 'fdm', 'pla', 'beyaz', 'ham')`,
        [third.id, sharedSha]
      );

      const first = await listCustomerParts(userId, 1);
      assert.equal(first.items.length, 20, "sayfa boyu 20");
      assert.equal(first.hasNext, true, "21. dosya ikinci sayfada");
      const second = await listCustomerParts(userId, 2);
      assert.equal(second.hasNext, false);

      const shas = [...first.items, ...second.items].map((p) => p.sha256);
      assert.equal(shas.length, 21, "20 + 1 tekil dosya (22 satır değil)");
      assert.equal(new Set(shas).size, 21, "aynı özet iki kez listelenmez");
      const shared = first.items.find((p) => p.sha256 === sharedSha)!;
      assert.equal(shared.useCount, 2, "kaç teklifte kullanıldığı sayılır");
      assert.equal(shared.quoteNumber, third.number, "en son kopya gösterilir");
    });

    await test("kütüphane BAŞKASININ parçalarını göstermez", async () => {
      const { items } = await listCustomerParts(randomUUID(), 1);
      assert.deepEqual(items, []);
    });

    await queue.obliterate({ force: true }).catch(() => {});
    console.log(`${checks} quote service DB checks passed`);
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
