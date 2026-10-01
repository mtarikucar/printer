/**
 * TAKIM GÖRÜNÜRLÜĞÜ — GERÇEK yolla testi: izole 55433 şeması, gerçek
 * `customer_teams`/`customer_team_members` satırları, gerçek erişim kabuğu,
 * gerçek bayrak tablosu, gerçek SSE ucu.
 *
 * ─── BU DOSYANIN KONUSU TEK BİR ŞEY: KİM GÖRÜYOR ────────────────────────────
 *
 * `scripts/test-quote-api.ts` matrisi SAF çekirdek üzerinde çiviliyor (K1/K2/K3).
 * Burada ölçülen şey, o çekirdeğe gerçeği TAŞIYAN kabuk:
 *
 *   1. Takım teklifi, üye oturumuyla `resolveQuoteAccess`ten FİYATLI dönüyor ve
 *      takımın ADI tek sorguyla geliyor (`access.team`). Yanındaki
 *      `access.teamId` SATIRIN takımıdır, bir HAK değil: paylaşım
 *      izleyicisinde ve bayrak kapalıyken de DOLU, `team` ise NULL.
 *   2. Üye OLMAYAN 404 alıyor — takımın varlığı kimseye hak vermiyor.
 *   3. Üyelik satırı SİLİNDİĞİ AN erişim kesiliyor (önbellek yok, gecikme yok).
 *   4. `quotes_team_requires_user_chk` GERÇEKTEN duruyor: anonim teklife
 *      `team_id` yazılamıyor (23514). Dal sırası argümanı buna dayanıyor.
 *   5. Bayrak KAPALIYKEN üyelik sorgusu HİÇ yapılmıyor — bu kez gerçek havuz
 *      üzerinde sayılarak.
 *   6. SSE ucu (`resolveQuoteViewer`dan GEÇMEYEN ikinci kapı) aynı cevabı
 *      veriyor: üye 200, çıkarılmış üye 404, PAYLAŞIM TOKEN'I 404.
 *
 * Taklit edilen TEK dış dünya müşteri oturumudur (`next/headers` bir istek
 * kapsamı olmadan okunamaz). Erişim çözümü, bayrak okuması, üyelik sorgusu,
 * sunum katmanı ve SSE rotası GERÇEK koddan geçer.
 *
 * Kullanıcının dev veritabanına (5432) ya da dev Redis'ine (6379) ASLA
 * bağlanmaz.
 *
 * Çalıştırma:
 *   npx tsx --env-file=<qa.env> scripts/test-quote-team-db.ts
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

const root = path.resolve(import.meta.dirname, "..");
const namespace = `quote_team_${Date.now()}_${process.pid}`;
const ddlOut = fs.mkdtempSync(path.join(os.tmpdir(), "quote-team-ddl-"));
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-team-uploads-"));

// Depolama kökü MODÜL YÜKLENİRKEN okunuyor (storage.ts) — her `import`tan önce.
process.env.UPLOAD_DIR = uploadDir;
process.env.FILES_SIGNING_SECRET = "qa-signing-secret";
process.env.AUTH_SECRET = "qa-auth-secret-0123456789abcdef0123456789";
process.env.ADMIN_EMAIL = "qa-admin@example.test";
process.env.NEXT_PUBLIC_APP_URL = "https://qa.example.test";

const admin = new pg.Client({ connectionString });
let pool: pg.Pool | undefined;
let checks = 0;

const require_ = createRequire(import.meta.url);

/**
 * Müşteri oturumu: `resolveQuoteAccess` ve SSE rotası çerezleri `next/headers`
 * üzerinden okuyor ve bir istek kapsamı olmadan çağrılamaz. Taklit YALNIZ
 * oturum okumasıdır — erişim matrisi, bayrak kapısı ve üyelik sorgusu gerçek
 * koddan geçer. (`test-quote-framework-db.ts` ile aynı desen.)
 */
let session: { userId: string; email: string } | null = null;
{
  const filename = require_.resolve("../src/lib/services/customer-auth");
  require_.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: {
      getSessionUser: async () => session,
      getAnonymousId: async () => null,
    },
  } as NodeJS.Module;
}

const test = async (name: string, run: () => Promise<void>) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};

/**
 * GERÇEK havuz üzerinde sorgu sayacı: metni kaydeder ve sorguyu olduğu gibi
 * geçirir. `scripts/test-quote-cutover.ts` aynı değişmezi taklit edilmiş bir
 * havuzla ölçüyor; buradaki kopyası onu CANLI SQL üzerinde doğruluyor.
 */
