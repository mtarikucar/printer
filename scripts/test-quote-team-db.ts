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
import { createHash, randomUUID } from "node:crypto";
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
// Oran limiti anahtarı `x-real-ip`ten okunabilsin diye (bkz. `req()` yorumu).
// `src/lib/env.ts` bu değeri MODÜL YÜKLENİRKEN okuyor — her `import`tan önce.
process.env.TRUSTED_PROXY_IPS = "127.0.0.1";

/** Tur başına rastgele istemci IP'si: QA Redis'teki oran limiti kovaları taze olsun. */
const clientIp = `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${
  Math.floor(Math.random() * 256)
}`;

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

/**
 * Takım bildirimleri TAKLİT EDİLİR ve bunun İKİ sebebi var:
 *
 * 1. **Ham davet token'ı yalnız e-posta gövdesinde yaşıyor** (DB'de sha256'sı
 *    var). Kabul zincirini sürebilmenin tek dürüst yolu, onu gerçek tüketicisinin
 *    aldığı yerden okumaktır — yani bu taklit aynı zamanda "token'ın TEK
 *    tüketicisi e-posta" iddiasının ölçüm noktasıdır.
 * 2. SMTP'ye bağlanmak testi ağa bağlardı.
 *
 * Taklit edilen şey YALNIZ postanın GÖNDERİMİDİR: kapılar, servis, denetim
 * satırı ve cevap gövdeleri gerçek koddan geçer.
 */
const sentEmails: Array<{ kind: string; args: Record<string, unknown> }> = [];
{
  const filename = require_.resolve("../src/lib/services/customer-team-notify");
  const record = (kind: string) => async (args: Record<string, unknown>) => {
    sentEmails.push({ kind, args });
  };
  require_.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: {
      teamInvitePath: (token: string) => `/takim/davet/${encodeURIComponent(token)}`,
      sendTeamInviteEmail: record("invite"),
      sendTeamRoleChangedEmail: record("role"),
      sendTeamMemberRemovedEmail: record("removed"),
      sendTeamOwnershipTransferredEmail: record("ownership"),
    },
  } as NodeJS.Module;
}

