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
import { createRequire } from "node:module";
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

/**
 * Giden e-postalar: SMTP sürücüsü kayda alınır, sokete çıkılmaz.
 *
 * İki işi birden görür. (1) Bildirimler bu testte İDDİA EDİLEBİLİR hâle gelir —
 * `quote-notify.ts`'in tek gözlenebilir çıktısı giden mektuptur. (2) Çıktı
 * temiz kalır: yamasız koşuda her bildirim QA makinesinde
 * `ECONNREFUSED :587` dökümü basıyordu; bu döküm bildirimin BEKLENEN
 * (yutulan) davranışıydı, yani gerçek bir arıza gibi görünen gürültüydü.
 */
const sentMail: Array<{ to: string; subject: string; html: string }> = [];
{
  const SMTP = createRequire(import.meta.url)("nodemailer/lib/smtp-transport") as {
    prototype: {
      send(
        mail: { data: { to: string; subject: string; html: string } },
        callback: (
          error: Error | null,
          info: { accepted: string[]; rejected: string[] }
        ) => void
      ): void;
    };
  };
  SMTP.prototype.send = (mail, callback) => {
    sentMail.push({ to: mail.data.to, subject: mail.data.subject, html: mail.data.html });
    callback(null, { accepted: [mail.data.to], rejected: [] });
  };
}

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

/**
 * Aynı küpün STEP'i; etiket DATA bölümüne YORUM olarak girer.
 *
 * Böylece her kopyanın sha256'sı ayrıdır (parça kütüphanesi dosyaları özetiyle
 * topluyor) ve dosya hâlâ geçerli bir ISO 10303-21 gövdesidir — doğrulama
 * kapısı gerçekten onu okur.
 */
