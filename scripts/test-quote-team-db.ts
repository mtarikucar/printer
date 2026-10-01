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
          body: { email: invited.email.toUpperCase(), role: "member" },
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
            body: { email: stranger.email, role: "viewer" },
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
          body: { email: invited.email, role: "viewer" },
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
            body: { email: invited.email, role: "member" },
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
          body: { email: rival.email, role: "member" },
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
            body: { email: rival.email, role: "member" },
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
          body: { email: heir.email, role: "member" },
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
            body: { email: target.email, role: "member" },
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
            body: { email: stranger.email, role: "viewer" },
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
