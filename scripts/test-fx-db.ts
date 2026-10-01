/**
 * Kur satırlarının GERÇEK veritabanı yolu: izole 55433 şeması, gerçek 0071
 * DDL'i (schema.ts'ten üretilmiş), gerçek tekil indeks.
 *
 * Üç şeyi kanıtlar ve üçü de "kur bozulursa ne olur" sorusunun cevabıdır:
 *
 * 1. MUTLU YOL + TEKİLLİK: aynı bültenin ikinci kez çekilmesi tek satır
 *    bırakır (`ON CONFLICT DO NOTHING`), yani drizzle'ın hata sarması hiç
 *    devreye girmez — yakalanan bir pg hatasında `.code` `undefined` olurdu
 *    (gerçek kod `.cause` üstünde), o yüzden tekillik veritabanına bırakıldı.
 * 2. BOZULMUŞ YOL: kur HİÇ yoksa, BAYAT ise ya da YARIM ise
 *    `loadActiveFxSnapshot()` `null` döner — "döviz gösterimi yok". Hiçbir
 *    fiyat yanlış olmaz, hiçbir sayfa düşmez, yalnız ₺ gösterilir. Yanlış kur
 *    göstermek hiç göstermemekten kötüdür.
 * 3. `catalogUpdatedAt()` REGRESYONU: `fx_rates`e satır yazmak kataloğun son
 *    değişme anını DEĞİŞTİRMEZ ve açık bir teklifin
 *    `catalogChangedSinceSnapshot`ını `true` yapmaz. Kur `quote_pricing_settings`
 *    tablosuna konulsaydı ya da `catalogUpdatedAt()`ın `greatest(...)` listesine
 *    `fx_rates` eklenseydi, her sabah AÇIK HER TEKLİFTE "Katalog güncellendi —
 *    yeniden fiyatla" bandı yanardı. Bu iddia ZORUNLUDUR.
 *
 * Kullanıcının dev veritabanına (5432) ya da dev Redis'ine (6379) ASLA
 * bağlanmaz.
 *
 * Çalıştırma:
 *   npx tsx --env-file=<qa.env> scripts/test-fx-db.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { ParsedFxBulletin } from "../src/lib/services/fx-rates";

const raw = process.env.QA_QUOTE_DB_URL;
if (!raw) throw new Error("Explicit QA_QUOTE_DB_URL is required");
const url = new URL(raw);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55433" ||
  url.pathname !== "/printer_qa" ||
  url.search
) {
  throw new Error("Only 127.0.0.1:55433/printer_qa without connection options is allowed");
}
const redisUrl = process.env.QA_REDIS_URL;
if (!redisUrl) throw new Error("QA_REDIS_URL required");
if (!new URL(redisUrl).port.startsWith("56")) throw new Error("Refusing non-QA redis");
process.env.REDIS_URL = redisUrl;

const root = path.resolve(import.meta.dirname, "..");
const namespace = `fx_${Date.now()}_${process.pid}`;
const ddlOut = fs.mkdtempSync(path.join(os.tmpdir(), "fx-ddl-"));
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "fx-uploads-"));
process.env.UPLOAD_DIR = uploads;
process.env.FILES_SIGNING_SECRET = "qa-signing-secret";
process.env.NEXT_PUBLIC_APP_URL = "https://qa.example.test";
process.env.AUTH_SECRET = "qa-auth-secret-0123456789abcdef0123456789";
process.env.ADMIN_EMAIL = "qa-admin@example.test";

const admin = new pg.Client({ connectionString: raw });
let pool: pg.Pool | undefined;
let checks = 0;

const test = async (name: string, run: () => Promise<void>) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};

/** Bülten tarihi: 2026-09-25 CUMA. 3 iş günü sonrası ÇARŞAMBA 2026-09-30. */
const BULLETIN = "2026-09-25";
const THIRD_BUSINESS_DAY = new Date("2026-09-30T09:00:00Z");
const FOURTH_BUSINESS_DAY = new Date("2026-10-01T09:00:00Z");
/** "Bülten bugün eksik, dünkü satır taze" vakası: PAZARTESİ yayım, SALI okuma. */
const MONDAY = "2026-09-28";
const TUESDAY = new Date("2026-09-29T09:00:00Z");