function stepFixture(tag: string): Buffer {
  const text = fs.readFileSync(path.join(root, "scripts/fixtures/quote/cube20.step"), "utf8");
  return Buffer.from(text.replace("DATA;", `DATA;\n/* ${tag} */`));
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

    // GERÇEK migration'ların tohumu — şema `schema.ts`'ten, veri 0064'ten ve
    // ondan SONRAKİ veri migration'larından gelir. Sonrakileri de uygulamak
    // şart: yeni kurulumun gerçekte aldığı değer bu zincirin sonucudur, tek
    // başına 0064 değil (ör. 0064'ün tohumladığı bir ayarı sonraki bir veri
    // migration'ı değiştirirse gerçek değer onunkidir). Zinciri atlayan bir
    // test, tohum kaymasını kaçırır ki bu testin tek varlık sebebi odur.
    const migration = fs.readFileSync(path.join(root, "drizzle/0064_instant_quotes.sql"), "utf8");
    const seedStatements = migration
      .split("--> statement-breakpoint")
      .filter((s) => /\bINSERT INTO\b/.test(s));
    assert.equal(seedStatements.length, 5, "0064 beş tohum ifadesi taşır");
    for (const statement of seedStatements) {
      await admin.query(statement.replace(/"public"\./g, ""));
    }

    const journal = JSON.parse(
      fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> };
    const laterDataStatements = journal.entries
      .filter((e) => e.idx > 64)
      .sort((a, b) => a.idx - b.idx)
      .flatMap((e) =>
        fs
          .readFileSync(path.join(root, `drizzle/${e.tag}.sql`), "utf8")
          .split("--> statement-breakpoint")
          .filter((s) => /\b(INSERT INTO|UPDATE)\s+"?(print_|quote_pricing_settings)/.test(s))
      );
    for (const statement of laterDataStatements) {
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
      importParts,
      listCustomerParts,
      listCustomerQuotes,
      loadPresentedQuote,
      loadQuoteParts,
      QuoteServiceError,
      repriceQuote,
      requestReview,
      requote,
      setDrawing,
      setShareToken,
      splitByTechnology,
      updatePart,
      updateQuote,
    } = await import("../src/lib/services/quote-service");
    const {
      createQuoteMessage,
      listQuoteMessages,
      markQuoteMessagesRead,
      MAX_MESSAGE_LENGTH,
    } = await import("../src/lib/services/quote-chat");
    const {
      notifyQuoteAbandoned,
      notifyQuoteExpiring,
      notifyQuoteMessage,
      notifyReviewRequested,
    } = await import("../src/lib/services/quote-notify");
    const {
      ANON_DAILY_UPLOAD_BYTES,
      appendChunk,
      chargeAnonymousDailyBytes,
      createStagedUpload,
      readStagedUploadMeta,
      setStagedUploadMeta,
      uploadOwnerKey,
    } = await import("../src/lib/services/chunked-upload");
    const { getQuoteAnalysisQueue } = await import("../src/lib/queue/quote-queues");
    const { setFlag } = await import("../src/lib/services/flags");

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
      isTeam: false,
      teamRole: null,
    });
    async function loadAccess(quoteId: string, sessionUserId: string | null) {
      const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
      assert.ok(quote, "teklif satırı okunabildi");
      // `team: null` → 0072 takım dalı KAPALI: bu dosyanın her vakası kişisel
      // tekliftir ve üyelik okuması erişim kabuğunun işi (`resolveQuoteTeam`).
      // `teamId` ise SATIRDAN gelir (kabuk da öyle yapıyor): bir hak değil,
      // yalnız "bu teklif hangi takımın" bilgisi — burada daima `null`.
      return {
        quote,
        viewer: viewerFor(sessionUserId !== null),
        sessionUserId,
        teamId: quote.teamId,
        team: null,
      };
    }

    /** Sahnelenmiş yükleme: dosyayı diske koyar ve sahibini deftere yazar. */
    async function stage(
      tag: string,
      owner: string,
      fixture: (tag: string) => Buffer = stlFixture
    ): Promise<string> {
      const uploadId = await createStagedUpload();
      const bytes = fixture(tag);
      const written = await appendChunk(uploadId, new Response(new Uint8Array(bytes)).body, 0);
      assert.equal(written.ok, true, "parça diske yazıldı");
      await setStagedUploadMeta(uploadId, { owner, expectedSize: bytes.length });
      return uploadId;
    }

    /** UPLOAD_DIR altındaki her dosyanın göreli yolu (sıralı). */
    const storedFiles = (): string[] => {
      const out: string[] = [];
      const walk = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
          else out.push(rel);
        }
      };
      walk(uploads, "");
      return out.sort();
    };

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
      // Öncelik parçanın SIRASIDIR, BİRDEN başlayarak: bullmq'da `0`
      // "önceliksiz" demektir ve o iş öncelikli kümeye hiç girmez — sıfırdan
      // başlayan bir sayım, ilk parçayı kardeşlerinden farklı bir listeye
      // koyup sıralamayı bozardı.
      assert.deepEqual(
        [...new Set(jobs.map((j) => j.opts.priority))].sort((a, b) => (a ?? 0) - (b ?? 0)),
        Array.from({ length: 20 }, (_, i) => i + 1),
        "yirmi iş, 1..20 önceliğiyle"
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

    // Fiyat kapısı bir MODALDIR: müşteri kayıt olurken çalışma alanı ayakta
    // kalır ve o sırada yürüyen yükleme tamamlanır. Sahneleme kaydındaki sahip
    // `a:<çerez>` olarak donmuştur; `callerKey` ise girişten sonra `u:<id>`
    // olur. Aday kümesi iki anahtarı da taşımazsa müşteri KENDİ dosyası için
    // "size ait değil" cevabı alır — hem de tam kazanım hunisinin ortasında.
    await test("giriş yapınca UÇUŞTAKİ misafir yüklemesi teklife bağlanır", async () => {
      const anonC = `anon-${randomUUID()}`;
      const userC = randomUUID();
      await admin.query(`INSERT INTO users (id, email, full_name) VALUES ($1, $2, $3)`, [
        userC,
        `kapi-${userC}@ornek.test`,
        "Fiyat Kapısı Müşterisi",
      ]);
      const quoteC = await createQuote({ userId: null, anonymousId: anonC, termsAccepted: true });
      // Dosya misafirken sahnelenir…
      const staged = await stage("fixture-gate", `a:${anonC}`);
      const foreign = await stage("fixture-gate-foreign", `a:${randomUUID()}`);
      // …müşteri fiyatı görmek için kayıt olur…
      assert.equal(await claimQuote(quoteC.id, userC, anonC), true);
      // …ve yükleme yine de bağlanır.
      const added = await addPartFromUpload(await loadAccess(quoteC.id, userC), {
        uploadId: staged,
        fileName: "kapi.stl",
      });
      assert.ok(added.partId, "uçuştaki yükleme bağlanamadı");
      // Gerçekten yabancı bir çerezin sahnelemesi hâlâ reddedilir.
      await assert.rejects(
        addPartFromUpload(await loadAccess(quoteC.id, userC), {
          uploadId: foreign,
          fileName: "yabanci.stl",
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 403 &&
          err.code === "upload_not_owned"
      );
    });

    // Aynı tarayıcı AYNI ANDA bir panel çerezi (üretici/boyacı/admin) ile bir
    // müşteri oturumu taşıyabilir. `/api/uploads/chunk` sahnelemeyi İLK eşleşen
    // kimlikle kaydeder — yani dosya `manufacturer:<id>` ile kaydedilir, müşteri
    // anahtarıyla değil. Aday kümesi çağıranın panel anahtarlarını taşımazsa bu
    // kişi KENDİ dosyası için 403 alır; lansman öncesi iç testi yapan kişi de
    // öyle.
    await test("panel oturumuyla sahnelenen dosya kendi sahneleyenine bağlanır", async () => {
      const anonD = `anon-${randomUUID()}`;
      const quoteD = await createQuote({ userId: null, anonymousId: anonD, termsAccepted: true });
      const panelKey = uploadOwnerKey({ role: "manufacturer", userId: randomUUID() });
      const staged = await stage("fixture-panel", panelKey);
      const access = await loadAccess(quoteD.id, null);

      // Panel anahtarı taşınmazsa çağıran KENDİ dosyasına yabancıdır.
      await assert.rejects(
        addPartFromUpload(access, { uploadId: staged, fileName: "panel.stl" }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 403 &&
          err.code === "upload_not_owned"
      );

      // Taşınınca bağlanır…
      const added = await addPartFromUpload(
        { ...access, uploadOwnerKeys: [panelKey] },
        { uploadId: staged, fileName: "panel.stl" }
      );
      assert.ok(added.partId, "panel sahnelemesi kendi sahibine bağlanamadı");

      // …ama BAŞKA bir panel kimliğinin sahnelemesi hâlâ reddedilir.
      const foreign = await stage(
        "fixture-panel-foreign",
        uploadOwnerKey({ role: "painter", userId: randomUUID() })
      );
      await assert.rejects(
        addPartFromUpload(
          { ...access, uploadOwnerKeys: [panelKey] },
          { uploadId: foreign, fileName: "yabanci.stl" }
        ),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 403 &&
          err.code === "upload_not_owned"
      );
    });

    // Sahiplik defteri CANLI Redis'te: "kayıt yok" ile "defter cevap vermedi"
    // aynı şey değildir. `/api/uploads/chunk` ikincisinde girişli çağıranı
    // geçirir; birincisinde geçirse sahiplik kapısı hiç olmazdı. Üretimde
    // REDIS_URL hep dolu olduğundan asıl riskli hâl budur.
    await test("sahiplik defteri: canlı Redis'te eksik kayıt 'bilinmiyor' DEĞİLDİR", async () => {
      assert.deepEqual(
        await readStagedUploadMeta("stagedUploadYokYokYok00"),
        { known: true, meta: null },
        "canlı defterde eksik kayıt cevapsız sayıldı"
      );
      const id = await stage("fixture-defter", "a:defter");
      assert.deepEqual(await readStagedUploadMeta(id), {
        known: true,
        meta: { owner: "a:defter", expectedSize: stlFixture("fixture-defter").length },
      });
    });

    await test("misafir günlük bayt kotası IP defterini de yükler", async () => {
      // `anonymous_session` imzasızdır ve sunucuda karşılığı yoktur: her istekte
      // taze bir çerez üretmek taze bir 2 GB kotası satın alırdı. IP defteri
      // çerezden bağımsız birikir, ikisinden biri dolduğunda kapı kapanır.
      const ip = `ip-${randomUUID()}`;
      const half = Math.floor(ANON_DAILY_UPLOAD_BYTES / 2) + 1;
      const first = await chargeAnonymousDailyBytes(`anon-${randomUUID()}`, half, ip);
      assert.equal(first.overQuota, false, "tek misafir tavanın altında kalmalı");
      const second = await chargeAnonymousDailyBytes(`anon-${randomUUID()}`, half, ip);
      assert.equal(second.overQuota, true, "çerez tazelemek IP kotasını sıfırladı");
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

    await test("sahipliği kanıtlanmamış parça için TEK BAYT yazılmaz", async () => {
      // Çizim yolu ham `partId`den kuruluyordu ve `saveFile` çağrısı sahiplik
      // kontrolünden ÖNCE yürüyordu: `../../` taşıyan bir parça kimliği dosyayı
      // UPLOAD_DIR'in dışına koyar, ardından sorgu patlar ve uç 500 döner —
      // dosya çoktan diskte. Sıra doğruysa hiçbir yol yazmaya ulaşmaz.
      const escape = `kacak-${namespace}`;
      const outside = path.resolve(uploads, "..", escape);
      const before = storedFiles();
      const pdf = () => new File(["%PDF-1.7\n%…\n"], "cizim.pdf", { type: "application/pdf" });

      // (a) Yol gezintisi: hem kodlanmış hem çözülmüş hâli.
      for (const evil of [`..%2F..%2F${escape}`, `../../${escape}`]) {
        await assert.rejects(
          setDrawing(await loadAccess(quoteB.id, userId), evil, pdf()),
          (err: unknown) =>
            err instanceof QuoteServiceError &&
            err.status === 404 &&
            err.code === "part_not_found",
          `kabul edildi: ${evil}`
        );
      }

      // (b) Biçimi kusursuz ama BAŞKA teklifin parçası.
      const [foreignPart] = await db
        .select({ id: quoteParts.id })
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, quoteA.id))
        .limit(1);
      await assert.rejects(
        setDrawing(await loadAccess(quoteB.id, userId), foreignPart.id, pdf()),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 404 &&
          err.code === "part_not_found"
      );

      assert.equal(fs.existsSync(outside), false, "UPLOAD_DIR DIŞINA dosya yazıldı");
      assert.deepEqual(storedFiles(), before, "reddedilen çizim diske dosya bıraktı");
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
      // Malzeme adı teklifin KENDİ anlık görüntüsünden çözülür (3.3): bugünün
      // kataloğuna bakmak, kaldırılmış bir malzemeyi kütüphanede boş bırakırdı.
      assert.equal(shared.lastMaterialName, "PLA", "son kullanılan malzeme adı yok");
    });

    await test("kütüphane BAŞKASININ parçalarını göstermez", async () => {
      const { items } = await listCustomerParts(randomUUID(), 1);
      assert.deepEqual(items, []);
    });

    // ─── `quoted` + parça KÜMESİ değişimi → `draft` ─────────────────────────

    const statusOf = async (quoteId: string) =>
      (await admin.query("SELECT status FROM quotes WHERE id = $1", [quoteId])).rows[0]
        .status as string;
    const markQuoted = async (quoteId: string) => {
      await admin.query("UPDATE quotes SET status = 'quoted' WHERE id = $1", [quoteId]);
    };

    await test("fiyatlanmış teklifte parça EKLEME/ÇOĞALTMA/SİLME teklifi taslağa düşürür", async () => {
      await markQuoted(quoteB.id);
      const copy = await duplicatePart(await loadAccess(quoteB.id, userId), partB);
      assert.equal(await statusOf(quoteB.id), "draft", "çoğaltma fiyatı geçersiz kılar");

      await markQuoted(quoteB.id);
      await deletePart(await loadAccess(quoteB.id, userId), copy.partId);
      assert.equal(await statusOf(quoteB.id), "draft", "silme fiyatı geçersiz kılar");

      await markQuoted(quoteB.id);
      const uploadId = await stage("fixture-demote", `u:${userId}`);
      const added = await addPartFromUpload(await loadAccess(quoteB.id, userId), {
        uploadId,
        fileName: "ek-parca.stl",
      });
      assert.equal(await statusOf(quoteB.id), "draft", "yeni parça fiyatı geçersiz kılar");

      await markQuoted(quoteB.id);
      await bulkUpdateParts(await loadAccess(quoteB.id, userId), [added.partId], {
        delete: true,
      });
      assert.equal(await statusOf(quoteB.id), "draft", "toplu silme fiyatı geçersiz kılar");
    });

    // ─── İnceleme talebi ────────────────────────────────────────────────────

    await test("hedef fiyat talebi teklifi needs_review yapar ve fiyatı parçaya yazar", async () => {
      await requestReview(await loadAccess(quoteB.id, userId), {
        kind: "target_price",
        note: "Bu parçayı 120 TL birim fiyatla alabilir miyiz?",
        targets: [{ partId: partB, unitKurus: 12_000 }],
      });
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteB.id)).limit(1);
      assert.equal(row.status, "needs_review");
      assert.equal(row.reviewKind, "target_price");
      assert.match(row.reviewNote ?? "", /120 TL/);
      assert.ok(row.reviewRequestedAt, "talep zamanı damgalandı");
      const [part] = await loadQuoteParts(quoteB.id);
      assert.equal(part.targetUnitPriceKurus, 12_000);
    });

    await test("incelemedeki teklif İKİNCİ kez sıraya girmez", async () => {
      await assert.rejects(
        requestReview(await loadAccess(quoteB.id, userId), {
          kind: "manual",
          note: "Bir de manuel bakar mısınız?",
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          err.code === "review_blocked"
      );
    });

    // ─── Teknolojiye göre bölme ─────────────────────────────────────────────

    let quoteC = { id: "", number: "" };
    let partCFdm = "";
    await test("iki teknolojili teklif hazırlandı", async () => {
      quoteC = await createQuote({ userId, anonymousId: null, termsAccepted: true });
      const first = await addPartFromUpload(await loadAccess(quoteC.id, userId), {
        uploadId: await stage("fixture-c1", `u:${userId}`),
        fileName: "fdm-parca.stl",
      });
      partCFdm = first.partId;
      const second = await addPartFromUpload(await loadAccess(quoteC.id, userId), {
        uploadId: await stage("fixture-c2", `u:${userId}`),
        fileName: "sla-parca.stl",
      });
      await updatePart(await loadAccess(quoteC.id, userId), second.partId, {
        technologyKey: "sla",
      });
      assert.equal((await loadQuoteParts(quoteC.id)).length, 2);
    });

    await test("splitByTechnology ikinci teknolojiyi YENİ teklife taşır", async () => {
      const { newQuoteNumbers } = await splitByTechnology(await loadAccess(quoteC.id, userId));
      assert.equal(newQuoteNumbers.length, 1);

      const stayed = await loadQuoteParts(quoteC.id);
      assert.equal(stayed.length, 1, "ilk teknoloji yerinde kaldı");
      assert.equal(stayed[0].id, partCFdm);
      assert.equal(stayed[0].technologyKey, "fdm");

      const [split] = await db
        .select()
        .from(quotes)
        .where(eq(quotes.number, newQuoteNumbers[0]))
        .limit(1);
      assert.equal(split.sourceQuoteId, quoteC.id, "yeni teklif kaynağını bilir");
      assert.equal(split.userId, userId);
      assert.equal(split.status, "draft");
      assert.equal(
        split.snapshotTakenAt.getTime(),
        (await loadAccess(quoteC.id, userId)).quote.snapshotTakenAt.getTime(),
        "bölme yeniden fiyatlama DEĞİLDİR: snapshot devralınır"
      );
      const moved = await loadQuoteParts(split.id);
      assert.equal(moved.length, 1);
      assert.equal(moved[0].technologyKey, "sla");
    });

    await test("tek teknolojili teklif bölünemez", async () => {
      await assert.rejects(
        splitByTechnology(await loadAccess(quoteC.id, userId)),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 400 &&
          err.code === "single_technology"
      );
    });

    // Bölmenin PARA etkisi: parça fiyatları aynı kalır, ama TEKLİF BAŞINA
    // işleyen iki kalem (sabit ek hizmet + asgari sipariş tamamlaması) her
    // teklifte ayrıca işler. Sayılar burada ÇİVİLENİR: `splitByTechnology`
    // toplamın değişmediğini iddia ediyordu ve hiçbir iddia buna bakmıyordu.
    const FDM_CUBE_KURUS = 7_400; // 20 mm küp, fdm/pla, standart kademe
    const SLA_CUBE_KURUS = 11_400; // aynı küp, sla/standard_resin
    const MIN_ORDER_KURUS = 20_000; // quote-seed.ts settings.minOrderKurus
    const OLCUM_RAPORU_KURUS = 125_000; // quote-seed.ts addons, priceType "fixed"

    /** İki teknolojili, İKİ PARÇASI DA ANALİZLİ teklif — toplamı ölçülebilsin. */
    async function twoTechPricedQuote(tag: string, addonKeys: string[]) {
      const created = await createQuote({ userId, anonymousId: null, termsAccepted: true });
      const fdm = await addPartFromUpload(await loadAccess(created.id, userId), {
        uploadId: await stage(`${tag}-fdm`, `u:${userId}`),
        fileName: `${tag}-fdm.stl`,
      });
      const sla = await addPartFromUpload(await loadAccess(created.id, userId), {
        uploadId: await stage(`${tag}-sla`, `u:${userId}`),
        fileName: `${tag}-sla.stl`,
      });
      await updatePart(await loadAccess(created.id, userId), sla.partId, {
        technologyKey: "sla",
      });
      await markAnalyzed(fdm.partId);
      await markAnalyzed(sla.partId);
      // Analizi ham SQL yazdı; önbelleği tazeleyen tek yol bir mutasyondur.
      await updateQuote(await loadAccess(created.id, userId), { title: tag, addonKeys });
      const [row] = await db.select().from(quotes).where(eq(quotes.id, created.id)).limit(1);
      assert.ok(row.totalKurus !== null, "iki parça da fiyatlandı");
      return { ...created, totalKurus: row.totalKurus! };
    }

    const totalsAfterSplit = async (sourceId: string, numbers: string[]) => {
      const [source] = await db.select().from(quotes).where(eq(quotes.id, sourceId)).limit(1);
      const moved = await Promise.all(
        numbers.map(async (number) => {
          const [row] = await db.select().from(quotes).where(eq(quotes.number, number)).limit(1);
          return row;
        })
      );
      return { source, moved };
    };

    await test("bölme ASGARİ SİPARİŞ tamamlamasını teklif başına işletir", async () => {
      const quoteMin = await twoTechPricedQuote("bolme-asgari", []);
      // İki küçük parça tek teklifte asgariyi BİR kez tamamlıyordu.
      assert.equal(quoteMin.totalKurus, MIN_ORDER_KURUS);

      const result = await splitByTechnology(await loadAccess(quoteMin.id, userId));
      assert.equal(result.newQuoteNumbers.length, 1);
      const { source, moved } = await totalsAfterSplit(quoteMin.id, result.newQuoteNumbers);

      // Artık İKİ sipariş var ve her biri asgariyi ayrıca karşılıyor.
      assert.equal(source.totalKurus, MIN_ORDER_KURUS, "kaynak asgariye tamamlandı");
      assert.equal(moved[0].totalKurus, MIN_ORDER_KURUS, "yeni teklif de tamamlandı");
      assert.deepEqual(result.totals, {
        beforeKurus: MIN_ORDER_KURUS,
        afterKurus: 2 * MIN_ORDER_KURUS,
        deltaKurus: MIN_ORDER_KURUS,
      });
    });

    await test("bölme SABİT ek hizmeti her teklifte ayrıca işletir, farkı geri döner", async () => {
      const quoteAddon = await twoTechPricedQuote("bolme-ek-hizmet", ["olcum_raporu"]);
      assert.equal(
        quoteAddon.totalKurus,
        FDM_CUBE_KURUS + SLA_CUBE_KURUS + OLCUM_RAPORU_KURUS,
        "bölmeden önce ölçüm raporu TEK kez"
      );

      const result = await splitByTechnology(await loadAccess(quoteAddon.id, userId));
      const { source, moved } = await totalsAfterSplit(quoteAddon.id, result.newQuoteNumbers);
      assert.deepEqual(moved[0].addonKeys, ["olcum_raporu"], "ek hizmet seçimi devralınır");

      // Bilerek: bölünen her teklif ayrı bir siparişe / ayrı bir üreticiye
      // gider, raporu o üretici düzenler. Sessiz kalmaz: fark `totals`'ta.
      assert.equal(source.totalKurus, FDM_CUBE_KURUS + OLCUM_RAPORU_KURUS);
      assert.equal(moved[0].totalKurus, SLA_CUBE_KURUS + OLCUM_RAPORU_KURUS);
      assert.deepEqual(result.totals, {
        beforeKurus: quoteAddon.totalKurus,
        afterKurus: quoteAddon.totalKurus + OLCUM_RAPORU_KURUS,
        deltaKurus: OLCUM_RAPORU_KURUS,
      });
    });

    await test("fiyat göremeyen sahibin bölme cevabında TEK bir tutar yoktur", async () => {
      const quoteAnon = await twoTechPricedQuote("bolme-anonim", ["olcum_raporu"]);
      // `loadAccess(..., null)` = anonim sahip: düzenleyebilir, fiyat göremez.
      const result = await splitByTechnology(await loadAccess(quoteAnon.id, null));
      assert.equal(result.newQuoteNumbers.length, 1);
      assert.equal("totals" in result, false, "anahtar null olarak bile durmaz");
      assert.equal(/Kurus"|"totals"/.test(JSON.stringify(result)), false);
    });

    // ─── Paylaşım bağlantısı ────────────────────────────────────────────────

    await test("paylaşım token'ı üretilir, yenilenir ve iptal edilir", async () => {
      const created = await setShareToken(await loadAccess(quoteC.id, userId), "create");
      assert.equal(created?.length, 32);
      const again = await setShareToken(await loadAccess(quoteC.id, userId), "create");
      assert.equal(again, created, "ikinci 'create' eski bağlantıyı bozmaz");

      const rotated = await setShareToken(await loadAccess(quoteC.id, userId), "rotate");
      assert.equal(rotated?.length, 32);
      assert.notEqual(rotated, created, "yenileme yeni token verir");

      const revoked = await setShareToken(await loadAccess(quoteC.id, userId), "revoke");
      assert.equal(revoked, null);
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteC.id)).limit(1);
      assert.equal(row.shareToken, null, "iptal kolonu boşaltır");
    });

    // ─── Yeniden teklif al ──────────────────────────────────────────────────

    /** Analizi bitmiş bir parça taklidi: geometri + gerçek bir canonical dosya. */
    async function markAnalyzed(partId: string): Promise<{ canonicalKey: string }> {
      const canonicalKey = `quote-parts/${partId}/canonical-test.stl`;
      fs.mkdirSync(path.dirname(path.join(uploads, canonicalKey)), { recursive: true });
      fs.writeFileSync(path.join(uploads, canonicalKey), stlFixture("canonical"));
      await admin.query(
        `UPDATE quote_parts
            SET analysis_status = 'ready', canonical_stl_key = $2, geometry = $3::jsonb
          WHERE id = $1`,
        [
          partId,
          canonicalKey,
          JSON.stringify({
            volume: 8000,
            area: 2400,
            extents: { x: 20, y: 20, z: 20 },
            bodyCount: 1,
            isWatertight: true,
            isVolume: true,
            volumeEstimated: false,
            faceCount: 12,
            wallP1: 20,
            wallP5: 20,
            overhangArea: 400,
            sourceUnits: null,
            objectCount: 1,
          }),
        ]
      );
      return { canonicalKey };
    }

    await test("requote parçaları YENİ anahtarlarla kopyalar, analizi taşır", async () => {
      const { canonicalKey } = await markAnalyzed(partCFdm);
      // Kaynakta ADMİNİN verdiği bir manuel fiyat var: o fiyat kaynağın
      // kataloğuna ve geçerlilik penceresine aitti, kopyaya geçmemeli.
      await admin.query("UPDATE quote_parts SET manual_unit_price_kurus = 99900 WHERE id = $1", [
        partCFdm,
      ]);
      const [source] = await loadQuoteParts(quoteC.id);

      const created = await requote(await loadAccess(quoteC.id, userId));
      assert.match(created.number, /^T-\d{6,}$/);
      assert.notEqual(created.number, quoteC.number);

      const [fresh] = await db
        .select()
        .from(quotes)
        .where(eq(quotes.number, created.number))
        .limit(1);
      assert.equal(fresh.sourceQuoteId, quoteC.id);
      assert.ok(
        fresh.snapshotTakenAt.getTime() > source.createdAt.getTime(),
        "yeniden teklif BUGÜNÜN kataloğunu dondurur"
      );

      const copies = await loadQuoteParts(fresh.id);
      assert.equal(copies.length, 1);
      const copy = copies[0];
      assert.equal(copy.analysisStatus, "ready", "analiz kopyalanır, yeniden çalışmaz");
      assert.deepEqual(copy.geometry, source.geometry);
      assert.equal(copy.sourceSha256, source.sourceSha256);
      assert.equal(copy.uploadId, null, "tekil yükleme kaydı kopyalanmaz");
      assert.notEqual(copy.sourceKey, source.sourceKey, "dosya YENİ anahtara kopyalandı");
      assert.notEqual(copy.canonicalStlKey, canonicalKey);
      for (const key of [copy.sourceKey, copy.canonicalStlKey!]) {
        assert.ok(key.startsWith(`quote-parts/${copy.id}/`), `kopya kendi klasöründe: ${key}`);
        assert.ok(fs.existsSync(path.join(uploads, key)), `kopya diskte: ${key}`);
      }
      assert.equal(copy.manualUnitPriceKurus, null, "manuel fiyat kopyaya GEÇMEZ");
      // Kaynak dosya DURUYOR: kopyalama taşıma değildir.
      assert.ok(fs.existsSync(path.join(uploads, source.sourceKey)));
      const remaining = await loadQuoteParts(quoteC.id);
      assert.equal(remaining.length, 1, "kaynak teklif değişmedi");
      assert.equal(remaining[0].manualUnitPriceKurus, 99_900, "kaynağın manuel fiyatı duruyor");
    });

    // ─── Kütüphaneden parça ekleme ──────────────────────────────────────────

    await test("importParts kütüphane parçasını kopyalar, yabancıya kapalıdır", async () => {
      const quoteD = await createQuote({ userId, anonymousId: null, termsAccepted: true });
      const imported = await importParts(
        await loadAccess(quoteD.id, userId),
        [partCFdm],
        userId
      );
      assert.equal(imported, 1);
      const [copy] = await loadQuoteParts(quoteD.id);
      assert.equal(copy.analysisStatus, "ready");
      assert.ok(copy.sourceKey.startsWith(`quote-parts/${copy.id}/`));
      assert.ok(fs.existsSync(path.join(uploads, copy.sourceKey)));

      // Başka bir kullanıcının kimliğiyle aynı parça: kaynak sahipliği tutmaz.
      await assert.rejects(
        importParts(await loadAccess(quoteD.id, userId), [partCFdm], randomUUID()),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 404 &&
          err.code === "part_not_found"
      );
      assert.equal((await loadQuoteParts(quoteD.id)).length, 1, "reddedilen istek satır bırakmadı");
    });

    // ─── Bildirimler ────────────────────────────────────────────────────────

    const customerEmail = `teklif-${userId}@ornek.test`;

    /** Zilin bu türden kaç satırı var (talep uçları bildirimi `void` ile atar). */
    const bellCount = async (type: string): Promise<number> =>
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM customer_notifications WHERE user_id = $1 AND type = $2",
          [userId, type]
        )
      ).rows[0].n as number;

    await test("inceleme talebi müşteriye ve admine yazar, gövdeler TUTAR taşımaz", async () => {
      const before = await bellCount("quote_review_requested");
      sentMail.length = 0;
      await notifyReviewRequested(quoteB.id);

      const toCustomer = sentMail.filter((m) => m.to === customerEmail);
      const toAdmin = sentMail.filter((m) => m.to !== customerEmail);
      assert.equal(toCustomer.length, 1, "müşteri bilgilendirildi");
      assert.equal(toAdmin.length, 1, "admin sıraya alındı");
      for (const mail of sentMail) {
        assert.match(mail.subject, new RegExp(quoteB.number), "konu teklif numarasını taşır");
        assert.match(
          mail.html,
          new RegExp(`/teklif/${quoteB.number}`),
          "gövde tutar yerine teklife BAĞLANTI verir"
        );
        assert.doesNotMatch(
          mail.html,
          /₺|\bTL\b|kuruş/i,
          "bildirim tutar taşımaz (sayfadaki fiyattan bağımsız olarak eskir)"
        );
      }

      assert.equal(
        await bellCount("quote_review_requested"),
        before + 1,
        "uygulama içi bildirim de düştü"
      );
    });

    await test("satış hatırlatması TİCARİ İLETİ İZNİ ister, süre dolumu istemez", async () => {
      sentMail.length = 0;
      await notifyQuoteAbandoned(quoteB.id);
      assert.equal(sentMail.length, 0, "izinsiz terk hatırlatması gönderilmez (ETK 6563)");

      await notifyQuoteExpiring(quoteB.id);
      assert.equal(sentMail.length, 1, "süre dolumu İŞLEMSELDİR, izin aranmaz");

      await admin.query("UPDATE users SET marketing_consent = true WHERE id = $1", [userId]);
      await notifyQuoteAbandoned(quoteB.id);
      assert.equal(sentMail.length, 2, "izin verilince hatırlatma gider");
      await admin.query("UPDATE users SET marketing_consent = false WHERE id = $1", [userId]);
    });

    await test("bildirim SMTP çökse de fırlatmaz, arızayı GÜNLÜĞE yazar", async () => {
      const SMTP = createRequire(import.meta.url)("nodemailer/lib/smtp-transport") as {
        prototype: { send(mail: unknown, callback: (e: Error | null) => void): void };
      };
      const working = SMTP.prototype.send;
      SMTP.prototype.send = (_mail, callback) => callback(new Error("SMTP kapalı"));
      // Yutma SESSİZ DEĞİLDİR: beklenen günlük satırları burada iddiaya
      // dönüşür (ve testin çıktısını kirletmez).
      const logged: string[] = [];
      const realError = console.error;
      console.error = (...args: unknown[]) => void logged.push(String(args[0]));
      try {
        // Çağıranın işlemi (talep kaydı, mesaj yazımı) bildirime rehin değildir.
        await notifyQuoteMessage(quoteB.id, "customer");
        await notifyReviewRequested(quoteB.id);
      } finally {
        console.error = realError;
        SMTP.prototype.send = working;
      }
      assert.deepEqual(logged, [
        "[quote-notify] notifyQuoteMessage başarısız (ölümcül değil)",
        "[quote-notify] notifyReviewRequested başarısız (ölümcül değil)",
      ]);
    });

    // ─── Sohbet ─────────────────────────────────────────────────────────────

    await test("sohbet: okunmamış KARŞI tarafta birikir, okundu işareti yalnız onu düşürür", async () => {
      await createQuoteMessage({
        quoteId: quoteB.id,
        sender: "customer",
        senderUserId: userId,
        body: "Bu parçayı üç gün içinde teslim alabilir miyim?",
      });
      let customerView = await listQuoteMessages(quoteB.id, "customer");
      assert.equal(customerView.messages.length, 1);
      assert.equal(customerView.messages[0].mine, true);
      assert.equal(customerView.unreadCount, 0, "kendi mesajı okunmamış sayılmaz");

      let adminView = await listQuoteMessages(quoteB.id, "admin");
      assert.equal(adminView.unreadCount, 1, "müşterinin mesajı admin kuyruğuna düştü");
      assert.equal(adminView.messages[0].mine, false);

      await createQuoteMessage({
        quoteId: quoteB.id,
        sender: "admin",
        senderEmail: "ekip@ornek.test",
        body: "Üç gün için ekspres kademesi gerekiyor.",
      });
      customerView = await listQuoteMessages(quoteB.id, "customer");
      assert.deepEqual(
        customerView.messages.map((m) => m.senderType),
        ["customer", "admin"],
        "mesajlar zaman sırasında gelir"
      );
      assert.equal(customerView.unreadCount, 1);

      await markQuoteMessagesRead(quoteB.id, "customer");
      assert.equal((await listQuoteMessages(quoteB.id, "customer")).unreadCount, 0);
      adminView = await listQuoteMessages(quoteB.id, "admin");
      assert.equal(adminView.unreadCount, 1, "müşterinin okuması ADMİN kuyruğunu temizlemez");

      await markQuoteMessagesRead(quoteB.id, "admin");
      assert.equal((await listQuoteMessages(quoteB.id, "admin")).unreadCount, 0);
    });

    await test("sohbet: iletişim bilgisi işaretlenir, bozuk gövde ve ek dosya reddedilir", async () => {
      await createQuoteMessage({
        quoteId: quoteB.id,
        sender: "customer",
        senderUserId: userId,
        body: "Bana 0532 111 22 33 numarasından ulaşın.",
      });
      const last = await admin.query(
        "SELECT flagged FROM quote_messages WHERE quote_id = $1 ORDER BY created_at DESC LIMIT 1",
        [quoteB.id]
      );
      assert.equal(last.rows[0].flagged, true, "platform dışına taşıma sezgisi işaretledi");

      const rejects = (body: string, file: File | null, code: string) =>
        assert.rejects(
          createQuoteMessage({ quoteId: quoteB.id, sender: "customer", body, file }),
          (err: unknown) =>
            err instanceof QuoteServiceError && err.status === 400 && err.code === code
        );
      await rejects("   ", null, "empty_message");
      await rejects("x".repeat(MAX_MESSAGE_LENGTH + 1), null, "message_too_long");
      // Teknik etiket (INVALID_IMAGE) değil, TÜRKÇE tek cümle görünür.
      await rejects(
        "Çizim ekte.",
        new File([Buffer.from("%PDF-1.4 sahte")], "cizim.pdf", { type: "application/pdf" }),
        "invalid_attachment"
      );

      const [{ n }] = (
        await admin.query(
          "SELECT count(*)::int AS n FROM quote_messages WHERE quote_id = $1",
          [quoteB.id]
        )
      ).rows;
      assert.equal(n, 3, "reddedilen istekler satır bırakmadı");
    });

    await test("sohbet tablosu yokken 500 değil, TÜRKÇE bir kapalı kapı (42P01)", async () => {
      await admin.query(`ALTER TABLE ${namespace}.quote_messages RENAME TO quote_messages_yok`);
      try {
        // Okuma: teklif sayfası sohbetsiz de açılabilmeli.
        assert.deepEqual(await listQuoteMessages(quoteB.id, "customer"), {
          messages: [],
          unreadCount: 0,
        });
        // İşaretleme: okunacak bir şey yoksa sessizce geçer.
        await markQuoteMessagesRead(quoteB.id, "customer");
        await assert.rejects(
          createQuoteMessage({
            quoteId: quoteB.id,
            sender: "customer",
            senderUserId: userId,
            body: "Tablo yokken yazılan mesaj.",
          }),
          (err: unknown) =>
            err instanceof QuoteServiceError &&
            err.status === 503 &&
            err.code === "chat_unavailable" &&
            /etkinleştirilmedi/.test(err.message)
        );
      } finally {
        await admin.query(`ALTER TABLE ${namespace}.quote_messages_yok RENAME TO quote_messages`);
      }
    });

    // ─── STEP: sunucu kapısı ve birim kilidi ────────────────────────────────

    // İki kapı, iki AYRI rol. Sunucu (`addPartFromUpload`) KURAL koyar:
    // bayrak kapalıyken gövdede gelen `.step` 400 alır. İstemci
    // (`acceptedFormats` → dropzone `accept`) yalnız KOLAYLIKTIR ve gövde elle
    // kurulabilir. Bu yüzden kapının sınandığı yer burasıdır.
    //
    // Kendi kullanıcısı ve kendi teklifi: yukarıdaki müşteri listesi testleri
    // `userId`nin teklif ve parça SAYILARINI birebir iddia ediyor.
    const stepUserId = randomUUID();
    let stepQuote = { id: "", number: "" };
    let stepPartId = "";
    let meshPartId = "";

    await test("bayrak KAPALI: gövdede gelen .step 400 step_disabled alır", async () => {
      await admin.query(`INSERT INTO users (id, email, full_name) VALUES ($1, $2, $3)`, [
        stepUserId,
        `step-${stepUserId}@ornek.test`,
        "STEP Müşterisi",
      ]);
      // Varsayılan zaten `false`; yine de AÇIKÇA kapatılır — bayrak okuması 10
      // saniye Redis'te önbelleklenir ve önceki bir koşunun artığı bu iddiayı
      // sessizce yeşile çevirebilirdi (`setFlag` önbelleği siler).
      await setFlag("quote_step_enabled", false, "test");
      stepQuote = await createQuote({
        userId: stepUserId,
        anonymousId: null,
        termsAccepted: true,
      });
      const access = await loadAccess(stepQuote.id, stepUserId);
      const staged = await stage("step-kapali", `u:${stepUserId}`, stepFixture);
      await assert.rejects(
        addPartFromUpload(access, { uploadId: staged, fileName: "govde.step" }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 400 &&
          err.code === "step_disabled" &&
          /STEP/.test(err.message)
      );
      // SESSİZ YOK SAYMA YOK: ne satır açıldı ne de "eklendi" gibi bir cevap
      // döndü. Müşteri teklifinde olmayan bir parçayı beklemeye başlamaz.
      assert.equal(await livePartCount(stepQuote.id), 0, "reddedilen .step satır bıraktı");
    });

    await test("bayrak KAPALI + admin oturumu: iç test kapısı açık", async () => {
      // `quoteApiEnabled` deseni: lansman öncesi iç testi bayrağı açmadan
      // yapılabilir. Yükleme admin anahtarıyla sahnelenir, çünkü
      // `/api/uploads/chunk` çağıranın İLK eşleşen kimliğini yazar.
      const adminKey = uploadOwnerKey({ role: "admin", userId: "admin@ornek.test" });
      const staged = await stage("step-admin", adminKey, stepFixture);
      const base = await loadAccess(stepQuote.id, null);
      const added = await addPartFromUpload(
        {
          ...base,
          viewer: {
            canSeePrices: true,
            canEdit: true,
            isOwner: false,
            isShare: false,
            isAdmin: true,
            isTeam: false,
            teamRole: null,
          },
          uploadOwnerKeys: [adminKey],
        },
        { uploadId: staged, fileName: "admin.step" }
      );
      const [part] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, added.partId))
        .limit(1);
      assert.equal(part.sourceFormat, "step");
      // `.stp` de olsa aynı anahtar, aynı dosya adı: analiz `source.step`i arar.
      assert.ok(part.sourceKey.endsWith("/source.step"), `kaynak adı: ${part.sourceKey}`);
      await deletePart(await loadAccess(stepQuote.id, stepUserId), added.partId);
    });

    await test("bayrak AÇIK: .stp yüklemesi de tek biçim anahtarına düşer", async () => {
      await setFlag("quote_step_enabled", true, "test");
      const access = await loadAccess(stepQuote.id, stepUserId);
      const staged = await stage("step-acik", `u:${stepUserId}`, stepFixture);
      const added = await addPartFromUpload(access, { uploadId: staged, fileName: "govde.stp" });
      stepPartId = added.partId;
      const [part] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, stepPartId))
        .limit(1);
      assert.equal(part.sourceFormat, "step", ".stp başka bir biçim anahtarına düştü");
      assert.ok(part.sourceKey.endsWith("/source.step"), `kaynak adı: ${part.sourceKey}`);
      assert.equal(part.units, "mm", "STEP parçası mm ile doğmadı");
      assert.ok(fs.existsSync(path.join(uploads, part.sourceKey)), "kaynak dosya diskte yok");
      // Karşılaştırma parçası: aynı teklifte bir mesh parçası.
      const meshStaged = await stage("step-mesh", `u:${stepUserId}`, stlFixture);
      meshPartId = (await addPartFromUpload(access, { uploadId: meshStaged, fileName: "mesh.stl" }))
        .partId;
    });

    const unitsOf = async (partId: string) =>
      (await admin.query("SELECT units FROM quote_parts WHERE id = $1", [partId])).rows[0]
        .units as string;

    await test("STEP parçasında units:'cm' 400 invalid_option alır, gövdesi TÜRKÇE", async () => {
      // Bu ret "daha anlaşılır mesaj" değil, 500'Ü ENGELLEYEN TEK ŞEYDİR:
      // olmasaydı UPDATE 0070'in CHECK'ine takılıp 23514 ile düşer ve rota
      // BOŞ GÖVDELİ bir 500 döndürürdü.
      await assert.rejects(
        updatePart(await loadAccess(stepQuote.id, stepUserId), stepPartId, { units: "cm" }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 400 &&
          err.code === "invalid_option" &&
          /STEP/.test(err.message) &&
          /değiştirilemez/.test(err.message)
      );
      assert.equal(await unitsOf(stepPartId), "mm", "reddedilen yama yine de yazıldı");
    });

    await test("aynı yama bir .stl parçasında GEÇER (kilit yalnız STEP'i bağlar)", async () => {
      await updatePart(await loadAccess(stepQuote.id, stepUserId), meshPartId, { units: "cm" });
      assert.equal(await unitsOf(meshPartId), "cm");
      await updatePart(await loadAccess(stepQuote.id, stepUserId), meshPartId, { units: "mm" });
    });

    await test("STEP'te ölçek SERBEST, mm'yi yeniden yazmak da serbest", async () => {
      // Tasarım §1.4: kilitli olan BİRİM, ölçek değil — müşteri parçayı
      // büyütüp küçültmeye devam eder.
      await updatePart(await loadAccess(stepQuote.id, stepUserId), stepPartId, { scale: 1.5 });
      const [scaled] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, stepPartId))
        .limit(1);
      assert.equal(scaled.scale, 1.5);
      // Kilit, DB CHECK'inin (`source_format <> 'step' OR units = 'mm'`) TS
      // tarafındaki EŞİDİR: CHECK'in kabul ettiği tek değer olan `mm` burada da
      // geçer (hiçbir şeyi değiştirmeyen bir yamayı reddetmek, toplu "hepsini
      // mm yap" yamasını STEP'li bir seçimde kırardı).
      await updatePart(await loadAccess(stepQuote.id, stepUserId), stepPartId, { units: "mm" });
      assert.equal(await unitsOf(stepPartId), "mm");
    });

    await test("TOPLU yama: STEP varsa reddedilir ve STL'in birimi DEĞİŞMEZ", async () => {
      // Bu vaka olmadan tek parça ucu kapalı, toplu uç AÇIK kalırdı. Sıra
      // bilerek "önce STL": ret yalnız veritabanından gelse STL'in yaması
      // ÖNCE uygulanmış olurdu ve işlemin geri alınması sınanmış olmazdı.
      await assert.rejects(
        bulkUpdateParts(await loadAccess(stepQuote.id, stepUserId), [meshPartId, stepPartId], {
          units: "cm",
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 400 &&
          err.code === "invalid_option"
      );
      assert.equal(await unitsOf(meshPartId), "mm", "toplu yama yarı uygulanmış kaldı");
      assert.equal(await unitsOf(stepPartId), "mm");
      await setFlag("quote_step_enabled", false, "test");
    });

    await test("bayrak kapansa da YÜKLENMİŞ STEP parçası teklifte kalır", async () => {
      // Geri dönüş planı (tasarım §5): bayrak yalnız YENİ yüklemeyi durdurur.
      const view = await loadPresentedQuote(await loadAccess(stepQuote.id, stepUserId));
      assert.deepEqual(view.catalog.acceptedFormats, ["stl", "obj", "3mf"]);
      const step = view.parts.find((p) => p.id === stepPartId);
      assert.ok(step, "yüklenmiş STEP parçası görünümden düştü");
      assert.equal(step.sourceFormat, "step");
      assert.equal(step.config.units, "mm");
    });

    // ─── Döviz kurunun DONDURULMASI (Faz 2b · D3) ───────────────────────────
    //
    // Dört yazım yeri var ve ikisi kur ÇEKER, biri KOPYALAR, biri de hiç
    // yazmaz. Ayrımın sebebi tek cümle: müşteri teklifi açtığı gün gördüğü
    // rakamı görmeye devam etmeli, ama YENİ bir fiyat YENİ bir kur demektir.

    const { istanbulDateKey } = await import("../src/lib/config/business-days");
    const { upsertFxBulletin } = await import("../src/lib/services/fx-rates");

    /** Teklifin DB'deki donmuş kur kümesi. */
    const frozenFx = async (quoteId: string) => {
      const [row] = await db
        .select({ fx: quotes.fxSnapshot })
        .from(quotes)
        .where(eq(quotes.id, quoteId))
        .limit(1);
      return row?.fx ?? null;
    };
    const eurMicro = (snapshot: Awaited<ReturnType<typeof frozenFx>>) =>
      snapshot?.rates.find((r) => r.currency === "EUR")?.microTryPerUnit ?? null;
    /** Bülten TAZE olmak zorunda: bayat kur `loadActiveFxSnapshot`ta null olur. */
    const bulletinFor = (date: string, eur: number) => ({
      bulletinDate: date,
      rates: [
        { currency: "EUR" as const, microTryPerUnit: eur, bulletinUnit: 1 },
        { currency: "USD" as const, microTryPerUnit: 41_523_100, bulletinUnit: 1 },
        { currency: "GBP" as const, microTryPerUnit: 55_903_400, bulletinUnit: 1 },
      ],
    });
    const YESTERDAY = istanbulDateKey(new Date(Date.now() - 86_400_000));
    const TODAY = istanbulDateKey(new Date());

    let fxQuoteId = "";
    await test("KUR YOKKEN `fx_snapshot` NULL kalır (yarım snapshot yazılmaz)", async () => {
      const { rows } = await admin.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM fx_rates"
      );
      assert.equal(Number(rows[0].n), 0, "test boş kur tablosuyla başlamalı");
      const empty = await createQuote({ userId, anonymousId: null, termsAccepted: true });
      assert.equal(await frozenFx(empty.id), null);
    });

    await test("createQuote bülteni DONDURUR (tarih + kur DB'deki değerlerle birebir)", async () => {
      assert.equal(await upsertFxBulletin(bulletinFor(YESTERDAY, 48_000_000)), 3);
      const created = await createQuote({ userId, anonymousId: null, termsAccepted: true });
      fxQuoteId = created.id;
      const snapshot = await frozenFx(fxQuoteId);
      assert.ok(snapshot, "kur varken snapshot yazılmalıydı");
      assert.equal(snapshot.version, 1);
      assert.equal(snapshot.source, "tcmb");
      assert.equal(snapshot.bulletinDate, YESTERDAY);
      assert.equal(eurMicro(snapshot), 48_000_000);
    });

    await test("DONDURMA GERÇEKTEN DONMUŞ: yeni bülten MEVCUT teklifi oynatmaz", async () => {
      assert.equal(await upsertFxBulletin(bulletinFor(TODAY, 49_000_000)), 3);
      const snapshot = await frozenFx(fxQuoteId);
      assert.equal(snapshot?.bulletinDate, YESTERDAY, "donmuş tarih değişti");
      assert.equal(eurMicro(snapshot), 48_000_000, "donmuş kur değişti");
      // D2'nin katalog bandı regresyonunun UÇTAN UCA hâli: kur yazımı
      // `catalogUpdatedAt()`a girmediği için müşteriye her sabah "Katalog
      // güncellendi — yeniden fiyatla" bandı yanmaz.
      const view = await loadPresentedQuote(await loadAccess(fxQuoteId, userId));
      assert.equal(view.catalogChangedSinceSnapshot, false, "kur yazımı bandı yaktı");
    });

    await test("repriceQuote kuru TAZELER (yeni fiyat, yeni kur)", async () => {
      await repriceQuote(await loadAccess(fxQuoteId, userId));
      const snapshot = await frozenFx(fxQuoteId);
      assert.equal(snapshot?.bulletinDate, TODAY);
      assert.equal(eurMicro(snapshot), 49_000_000);
    });

    let fxSplitId = "";
    await test("splitByTechnology ebeveynin kurunu KOPYALAR, yeniden ÇEKMEZ", async () => {
      const parent = await createQuote({ userId, anonymousId: null, termsAccepted: true });
      fxSplitId = parent.id;
      await addPartFromUpload(await loadAccess(parent.id, userId), {
        uploadId: await stage("fixture-fx1", `u:${userId}`),
        fileName: "fx-fdm.stl",
      });
      const second = await addPartFromUpload(await loadAccess(parent.id, userId), {
        uploadId: await stage("fixture-fx2", `u:${userId}`),
        fileName: "fx-sla.stl",
      });
      await updatePart(await loadAccess(parent.id, userId), second.partId, {
        technologyKey: "sla",
      });
      const parentFx = await frozenFx(parent.id);
      assert.ok(parentFx);

      // Bölmeden HEMEN ÖNCE kur satırı değişir: yeniden çeken bir uygulama
      // burada çocuğa 51.000.000 yazardı ve müşteri aynı teklifin iki
      // parçasında İKİ FARKLI döviz rakamı görürdü.
      await admin.query(
        "UPDATE fx_rates SET micro_try_per_unit = 51000000 WHERE currency = 'EUR' AND bulletin_date = $1",
        [TODAY]
      );
      const { newQuoteNumbers } = await splitByTechnology(await loadAccess(parent.id, userId));
      assert.equal(newQuoteNumbers.length, 1);
      const [child] = await db
        .select()
        .from(quotes)
        .where(eq(quotes.number, newQuoteNumbers[0]))
        .limit(1);
      assert.deepEqual(child.fxSnapshot, parentFx, "çocuk kendi kurunu çekmiş");
      assert.equal(eurMicro(await frozenFx(parent.id)), 49_000_000, "ebeveyn de oynamamalı");
    });

    await test("requote kuru TAZELER (yeni teklif, yeni kur)", async () => {
      const created = await requote(await loadAccess(fxSplitId, userId));
      const [fresh] = await db
        .select()
        .from(quotes)
        .where(eq(quotes.number, created.number))
        .limit(1);
      assert.equal(fresh.fxSnapshot?.bulletinDate, TODAY);
      assert.equal(eurMicro(fresh.fxSnapshot), 51_000_000, "yeniden teklif eski kuru kopyaladı");
      assert.equal(eurMicro(await frozenFx(fxSplitId)), 49_000_000, "kaynak teklif oynadı");
    });

    await test("BAYRAK açıkken donmuş kur müşteriye AYNEN gider", async () => {
      await setFlag("quote_fx_display_enabled", true, "test");
      try {
        const view = await loadPresentedQuote(await loadAccess(fxQuoteId, userId));
        assert.equal("display" in view, true, "bayrak açık ama anahtar gelmedi");
        assert.equal(view.display?.snapshot.bulletinDate, TODAY);
        assert.equal(view.display?.currencies[0], "TRY");
      } finally {
        await setFlag("quote_fx_display_enabled", false, "test");
      }
      // Bayrak kapanınca anahtar TEKRAR yok olur; donmuş satır DB'de zararsız
      // kalır (kapatma yolu deploy gerektirmez, tek DB satırıdır).
      const off = await loadPresentedQuote(await loadAccess(fxQuoteId, userId));
      assert.equal("display" in off, false);
      assert.ok(await frozenFx(fxQuoteId), "bayrak kapandı diye donmuş kur silinmemeli");
    });

    await test("KAPATMA GERİ ALINABİLİR: bayrak yeniden açılınca AYNI rakam gelir", async () => {
      // BU BİR ÖZELLİKTİR, HATA DEĞİL. Teklif kendi anlık görüntüsüyle
      // BAĞLAYICIDIR: bayrak bir gün kapanıp yeniden açıldığında müşterinin
      // gördüğü rakamın DEĞİŞMESİ, gördüğü şeye güvenilmemesi demek olurdu.
      // Kapatma yolu bu yüzden donmuş satıra DOKUNMAZ — tek bir
      // `platform_flags` satırıdır, dağıtım bile gerektirmez.
      const read = async () => {
        const view = await loadPresentedQuote(await loadAccess(fxQuoteId, userId));
        return view.display ?? null;
      };
      try {
        await setFlag("quote_fx_display_enabled", true, "test");
        const first = await read();
        assert.ok(first, "birinci açılışta kur gelmedi");

        await setFlag("quote_fx_display_enabled", false, "test");
        assert.equal(await read(), null, "kapalı bayrakta kur hâlâ gidiyor");

        // Kapalı geçen sürede kur OYNADI: yeniden açılış bugünün kurunu değil
        // TEKLİFİN kurunu göstermek zorunda. Bu satır olmasa vaka "hiçbir şey
        // değişmedi" diye bedava yeşil kalırdı.
        await admin.query(
          "UPDATE fx_rates SET micro_try_per_unit = 52000000 WHERE currency = 'EUR' AND bulletin_date = $1",
          [TODAY]
        );

        await setFlag("quote_fx_display_enabled", true, "test");
        const second = await read();
        assert.deepEqual(second, first, "bayrak yeniden açılınca müşteri BAŞKA bir rakam gördü");
        assert.equal(eurMicro(second?.snapshot ?? null), 49_000_000, "teklifin kendi kuru oynadı");
      } finally {
        // Üretimdeki çıkış durumu KAPALI: sonraki turlar bayat bir Redis
        // önbelleğinden açık bayrak devralmasın.
        await setFlag("quote_fx_display_enabled", false, "test");
      }
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