function countQueries(needle: string): { get: () => number; restore: () => void } {
  const original = pg.Pool.prototype.query;
  let hits = 0;
  (pg.Pool.prototype as unknown as { query: unknown }).query = function counted(
    this: pg.Pool,
    ...args: unknown[]
  ) {
    const config = args[0];
    const text =
      typeof config === "string" ? config : String((config as { text?: string })?.text ?? "");
    if (text.includes(needle)) hits++;
    return (original as unknown as (...a: unknown[]) => unknown).apply(this, args);
  };
  return {
    get: () => hits,
    restore: () => {
      pg.Pool.prototype.query = original;
    },
  };
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
    // Katalog tohumu GERÇEK migration'dan gelir: `createQuote` aktif bir
    // katalog snapshot'ı olmadan teklif açamaz.
    const migration = fs.readFileSync(path.join(root, "drizzle/0064_instant_quotes.sql"), "utf8");
    for (const statement of migration
      .split("--> statement-breakpoint")
      .filter((s) => /\bINSERT INTO\b/.test(s))) {
      await admin.query(statement.replace(/"public"\./g, ""));
    }

    url.searchParams.set("options", `-c search_path=${namespace}`);
    process.env.DATABASE_URL = url.toString();

    const { db } = await import("../src/lib/db");
    pool = (db as typeof db & { $client: pg.Pool }).$client;
    const { eq } = await import("drizzle-orm");
    const { customerTeamMembers, customerTeams, quotes, users } = await import(
      "../src/lib/db/schema"
    );
    const { resolveQuoteAccess } = await import("../src/lib/services/quote-access");
    const { loadPresentedQuote } = await import("../src/lib/services/quote-service");
    const { createQuote } = await import("../src/lib/services/quote-service");
    const { setFlag } = await import("../src/lib/services/flags");
    const sse = await import("../src/app/api/realtime/quote/[id]/route");

    /**
     * Dönen şekil `getSessionUser()`in şeklidir (`userId`, `id` DEĞİL): taklit
     * oturum doğrudan buradan besleniyor ve `requestIdentity` yalnız `userId`
     * alanını okuyor — `id` yazmak sessizce `undefined` bir oturum üretirdi.
     */
    async function makeUser(label: string): Promise<{ userId: string; email: string }> {
      const userId = randomUUID();
      const email = `quote-team-${label}-${userId}@example.test`;
      await db.insert(users).values({ id: userId, email, fullName: `QA ${label}` });
      return { userId, email };
    }

    const owner = await makeUser("sahip");
    const member = await makeUser("uye");
    const outsider = await makeUser("yabanci");

    const [team] = await db
      .insert(customerTeams)
      .values({
        name: "QA Mühendislik A.Ş.",
        ownerUserId: owner.userId,
        kvkkNoticeVersion: "2026-09-22",
      })
      .returning({ id: customerTeams.id, memberCanCheckout: customerTeams.memberCanCheckout });
    assert.equal(team.memberCanCheckout, false, "para kapısı DAR doğmalı");

    await db
      .insert(customerTeamMembers)
      .values({ teamId: team.id, userId: owner.userId, role: "owner" });
    await db
      .insert(customerTeamMembers)
      .values({ teamId: team.id, userId: member.userId, role: "member" });

    // Teklifi SAHİP açar ve takıma bağlanır. `share_token` de yazılır: paylaşım
    // dalının SSE ucuna girmediğini ölçebilmek için gerekli.
    const shareToken = "t".repeat(32);
    const created = await createQuote({ userId: owner.userId, anonymousId: null, termsAccepted: true });
    await db
      .update(quotes)
      .set({ teamId: team.id, shareToken })
      .where(eq(quotes.id, created.id));

    /** SSE ucunu gerçek `Request` ile sürer; akışı hemen kapatır. */
    async function openStream(id: string, query = ""): Promise<number> {
      const response = await sse.GET(
        new Request(`https://qa.example.test/api/realtime/quote/${id}${query}`),
        { params: Promise.resolve({ id }) }
      );
      // Açık kalan bir okuyucu hem Redis abonesini hem heartbeat'i tutar.
      await response.body?.cancel();
      return response.status;
    }

    await setFlag("quote_teams_enabled", true, "qa");

    await test("takım teklifi ÜYEYE fiyatlı açılır ve takımın adı TEK sorguyla gelir", async () => {
      session = member;
      const access = await resolveQuoteAccess(created.id);
      assert.ok(access, "üye kendi takımının teklifini göremedi");
      assert.equal(access.viewer.isTeam, true);
      assert.equal(access.viewer.teamRole, "member");
      assert.equal(access.viewer.canSeePrices, true, "üye fiyat kapısının arkasında kaldı");
      assert.equal(access.viewer.canEdit, true);
      // `isOwner` ANLAMI değişmedi: üye KİŞİSEL sahip değildir.
      assert.equal(access.viewer.isOwner, false);
      assert.equal(access.team?.id, team.id);
      assert.equal(access.team?.name, "QA Mühendislik A.Ş.");
      assert.equal(access.team?.memberCanCheckout, false);
      // `teamId` SATIRIN takımı: rota katmanı ikinci bir sorgu açmasın diye
      // taşınıyor ve çekilen satırla aynı şeyi söylemek ZORUNDA.
      assert.equal(access.teamId, team.id);
      assert.equal(access.teamId, access.quote.teamId);

      // Ve bilgi sunum katmanına kadar gidiyor: `view.team` üyeye yazılıyor,
      // kimliği (`id`) gövdeye GİRMİYOR.
      const view = await loadPresentedQuote(access);
      assert.deepEqual(view.team, {
        name: "QA Mühendislik A.Ş.",
        role: "member",
        memberCanCheckout: false,
      });
      assert.ok(view.totals, "üye toplamları görmeli");
    });

    await test("takım DIŞINDAKİ kullanıcı 404 alır", async () => {
      session = outsider;
      assert.equal(await resolveQuoteAccess(created.id), null);
      // Paylaşım token'ı bugünkü hakkını verir (salt okunur), takım hakkını VERMEZ.
      const shared = await resolveQuoteAccess(created.id, { shareToken });
      assert.ok(shared, "paylaşım bağlantısı çalışmıyor");
      assert.equal(shared.viewer.isShare, true);
      assert.equal(shared.viewer.isTeam, false);
      assert.equal(shared.team, null);
      // `teamId` DOLU ama `team` NULL: alanın bir KAPI olmadığının kanıtı.
      // `teamId !== null` ile yazılmış bir kapı bu izleyiciye takım hakkı
      // verirdi; hak `team`/`viewer.isTeam` ile ölçülür. (Alan müşteri
      // gövdesine girmiyor: `view.team` yok, aşağıdaki satır onu ölçüyor.)
      assert.equal(shared.teamId, team.id);
      assert.equal("team" in (await loadPresentedQuote(shared)), false, "takım adı sızdı");
    });

    await test("SSE ucu: üye 200, sahip 200, paylaşım token'ı 404", async () => {
      session = member;
      assert.equal(await openStream(created.id), 200, "üye canlı tazelemeyi alamadı");
      session = owner;
      assert.equal(await openStream(created.id), 200);
      // Paylaşım görünümü DURAĞANDIR: token bu uca girmez (bugünkü kural).
      session = outsider;
      assert.equal(await openStream(created.id, `?t=${shareToken}`), 404);
      assert.equal(await openStream(created.id), 404);
    });

    await test("üyelik satırı silinince erişim ANINDA kesilir (önbellek yok)", async () => {
      await db
        .delete(customerTeamMembers)
        .where(eq(customerTeamMembers.userId, member.userId));
      session = member;
      assert.equal(await resolveQuoteAccess(created.id), null, "çıkarılmış üye hâlâ görüyor");
      assert.equal(await openStream(created.id), 404, "çıkarılmış üye hâlâ canlı akışta");
      // Kişisel sahip erişimini KAYBETMEZ: dal sırası (sahip → … → takım).
      session = owner;
      const ownerAccess = await resolveQuoteAccess(created.id);
      assert.equal(ownerAccess?.viewer.isOwner, true);
    });

    await test("bayrak KAPALIYKEN üyelik sorgusu hiç yapılmaz ve üye 404 alır", async () => {
      await db
        .insert(customerTeamMembers)
        .values({ teamId: team.id, userId: member.userId, role: "member" });
      await setFlag("quote_teams_enabled", false, "qa");
      session = member;
      const counter = countQueries("customer_team_members");
      try {
        assert.equal(
          await resolveQuoteAccess(created.id),
          null,
          "bayrak kapalıyken takım dalı hâlâ açık"
        );
        assert.equal(await openStream(created.id), 404);
        // Kişisel SAHİP bayrak kapalıyken de açar: `teamId` SATIRIN gerçeği
        // olduğu için DOLU gelir, `team` ise üyelik hiç okunmadığından NULL.
        // Yani geri dönüş planı bu alanı bir HAKKA çevirmiyor.
        session = owner;
        const ownerClosed = await resolveQuoteAccess(created.id);
        assert.equal(ownerClosed?.viewer.isTeam, false, "bayrak kapalıyken takım dalı çalıştı");
        assert.equal(ownerClosed?.teamId, team.id);
        assert.equal(ownerClosed?.team, null, "bayrak kapalıyken üyelik taşındı");
        session = member;
        assert.equal(counter.get(), 0, "bayrak kapalıyken üyelik sorgulandı");
      } finally {
        counter.restore();
      }
      await setFlag("quote_teams_enabled", true, "qa");
    });

    await test("quotes_team_requires_user_chk: anonim teklif takım teklifi OLAMAZ", async () => {
      // Dal sırası argümanının dayandığı kısıt: takım teklifinde `user_id`
      // DAİMA dolu, yani anonim dal ile takım dalı çakışamaz.
      const anon = await createQuote({
        userId: null,
        anonymousId: randomUUID(),
        termsAccepted: true,
      });
      await assert.rejects(
        db.update(quotes).set({ teamId: team.id }).where(eq(quotes.id, anon.id)),
        (err: unknown) => {
          const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
          assert.equal(code, "23514", `beklenen 23514, gelen ${String(code)}`);
          return true;
        }
      );
    });

    console.log(`${checks} quote team DB checks passed`);
  } finally {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end();
    fs.rmSync(ddlOut, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