async function main() {
  await admin.connect();
  try {
    execFileSync(
      "npx",
      ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"],
      { env: { ...process.env, SCRATCH_OUT: ddlOut }, stdio: "ignore" }
    );
    const ddl = fs
      .readFileSync(
        path.join(ddlOut, fs.readdirSync(ddlOut).find((f) => f.endsWith(".sql"))!),
        "utf8"
      )
      .replace(/"public"\./g, "");
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await admin.query(`SET search_path TO ${namespace}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter((s) => s.trim())) {
      await admin.query(statement);
    }
    // Katalog + ayar satırı GERÇEK migration zincirinden gelir (0064 tohumu ve
    // ondan sonraki veri migration'ları): tatil listesi de fiyat politikası da
    // canlıdaki değerlerdir, testin uydurduğu sayılar değil.
    const seedStatements = fs
      .readFileSync(path.join(root, "drizzle/0064_instant_quotes.sql"), "utf8")
      .split("--> statement-breakpoint")
      .filter((s) => /\bINSERT INTO\b/.test(s));
    for (const statement of seedStatements) {
      await admin.query(statement.replace(/"public"\./g, ""));
    }
    const journal = JSON.parse(
      fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8")
    ) as { entries: Array<{ idx: number; tag: string }> };
    for (const entry of journal.entries.filter((e) => e.idx > 64).sort((a, b) => a.idx - b.idx)) {
      const statements = fs
        .readFileSync(path.join(root, `drizzle/${entry.tag}.sql`), "utf8")
        .replace(/"public"\./g, "")
        .split("--> statement-breakpoint")
        .filter((s) => /\b(INSERT INTO|UPDATE)\s+"?(print_|quote_pricing_settings)/.test(s));
      for (const statement of statements) {
        await admin.query(statement);
      }
    }

    url.searchParams.set("options", `-c search_path=${namespace}`);
    process.env.DATABASE_URL = url.toString();

    const { db } = await import("../src/lib/db");
    pool = (db as typeof db & { $client: pg.Pool }).$client;
    const { eq } = await import("drizzle-orm");
    const { fxRates, quotes } = await import("../src/lib/db/schema");
    const { catalogUpdatedAt, loadActiveSnapshot } = await import(
      "../src/lib/services/quote-catalog"
    );
    const { createQuote, loadPresentedQuote } = await import("../src/lib/services/quote-service");
    const {
      loadActiveFxSnapshot,
      loadFxAdminOverview,
      loadLatestFxBulletin,
      refreshFxRates,
      upsertFxBulletin,
    } = await import("../src/lib/services/fx-rates");
    const { FLAG_DEFAULTS } = await import("../src/lib/config/flags");
    const { isFlagEnabled, setFlag } = await import("../src/lib/services/flags");
    const { runFxRefreshJob } = await import("../src/lib/queue/workers/fx-refresh.worker");

    const snapshot = await loadActiveSnapshot();
    /** Tatil listesinin KAYNAĞI: `quote_pricing_settings.holidays` (ikinci takvim yok). */
    const catalogHolidays = snapshot.settings.holidays;

    const bulletin = (date: string): ParsedFxBulletin => ({
      bulletinDate: date,
      rates: [
        { currency: "EUR", microTryPerUnit: 48_741_200, bulletinUnit: 1 },
        { currency: "USD", microTryPerUnit: 41_523_100, bulletinUnit: 1 },
        { currency: "GBP", microTryPerUnit: 55_903_400, bulletinUnit: 1 },
      ],
    });
    const rowCount = async () => {
      const { rows } = await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM fx_rates`);
      return Number(rows[0].n);
    };

    await test("tatil listesi kataloğun ayar satırından okunur (gün anahtarı biçiminde)", async () => {
      assert.ok(Array.isArray(catalogHolidays), "settings.holidays bir liste olmalı");
      for (const day of catalogHolidays) {
        assert.match(day, /^\d{4}-\d{2}-\d{2}$/, `tatil gün anahtarı değil: ${day}`);
      }
    });

    // ─── Bozulmuş yol 1: kur HİÇ yok ───────────────────────────────────────

    await test("BOZULMUŞ YOL 1: `fx_rates` BOŞ → `loadActiveFxSnapshot()` null", async () => {
      assert.equal(await rowCount(), 0, "test boş tabloyla başlamalı");
      assert.equal(await loadActiveFxSnapshot(catalogHolidays, THIRD_BUSINESS_DAY), null);
      assert.equal(await loadLatestFxBulletin(), null);
      const overview = await loadFxAdminOverview(catalogHolidays, THIRD_BUSINESS_DAY);
      assert.equal(overview.bulletin, null);
      assert.equal(overview.stale, true, "bülten yoksa ekran BAYAT uyarısı göstermeli");
      assert.equal(overview.staleAfter, null);
    });

    // ─── `catalogUpdatedAt()` tuzağı: ÖNCE ölç ──────────────────────────────

    const catalogBefore = await catalogUpdatedAt();
    const anonymousId = randomUUID();
    const quote = await createQuote({ userId: null, anonymousId, termsAccepted: true });
    const access = async () => {
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quote.id)).limit(1);
      assert.ok(row, "teklif satırı okunabildi");
      return {
        quote: row,
        viewer: {
          canSeePrices: true,
          canEdit: true,
          isOwner: true,
          isShare: false,
          isAdmin: false,
          isTeam: false,
          teamRole: null,
        },
        sessionUserId: null,
        // 0072: kişisel teklif, takım yok. Üyeliği erişim kabuğu okur
        // (`resolveQuoteTeam`); bu dosya kabuğu atlayıp servisi doğrudan
        // çağırdığı için alanları KENDİSİ beyan eder. `teamId` satırdan gelir
        // (kabuk da öyle yapıyor), `team` ise üyelik olmadığı için `null`.
        teamId: row.teamId,
        team: null,
      };
    };

    await test("teklif açıldığında katalog bandı YANMIYOR (çıkış durumu)", async () => {
      const view = await loadPresentedQuote(await access());
      assert.equal(view.catalogChangedSinceSnapshot, false);
    });

    // ─── Mutlu yol + tekillik ───────────────────────────────────────────────

    await test("bülten yazılır: üç satır", async () => {
      assert.equal(await upsertFxBulletin(bulletin(BULLETIN)), 3);
      assert.equal(await rowCount(), 3);
    });

    await test("AYNI (currency, bulletin_date) ikinci kez → tek satır, HATA YOK", async () => {
      // `ON CONFLICT DO NOTHING`: hata yakalama yolu hiç açılmaz, yani
      // drizzle'ın `.code`u yutan hata sarması bu yolda hiç devreye girmez.
      assert.equal(await upsertFxBulletin(bulletin(BULLETIN)), 0, "ikinci yazım satır EKLEMEZ");
      assert.equal(await rowCount(), 3, "tekil indeks ikinci satırı engelledi");
    });

    await test("MUTLU YOL: üç kurlu snapshot, `bulletinDate` DB'deki değerle birebir", async () => {
      const stored = await admin.query<{ bulletin_date: string }>(
        `SELECT DISTINCT bulletin_date::text AS bulletin_date FROM fx_rates`
      );
      assert.equal(stored.rows.length, 1);
      const active = await loadActiveFxSnapshot(catalogHolidays, THIRD_BUSINESS_DAY);
      assert.ok(active, "kur taze: snapshot dönmeliydi");
      assert.equal(active.version, 1);
      assert.equal(active.source, "tcmb");
      assert.equal(active.bulletinDate, stored.rows[0].bulletin_date);
      assert.equal(active.bulletinDate, BULLETIN);
      assert.equal(active.takenAt, THIRD_BUSINESS_DAY.toISOString());
      assert.deepEqual(active.rates, [
        { currency: "EUR", microTryPerUnit: 48_741_200 },
        { currency: "USD", microTryPerUnit: 41_523_100 },
        { currency: "GBP", microTryPerUnit: 55_903_400 },
      ]);
    });

    await test("kur MİKRO-TRY tamsayısı olarak geri gelir (bigint kayan noktaya dönmüyor)", async () => {
      const latest = await loadLatestFxBulletin();
      assert.ok(latest);
      for (const rate of latest.rates) {
        assert.ok(
          Number.isSafeInteger(rate.microTryPerUnit),
          `${rate.currency} kuru tamsayı değil: ${rate.microTryPerUnit}`
        );
        assert.equal(rate.bulletinUnit, 1);
      }
      assert.ok(latest.fetchedAt instanceof Date, "operatörün 'kur güncel mi' damgası yok");
    });

    // ─── `catalogUpdatedAt()` REGRESYONU (ZORUNLU) ──────────────────────────

    await test("REGRESYON: `fx_rates`e yazmak `catalogUpdatedAt()`ı DEĞİŞTİRMEZ", async () => {
      const after = await catalogUpdatedAt();
      assert.equal(
        after.getTime(),
        catalogBefore.getTime(),
        "kur yazımı kataloğun son değişme anını oynattı: her sabah açık her " +
          "teklifte 'Katalog güncellendi — yeniden fiyatla' bandı yanar"
      );
    });

    await test("REGRESYON (uçtan uca): açık teklifin bandı HÂLÂ yanmıyor", async () => {
      const view = await loadPresentedQuote(await access());
      assert.equal(
        view.catalogChangedSinceSnapshot,
        false,
        "kur yazımı müşteriye 'yeniden fiyatla' dedi"
      );
    });

    // ─── Bozulmuş yol 2: BAYAT kur ──────────────────────────────────────────

    await test("BOZULMUŞ YOL 2: 4 iş günü eski bülten → null (bayat kur SESSİZCE kullanılmaz)", async () => {
      assert.equal(await loadActiveFxSnapshot([], FOURTH_BUSINESS_DAY), null);
      const overview = await loadFxAdminOverview([], FOURTH_BUSINESS_DAY);
      assert.equal(overview.stale, true, "admin ekranı bayat uyarısı göstermeli");
      assert.equal(overview.staleAfter, "2026-09-30");
      assert.equal(overview.bulletin?.bulletinDate, BULLETIN, "bayat satır YERİNDE kalır");
    });

    await test("BAYATLIK İŞ GÜNÜ ölçüsü: `holidays` bir iş günü eksiltince aynı an TAZE", async () => {
      const active = await loadActiveFxSnapshot(["2026-09-29"], FOURTH_BUSINESS_DAY);
      assert.ok(active, "tatil sayılmayınca bülten 3. iş gününde olmalıydı");
      assert.equal(active.bulletinDate, BULLETIN);
    });

    await test("daha yeni bülten yazılınca EN YENİSİ okunur", async () => {
      assert.equal(await upsertFxBulletin(bulletin("2026-09-28")), 3);
      const active = await loadActiveFxSnapshot([], FOURTH_BUSINESS_DAY);
      assert.ok(active, "yeni bülten taze");
      assert.equal(active.bulletinDate, "2026-09-28");
      assert.equal(await rowCount(), 6, "eski bülten silinmez, arşiv kalır");
    });

    // ─── Bozulmuş yol 3: YARIM bülten ───────────────────────────────────────

    await test("BOZULMUŞ YOL 3: en yeni bültende GBP eksikse → null (yarım küme gösterilmez)", async () => {
      await db.delete(fxRates).where(eq(fxRates.bulletinDate, "2026-09-28"));
      await admin.query(`DELETE FROM fx_rates WHERE bulletin_date = $1 AND currency = 'GBP'`, [
        BULLETIN,
      ]);
      const latest = await loadLatestFxBulletin();
      assert.equal(latest?.rates.length, 2, "iki satırlık yarım bülten kurulamadı");
      assert.equal(await loadActiveFxSnapshot([], THIRD_BUSINESS_DAY), null);
    });

    // ─── Negatif kontrol: yukarıdaki regresyon iddiası BEDAVA yeşil değil ───

    await test("NEGATİF KONTROL: GERÇEK bir katalog yazımı bandı YAKAR", async () => {
      // Yukarıdaki iki regresyon iddiası, mekanizma ölü olsa da yeşil kalırdı.
      // Bu vaka mekanizmanın CANLI olduğunu kanıtlar: katalog tablosuna
      // dokunmak `catalogUpdatedAt()`ı oynatır ve açık teklifte bandı yakar —
      // yani `fx_rates`in aynı şeyi YAPMAMASI gerçek bir bilgidir.
      await admin.query(`UPDATE print_addons SET updated_at = now() + interval '1 second'`);
      const after = await catalogUpdatedAt();
      assert.ok(after.getTime() > catalogBefore.getTime(), "katalog yazımı ölçüyü oynatmadı");
      const view = await loadPresentedQuote(await access());
      assert.equal(view.catalogChangedSinceSnapshot, true);
    });

    // ─── Bozulmuş yol 4: BUGÜNÜN bülteni eksik, DÜNKÜ satır TAZE ───────────

    await test("BUGÜN bülten YOK ama DÜNKÜ satır TAZE → gösterim ÇALIŞIR, tarih DÜNÜN", async () => {
      // Bu hâl ARIZA DEĞİL, normal çalışma: TCMB yalnız iş günü yayımlıyor ve
      // bülten gün içinde geç çıkabiliyor. Kritik olan şu: "bugünün kuru" diye
      // dünkü rakamı BUGÜNÜN tarihiyle damgalamıyoruz — müşteriye DÜNÜN tarihi
      // AYNEN gösteriliyor. Aksi hâlde belgede yazan tarih, TCMB'de o tarihte
      // yayımlanmış rakamla TUTMAZDI.
      assert.equal(await upsertFxBulletin(bulletin(MONDAY)), 3, "dünkü tam bülten kurulamadı");
      const active = await loadActiveFxSnapshot([], TUESDAY);
      assert.ok(active, "DÜN yayımlanmış taze bülten gösterimi kapattı");
      assert.equal(active.bulletinDate, MONDAY, "bülten tarihi BUGÜNE kaydırılmış");
      // `takenAt` OKUMA anıdır, bültenin tarihi DEĞİL: ikisi karışmamalı.
      assert.equal(active.takenAt, TUESDAY.toISOString());
      const overview = await loadFxAdminOverview([], TUESDAY);
      assert.equal(overview.stale, false, "bir iş günü eski bülten bayat sayıldı");
      assert.equal(overview.bulletin?.bulletinDate, MONDAY, "admin ekranı dünün tarihini yazmıyor");
    });

    // ─── Bozulmuş yol 5: TCMB erişilemez ───────────────────────────────────

    await test("TCMB ERİŞİLEMEZ: tur satır YAZMAZ, son satır YERİNDE kalır, ATMAZ", async () => {
      const before = await rowCount();
      const latestBefore = await loadLatestFxBulletin();
      assert.ok(latestBefore, "vaka geçerli bir son satırla başlamalı");

      const realFetch = globalThis.fetch;
      const realWarn = console.warn;
      const warnings: string[] = [];
      globalThis.fetch = (() => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch;
      console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
      let outcome: Awaited<ReturnType<typeof refreshFxRates>>;
      try {
        // FIRLATMIYOR: etiketli sonuç döner. Atan bir tur, işçinin yeniden
        // deneme yolunu değil çağıranın yolunu bozardı (admin ucu da bunu
        // DOĞRUDAN çağırıyor).
        outcome = await refreshFxRates();
      } finally {
        globalThis.fetch = realFetch;
        console.warn = realWarn;
      }
      assert.equal(outcome.ok, false, "erişilemeyen TCMB başarılı sayıldı");
      assert.ok(!outcome.ok && outcome.reason === "network_error", `etiket: ${JSON.stringify(outcome)}`);
      assert.ok(
        warnings.some((w) => w.includes("ECONNRESET")),
        "yutulan arıza günlüğe yazılmadı: kimsenin bakmadığı bir arıza olurdu"
      );

      assert.equal(await rowCount(), before, "başarısız tur satır yazdı");
      assert.deepEqual(
        await loadLatestFxBulletin(),
        latestBefore,
        "son geçerli kur yerinden oynadı (fail-closed bozuldu)"
      );
      // …ve gösterim HÂLÂ çalışıyor: erişilemeyen bir tur, elde duran taze
      // bülteni geçersiz kılmaz.
      const active = await loadActiveFxSnapshot([], TUESDAY);
      assert.equal(active?.bulletinDate, MONDAY, "başarısız tur gösterimi kapattı");
    });

    // ─── Bayrak-kapalı kanıtı: tur ilk satırda çıkar ────────────────────────

    await test("BAYRAK KAPALI: tur TCMB'ye HİÇ çıkmaz ve satır YAZMAZ", async () => {
      // Kapatma bir DB satırıdır (`platform_flags`), dağıtım gerektirmez. Bu
      // vaka onun worker tarafındaki karşılığı: kapalı bir özellik için dış
      // servise çıkılmaz ve tabloya dokunulmaz. Kapı gerçekten İLK satırda:
      // `fetch` ATAN bir vekile bağlanıyor, yani çağrılsa tur kırmızıya döner.
      const before = await rowCount();
      const latestBefore = await loadLatestFxBulletin();
      // Üretimdeki ÇIKIŞ DURUMU derlenmiş varsayılanda yazılı.
      assert.equal(
        FLAG_DEFAULTS.quote_fx_display_enabled,
        false,
        "özelliğin çıkış durumu artık KAPALI değil: bu vakanın konusu değişti"
      );
      // …ama bayrak AÇIKÇA yazılır, varsayılana bırakılmaz: `isFlagEnabled`
      // cevabı 10 saniyelik bir REDİS önbeleğinde duruyor ve QA Redis'i turlar
      // arasında PAYLAŞILIYOR (tek kullanımlık ŞEMA onu izole etmiyor) — bir
      // önceki tur bayrağı açık bırakırsa vaka rastgele kırmızıya dönerdi.
      // `setFlag` önbelleği sildiği için koşum deterministik olur. Emsal:
      // `scripts/test-quote-checkout-db.ts` hediye kartı bayrağı.
      await setFlag("quote_fx_display_enabled", false, "qa");
      assert.equal(await isFlagEnabled("quote_fx_display_enabled"), false);

      const logs: string[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (() => {
        throw new Error("bayrak KAPALIYKEN TCMB'ye çıkıldı");
      }) as unknown as typeof fetch;
      try {
        await runFxRefreshJob({
          log: async (message: string) => logs.push(message),
        });
      } finally {
        globalThis.fetch = realFetch;
      }

      assert.equal(await rowCount(), before, "kapalı bayrakta satır yazıldı");
      assert.deepEqual(await loadLatestFxBulletin(), latestBefore, "kapalı bayrakta satır oynadı");
      assert.ok(
        logs.some((l) => l.includes("quote_fx_display_enabled")),
        `turun atlandığı işin günlüğüne yazılmadı: ${JSON.stringify(logs)}`
      );
    });

    console.log(`${checks} fx DB checks passed`);
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
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