/**
 * Teklif BİLDİRİMLERİ taklit edilir — tek sebebi SMTP: T-4'ün sohbet vakası
 * gerçek `createQuoteMessage`i çağırıyor ve o da müşteriye e-posta atmaya
 * çalışıyor (127.0.0.1:587). Gerçek kod bu hatayı yutup günlüğe yazıyor, yani
 * vaka yine yeşil kalırdı; taklit edilen şey testi ağa bağlayan ve çıktıyı
 * kirleten tek satır. Bildirimin KENDİSİ başka bir dosyanın konusu
 * (`scripts/test-quote-service-db.ts` zili ve gövdeleri ölçüyor).
 */
{
  const filename = require_.resolve("../src/lib/services/quote-notify");
  const noop = async () => {};
  require_.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: {
      notifyReviewRequested: noop,
      notifyManualQuoteReady: noop,
      notifyTargetDecision: noop,
      notifyQuoteExpiring: noop,
      notifyQuoteAbandoned: noop,
      notifyFrameworkReleaseWindow: noop,
      notifyQuoteMessage: noop,
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
    // `next/server` ve saf çekirdek TEMBEL yüklenir: yukarıdaki ortam
    // değişkenleri (UPLOAD_DIR, TRUSTED_PROXY_IPS) modül yüklenirken okunuyor.
    const { NextRequest } = await import("next/server");
    const { TEAM_KVKK_NOTICE_VERSION } = await import("../src/lib/config/quote-team");

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

    // ═══ DAVET YAŞAM DÖNGÜSÜ (T-3) ═══════════════════════════════════════════
    //
    // Buradan aşağısı GERÇEK UÇLARDAN geçer (`src/app/api/customer/team/**`):
    // bayrak kapısı, oturum kapısı, oran limitleri, zod, servis ve denetim
    // satırı aynı yoldan. Sebebi şu: bu sevkiyatın iddialarının yarısı bir
    // CEVAP hakkında ("400 + Türkçe gövde", "409 owner_transfer_race",
    // "boş gövdeli 500 YOK") ve bir cevabı yalnız uç üretir.
    const teamRoute = await import("../src/app/api/customer/team/route");
    const invitesRoute = await import("../src/app/api/customer/team/invites/route");
    const inviteIdRoute = await import("../src/app/api/customer/team/invites/[id]/route");
    const acceptRoute = await import("../src/app/api/customer/team/invites/accept/route");
    const membersRoute = await import("../src/app/api/customer/team/members/[userId]/route");

    /**
     * İstek nesnesi. `x-real-ip` TUR BAŞINA RASTGELE: oran limiti kovaları QA
     * Redis'inde yaşıyor ve sabit bir IP ile testin ikinci koşusu 429 alırdı.
     * Başlığa güvenilmesi için `TRUSTED_PROXY_IPS` yukarıda ayarlı — yani bu
     * satır aynı zamanda `extractClientIp`in gerçekten okunduğunun kanıtı.
     */
    function req(path: string, init: { method?: string; body?: unknown } = {}) {
      return new NextRequest(`https://qa.example.test${path}`, {
        method: init.method ?? "GET",
        headers: { "content-type": "application/json", "x-real-ip": clientIp },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    }
    async function body(response: Response): Promise<Record<string, unknown>> {
      const text = await response.text();
      // BOŞ GÖVDELİ CEVAP YOKTUR: her ret bir ekranın basabileceği cümle taşır.
      assert.ok(text.length > 0, "cevap gövdesi BOŞ (sıfır bayt)");
      return JSON.parse(text) as Record<string, unknown>;
    }
    /** Ret gövdesi: Türkçe cümle + beklenen kod. */
    async function refusal(response: Response, status: number, code: string) {
      const payload = await body(response);
      assert.equal(response.status, status, `beklenen ${status}, gelen ${response.status}`);
      assert.equal(payload.code, code, `beklenen kod ${code}, gelen ${String(payload.code)}`);
      const message = String(payload.error ?? "");
      assert.match(message, /[çğıöşüÇĞİÖŞÜ]/, `gövde Türkçe değil: ${message}`);
      return payload;
    }
    /** Takımın denetim izi, SIRAYLA. */
    async function auditTrail(teamId: string): Promise<string[]> {
      const rows = await admin.query(
        `SELECT action FROM customer_team_actions WHERE team_id = $1 ORDER BY created_at, action`,
        [teamId]
      );
      return rows.rows.map((r: { action: string }) => r.action);
    }
    /** Bir adrese kalan CANLI davet sayısı — `customer_team_invites_live_uq`nin sözü. */
    async function liveInvites(teamId: string, email: string): Promise<number> {
      return (
        await admin.query(
          `SELECT count(*)::int AS n FROM customer_team_invites
            WHERE team_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
          [teamId, email]
        )
      ).rows[0].n;
    }
    /**
     * Sahnelenen yarışta ucun INSERT'inin GERÇEKTEN indeks kilidinde beklediğini
     * doğrular.
     *
     * Bir `sleep(400)` ile COMMIT etmek testi zamanlamaya bağlardı: yavaş bir
     * makinede rakip erken biter, uç yenileme yapıp 201 döner ve test yarışı HİÇ
     * kurmadan yeşil kalır. Burada beklenen durum GÖRÜLEREK ölçülüyor.
     */
    async function waitForInviteLockWaiter(timeoutMs = 10_000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const waiting = (
          await admin.query(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database()
                AND wait_event_type = 'Lock'
                AND query ILIKE '%customer_team_invites%'`
          )
        ).rows[0].n;
        if (waiting > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    }

    const founder = await makeUser("kurucu");
    const invited = await makeUser("davetli");
    const stranger = await makeUser("davetsiz");

    await test("oturum YOKKEN uç 401 döner (bayraktan SONRA, veriden ÖNCE)", async () => {
      session = null;
      const response = await teamRoute.GET(req("/api/customer/team"));
      assert.equal(response.status, 401);
      assert.ok((await body(response)).error, "401 gövdesi boş");
    });

    await test("bayrak KAPALIYKEN takım ucu 404 (403 DEĞİL) döner", async () => {
      // Değişmez 5: kapalı bir özelliğin varlığını duyurmanın anlamı yok.
      await setFlag("quote_teams_enabled", false, "qa");
      session = founder;
      const response = await teamRoute.GET(req("/api/customer/team"));
      assert.equal(response.status, 404);
      await setFlag("quote_teams_enabled", true, "qa");
    });

    await test("takımı olmayan müşteriye GET boş kabuk döner (hata DEĞİL)", async () => {
      session = founder;
      const payload = await body(await teamRoute.GET(req("/api/customer/team")));
      assert.deepEqual(payload, { team: null, role: null, members: [], invites: [] });
    });

    let chainTeamId = "";
    /** Zincir takımının GÜNCEL sahibi: devir testinden sonra varise geçer. */
    let chainOwner: { userId: string; email: string } = founder;
    await test("zincir 1/5 · KUR → tam olarak bir `team_created` satırı", async () => {
      session = founder;
      const response = await teamRoute.POST(
        req("/api/customer/team", {
          method: "POST",
          body: { name: "Zincir Mühendislik", kvkkConsent: true },
        })
      );
      assert.equal(response.status, 201);
      const payload = await body(response);
      const team = payload.team as { id: string; memberCanCheckout: boolean };
      chainTeamId = team.id;
      assert.equal(payload.role, "owner");
      assert.equal(team.memberCanCheckout, false, "para kapısı DAR doğmalı");
      assert.deepEqual(await auditTrail(chainTeamId), ["team_created"]);
      // KVKK onayı SÜRÜMÜYLE yazıldı; onay kutusu olmadan uç 400 döner (altta).
      const row = await admin.query(
        `SELECT kvkk_notice_version, kvkk_consent_at FROM customer_teams WHERE id = $1`,
        [chainTeamId]
      );
      assert.equal(row.rows[0].kvkk_notice_version, TEAM_KVKK_NOTICE_VERSION);
      assert.ok(row.rows[0].kvkk_consent_at, "kvkk_consent_at damgalanmadı");
    });

    await test("KVKK onayı İŞARETLENMEDEN takım kurulamaz", async () => {
      session = stranger;
      await refusal(
        await teamRoute.POST(
          req("/api/customer/team", { method: "POST", body: { name: "Onaysız" } })
        ),
        400,
        "invalid_body"
      );
      assert.equal(
        (await admin.query(`SELECT count(*)::int AS n FROM customer_teams WHERE name = 'Onaysız'`))
          .rows[0].n,
        0,
        "onaysız takım yazıldı"
      );
    });

    let rawToken = "";
    let inviteId = "";
    await test("zincir 2/5 · DAVET → ham token YALNIZ e-postada, cevapta YOK", async () => {
      session = founder;
      sentEmails.length = 0;
      const response = await invitesRoute.POST(
        req("/api/customer/team/invites", {
          method: "POST",
          // Büyük harfli adres BİLEREK: tekillik ve kabul kapısı aynı
          // normalizasyonu paylaşmak zorunda.
          body: { email: invited.email.toUpperCase(), role: "member", kvkkConsent: true },
        })
      );
      assert.equal(response.status, 201);
      const payload = await body(response);
      const invite = payload.invite as { id: string; email: string; role: string };
      inviteId = invite.id;
      assert.equal(invite.email, invited.email, "adres küçük harfe indirilmedi");
      assert.equal(invite.role, "member");
      assert.equal(payload.renewed, false);
      // Cevap gövdesinin HİÇBİR alanı token taşımıyor.
      assert.equal(JSON.stringify(payload).includes("token"), false, "cevap token taşıyor");
      // Tek tüketici e-posta gövdesi.
      assert.equal(sentEmails.length, 1);
      assert.equal(sentEmails[0].kind, "invite");
      rawToken = String(sentEmails[0].args.rawToken);
      assert.ok(rawToken.length >= 32, "ham token üretilmedi");
      assert.equal(sentEmails[0].args.teamName, "Zincir Mühendislik");
      assert.deepEqual(await auditTrail(chainTeamId), ["team_created", "invite_sent"]);
    });

    await test("DAVET: KVKK onayı OLMADAN gönderilemez (ekranın kutusu uçta da zorunlu)", async () => {
      // Davet GÖNDERME formunda bir onay kutusu var (brief §T5.2) ve ekran,
      // ucun uygulamadığı bir kuralı yazamaz: şema `z.literal(true)`.
      // MUTASYON SINAVI: `inviteSchema`dan `kvkkConsent`i çıkar → KIRMIZI.
      session = founder;
      const before = sentEmails.length;
      for (const consent of [undefined, false]) {
        await refusal(
          await invitesRoute.POST(
            req("/api/customer/team/invites", {
              method: "POST",
              body:
                consent === undefined
                  ? { email: stranger.email, role: "member" }
                  : { email: stranger.email, role: "member", kvkkConsent: consent },
            })
          ),
          400,
          "invalid_body"
        );
      }
      // Onaysız istek bir SATIR da bir E-POSTA da üretmedi.
      assert.equal(sentEmails.length, before, "onaysız davet e-posta gönderdi");
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM customer_team_invites WHERE team_id = $1 AND email = $2",
            [chainTeamId, stranger.email]
          )
        ).rows[0].n,
        0,
        "onaysız davet satır yazdı"
      );
    });

    await test("HAM TOKEN DB'DE YOK: yalnız sha256'sı saklanıyor", async () => {
      // MUTASYON SINAVI: `inviteMember`ı ham token'ı yazacak şekilde değiştir
      // (`tokenHash: raw`) → bu iddia KIRMIZI olur.
      const row = (
        await admin.query(`SELECT * FROM customer_team_invites WHERE id = $1`, [inviteId])
      ).rows[0];
      assert.equal(
        row.token_hash,
        createHash("sha256").update(rawToken).digest("hex"),
        "token_hash sha256(raw) değil"
      );
      for (const [column, value] of Object.entries(row)) {
        if (typeof value !== "string") continue;
        assert.equal(
          value.includes(rawToken),
          false,
          `ham token \`${column}\` kolonunda duruyor`
        );
      }
      // Denetim izi de taşımıyor (yönetici kimin davet edildiğini görür, daveti
      // kabul edemez).
      const trail = await admin.query(
        `SELECT before::text, after::text FROM customer_team_actions WHERE team_id = $1`,
        [chainTeamId]
      );
      for (const r of trail.rows) {
        assert.equal(String(r.before ?? "").includes(rawToken), false);
        assert.equal(String(r.after ?? "").includes(rawToken), false);
      }
    });

    await test("YANLIŞ E-POSTAYLA KABUL REDDEDİLİR ve davet BEKLEMEDE kalır", async () => {
      // BU SEVKİYATIN EN ÖNEMLİ TEK İDDİASI: token'ı ele geçiren başka bir
      // hesap takıma giremez.
      // MUTASYON SINAVI: `inviteAcceptable`tan e-posta eşleşme kontrolünü
      // kaldır → bu vaka KIRMIZI olur.
      session = stranger;
      await refusal(
        await acceptRoute.POST(
          req("/api/customer/team/invites/accept", {
            method: "POST",
            body: { token: rawToken, kvkkConsent: true },
          })
        ),
        403,
        "invite_email_mismatch"
      );
      const row = (
        await admin.query(
          `SELECT accepted_at, accepted_user_id FROM customer_team_invites WHERE id = $1`,
          [inviteId]
        )
      ).rows[0];
      assert.equal(row.accepted_at, null, "reddedilen kabul daveti tüketti");
      assert.equal(row.accepted_user_id, null);
      assert.equal(
        (
          await admin.query(`SELECT count(*)::int AS n FROM customer_team_members WHERE user_id = $1`, [
            stranger.userId,
          ])
        ).rows[0].n,
        0,
        "davetsiz kullanıcıya üyelik satırı yazıldı"
      );
    });

    await test("zincir 3/5 · KABUL → üyelik + KVKK damgası + tek `invite_accepted`", async () => {
      // Oturum adresi BOŞLUKLU ve BÜYÜK HARFLİ: normalizasyon İKİ TARAFA da
      // uygulanıyor (davet `ALİ@X`, oturum ` ali@x `).
      session = { userId: invited.userId, email: ` ${invited.email.toUpperCase()} ` };
      const payload = await body(
        await acceptRoute.POST(
          req("/api/customer/team/invites/accept", {
            method: "POST",
            body: { token: rawToken, kvkkConsent: true },
          })
        )
      );
      assert.equal((payload.team as { id: string }).id, chainTeamId);
      assert.equal(payload.role, "member");
      const row = (
        await admin.query(
          `SELECT role, kvkk_acknowledged_at, invited_by_user_id FROM customer_team_members
            WHERE team_id = $1 AND user_id = $2`,
          [chainTeamId, invited.userId]
        )
      ).rows[0];
      assert.equal(row.role, "member");
      assert.ok(row.kvkk_acknowledged_at, "kabul onayı damgalanmadı");
      assert.equal(row.invited_by_user_id, founder.userId);
      assert.deepEqual(await auditTrail(chainTeamId), [
        "team_created",
        "invite_sent",
        "invite_accepted",
      ]);
    });

    await test("YETKİ UÇTA uygulanıyor: `member` yönetim uçlarının HİÇBİRİNİ açamaz", async () => {
      // Saf yüklemin (`canInvite`, `canEditTeamProfile`, …) doğru cevap vermesi
      // UCUN onu SORDUĞUNU kanıtlamaz. Beş yönetim yüzeyi, `member` oturumuyla:
      // hepsi 403 `not_allowed`, hiçbiri satır yazmıyor, denetim izi sabit.
      session = { userId: invited.userId, email: invited.email };
      const before = await auditTrail(chainTeamId);
      await refusal(
        await teamRoute.PATCH(
          req("/api/customer/team", { method: "PATCH", body: { name: "Üye Değiştirdi" } })
        ),
        403,
        "not_allowed"
      );
      await refusal(
        await teamRoute.DELETE(req("/api/customer/team", { method: "DELETE" })),
        403,
        "not_allowed"
      );
      await refusal(
        await invitesRoute.POST(
          req("/api/customer/team/invites", {
            method: "POST",
            body: { email: stranger.email, role: "viewer", kvkkConsent: true },
          })
        ),
        403,
        "not_allowed"
      );
      await refusal(await invitesRoute.GET(req("/api/customer/team/invites")), 403, "not_allowed");
      await refusal(
        await membersRoute.PATCH(
          req(`/api/customer/team/members/${chainOwner.userId}`, {
            method: "PATCH",
            body: { role: "viewer" },
          }),
          { params: Promise.resolve({ userId: chainOwner.userId }) }
        ),
        403,
        "not_allowed"
      );
      assert.equal(
        (await admin.query(`SELECT name FROM customer_teams WHERE id = $1`, [chainTeamId])).rows[0]
          .name,
        "Zincir Mühendislik",
        "reddedilen PATCH takım adını değiştirdi"
      );
      assert.deepEqual(await auditTrail(chainTeamId), before, "reddedilen istek denetim satırı yazdı");
      // Ama ÜYE listesini GÖREBİLİR (ad + e-posta + rol): takımın işini görmek
      // üyeliğin kendisidir, yönetmek ayrı yetkidir.
      const own = await body(await teamRoute.GET(req("/api/customer/team")));
      assert.equal(own.role, "member");
      assert.equal((own.members as unknown[]).length, 2);
      // Bekleyen davetler ona GÖNDERİLMEZ (gereksiz yayılım).
      assert.deepEqual(own.invites, []);
      // Ve üye satırı YALNIZ dört alan + katılma anı taşıyor (değişmez 6).
      const row = (own.members as Array<Record<string, unknown>>)[0];
      assert.deepEqual(Object.keys(row).sort(), ["email", "joinedAt", "name", "role", "userId"]);
    });

    await test("zincir 4/5 · ROL DEĞİŞTİR → tek `role_changed`, before/after dolu", async () => {
      session = founder;
      sentEmails.length = 0;
      const response = await membersRoute.PATCH(
        req(`/api/customer/team/members/${invited.userId}`, {
          method: "PATCH",
          body: { role: "admin" },
        }),
        { params: Promise.resolve({ userId: invited.userId }) }
      );
      assert.equal(response.status, 200);
      const payload = await body(response);
      assert.equal(payload.role, "admin");
      assert.equal(payload.transferred, false);
      assert.deepEqual(await auditTrail(chainTeamId), [
        "team_created",
        "invite_sent",
        "invite_accepted",
        "role_changed",
      ]);
      const row = (
        await admin.query(
          `SELECT before->>'role' AS before_role, after->>'role' AS after_role
             FROM customer_team_actions WHERE team_id = $1 AND action = 'role_changed'`,
          [chainTeamId]
        )
      ).rows[0];
      assert.equal(row.before_role, "member");
      assert.equal(row.after_role, "admin");
      assert.equal(sentEmails.length, 1);
      assert.equal(sentEmails[0].kind, "role");
    });

    await test("zincir 5/5 · ÇIKAR → üyelik satırı SİLİNİR, tek `member_removed`", async () => {
      session = founder;
      sentEmails.length = 0;
      const response = await membersRoute.DELETE(
        req(`/api/customer/team/members/${invited.userId}`, { method: "DELETE" }),
        { params: Promise.resolve({ userId: invited.userId }) }
      );
      assert.equal(response.status, 200);
      assert.equal((await body(response)).left, false);
      assert.equal(
        (
          await admin.query(`SELECT count(*)::int AS n FROM customer_team_members WHERE user_id = $1`, [
            invited.userId,
          ])
        ).rows[0].n,
        0,
        "çıkarılan üyenin satırı silinmedi (soft-delete yazılmış)"
      );
      assert.deepEqual(await auditTrail(chainTeamId), [
        "team_created",
        "invite_sent",
        "invite_accepted",
        "role_changed",
        "member_removed",
      ]);
      assert.equal(sentEmails.length, 1);
      assert.equal(sentEmails[0].kind, "removed");
    });

    await test("BİÇİMİ UUID OLMAYAN yol parçası 404 döner (22P02 → 500 YOK)", async () => {
      // `[id]`/`[userId]` ham bir yol parçasıdır: biçimi uuid olmayan bir dize
      // `uuid` kolonuna sorulursa Postgres onu `22P02` ile patlatır, o hata bir
      // `TeamServiceError` DEĞİLDİR ve rota katmanı onu boş gövdeli bir 500'e
      // (+ Sentry gürültüsüne) çevirir. Bayat bir davet bağlantısı, bir tarayıcı
      // eklentisi ya da T-5'in bir yazım hatası bunu bedava tetikliyor; doğru
      // cevap gövdesinde Türkçe cümle taşıyan bir 404'tür.
      session = chainOwner;
      const before = await auditTrail(chainTeamId);
      await refusal(
        await inviteIdRoute.DELETE(req("/api/customer/team/invites/abc", { method: "DELETE" }), {
          params: Promise.resolve({ id: "abc" }),
        }),
        404,
        "invite_not_found"
      );
      await refusal(
        await membersRoute.PATCH(
          req("/api/customer/team/members/abc", { method: "PATCH", body: { role: "member" } }),
          { params: Promise.resolve({ userId: "abc" }) }
        ),
        404,
        "not_member"
      );
      await refusal(
        await membersRoute.DELETE(req("/api/customer/team/members/abc", { method: "DELETE" }), {
          params: Promise.resolve({ userId: "abc" }),
        }),
        404,
        "not_member"
      );
      // Ve biçimi DOĞRU olan var olmayan kimlik AYNI cevabı alıyor: ret sebebi
      // "biçim" değil "yok"tur, yani uç kimlik biçimi saydırmıyor.
      const ghost = randomUUID();
      await refusal(
        await inviteIdRoute.DELETE(
          req(`/api/customer/team/invites/${ghost}`, { method: "DELETE" }),
          { params: Promise.resolve({ id: ghost }) }
        ),
        404,
        "invite_not_found"
      );
      await refusal(
        await membersRoute.DELETE(
          req(`/api/customer/team/members/${ghost}`, { method: "DELETE" }),
          { params: Promise.resolve({ userId: ghost }) }
        ),
        404,
        "not_member"
      );
      assert.deepEqual(await auditTrail(chainTeamId), before, "reddedilen istek satır yazdı");
    });

    await test("TOKEN TEK KULLANIMLIK: tüketilmiş token ÇIKARILDIKTAN SONRA da reddedilir", async () => {
      // Vaka BİLEREK burada: `invited` artık takımsız olduğu için
      // `already_in_team` kapısı KAPALI ve reddin tek sebebi davetin
      // TÜKETİLMİŞ olmasıdır (`accepted_at` dolu). Çıkarılan üye elindeki eski
      // bağlantıyla geri giremez.
      session = { userId: invited.userId, email: invited.email };
      await refusal(
        await acceptRoute.POST(
          req("/api/customer/team/invites/accept", {
            method: "POST",
            body: { token: rawToken, kvkkConsent: true },
          })
        ),
        400,
        "not_allowed"
      );
      assert.equal(
        (
          await admin.query(`SELECT count(*)::int AS n FROM customer_team_members WHERE user_id = $1`, [
            invited.userId,
          ])
        ).rows[0].n,
        0,
        "tüketilmiş token yeniden üyelik yazdı"
      );
      assert.deepEqual(await auditTrail(chainTeamId), [
        "team_created",
        "invite_sent",
        "invite_accepted",
        "role_changed",
        "member_removed",
      ]);
    });

    await test("SÜRESİ DOLMUŞ token reddedilir (TTL gerçekten uygulanıyor)", async () => {
      session = founder;
      sentEmails.length = 0;
      await invitesRoute.POST(
        req("/api/customer/team/invites", {
          method: "POST",
          body: { email: invited.email, role: "viewer", kvkkConsent: true },
        })
      );
      const expiredToken = String(sentEmails[0].args.rawToken);
      // Süreyi ELLE geriye al: 7 günlük TTL'i beklemek yerine saati değil
      // SATIRI oynatıyoruz (yüklem `expires_at <= now` soruyor).
      await admin.query(
        `UPDATE customer_team_invites SET expires_at = now() - interval '1 second'
          WHERE token_hash = $1`,
        [createHash("sha256").update(expiredToken).digest("hex")]
      );
      session = { userId: invited.userId, email: invited.email };
      await refusal(
        await acceptRoute.POST(
          req("/api/customer/team/invites/accept", {
            method: "POST",
            body: { token: expiredToken, kvkkConsent: true },
          })
        ),
        400,
        "invite_expired"
      );
    });

    await test("İPTAL EDİLEN davet kabul edilemez", async () => {
      session = founder;
      sentEmails.length = 0;
      const created = await body(
        await invitesRoute.POST(
          req("/api/customer/team/invites", {
            method: "POST",
            // Aynı adrese ikinci CANLI davet YOK: bu bir YENİLEMEDİR
            // (`customer_team_invites_live_uq`), eskisi aynı işlemde kapanır.
            body: { email: invited.email, role: "member", kvkkConsent: true },
          })
        )
      );
      assert.equal(created.renewed, true, "aynı adrese ikinci davet yenileme olarak yazılmadı");
      const token = String(sentEmails[0].args.rawToken);
      const id = (created.invite as { id: string }).id;
      const revoked = await inviteIdRoute.DELETE(
        req(`/api/customer/team/invites/${id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id }) }
      );
      assert.equal(revoked.status, 200);
      session = { userId: invited.userId, email: invited.email };
      await refusal(
        await acceptRoute.POST(
          req("/api/customer/team/invites/accept", {
            method: "POST",
            body: { token, kvkkConsent: true },
          })
        ),
        400,
        "not_allowed"
      );
      // İptal edilen davet CANLI listeden düşer.
      session = founder;
      const list = await body(await invitesRoute.GET(req("/api/customer/team/invites")));
      assert.deepEqual(list.invites, [], "iptal edilen davet hâlâ bekleyen listesinde");
    });

    await test("BAŞKA TAKIMDAKİ kullanıcı daveti kabul EDEMEZ (400 + Türkçe, 23505 YOK)", async () => {
      // Sahibin kararı 6.5: bir kullanıcı EN FAZLA BİR takımda. Kapı iki
      // katmanlı — servis önce kontrol eder, `customer_team_members_user_uq`
      // ikinci savunma hattıdır. `23505` sızsa cevap boş gövdeli 500 olurdu
      // ([[drizzle-error-wrapping]]).
      const rival = await makeUser("rakip");
      session = founder;
      sentEmails.length = 0;
      await invitesRoute.POST(
        req("/api/customer/team/invites", {
          method: "POST",
          body: { email: rival.email, role: "member", kvkkConsent: true },
        })
      );
      const token = String(sentEmails[0].args.rawToken);
      // Davet geldikten SONRA kendi takımını kuruyor.
      session = rival;
      assert.equal(
        (
          await teamRoute.POST(
            req("/api/customer/team", {
              method: "POST",
              body: { name: "Rakip Takım", kvkkConsent: true },
            })
          )
        ).status,
        201
      );
      await refusal(
        await acceptRoute.POST(
          req("/api/customer/team/invites/accept", {
            method: "POST",
            body: { token, kvkkConsent: true },
          })
        ),
        400,
        "already_in_team"
      );
      // İkinci takım kurma denemesi de aynı cevabı alır (aynı kapı).
      await refusal(
        await teamRoute.POST(
          req("/api/customer/team", {
            method: "POST",
            body: { name: "İkinci Takım", kvkkConsent: true },
          })
        ),
        400,
        "already_in_team"
      );
      // Ve davet ucu da: kabul edilemeyeceği kesin olan davet GÖNDERİLMEZ.
      session = founder;
      await refusal(
        await invitesRoute.POST(
          req("/api/customer/team/invites", {
            method: "POST",
            body: { email: rival.email, role: "member", kvkkConsent: true },
          })
        ),
        400,
        "already_in_team"
      );
    });

    await test("SAHİP AYRILAMAZ (`owner_must_transfer`); devrettikten sonra ayrılabilir", async () => {
      // Önce takıma yeni bir üye alınır (devir için hedef gerekiyor).
      const heir = await makeUser("varis");
      session = founder;
      sentEmails.length = 0;
      await invitesRoute.POST(
        req("/api/customer/team/invites", {
          method: "POST",
          body: { email: heir.email, role: "member", kvkkConsent: true },
        })
      );
      const token = String(sentEmails[0].args.rawToken);
      session = heir;
      assert.equal(
        (
          await acceptRoute.POST(
            req("/api/customer/team/invites/accept", {
              method: "POST",
              body: { token, kvkkConsent: true },
            })
          )
        ).status,
        200
      );

      // Sahip ayrılmayı dener → REDDEDİLİR.
      session = founder;
      await refusal(
        await membersRoute.DELETE(
          req(`/api/customer/team/members/${founder.userId}`, { method: "DELETE" }),
          { params: Promise.resolve({ userId: founder.userId }) }
        ),
        400,
        "owner_must_transfer"
      );
      assert.equal(
        (
          await admin.query(`SELECT count(*)::int AS n FROM customer_team_members WHERE user_id = $1`, [
            founder.userId,
          ])
        ).rows[0].n,
        1,
        "reddedilen ayrılma satırı sildi"
      );

      // Devir: PATCH { role: "owner" } bir rol ataması DEĞİL, devirdir.
      sentEmails.length = 0;
      const transfer = await body(
        await membersRoute.PATCH(
          req(`/api/customer/team/members/${heir.userId}`, {
            method: "PATCH",
            body: { role: "owner" },
          }),
          { params: Promise.resolve({ userId: heir.userId }) }
        )
      );
      assert.equal(transfer.transferred, true);
      const roles = await admin.query(
        `SELECT user_id, role FROM customer_team_members WHERE team_id = $1`,
        [chainTeamId]
      );
      const byUser = new Map(roles.rows.map((r: { user_id: string; role: string }) => [r.user_id, r.role]));
      assert.equal(byUser.get(heir.userId), "owner");
      assert.equal(byUser.get(founder.userId), "admin", "eski sahip admin'e düşmedi");
      // Takım satırı da takip eder: "sahibi kim" sorusunun TEK cevabı olmalı.
      assert.equal(
        (await admin.query(`SELECT owner_user_id FROM customer_teams WHERE id = $1`, [chainTeamId]))
          .rows[0].owner_user_id,
        heir.userId
      );
      assert.equal(sentEmails[0].kind, "ownership");

      // Artık ayrılabilir.
      const left = await membersRoute.DELETE(
        req(`/api/customer/team/members/${founder.userId}`, { method: "DELETE" }),
        { params: Promise.resolve({ userId: founder.userId }) }
      );
      assert.equal(left.status, 200);
      assert.equal((await body(left)).left, true);
      assert.equal(
        (
          await admin.query(`SELECT count(*)::int AS n FROM customer_team_members WHERE user_id = $1`, [
            founder.userId,
          ])
        ).rows[0].n,
        0
      );
      const trail = await auditTrail(chainTeamId);
      assert.equal(trail.includes("ownership_transferred"), true);
      assert.equal(trail.includes("member_left"), true);
      // Devrin hedefi artık sahip: sonraki testler onun oturumuyla koşar.
      chainOwner = heir;
    });

    await test("PROFİL PATCH: değişen BÖLÜM başına bir denetim satırı", async () => {
      // `TEAM_ACTIONS` ad / fatura / teslimat için ÜÇ ayrı ad taşıyor çünkü üçü
      // ayrı bir açıklamadır; hangisinin değiştiğini tek satıra sıkıştırmak izi
      // yalancı yapardı. Tek çağrıda üçü birden değişiyorsa üç satır yazılır.
      session = chainOwner;
      const before = await auditTrail(chainTeamId);
      const address = {
        adres: "Organize Sanayi 3. Cadde No 12",
        ilce: "Nilüfer",
        il: "Bursa",
        postaKodu: "16140",
        telefon: "+905551112233",
      };
      const payload = await body(
        await teamRoute.PATCH(
          req("/api/customer/team", {
            method: "PATCH",
            body: {
              name: "Zincir Mühendislik A.Ş.",
              invoiceType: "corporate",
              companyName: "Zincir Mühendislik Sanayi A.Ş.",
              taxId: "1234567890",
              taxIdType: "vkn",
              taxOffice: "Nilüfer",
              billingAddress: address,
              shippingAddress: address,
              memberCanCheckout: true,
            },
          })
        )
      );
      const team = payload.team as Record<string, unknown>;
      assert.equal(team.name, "Zincir Mühendislik A.Ş.");
      assert.equal(team.invoiceType, "corporate");
      assert.equal(team.memberCanCheckout, true);
      assert.deepEqual(team.shippingAddress, address);
      // KVKK kaydı müşteri gövdesine GİRMEZ (denetim verisi).
      assert.equal("kvkkNoticeVersion" in team, false);
      assert.equal("kvkkConsentAt" in team, false);
      assert.deepEqual(
        (await auditTrail(chainTeamId)).slice(before.length).sort(),
        ["billing_updated", "shipping_updated", "team_renamed"]
      );
      const renamed = (
        await admin.query(
          `SELECT before->>'name' AS b, after->>'name' AS a FROM customer_team_actions
            WHERE team_id = $1 AND action = 'team_renamed'`,
          [chainTeamId]
        )
      ).rows[0];
      assert.equal(renamed.b, "Zincir Mühendislik");
      assert.equal(renamed.a, "Zincir Mühendislik A.Ş.");
      // Para kapısının açılması FATURA bölümünde izlenir: `TEAM_ACTIONS`ta ona
      // ayrı bir ad yok ve listeye ad eklemek migration demek.
      const billing = (
        await admin.query(
          `SELECT before->>'memberCanCheckout' AS b, after->>'memberCanCheckout' AS a
             FROM customer_team_actions WHERE team_id = $1 AND action = 'billing_updated'`,
          [chainTeamId]
        )
      ).rows[0];
      assert.equal(billing.b, "false");
      assert.equal(billing.a, "true");

      // Verilmeyen alan DOKUNULMAZ ve değişmeyen bölüm satır YAZMAZ.
      const after = await auditTrail(chainTeamId);
      const only = await body(
        await teamRoute.PATCH(
          req("/api/customer/team", { method: "PATCH", body: { taxOffice: "Osmangazi" } })
        )
      );
      assert.equal((only.team as Record<string, unknown>).name, "Zincir Mühendislik A.Ş.");
      assert.equal((only.team as Record<string, unknown>).taxOffice, "Osmangazi");
      assert.deepEqual((await auditTrail(chainTeamId)).slice(after.length), ["billing_updated"]);

      // Boş gövde bir işlem DEĞİLDİR: 400 + Türkçe cümle.
      await refusal(
        await teamRoute.PATCH(req("/api/customer/team", { method: "PATCH", body: {} })),
        400,
        "invalid_body"
      );
      // Ve geçersiz ad reddedilir (sınır serviste de duruyor).
      await refusal(
        await teamRoute.PATCH(req("/api/customer/team", { method: "PATCH", body: { name: "A" } })),
        400,
        "invalid_body"
      );
    });

    await test("EŞZAMANLI iki devir: yalnız biri yazar, ikincisi 409 `owner_transfer_race`", async () => {
      // Kısmi tekil indeks (`customer_team_members_one_owner_idx`) + düşürme
      // UPDATE'inin `role = 'owner'` KOŞULU yarışı kesiyor. Beklenen: bir 200,
      // bir 409 — ve DB'de TEK sahip.
      const a = await makeUser("aday-a");
      const b = await makeUser("aday-b");
      for (const target of [a, b]) {
        session = chainOwner;
        sentEmails.length = 0;
        await invitesRoute.POST(
          req("/api/customer/team/invites", {
            method: "POST",
            body: { email: target.email, role: "member", kvkkConsent: true },
          })
        );
        const token = String(sentEmails[0].args.rawToken);
        session = target;
        assert.equal(
          (
            await acceptRoute.POST(
              req("/api/customer/team/invites/accept", {
                method: "POST",
                body: { token, kvkkConsent: true },
              })
            )
          ).status,
          200
        );
      }
      session = chainOwner;
      const results = await Promise.all(
        [a, b].map((target) =>
          membersRoute.PATCH(
            req(`/api/customer/team/members/${target.userId}`, {
              method: "PATCH",
              body: { role: "owner" },
            }),
            { params: Promise.resolve({ userId: target.userId }) }
          )
        )
      );
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [200, 409], `beklenen [200,409], gelen ${statuses.join(",")}`);
      const loser = results.find((r) => r.status === 409)!;
      await refusal(loser, 409, "owner_transfer_race");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int AS n FROM customer_team_members WHERE team_id = $1 AND role = 'owner'`,
            [chainTeamId]
          )
        ).rows[0].n,
        1,
        "takımda iki sahip var"
      );
      // Kazanan kim olduysa takım satırı onu gösteriyor.
      const ownerRow = (
        await admin.query(
          `SELECT m.user_id FROM customer_team_members m
            WHERE m.team_id = $1 AND m.role = 'owner'`,
          [chainTeamId]
        )
      ).rows[0];
      assert.equal(
        (await admin.query(`SELECT owner_user_id FROM customer_teams WHERE id = $1`, [chainTeamId]))
          .rows[0].owner_user_id,
        ownerRow.user_id,
        "takım satırı ile üyelik satırı ayrıştı"
      );
    });

    await test("EŞZAMANLI iki davet: ikinci 409 `invite_renew_race`, 23505 sızmıyor", async () => {
      // Devir yarışının EŞİ, ama kapıyı tutan şey başka: orada koşullu
      // UPDATE'in satır kilidi, burada `customer_team_invites_live_uq` kısmi
      // tekil indeksi. Yenileme UPDATE'i kendi SNAPSHOT'ını gördüğü için iki
      // eşzamanlı istek de 0 satır kapatır ve ikinci INSERT 23505 alır —
      // yakalanmazsa (drizzle hatayı sarıyor: `.code` undefined, gerçek kod
      // `.cause`ta) çift tıklanan bir "yeniden gönder" boş gövdeli bir 500 olur.
      session = chainOwner;

      // 1) GERÇEK çift tıklama: aynı adrese iki uç çağrısı, aynı anda.
      const twin = await makeUser("ikiz");
      const invite = () =>
        invitesRoute.POST(
          req("/api/customer/team/invites", {
            method: "POST",
            body: { email: twin.email, role: "member", kvkkConsent: true },
          })
        );
      const both = await Promise.all([invite(), invite()]);
      const statuses = both.map((r) => r.status).sort();
      // İki MEŞRU sonuç var: ikinci işlem birincisini görebildiyse bu bir
      // yenilemedir (201), göremediyse indeks onu keser (409). 500 hiçbir hâlde
      // meşru değil ve 409 Türkçe bir gövde taşımak zorunda.
      assert.ok(
        statuses.every((s) => s === 201 || s === 409),
        `beklenen 201/409, gelen ${statuses.join(",")}`
      );
      for (const loser of both.filter((r) => r.status === 409)) {
        await refusal(loser, 409, "invite_renew_race");
      }
      assert.equal(await liveInvites(chainTeamId, twin.email), 1, "adrese iki CANLI davet kaldı");

      // 2) Aynı yarış DETERMİNİST hâliyle — çünkü (1) makineye göre yenilemeye
      //    de düşebilir ve o hâlde 409 yolu HİÇ ölçülmemiş olur. Ayrı bir DB
      //    oturumu aynı `(team_id, email)` için CANLI bir davet satırı yazar ve
      //    COMMIT ETMEZ: ucun yenileme UPDATE'i o satırı GÖREMEZ, INSERT ise
      //    indekste ona takılıp BEKLER; rakip COMMIT edince 23505 gelir.
      const solo = await makeUser("tekil");
      const trailBefore = await auditTrail(chainTeamId);
      const racer = new pg.Client({ connectionString });
      await racer.connect();
      try {
        await racer.query(`SET search_path TO ${namespace}`);
        await racer.query("BEGIN");
        await racer.query(
          `INSERT INTO customer_team_invites
             (team_id, email, role, token_hash, invited_by_user_id, expires_at)
           VALUES ($1, $2, 'member', $3, $4, now() + interval '7 days')`,
          [
            chainTeamId,
            solo.email,
            createHash("sha256").update(randomUUID()).digest("hex"),
            chainOwner.userId,
          ]
        );
        const pending = invitesRoute.POST(
          req("/api/customer/team/invites", {
            method: "POST",
            body: { email: solo.email, role: "member", kvkkConsent: true },
          })
        );
        assert.ok(await waitForInviteLockWaiter(), "ucun INSERT'i indekste beklemedi");
        await racer.query("COMMIT");
        await refusal(await pending, 409, "invite_renew_race");
        // İşlem GERİ ALINDI: ne ikinci bir canlı davet ne de bir `invite_sent`
        // denetim satırı kaldı — 409 "yarıda kalmış bir yazma" bırakmıyor.
        assert.equal(await liveInvites(chainTeamId, solo.email), 1, "reddedilen davet satır bıraktı");
        assert.deepEqual(await auditTrail(chainTeamId), trailBefore, "409 denetim satırı yazdı");
      } finally {
        await racer.query("ROLLBACK").catch(() => {});
        await racer
          .query(`DELETE FROM customer_team_invites WHERE team_id = $1 AND email = $2`, [
            chainTeamId,
            solo.email,
          ])
          .catch(() => {});
        await racer.end();
      }
    });

    await test("ÇIKARILAN üyenin takım teklifine erişimi ANINDA 404", async () => {
      // T-2'nin sözü ("üyelik satırı silindiği an erişim kesilir") YAZMA
      // yoluyla birlikte de duruyor: bu kez satırı test değil UÇ siliyor.
      session = owner;
      const removed = await membersRoute.DELETE(
        req(`/api/customer/team/members/${member.userId}`, { method: "DELETE" }),
        { params: Promise.resolve({ userId: member.userId }) }
      );
      assert.equal(removed.status, 200);
      session = member;
      assert.equal(await resolveQuoteAccess(created.id), null, "çıkarılmış üye hâlâ görüyor");
      assert.equal(await openStream(created.id), 404, "çıkarılmış üye hâlâ canlı akışta");
      // Kişisel sahip erişimini KAYBETMEZ (dal sırası).
      session = owner;
      assert.equal((await resolveQuoteAccess(created.id))?.viewer.isOwner, true);
    });

    await test("DELETE: üyesi/daveti/teklifi olan takım silinmez, boşalınca silinir", async () => {
      session = owner;
      // 1) Takıma bağlı teklif varken reddedilir (`quotes.team_id` restrict FK).
      await refusal(
        await teamRoute.DELETE(req("/api/customer/team", { method: "DELETE" })),
        409,
        "team_not_empty"
      );
      await admin.query(`UPDATE quotes SET team_id = NULL WHERE team_id = $1`, [team.id]);

      // 2) BEKLEYEN davet varken de reddedilir.
      sentEmails.length = 0;
      const invite = await body(
        await invitesRoute.POST(
          req("/api/customer/team/invites", {
            method: "POST",
            body: { email: stranger.email, role: "viewer", kvkkConsent: true },
          })
        )
      );
      await refusal(
        await teamRoute.DELETE(req("/api/customer/team", { method: "DELETE" })),
        409,
        "team_not_empty"
      );
      const pendingId = (invite.invite as { id: string }).id;
      await inviteIdRoute.DELETE(
        req(`/api/customer/team/invites/${pendingId}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: pendingId }) }
      );

      // 3) Boşalınca silinir — çocuk satırlar (davet + denetim) takımla gider.
      const response = await teamRoute.DELETE(req("/api/customer/team", { method: "DELETE" }));
      assert.equal(response.status, 200);
      for (const table of [
        "customer_teams",
        "customer_team_members",
        "customer_team_invites",
        "customer_team_actions",
      ]) {
        const column = table === "customer_teams" ? "id" : "team_id";
        assert.equal(
          (
            await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [
              team.id,
            ])
          ).rows[0].n,
          0,
          `${table} satırı kaldı`
        );
      }
    });

    // ═══ T-4 · TEKLİF ↔ TAKIM BAĞI VE SOHBET ASİMETRİSİ ══════════════════════
    //
    // Gerçek uçlardan geçer (`/api/quotes/[id]/team`, `/api/quotes/[id]/messages`):
    // bu vakaların iddiası bir CEVAP hakkında (409 `quote_has_order`, 403, GET
    // 200 / POST 404) ve bir cevabı yalnız uç üretir.
    const quoteTeamRoute = await import("../src/app/api/quotes/[id]/team/route");
    const messagesRoute = await import("../src/app/api/quotes/[id]/messages/route");
    // Parça kütüphanesinden içe aktarma ucu: salt okunur rolün HEDEF kapısı
    // (`accessOr404(..., { forEdit: true })`) yalnız uçtan ölçülebilir —
    // servis katmanı izleyici görmüyor, `test-quote-service-db.ts`in
    // yardımcısı ise izleyiciyi elle "sahip" olarak üretiyor.
    const partsImportRoute = await import("../src/app/api/quotes/[id]/parts/import/route");

    // Teklif uçlarının ortak bayrağı: kapalıyken `quoteRouteBody` her şeye 404
    // der ve vakalar hiçbir şey kanıtlamazdı.
    await setFlag("instant_quote_enabled", true, "qa");

    const bindOwner = await makeUser("bag-sahip");
    const bindAdmin = await makeUser("bag-yonetici");
    const bindViewer = await makeUser("bag-izleyici");
    const loner = await makeUser("takimsiz");
    const bindTeamId = (
      await admin.query(
        `INSERT INTO customer_teams (name, owner_user_id, kvkk_notice_version)
           VALUES ('Bağ Mühendislik', $1, '2026-09-22') RETURNING id`,
        [bindAdmin.userId]
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO customer_team_members (team_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'viewer')`,
      [bindTeamId, bindAdmin.userId, bindOwner.userId, bindViewer.userId]
    );

    /** Bu kullanıcının takımsız bir teklifi (bayrak açıkken `createQuote` bağlar). */
    async function personalQuote(user: { userId: string }): Promise<string> {
      const created = await createQuote({
        userId: user.userId,
        anonymousId: null,
        termsAccepted: true,
      });
      await db.update(quotes).set({ teamId: null }).where(eq(quotes.id, created.id));
      return created.id;
    }
    const attach = (id: string) =>
      quoteTeamRoute.POST(req(`/api/quotes/${id}/team`, { method: "POST" }), {
        params: Promise.resolve({ id }),
      });
    const detach = (id: string) =>
      quoteTeamRoute.DELETE(req(`/api/quotes/${id}/team`, { method: "DELETE" }), {
        params: Promise.resolve({ id }),
      });
    const teamIdOf = async (id: string): Promise<string | null> =>
      (await admin.query("SELECT team_id FROM quotes WHERE id = $1", [id])).rows[0].team_id;

    await test("POST: teklifin sahibi kendi teklifini TAKIMA bağlar (denetim satırıyla)", async () => {
      const id = await personalQuote(bindOwner);
      session = bindOwner;
      const response = await attach(id);
      assert.equal(response.status, 200);
      const payload = await body(response);
      assert.equal(payload.success, true);
      // Cevap TAZE gövdedir: ekranın rozeti `PresentedQuote.team`den çizilir.
      const view = payload.quote as { team?: { name: string; role: string } };
      assert.equal(view.team?.name, "Bağ Mühendislik");
      assert.equal(view.team?.role, "member");
      assert.equal(await teamIdOf(id), bindTeamId);
      const trail = await admin.query(
        "SELECT action, target_quote_id, actor_user_id FROM customer_team_actions WHERE team_id = $1 ORDER BY created_at",
        [bindTeamId]
      );
      assert.deepEqual(
        trail.rows.map((r: { action: string }) => r.action),
        ["quote_attached"]
      );
      assert.equal(trail.rows[0].target_quote_id, id, "denetim satırı teklifi işaret etmiyor");
      assert.equal(trail.rows[0].actor_user_id, bindOwner.userId);
    });

    await test("POST: zaten bağlı teklif 409 `already_in_team_quote` alır", async () => {
      const id = (
        await admin.query("SELECT id FROM quotes WHERE team_id = $1 LIMIT 1", [bindTeamId])
      ).rows[0].id as string;
      session = bindOwner;
      await refusal(await attach(id), 409, "already_in_team_quote");
    });

    await test("POST: TAKIMSIZ kullanıcı 403 `not_member` alır", async () => {
      // SAPMA, KAYITLI: brief bu yola "400" diyor. Kod 403 `not_member`
      // döndürüyor çünkü üyelik kapısı T-3'ün TEK `requireMembership`i ve onu
      // 22 takım ucu paylaşıyor (tasarım §8 kod kümesi de `not_member`ı 403
      // olarak çiviliyor). 400'e çevirmek ya o paylaşılan kapıyı tek uç için
      // çatallamak ya da T-3'ün sözleşmesini sessizce yanlışlamak olurdu.
      // Brief'in GEREKÇESİ ("dört ret yolu AYRI olsun") korunuyor: 403
      // `not_member` / 403 `not_allowed` / 409 `already_in_team_quote` /
      // 409 `quote_has_order` — dördü de ayrı kod, dördü de bu dosyada ölçülü.
      const id = await personalQuote(loner);
      session = loner;
      await refusal(await attach(id), 403, "not_member");
      assert.equal(await teamIdOf(id), null, "takımsız kullanıcı teklifi bağladı");
    });

    await test("POST: takımın `viewer` rolü kendi teklifini bile bağlayamaz", async () => {
      const id = await personalQuote(bindViewer);
      session = bindViewer;
      await refusal(await attach(id), 403, "not_allowed");
      assert.equal(await teamIdOf(id), null);
    });

    await test("POST: BAŞKASININ teklifi takıma çekilemez (403, satır değişmez)", async () => {
      // Takımın sahibi bile meslektaşının KİŞİSEL teklifini takıma çekemez:
      // dosyasını paylaşma kararı sahibinin.
      const id = await personalQuote(bindOwner);
      session = bindAdmin;
      const response = await attach(id);
      // Erişim kabuğu bu teklifi `bindAdmin`e hiç göstermiyor: cevap 404.
      assert.equal(response.status, 404);
      assert.equal(await teamIdOf(id), null);
    });

    await test("POST/DELETE: SİPARİŞE DÖNMÜŞ teklifte 409 `quote_has_order` (değişmez 5)", async () => {
      const orderId = randomUUID();
      await admin.query(
        `INSERT INTO orders (id, order_number, user_id, email, customer_name, shipping_address,
                             amount_kurus, payment_method)
           VALUES ($1, $2, $3, $4, 'QA Müşteri', $5, 10000, 'card')`,
        [
          orderId,
          `QA-${Date.now()}`,
          bindOwner.userId,
          bindOwner.email,
          JSON.stringify({
            adres: "Atatürk Cad. 1",
            ilce: "Kadıköy",
            il: "İstanbul",
            postaKodu: "34000",
            telefon: "+905321234567",
          }),
        ]
      );
      // 1) BAĞLAMA: kişisel teklif siparişe dönmüşse takıma bağlanamaz.
      const personal = await personalQuote(bindOwner);
      await db.update(quotes).set({ orderId }).where(eq(quotes.id, personal));
      session = bindOwner;
      await refusal(await attach(personal), 409, "quote_has_order");
      assert.equal(await teamIdOf(personal), null);

      // 2) AYIRMA: ödenmiş bir işin sahipliği de oynatılmaz.
      const attached = await personalQuote(bindOwner);
      session = bindOwner;
      assert.equal((await attach(attached)).status, 200);
      await db.update(quotes).set({ orderId: null }).where(eq(quotes.id, personal));
      await db.update(quotes).set({ orderId }).where(eq(quotes.id, attached));
      await refusal(await detach(attached), 409, "quote_has_order");
      assert.equal(await teamIdOf(attached), bindTeamId, "siparişli teklif takımdan ayrıldı");
      await db.update(quotes).set({ orderId: null }).where(eq(quotes.id, attached));
      // FİKSTÜR TEMİZLENİR: dosyanın kapanış iddiası ("takım yolu para hattına
      // dokunmadı") `orders` tablosunu SAYIYOR. Bu satırı bırakmak, o iddiayı
      // takım kodunun yazdığı bir satır sanıp kırmızıya düşürürdü — oysa onu
      // bu vaka, elle, sipariş koşulunu kurmak için yazdı.
      await admin.query("DELETE FROM orders WHERE id = $1", [orderId]);
    });

    await test("DELETE: takımın yetkilisi ayırır, BAŞKA bir takımın yetkilisi AYIRAMAZ", async () => {
      const id = await personalQuote(bindOwner);
      session = bindOwner;
      assert.equal((await attach(id)).status, 200);

      // BAŞKA takımın sahibi (`owner`, en yüksek rütbe) bu teklife hiç
      // erişemiyor: değişmez 6 — bağlama/ayırma TEK bir takıma göredir.
      session = owner;
      assert.equal((await detach(id)).status, 404);
      assert.equal(await teamIdOf(id), bindTeamId, "başka takımın yetkilisi ayırdı");

      // Takımın yöneticisi, teklifi KENDİSİ açmasa da ayırır.
      session = bindAdmin;
      const response = await detach(id);
      assert.equal(response.status, 200);
      const payload = await body(response);
      assert.equal(payload.success, true);
      // Ayıran kişi teklifi kendisi AÇMADIĞI için erişimini de kaybetti:
      // `quote: null` bir hata değil, ekranın "tekliften çık" işareti.
      assert.equal(payload.quote, null);
      assert.equal(await teamIdOf(id), null);
      const actions = (
        await admin.query(
          "SELECT action FROM customer_team_actions WHERE team_id = $1 AND target_quote_id = $2 ORDER BY created_at",
          [bindTeamId, id]
        )
      ).rows.map((r: { action: string }) => r.action);
      assert.deepEqual(actions, ["quote_attached", "quote_detached"]);
    });

    await test("bayrak KAPALIYKEN bağlama ucu 404 (403 DEĞİL) döner", async () => {
      const id = await personalQuote(bindOwner);
      await setFlag("quote_teams_enabled", false, "qa");
      session = bindOwner;
      const response = await attach(id);
      assert.equal(response.status, 404);
      assert.equal((await body(response)).code, "team_not_found");
      await setFlag("quote_teams_enabled", true, "qa");
    });

    await test("SOHBET ASİMETRİSİ: `viewer` rolü GET'te 200, POST'ta 404 alır", async () => {
      const id = await personalQuote(bindOwner);
      session = bindOwner;
      assert.equal((await attach(id)).status, 200);

      session = bindViewer;
      const read = await messagesRoute.GET(req(`/api/quotes/${id}/messages`), {
        params: Promise.resolve({ id }),
      });
      assert.equal(read.status, 200, "salt okunur üye yazışmayı okuyamadı");
      assert.deepEqual(await read.json(), { messages: [], unreadCount: 0 });

      const write = await messagesRoute.POST(
        req(`/api/quotes/${id}/messages`, { method: "POST" }),
        { params: Promise.resolve({ id }) }
      );
      // Cevap BİÇİMİ bugünküyle aynı: `quoteNotFound()` — uç hiçbir hakkı
      // "var ama sana kapalı" diye duyurmaz.
      assert.equal(write.status, 404);
      assert.equal((await body(write)).code, "quote_not_found");

      // DÜZENLEYEBİLEN üye yazabilir (`canChatOnQuote`).
      session = bindAdmin;
      const ok = await messagesRoute.POST(
        new NextRequest(`https://qa.example.test/api/quotes/${id}/messages`, {
          method: "POST",
          headers: { "x-real-ip": clientIp },
          body: (() => {
            const form = new FormData();
            form.set("body", "Takımın mesajı");
            return form;
          })(),
        }),
        { params: Promise.resolve({ id }) }
      );
      assert.equal(ok.status, 200, "düzenleyebilen üye sohbete yazamadı");
      const thread = (await ok.json()) as { messages: Array<{ body: string }> };
      assert.equal(thread.messages.at(-1)?.body, "Takımın mesajı");
    });

    await test("`viewer` rolü takımın parçasını İÇE AKTARAMAZ (hedef `forEdit` kapısı)", async () => {
      // KAYNAK kapsamı (T-4) rol SORMUYOR ve bu bilinçli: takımın dört rolü de
      // kütüphanede takımın parçasını görür (tasarım §4). İçe aktarmayı
      // durduran şey HEDEF teklife yazma yetkisidir. Vaka tam olarak o kapıyı
      // ölçüyor ve cevabın KODU ayrımı taşıyor: `quote_not_found` = hedef
      // kapısı (`accessOr404(..., { forEdit: true })`), kaynak kapsamının kodu
      // olan `part_not_found` DEĞİL.
      const sourceQuote = await personalQuote(bindOwner);
      const targetQuote = await personalQuote(bindOwner);
      session = bindOwner;
      assert.equal((await attach(sourceQuote)).status, 200);
      assert.equal((await attach(targetQuote)).status, 200);

      // Kaynak parça GERÇEK bir dosyaya işaret ediyor: aşağıdaki OLUMLU
      // KONTROL dosyayı diskten kopyalıyor (`copyPartInto`), yani dosyasız bir
      // fikstür vakayı "yetki" yüzünden değil ENOENT yüzünden kırmızı yapardı.
      const partId = randomUUID();
      const sourceKey = `quote-parts/${partId}/source.stl`;
      fs.mkdirSync(path.join(uploadDir, "quote-parts", partId), { recursive: true });
      fs.writeFileSync(path.join(uploadDir, sourceKey), "solid qa\nendsolid qa\n");
      await admin.query(
        `INSERT INTO quote_parts
           (id, quote_id, name, file_name, source_key, source_format, source_bytes, source_sha256,
            technology_key, material_key, color_key, finish_key)
         VALUES ($1, $2, 'Takımın parçası', 'braket.stl', $3, 'stl', 2048, $4,
                 'fdm', 'pla', 'beyaz', 'ham')`,
        [partId, sourceQuote, sourceKey, "e".repeat(64)]
      );

      const importInto = (quoteId: string) =>
        partsImportRoute.POST(
          req(`/api/quotes/${quoteId}/parts/import`, {
            method: "POST",
            body: { sourcePartIds: [partId] },
          }),
          { params: Promise.resolve({ id: quoteId }) }
        );
      const partCount = async (quoteId: string): Promise<number> =>
        (
          await admin.query("SELECT count(*)::int AS n FROM quote_parts WHERE quote_id = $1", [
            quoteId,
          ])
        ).rows[0].n;

      session = bindViewer;
      const refused = await importInto(targetQuote);
      assert.equal(refused.status, 404, "salt okunur rol takımın parçasını içe aktardı");
      assert.equal((await body(refused)).code, "quote_not_found");
      assert.equal(await partCount(targetQuote), 0, "reddedilen istek hedefe satır yazdı");

      // OLUMLU KONTROL: aynı kaynak, aynı hedef, aynı gövde — yalnız ROL
      // değişti. `bindAdmin` hedefi KENDİSİ açmadı; yetkisi takım rolünden
      // geliyor, yani 404'ü üreten şey rolün salt okunur olmasıydı.
      session = bindAdmin;
      const allowed = await importInto(targetQuote);
      assert.equal(allowed.status, 200, "düzenleyebilen rol içe aktaramadı");
      assert.equal(await partCount(targetQuote), 1, "içe aktarılan parça yazılmadı");

      // Analiz kuyruğu QA Redis'inde PAYLAŞILIYOR: içe aktarılan parça bir iş
      // doğurdu ve sonraki turlara artık bırakılmaz.
      const { getQuoteAnalysisQueue } = await import("../src/lib/queue/quote-queues");
      await getQuoteAnalysisQueue()
        .obliterate({ force: true })
        .catch(() => {});
    });

    await test("PARA HATTINA DOKUNULMADI: hiç taslak/sipariş yazılmadı", async () => {
      // Bu sevkiyat hiçbir tutar, kalem ya da indirim üretmez. İddia sayımla:
      // yukarıdaki onlarca uç çağrısından sonra ödeme tabloları hâlâ BOŞ.
      for (const table of ["order_drafts", "orders", "quote_checkouts"]) {
        assert.equal(
          (await admin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,
          0,
          `${table} satırı yazıldı — takım yazma yolu para hattına dokundu`
        );
      }
    });


    // ─── T-5 · TAKIM SİPARİŞLERİ (SALT OKUNUR) ──────────────────────────────
    //
    // SIRA BİR KURALDIR: bu bölüm "PARA HATTINA DOKUNULMADI" vakasından SONRA
    // duruyor. O vaka takım YAZMA yolunun hiçbir taslak/sipariş satırı
    // üretmediğini sayarak kanıtlıyor; aşağıdaki satırlar ise FİKSTÜRDÜR ve
    // doğrudan `admin.query` ile yazılıyor (uygulama kodundan değil). Önce
    // yazılsalar o sayım kırmızıya düşer ve kanıt kaybolurdu.
    //
    // Ölçülen şey TÜRETİLMİŞ GÖRÜNÜRLÜK: `quotes.team_id` ⋈ `quotes.order_id`.
    // `orders` tablosuna hiçbir kolon eklenmedi (tasarım §0), yani bağ bu iki
    // kolondan başka hiçbir yerde yazılı değil.
    const teamOrdersRoute = await import("../src/app/api/customer/team/orders/route");
    const teamOrderDetailRoute = await import(
      "../src/app/api/customer/team/orders/[orderNumber]/route"
    );

    const payer = await makeUser("odeyen");
    const PAYER_NAME = "QA Ödeyen Kişi";
    const PAYER_ADDRESS = {
      adres: "Gizli Mahalle 1. Sokak No 2 Daire 3",
      mahalle: "Gizli",
      ilce: "Kadıköy",
      il: "İstanbul",
      postaKodu: "34000",
      telefon: "+905551112233",
    };

    /**
     * Bir teklifi ÖDENMİŞ siparişe çevirir — gerçek kolonlarla, gerçek bağla.
     *
     * `order_drafts` satırı zorunlu çünkü `quote_checkouts.draft_id` NOT NULL:
     * parça listesinin kaynağı ödeme anında donan `parts_snapshot` ve o satır
     * taslağa bağlı. Bağ yine `quotes.order_id`tir — bu yüzden fikstür de onu
     * yazıyor, uydurma bir kolon değil.
     */
    async function makePaidOrder(args: {
      quoteId: string;
      orderNumber: string;
      amountKurus: number;
      partName: string;
    }): Promise<void> {
      const draftId = (
        await admin.query(
          `INSERT INTO order_drafts (reference, user_id, email, customer_name, shipping_address,
             payment_method, amount_kurus)
           VALUES ($1, $2, $3, $4, $5::jsonb, 'card', $6) RETURNING id`,
          [
            `QA-DRAFT-${args.orderNumber}`,
            payer.userId,
            payer.email,
            PAYER_NAME,
            JSON.stringify(PAYER_ADDRESS),
            args.amountKurus,
          ]
        )
      ).rows[0].id as string;
      const orderId = (
        await admin.query(
          `INSERT INTO orders (order_number, user_id, draft_id, email, customer_name,
             shipping_address, payment_method, amount_kurus, status, tracking_number)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'card', $7, 'printing', 'QA-TRACK-1')
           RETURNING id`,
          [
            args.orderNumber,
            payer.userId,
            draftId,
            payer.email,
            PAYER_NAME,
            JSON.stringify(PAYER_ADDRESS),
            args.amountKurus,
          ]
        )
      ).rows[0].id as string;
      await admin.query(
        `INSERT INTO quote_checkouts (quote_id, draft_id, quote_version, amount_kurus,
           parts_snapshot, lead_days)
         VALUES ($1, $2, 1, $3, $4::jsonb, 5)`,
        [
          args.quoteId,
          draftId,
          args.amountKurus,
          JSON.stringify([
            {
              partId: randomUUID(),
              position: 1,
              name: args.partName,
              fileName: "gizli-dosya-adi.stl",
              sourceFormat: "stl",
              canonicalStlKey: "quotes/qa/gizli-anahtar.stl",
              thumbnailKey: null,
              drawingKey: null,
              drawingName: null,
              scaleFactor: 1,
              technologyKey: "fdm",
              technologyName: "FDM",
              materialKey: "pla",
              materialName: "PLA",
              colorName: "Siyah",
              colorHex: "#000000",
              finishKey: "standard",
              finishName: "Standart",
              layerUm: 200,
              infillPct: 20,
              quantity: 2,
              dimensionsMm: { x: 40, y: 30, z: 20 },
              volumeCm3: 12,
              tessellationMm: null,
              unitKurus: 7400,
              lineKurus: 14800,
              note: null,
              dfmWarnings: [],
            },
          ]),
        ]
      );
      await admin.query("UPDATE quotes SET order_id = $1, status = 'ordered' WHERE id = $2", [
        orderId,
        args.quoteId,
      ]);
    }

    const listTeamOrders = () =>
      teamOrdersRoute.GET(req("/api/customer/team/orders"));
    const readTeamOrder = (orderNumber: string) =>
      teamOrderDetailRoute.GET(
        req(`/api/customer/team/orders/${encodeURIComponent(orderNumber)}`),
        { params: Promise.resolve({ orderNumber }) }
      );

    // Bağ takımının İKİ teklifi: biri siparişe döndü, biri dönmedi.
    const orderedQuoteId = await personalQuote(bindOwner);
    await admin.query("UPDATE quotes SET team_id = $1 WHERE id = $2", [
      bindTeamId,
      orderedQuoteId,
    ]);
    await makePaidOrder({
      quoteId: orderedQuoteId,
      orderNumber: "FIG-QA-TEAM-1",
      amountKurus: 14800,
      partName: "Takım kalıbı",
    });
    const pendingQuoteId = await personalQuote(bindOwner);
    await admin.query("UPDATE quotes SET team_id = $1 WHERE id = $2", [
      bindTeamId,
      pendingQuoteId,
    ]);
    // BAŞKA takımın siparişi (ilk takım, `QA Mühendislik A.Ş.`).
    await makePaidOrder({
      quoteId: created.id,
      orderNumber: "FIG-QA-OTHER-1",
      amountKurus: 99900,
      partName: "Yabancı takımın parçası",
    });

    await test("LİSTE: üye yalnız KENDİ takımının siparişe dönmüş tekliflerini görür", async () => {
      session = bindOwner;
      const response = await listTeamOrders();
      assert.equal(response.status, 200);
      const rows = (await body(response)).orders as Array<Record<string, unknown>>;
      const numbers = rows.map((r) => r.orderNumber);
      assert.deepEqual(numbers, ["FIG-QA-TEAM-1"], `beklenmeyen liste: ${numbers.join(", ")}`);
      // Siparişi OLMAYAN takım teklifi listede yok (türetilmiş görünürlük:
      // `order_id IS NULL` satır üretmez).
      assert.equal(
        (await admin.query("SELECT order_id FROM quotes WHERE id = $1", [pendingQuoteId]))
          .rows[0].order_id,
        null
      );
      // Tutar UÇTAN gelir ve kuruştur; ekran yalnız basar.
      assert.equal(rows[0].amountKurus, 14800);
      assert.equal(rows[0].trackingNumber, "QA-TRACK-1");
      assert.equal(rows[0].status, "printing");
    });

    await test("LİSTE/DETAY: BAŞKA takımın siparişi ne listede ne detayda", async () => {
      session = bindOwner;
      const rows = (await body(await listTeamOrders())).orders as Array<Record<string, unknown>>;
      assert.ok(
        !rows.some((r) => r.orderNumber === "FIG-QA-OTHER-1"),
        "başka takımın siparişi listeye girdi"
      );
      // Numarayı BİLMEK hak vermiyor: görünürlük tek `WHERE`de, takım
      // kimliğiyle birlikte.
      await refusal(await readTeamOrder("FIG-QA-OTHER-1"), 404, "quote_not_found");
    });

    await test("DETAY: parça listesi `parts_snapshot`tan gelir; ÖDEYEN ve ADRES YOK", async () => {
      session = bindOwner;
      const response = await readTeamOrder("FIG-QA-TEAM-1");
      assert.equal(response.status, 200);
      const payload = await body(response);
      const order = payload.order as Record<string, unknown>;
      assert.equal(order.orderNumber, "FIG-QA-TEAM-1");
      assert.equal(order.amountKurus, 14800);
      assert.equal(order.trackingNumber, "QA-TRACK-1");
      const parts = order.parts as Array<Record<string, unknown>>;
      assert.equal(parts.length, 1, "donmuş parça listesi gelmedi");
      assert.equal(parts[0].name, "Takım kalıbı");
      assert.equal(parts[0].quantity, 2);
      assert.equal(parts[0].lineKurus, 14800);

      // ÖDEME ARACI DA YOK: `card | bank_transfer | gift_card_full` kümesi,
      // meslektaşının siparişini HEDİYE KARTI bakiyesiyle ödediğini söylerdi —
      // `/privacy` §5.1 "ödeme araçlarınız… paylaşılmaz" diyor. Liste ucu da
      // göndermiyor. MUTASYON SINAVI: `select`e `paymentMethod`ı geri koy →
      // bu iddia KIRMIZI (statik eşi `test-customer-team-api.ts`te).
      assert.ok(
        !Object.prototype.hasOwnProperty.call(order, "paymentMethod"),
        "detay cevabı ödeme aracını taşıyor"
      );
      const listRow = ((await body(await listTeamOrders())).orders as Array<
        Record<string, unknown>
      >)[0];
      assert.ok(
        !Object.prototype.hasOwnProperty.call(listRow, "paymentMethod"),
        "liste cevabı ödeme aracını taşıyor"
      );

      // DEĞİŞMEZ 4 — CANLI KANIT: gövdenin HİÇBİR yerinde ödeyenin adı,
      // e-postası, telefonu, teslimat adresi ya da depolama anahtarı yok.
      const wire = JSON.stringify(payload);
      for (const secret of [
        PAYER_NAME,
        payer.email,
        PAYER_ADDRESS.adres,
        PAYER_ADDRESS.telefon,
        PAYER_ADDRESS.postaKodu,
        "gizli-anahtar.stl",
        "gizli-dosya-adi.stl",
      ]) {
        assert.ok(!wire.includes(secret), `cevapta sızan alan: ${secret}`);
      }
    });

    await test("DETAY: İKİ dondurmalı teklifte SİPARİŞİN taslağındaki liste gelir", async () => {
      // Bir teklifte birden çok dondurma GERÇEK bir hâl: taslak süresi dolup
      // müşteri yeniden ödemeye başladığında yeni taslak + yeni dondurma
      // yazılır. Tekillik `quote_checkouts_draft_id_uq` ile `draft_id`
      // üzerinde; `quote_id` üzerinde yalnız indeks var. "Teklifin en yeni
      // dondurması" ile seçmek, siparişe dönMEYEN denemenin satır fiyatlarını
      // bu siparişin yanında göstermek olurdu (Σ lineKurus ≠ amount_kurus).
      // MUTASYON SINAVI: seçimi `quoteId` + `desc(createdAt)`e çevir → KIRMIZI.
      const orderDraftId = (
        await admin.query("SELECT draft_id FROM orders WHERE order_number = $1", [
          "FIG-QA-TEAM-1",
        ])
      ).rows[0].draft_id as string;
      const strayDraftId = (
        await admin.query(
          `INSERT INTO order_drafts (reference, user_id, email, customer_name, shipping_address,
             payment_method, amount_kurus)
           VALUES ($1, $2, $3, $4, $5::jsonb, 'card', $6) RETURNING id`,
          [
            "QA-DRAFT-STRAY-1",
            payer.userId,
            payer.email,
            PAYER_NAME,
            JSON.stringify(PAYER_ADDRESS),
            999900,
          ]
        )
      ).rows[0].id as string;
      assert.notEqual(strayDraftId, orderDraftId, "fikstür aynı taslağı yazdı");
      // SONRA yazılan ve DAHA YÜKSEK tutarlı dondurma: sıra yanlışsa gövdede
      // bu satır görünür.
      await admin.query(
        `INSERT INTO quote_checkouts (quote_id, draft_id, quote_version, amount_kurus,
           parts_snapshot, lead_days, created_at)
         VALUES ($1, $2, 2, $3, $4::jsonb, 99, now() + interval '1 minute')`,
        [
          orderedQuoteId,
          strayDraftId,
          999900,
          JSON.stringify([
            {
              partId: randomUUID(),
              position: 1,
              name: "YANLIŞ DONDURMA",
              fileName: "yanlis.stl",
              sourceFormat: "stl",
              canonicalStlKey: "quotes/qa/yanlis.stl",
              thumbnailKey: null,
              drawingKey: null,
              drawingName: null,
              scaleFactor: 1,
              technologyKey: "fdm",
              technologyName: "FDM",
              materialKey: "pla",
              materialName: "PLA",
              colorName: "Siyah",
              colorHex: "#000000",
              finishKey: "standard",
              finishName: "Standart",
              layerUm: 200,
              infillPct: 20,
              quantity: 10,
              dimensionsMm: { x: 40, y: 30, z: 20 },
              volumeCm3: 12,
              tessellationMm: null,
              unitKurus: 99990,
              lineKurus: 999900,
              note: null,
              dfmWarnings: [],
            },
          ]),
        ]
      );
      session = bindOwner;
      const order = (await body(await readTeamOrder("FIG-QA-TEAM-1"))).order as Record<
        string,
        unknown
      >;
      const parts = order.parts as Array<Record<string, unknown>>;
      assert.equal(parts.length, 1);
      assert.equal(parts[0].name, "Takım kalıbı", "yanlış dondurmanın parçası geldi");
      assert.equal(order.leadDays, 5, "yanlış dondurmanın teslim süresi geldi");
      // PARA TUTARLILIĞI: satırların toplamı siparişin tutarıdır. (Ekranda
      // aritmetik yok; bu toplam TESTİN kendi ölçümü.)
      assert.equal(
        parts.reduce((sum, part) => sum + Number(part.lineKurus), 0),
        order.amountKurus,
        "satır fiyatları siparişin tutarıyla tutmuyor"
      );
    });

    await test("DETAY: `viewer` rolü de OKUR (takım yalnız okur, ama HEPSİ okur)", async () => {
      session = bindViewer;
      const list = (await body(await listTeamOrders())).orders as Array<Record<string, unknown>>;
      assert.deepEqual(list.map((r) => r.orderNumber), ["FIG-QA-TEAM-1"]);
      const detail = await readTeamOrder("FIG-QA-TEAM-1");
      assert.equal(detail.status, 200, "salt okunur rol siparişi okuyamadı");
    });

    await test("ÇIKARILAN ÜYE: bir sonraki istekte liste BOŞ, detay 404", async () => {
      const exMember = await makeUser("eski-uye");
      await admin.query(
        "INSERT INTO customer_team_members (team_id, user_id, role) VALUES ($1, $2, 'member')",
        [bindTeamId, exMember.userId]
      );
      session = exMember;
      assert.equal((await readTeamOrder("FIG-QA-TEAM-1")).status, 200, "üye okuyamadı");

      // Üyelik SATIRI silinir — önbellek yok, gecikme yok.
      await admin.query("DELETE FROM customer_team_members WHERE team_id = $1 AND user_id = $2", [
        bindTeamId,
        exMember.userId,
      ]);
      const list = (await body(await listTeamOrders())).orders as unknown[];
      assert.deepEqual(list, [], "çıkarılan üye listeyi hâlâ görüyor");
      await refusal(await readTeamOrder("FIG-QA-TEAM-1"), 404, "quote_not_found");
    });

    await test("BAYRAK KAPALI: takım sipariş uçları 404 (403 DEĞİL)", async () => {
      await setFlag("quote_teams_enabled", false, "qa");
      try {
        session = bindOwner;
        await refusal(await listTeamOrders(), 404, "team_not_found");
        await refusal(await readTeamOrder("FIG-QA-TEAM-1"), 404, "team_not_found");
      } finally {
        await setFlag("quote_teams_enabled", true, "qa");
      }
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
