/**
 * Bakım işinin GERÇEK yoluyla testi: izole 55433 şeması + tek kullanımlık
 * UPLOAD_DIR + QA Redis. Taklit edilen tek şey SMTP sürücüsüdür (mektup
 * sokete çıkmaz, listeye yazılır); durumlar, tekil kolonlar ve DOSYALAR
 * gerçektir.
 *
 * Burada sınanan dört şey, işin gözetimsiz koşmasının şartıdır:
 *  - süre dolumu YALNIZ vadesi geçmiş, siparişe dönmemiş teklifi vurur,
 *  - işlemsel hatırlatma BİR KEZ gider (iki eşzamanlı tur tek mektup üretir),
 *  - terk hatırlatması ticari ileti iznine BAĞLIDIR (ETK 6563),
 *  - saklama süpürmesi süresi dolan teklifin dosyasını siler ama BAŞKA bir
 *    canlı parçanın gösterdiği anahtara ve siparişe dönmüş teklife dokunmaz,
 *  - yetim dizin süpürmesi yalnız SATIRI OLMAYAN, beklemesi dolmuş dizini
 *    toplar (canlı parçanın dizinine ve paylaşılan dosyaya dokunmaz),
 *  - sahipsiz kalmış hediye kartı rezervasyonu (bakiye düştü, sipariş doğmadı)
 *    siparişe çevrilir; çevrilemiyorsa tur KIRMIZI olur ama öteki aşamalar
 *    yine koşar.
 *
 * `server-only` TAKOZU BİLEREK KURULMADI: bu dosya `quote-maintenance.ts`'i
 * düz Node altında import eder. Zincire `server-only` sızarsa (örn.
 * `quote-checkout.ts`) import burada patlar — worker sürecindeki crash-loop'un
 * ta kendisi, testte bedava yakalanır.
 *
 * Kullanıcının dev veritabanına (5432) ya da dev Redis'ine (6379) ASLA
 * bağlanmaz.
 *
 * Çalıştırma:
 *   npx tsx --env-file=<qa.env> scripts/test-quote-maintenance-db.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { PricingSnapshot, QuoteStatus } from "../src/lib/config/quote-types";

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
const namespace = `quote_maint_${Date.now()}_${process.pid}`;
const ddlOut = fs.mkdtempSync(path.join(os.tmpdir(), "quote-maint-ddl-"));
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "quote-maint-uploads-"));
// Depolama kökü MODÜL YÜKLENİRKEN okunuyor (storage.ts) — her `import`tan önce.
process.env.UPLOAD_DIR = uploads;
process.env.FILES_SIGNING_SECRET = "qa-signing-secret";
process.env.AUTH_SECRET = "qa-auth-secret-0123456789abcdef0123456789";
process.env.ADMIN_EMAIL = "qa-admin@example.test";
process.env.NEXT_PUBLIC_APP_URL = "https://qa.example.test";

const admin = new pg.Client({ connectionString });
let pool: pg.Pool | undefined;
let checks = 0;

/** Giden mektuplar: SMTP sürücüsü kayda alınır, sokete çıkılmaz. */
const sentMail: Array<{ to: string; subject: string; html: string }> = [];
/**
 * Mektup SOKETE ÇIKARKEN koşan kanca: "tam bu mektup gönderilirken veritabanı
 * neye benziyordu" sorusunu sormanın tek yolu. Damganın parti olarak mı satır
 * satır mı vurulduğu ancak buradan görülebilir.
 */
let onSend: ((to: string) => Promise<void>) | null = null;
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
    const hook = onSend;
    if (!hook) {
      callback(null, { accepted: [mail.data.to], rejected: [] });
      return;
    }
    hook(mail.data.to).then(
      () => callback(null, { accepted: [mail.data.to], rejected: [] }),
      (err: unknown) => callback(err as Error, { accepted: [], rejected: [mail.data.to] })
    );
  };
}

const mailsTo = (to: string) => sentMail.filter((m) => m.to === to);

const test = async (name: string, run: () => Promise<void>) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};

const syncTest = (name: string, run: () => void) => {
  run();
  checks++;
  console.log(`PASS ${name}`);
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
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
    // Katalog + ayar satırı GERÇEK migration'dan gelir: saklama süresi
    // (90 gün) canlıdaki değerdir, testin uydurduğu bir sayı değil.
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
    const {
      giftCardRedemptions,
      giftCards,
      orderDrafts,
      orders,
      quoteCheckouts,
      quoteParts,
      quotes,
      users,
    } = await import("../src/lib/db/schema");
    const { loadActiveSnapshot } = await import("../src/lib/services/quote-catalog");
    const {
      ABANDONED_AFTER_HOURS,
      EXPIRY_REMINDER_DAYS,
      ORPHAN_DIR_BATCH,
      ORPHAN_DIR_GRACE_HOURS,
      STUCK_GIFT_DRAFT_GRACE_MINUTES,
      expireQuotes,
      promoteStuckGiftCoveredDrafts,
      purgeExpiredQuoteFiles,
      runQuoteMaintenance,
      sendAbandonedReminders,
      sendExpiryReminders,
      sweepOrphanQuotePartDirs,
    } = await import("../src/lib/services/quote-maintenance");

    const snapshot: PricingSnapshot = await loadActiveSnapshot();
    const address = {
      adres: "Atatürk Cad. No:1",
      mahalle: "Merkez",
      ilce: "Kadıköy",
      il: "İstanbul",
      postaKodu: "34000",
      telefon: "+905321234567",
    };

    async function makeUser(opts: { marketingConsent?: boolean; tag: string }) {
      const id = randomUUID();
      const email = `${opts.tag}-${id.slice(0, 8)}@example.test`;
      await db.insert(users).values({
        id,
        email,
        fullName: "Teklif Müşterisi",
        marketingConsent: opts.marketingConsent ?? false,
      });
      return { id, email };
    }

    async function makeQuote(values: {
      userId?: string | null;
      status?: QuoteStatus;
      expiresAt: Date;
      totalKurus?: number | null;
      updatedAt?: Date;
      orderId?: string | null;
    }): Promise<string> {
      const [row] = await db
        .insert(quotes)
        .values({
          userId: values.userId ?? null,
          anonymousId: values.userId ? null : `anon-${randomUUID()}`,
          status: values.status ?? "quoted",
          pricingSnapshot: snapshot,
          expiresAt: values.expiresAt,
          totalKurus: values.totalKurus === undefined ? 199_00 : values.totalKurus,
          leadDays: 7,
          orderId: values.orderId ?? null,
          ...(values.updatedAt ? { updatedAt: values.updatedAt } : {}),
        })
        .returning({ id: quotes.id });
      return row.id;
    }

    /** Diske GERÇEK bir dosya yazar ve depolama anahtarını döner. */
    function writeKey(dir: string, filename: string): string {
      const key = `quote-parts/${dir}/${filename}`;
      fs.mkdirSync(path.join(uploads, "quote-parts", dir), { recursive: true });
      fs.writeFileSync(path.join(uploads, key), `bytes:${key}`);
      return key;
    }

    const onDisk = (key: string) => fs.existsSync(path.join(uploads, key));

    /** Dizinin son değişme zamanını geriye alır (yetim bekleme süresi sınavı). */
    function ageDir(dir: string, ms: number): void {
      const when = new Date(Date.now() - ms);
      fs.utimesSync(path.join(uploads, "quote-parts", dir), when, when);
    }

    const dirOnDisk = (dir: string) => fs.existsSync(path.join(uploads, "quote-parts", dir));

    async function makePart(
      quoteId: string,
      keys: {
        /** Dizin adı parçanın kimliğidir: yetim süpürmesi tam olarak buna bakar. */
        id?: string;
        sourceKey: string;
        canonicalStlKey?: string | null;
        previewGlbKey?: string | null;
        thumbnailKey?: string | null;
        drawingKey?: string | null;
      }
    ): Promise<string> {
      const tech = snapshot.technologies[0];
      const material = snapshot.materials.find((m) => m.technologyKey === tech.key)!;
      const finish = snapshot.finishes.find(
        (f) => f.technologyKey === null || f.technologyKey === tech.key
      )!;
      const [row] = await db
        .insert(quoteParts)
        .values({
          quoteId,
          name: "Parça",
          fileName: "part.stl",
          sourceFormat: "stl",
          sourceBytes: 1024,
          sourceSha256: randomUUID().replace(/-/g, ""),
          technologyKey: tech.key,
          materialKey: material.key,
          colorKey: material.colors[0].key,
          finishKey: finish.key,
          ...keys,
        })
        .returning({ id: quoteParts.id });
      return row.id;
    }

    const statusOf = async (quoteId: string): Promise<string> => {
      const [row] = await db
        .select({ status: quotes.status })
        .from(quotes)
        .where(eq(quotes.id, quoteId));
      return row.status;
    };
    const reminderStamps = async (quoteId: string) => {
      const [row] = await db
        .select({
          expiry: quotes.expiryReminderSentAt,
          abandoned: quotes.abandonedReminderSentAt,
          updatedAt: quotes.updatedAt,
        })
        .from(quotes)
        .where(eq(quotes.id, quoteId));
      return row;
    };
    const purgedAt = async (partId: string): Promise<Date | null> => {
      const [row] = await db
        .select({ at: quoteParts.filesPurgedAt })
        .from(quoteParts)
        .where(eq(quoteParts.id, partId));
      return row.at;
    };

    /** Teklife bağlı ödeme taslağı (terk hatırlatmasını kapatan köprü). */
    async function makeCheckout(quoteId: string, userId: string, email: string) {
      const [draft] = await db
        .insert(orderDrafts)
        .values({
          reference: `QA-${randomUUID().slice(0, 12)}`,
          userId,
          email,
          customerName: "Teklif Müşterisi",
          shippingAddress: address,
          paymentMethod: "card",
          amountKurus: 199_00,
        })
        .returning({ id: orderDrafts.id });
      await db.insert(quoteCheckouts).values({
        quoteId,
        draftId: draft.id,
        quoteVersion: 1,
        amountKurus: 199_00,
        partsSnapshot: [],
        leadDays: 7,
      });
    }

    /**
     * Tamamı hediye kartıyla karşılanmış ama SİPARİŞE DÖNEMEMİŞ teklif taslağı.
     *
     * Üretimde bu hâl, tam karşılanan ödemede `promoteDraftToOrder`ın patlaması
     * (ya da sürecin tam o anda ölmesi) ile doğar: bakiye düşmüş, kullanım kaydı
     * yazılmış, ama sipariş yok. `bridged: false` teklif köprüsü olmayan
     * (`/api/orders` yolundan gelen) taslağı, `returned: true` rezervasyonu
     * çoktan iade edilmiş — yani terfi EDEMEYECEK — taslağı kurar.
     */
    async function makeStuckGiftDraft(opts: {
      userId: string;
      email: string;
      ageMs: number;
      bridged?: boolean;
      returned?: boolean;
    }): Promise<{
      draftId: string;
      reference: string;
      quoteId: string;
      cardId: string;
      amountKurus: number;
    }> {
      const amountKurus = 199_00;
      const quoteId = await makeQuote({
        userId: opts.userId,
        status: "quoted",
        expiresAt: new Date(Date.now() + 30 * DAY),
      });
      const [card] = await db
        .insert(giftCards)
        .values({
          code: `GC-MAINT-${randomUUID().slice(0, 8).toUpperCase()}`,
          amountKurus,
          // Rezervasyon zaten yapılmış: bakiye düştü, kart kapandı.
          balanceKurus: 0,
          status: "fully_used",
          paidAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * DAY),
        })
        .returning({ id: giftCards.id });
      const [draft] = await db
        .insert(orderDrafts)
        .values({
          reference: `FIG-QA${randomUUID().slice(0, 6).toUpperCase()}`,
          userId: opts.userId,
          email: opts.email,
          customerName: "Teklif Müşterisi",
          shippingAddress: address,
          orderType: "upload",
          paymentMethod: "gift_card_full",
          status: "pending",
          amountKurus,
          productionBaseKurus: amountKurus,
          giftCardId: card.id,
          giftCardAmountKurus: amountKurus,
          createdAt: new Date(Date.now() - opts.ageMs),
        })
        .returning({ id: orderDrafts.id, reference: orderDrafts.reference });
      await db.insert(giftCardRedemptions).values({
        giftCardId: card.id,
        draftId: draft.id,
        amountKurus,
        redeemedByUserId: opts.userId,
        ...(opts.returned ? { refundedAt: new Date() } : {}),
      });
      if (opts.bridged !== false) {
        await db.insert(quoteCheckouts).values({
          quoteId,
          draftId: draft.id,
          quoteVersion: 1,
          amountKurus,
          partsSnapshot: [],
          leadDays: 7,
        });
      }
      return { draftId: draft.id, reference: draft.reference, quoteId, cardId: card.id, amountKurus };
    }

    async function makeOrder(userId: string, email: string): Promise<string> {
      const id = randomUUID();
      await db.insert(orders).values({
        id,
        orderNumber: `FIG-QA-${id.slice(0, 8).toUpperCase()}`,
        userId,
        email,
        customerName: "Teklif Müşterisi",
        shippingAddress: address,
        orderType: "custom",
        paymentMethod: "card",
        amountKurus: 199_00,
      });
      return id;
    }

    // ─── 1) Süre dolumu ─────────────────────────────────────────────────────

    await test("süre dolumu YALNIZ vadesi geçmiş, siparişsiz teklifi vurur", async () => {
      const now = new Date();
      const user = await makeUser({ tag: "expire" });
      const orderId = await makeOrder(user.id, user.email);

      const pastDraft = await makeQuote({
        userId: user.id,
        status: "draft",
        expiresAt: new Date(now.getTime() - HOUR),
      });
      const pastReview = await makeQuote({
        userId: user.id,
        status: "needs_review",
        expiresAt: new Date(now.getTime() - DAY),
        totalKurus: null,
      });
      const future = await makeQuote({
        userId: user.id,
        status: "quoted",
        // Uzak vade: bu teklif sonraki sınavların hatırlatma penceresine
        // düşmesin (aynı şemada koşuyorlar).
        expiresAt: new Date(now.getTime() + 30 * DAY),
      });
      // Ödenmiş teklif: vadesi geçmiş olsa da SİPARİŞİ vardır, dokunulmaz.
      const ordered = await makeQuote({
        userId: user.id,
        status: "quoted",
        expiresAt: new Date(now.getTime() - 5 * DAY),
        orderId,
      });
      const alreadyExpired = await makeQuote({
        userId: user.id,
        status: "expired",
        expiresAt: new Date(now.getTime() - 9 * DAY),
      });

      assert.equal(await expireQuotes(now), 2, "yalnız iki teklifin süresi dolmalı");
      assert.equal(await statusOf(pastDraft), "expired");
      assert.equal(await statusOf(pastReview), "expired");
      assert.equal(await statusOf(future), "quoted");
      assert.equal(await statusOf(ordered), "quoted", "siparişli teklif korunur");
      assert.equal(await statusOf(alreadyExpired), "expired");

      // İkinci tur: aynı satırlar yeniden sayılmaz (iş saatte bir koşuyor).
      assert.equal(await expireQuotes(new Date(now.getTime() + 1000)), 0);
    });

    // ─── 2) Süre dolumu hatırlatması (işlemsel) ─────────────────────────────

    await test("süre hatırlatması: fiyatlı ve sahipli teklife BİR kez gider", async () => {
      const now = new Date();
      const user = await makeUser({ tag: "expiry-rem" });
      const soon = await makeQuote({
        userId: user.id,
        status: "quoted",
        expiresAt: new Date(now.getTime() + 2 * DAY),
      });

      assert.equal(await sendExpiryReminders(now), 1);
      const mails = mailsTo(user.email);
      assert.equal(mails.length, 1, "tek mektup");
      assert.match(mails[0].subject, /süresi dolmak üzere/i);
      const stamps = await reminderStamps(soon);
      assert.ok(stamps.expiry, "expiry_reminder_sent_at yazıldı");

      // İkinci tur sessiz: kolon dolu.
      assert.equal(await sendExpiryReminders(new Date(now.getTime() + 1000)), 0);
      assert.equal(mailsTo(user.email).length, 1, "ikinci mektup YOK");
    });

    await test("süre hatırlatması: ÖTEKİ tur satırı almışsa ikinci tur susar", async () => {
      // Yarış BURADA gerçekten kuruluyor: ayrı bir bağlantıda açık bir işlem
      // satırı sahiplenip TUTUYOR; süpürme aday listesini (henüz boş kolonu
      // gören) anlık görüntüyle çıkarıyor, sonra satır kilidinde bekliyor.
      // Kilit çözülünce koşullu `UPDATE`in yeniden süzmesi tek savunmadır:
      // süzmeseydi müşteri aynı mektubu iki kez alırdı.
      const now = new Date();
      const user = await makeUser({ tag: "expiry-race" });
      const quoteId = await makeQuote({
        userId: user.id,
        status: "quoted",
        expiresAt: new Date(now.getTime() + DAY),
      });

      await admin.query("BEGIN");
      const claimed = await admin.query(
        `UPDATE quotes SET expiry_reminder_sent_at = now()
         WHERE id = $1 AND expiry_reminder_sent_at IS NULL RETURNING id`,
        [quoteId]
      );
      assert.equal(claimed.rowCount, 1, "öteki tur satırı sahiplendi");

      const sweep = sendExpiryReminders(now);
      // Süpürmenin kilide girmesi için nefes payı; sonra öteki tur commit eder.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await admin.query("COMMIT");

      assert.equal(await sweep, 0, "ikinci tur satırı sahiplenmemeli");
      assert.equal(mailsTo(user.email).length, 0, "çift gönderim YOK");
    });

    await test("süre hatırlatması: penceresiz / sahipsiz / fiyatsız teklif atlanır", async () => {
      const now = new Date();
      const far = await makeUser({ tag: "expiry-far" });
      const anon = await makeUser({ tag: "expiry-anon" });
      const unpriced = await makeUser({ tag: "expiry-unpriced" });

      const farQuote = await makeQuote({
        userId: far.id,
        expiresAt: new Date(now.getTime() + (EXPIRY_REMINDER_DAYS + 2) * DAY),
      });
      // Anonim teklif: yazacak adres yok.
      const anonQuote = await makeQuote({
        userId: null,
        expiresAt: new Date(now.getTime() + DAY),
      });
      // Fiyatlanamayan teklif: hatırlatacak bir fiyat yok.
      const unpricedQuote = await makeQuote({
        userId: unpriced.id,
        expiresAt: new Date(now.getTime() + DAY),
        totalKurus: null,
      });

      assert.equal(await sendExpiryReminders(now), 0);
      assert.equal(mailsTo(far.email).length, 0);
      assert.equal(mailsTo(anon.email).length, 0);
      assert.equal(mailsTo(unpriced.email).length, 0);
      for (const id of [farQuote, anonQuote, unpricedQuote]) {
        assert.equal((await reminderStamps(id)).expiry, null);
      }
    });

    await test("süre hatırlatması SATIR SATIR damgalanır, parti önden damgalanmaz", async () => {
      // Kırılan hâl: tur önce 200 satırın hepsini "gönderildi" damgalıyor, sonra
      // mektupları yazıyordu. Dağıtımın ortasında gelen bir SIGTERM 195
      // hatırlatmayı gönderilmemiş ama gönderilmiş SAYILMIŞ bırakır — ve damga
      // kolonu dolduğu için bir daha hiç denenmez. Ölçü: mektup sokete çıkarken
      // kaç satır damgalı?
      const now = new Date();
      const user = await makeUser({ tag: "row-claim" });
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push(
          await makeQuote({
            userId: user.id,
            status: "quoted",
            expiresAt: new Date(now.getTime() + (i + 1) * HOUR),
          })
        );
      }
      const stampedWhenSent: number[] = [];
      onSend = async () => {
        const res = await admin.query(
          `SELECT count(*)::int AS n FROM quotes
             WHERE id = ANY($1) AND expiry_reminder_sent_at IS NOT NULL`,
          [ids]
        );
        stampedWhenSent.push(res.rows[0].n as number);
      };
      try {
        assert.equal(await sendExpiryReminders(now), 3);
      } finally {
        onSend = null;
      }

      assert.deepEqual(
        stampedWhenSent,
        [1, 2, 3],
        "her mektup, YALNIZ kendi satırı damgalıyken gitmeli (parti damgası 3,3,3 verirdi)"
      );
      assert.equal(mailsTo(user.email).length, 3);
      for (const id of ids) assert.ok((await reminderStamps(id)).expiry, "üçü de damgalandı");
    });

    // ─── 3) Terk hatırlatması (pazarlama) ───────────────────────────────────

    await test("terk hatırlatması YALNIZ ticari ileti izni olana gider", async () => {
      const now = new Date();
      const idle = new Date(now.getTime() - (ABANDONED_AFTER_HOURS + 1) * HOUR);
      const willing = await makeUser({ marketingConsent: true, tag: "abandon-yes" });
      const refusing = await makeUser({ marketingConsent: false, tag: "abandon-no" });

      const consented = await makeQuote({
        userId: willing.id,
        expiresAt: new Date(now.getTime() + 20 * DAY),
        updatedAt: idle,
      });
      const withoutConsent = await makeQuote({
        userId: refusing.id,
        expiresAt: new Date(now.getTime() + 20 * DAY),
        updatedAt: idle,
      });

      assert.equal(await sendAbandonedReminders(now), 1);
      assert.equal(mailsTo(willing.email).length, 1, "izinli müşteriye tek mektup");
      assert.match(mailsTo(willing.email)[0].subject, /sizi bekliyor/i);
      assert.equal(mailsTo(refusing.email).length, 0, "izinsiz müşteriye mektup YOK");
      assert.ok((await reminderStamps(consented)).abandoned);
      assert.equal(
        (await reminderStamps(withoutConsent)).abandoned,
        null,
        "izinsiz teklifin kolonu BOŞ kalır (izin sonradan verilirse gider)"
      );

      assert.equal(await sendAbandonedReminders(new Date(now.getTime() + 1000)), 0);
      assert.equal(mailsTo(willing.email).length, 1);
    });

    await test("terk hatırlatması: taze teklif ve ödemesi başlamış teklif atlanır", async () => {
      const now = new Date();
      const fresh = await makeUser({ marketingConsent: true, tag: "abandon-fresh" });
      const paying = await makeUser({ marketingConsent: true, tag: "abandon-paying" });

      const freshQuote = await makeQuote({
        userId: fresh.id,
        expiresAt: new Date(now.getTime() + 20 * DAY),
        updatedAt: new Date(now.getTime() - 2 * HOUR),
      });
      const payingQuote = await makeQuote({
        userId: paying.id,
        expiresAt: new Date(now.getTime() + 20 * DAY),
        updatedAt: new Date(now.getTime() - 30 * HOUR),
      });
      await makeCheckout(payingQuote, paying.id, paying.email);

      assert.equal(await sendAbandonedReminders(now), 0);
      assert.equal(mailsTo(fresh.email).length, 0);
      assert.equal(mailsTo(paying.email).length, 0, "ödeme yolundaki teklif pazarlama konusu değil");
      assert.equal((await reminderStamps(freshQuote)).abandoned, null);
      assert.equal((await reminderStamps(payingQuote)).abandoned, null);
    });

    await test("terk hatırlatması da satır satır damgalanır", async () => {
      // Aynı kural pazarlama dalında DAHA çok önemli: yarıda kesilen bir tur,
      // izni olan müşterinin hiç almadığı bir mektubu "gitti" sayar.
      const now = new Date();
      const idle = new Date(now.getTime() - (ABANDONED_AFTER_HOURS + 2) * HOUR);
      const user = await makeUser({ marketingConsent: true, tag: "row-claim-abandon" });
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        ids.push(
          await makeQuote({
            userId: user.id,
            expiresAt: new Date(now.getTime() + 20 * DAY),
            updatedAt: new Date(idle.getTime() - i * HOUR),
          })
        );
      }
      const stampedWhenSent: number[] = [];
      onSend = async () => {
        const res = await admin.query(
          `SELECT count(*)::int AS n FROM quotes
             WHERE id = ANY($1) AND abandoned_reminder_sent_at IS NOT NULL`,
          [ids]
        );
        stampedWhenSent.push(res.rows[0].n as number);
      };
      try {
        assert.equal(await sendAbandonedReminders(now), 2);
      } finally {
        onSend = null;
      }
      assert.deepEqual(stampedWhenSent, [1, 2], "parti damgası 2,2 verirdi");
      assert.equal(mailsTo(user.email).length, 2);
    });

    await test("hatırlatma damgası teklifin updated_at'ini OYNATMAZ", async () => {
      // Oynatsaydı: terk saati her hatırlatmada sıfırlanır, "24 saattir
      // dokunulmadı" ölçüsü işin kendi yan etkisiyle yalanlanırdı.
      const now = new Date();
      const user = await makeUser({ marketingConsent: true, tag: "stamp" });
      const idle = new Date(now.getTime() - 40 * HOUR);
      const quoteId = await makeQuote({
        userId: user.id,
        expiresAt: new Date(now.getTime() + 2 * DAY),
        updatedAt: idle,
      });

      await sendExpiryReminders(now);
      await sendAbandonedReminders(now);
      const stamps = await reminderStamps(quoteId);
      assert.ok(stamps.expiry && stamps.abandoned, "iki hatırlatma da gitti");
      assert.equal(
        stamps.updatedAt.getTime(),
        idle.getTime(),
        "updated_at hatırlatmayla değişmemeli"
      );
    });

    // ─── 4) Saklama süpürmesi ───────────────────────────────────────────────

    await test("saklama: süresi dolan teklifin dosyaları silinir, paylaşılan anahtar KALIR", async () => {
      const now = new Date();
      const user = await makeUser({ tag: "purge" });
      const long = new Date(now.getTime() - 200 * DAY);

      // Süresi 200 gün önce dolmuş, siparişe dönmemiş teklif.
      const old = await makeQuote({
        userId: user.id,
        status: "expired",
        expiresAt: long,
      });
      // `duplicatePart` iki satıra AYNI anahtarı verir, `splitByTechnology`
      // satırı başka teklife taşır: paylaşılan anahtar gerçek bir hâldir.
      const sharedKey = writeKey("shared", "source.stl");
      const oldOwnCanonical = writeKey("old", "canonical.stl");
      const oldOwnSource = writeKey("old", "source.stl");
      const oldOwnThumb = writeKey("old", "thumb.webp");
      const oldOwnDrawing = writeKey("old", "drawing.pdf");

      const sharingPart = await makePart(old, {
        sourceKey: sharedKey,
        canonicalStlKey: oldOwnCanonical,
      });
      const ownPart = await makePart(old, {
        sourceKey: oldOwnSource,
        thumbnailKey: oldOwnThumb,
        drawingKey: oldOwnDrawing,
      });

      // Aynı anahtarı gösteren CANLI parça: dosya silinemez.
      const live = await makeQuote({
        userId: user.id,
        status: "draft",
        expiresAt: new Date(now.getTime() + 10 * DAY),
      });
      const livePart = await makePart(live, { sourceKey: sharedKey });

      // Süresi dolmuş ama saklama penceresi HENÜZ geçmemiş teklif.
      const recent = await makeQuote({
        userId: user.id,
        status: "expired",
        expiresAt: new Date(now.getTime() - 10 * DAY),
      });
      const recentKey = writeKey("recent", "source.stl");
      const recentPart = await makePart(recent, { sourceKey: recentKey });

      // İptal edilmiş AMA siparişi olan teklif: dosyaları asla silinmez.
      const orderId = await makeOrder(user.id, user.email);
      const ordered = await makeQuote({
        userId: user.id,
        status: "cancelled",
        expiresAt: long,
        orderId,
      });
      const orderedKey = writeKey("ordered", "source.stl");
      const orderedPart = await makePart(ordered, { sourceKey: orderedKey });

      assert.equal(await purgeExpiredQuoteFiles(now), 2, "yalnız eski teklifin iki parçası");

      assert.equal(onDisk(sharedKey), true, "canlı parçanın gösterdiği anahtar KORUNUR");
      for (const key of [oldOwnCanonical, oldOwnSource, oldOwnThumb, oldOwnDrawing]) {
        assert.equal(onDisk(key), false, `silinmeliydi: ${key}`);
      }
      assert.equal(onDisk(recentKey), true, "saklama penceresi dolmadı");
      assert.equal(onDisk(orderedKey), true, "siparişli teklifin dosyası korunur");

      assert.ok(await purgedAt(sharingPart));
      assert.ok(await purgedAt(ownPart));
      assert.equal(await purgedAt(livePart), null);
      assert.equal(await purgedAt(recentPart), null);
      assert.equal(await purgedAt(orderedPart), null);

      // İkinci tur: damgalı parçalar yeniden seçilmez.
      assert.equal(await purgeExpiredQuoteFiles(new Date(now.getTime() + 1000)), 0);

      // SON referans da süresini doldurunca dosya gerçekten gider.
      await db
        .update(quotes)
        .set({ status: "expired", expiresAt: long })
        .where(eq(quotes.id, live));
      assert.equal(await purgeExpiredQuoteFiles(new Date(now.getTime() + 2000)), 1);
      assert.equal(onDisk(sharedKey), false, "son referans gidince dosya silinir");
    });

    // ─── 4b) Yetim dizin süpürmesi ──────────────────────────────────────────

    await test("yetim süpürmesi: satırı olmayan ESKİ dizin gider, ötekiler kalır", async () => {
      const now = new Date();
      const user = await makeUser({ tag: "orphan" });
      const quote = await makeQuote({
        userId: user.id,
        status: "draft",
        expiresAt: new Date(now.getTime() + 20 * DAY),
      });

      // (a) İŞLEMİ GERİ ALINAN yükleme: `addPart` dosyayı işlem içinde taşır,
      //     satır yazılamazsa dosya `quote-parts/<id>/` altında sahipsiz kalır.
      //     Saklama süpürmesi onu asla bulamaz (satırdan okur).
      const rolledBack = randomUUID();
      const rolledBackKey = writeKey(rolledBack, "source.stl");
      ageDir(rolledBack, (ORPHAN_DIR_GRACE_HOURS + 1) * HOUR);

      // (b) CANLI parçanın dizini: satır var → yaşı ne olursa olsun dokunulmaz.
      const liveId = randomUUID();
      const liveKey = writeKey(liveId, "source.stl");
      await makePart(quote, { id: liveId, sourceKey: liveKey });
      ageDir(liveId, 400 * DAY);

      // (c) TAZE yetim: açık bir işlem tam şu an dosyayı taşımış olabilir.
      //     Bekleme süresi dolmadan silmek, commit edilmek üzere olan bir
      //     parçayı dosyasız bırakırdı.
      const fresh = randomUUID();
      const freshKey = writeKey(fresh, "source.stl");

      // (d) Dizin adı hiçbir parçanın kimliği DEĞİL, ama içindeki dosyayı BAŞKA
      //     bir satır gösteriyor (`duplicatePart` anahtarı paylaşır).
      const sharedDir = randomUUID();
      const sharedKey = writeKey(sharedDir, "canonical.stl");
      const holderId = randomUUID();
      const holderKey = writeKey(holderId, "source.stl");
      await makePart(quote, {
        id: holderId,
        sourceKey: holderKey,
        canonicalStlKey: sharedKey,
      });
      ageDir(sharedDir, (ORPHAN_DIR_GRACE_HOURS + 1) * HOUR);
      ageDir(holderId, (ORPHAN_DIR_GRACE_HOURS + 1) * HOUR);

      // (e) Kimlik biçiminde OLMAYAN dizin: bizim yazdığımız bir dizin değil,
      //     ne olduğu bilinmiyor → silinmez.
      const strangeKey = writeKey("elle-birakilmis", "not.txt");
      ageDir("elle-birakilmis", 400 * DAY);

      assert.equal(await sweepOrphanQuotePartDirs(now), 1, "yalnız (a) toplanır");
      assert.equal(onDisk(rolledBackKey), false, "sahipsiz dosya silinmeli");
      assert.equal(dirOnDisk(rolledBack), false, "boş kalan dizin de silinmeli");
      assert.equal(onDisk(liveKey), true, "CANLI parçanın dosyasına dokunulmaz");
      assert.equal(onDisk(freshKey), true, "bekleme süresi dolmadan silinmez");
      assert.equal(onDisk(sharedKey), true, "başka satırın gösterdiği dosya korunur");
      assert.equal(onDisk(holderKey), true);
      assert.equal(onDisk(strangeKey), true, "tanımadığımız dizin korunur");

      // İkinci tur: toplanacak bir şey kalmadı.
      assert.equal(await sweepOrphanQuotePartDirs(now), 0);

      // Bekleme süresi dolunca taze yetim de toplanır.
      ageDir(fresh, (ORPHAN_DIR_GRACE_HOURS + 1) * HOUR);
      assert.equal(await sweepOrphanQuotePartDirs(now), 1);
      assert.equal(onDisk(freshKey), false);
      assert.equal(dirOnDisk(fresh), false);
    });

    await test("yetim süpürmesi tavanı SİLMEYE konur, incelemeye değil", async () => {
      // Tavan incelemeye konsaydı (en eski N dizine bak) süpürme bir süre sonra
      // hiçbir yetimi bulamazdı: en eski dizinler neredeyse her zaman CANLI
      // parçaların dizinidir, yani tur her seferinde aynı satırları doğrular ve
      // arkalarındaki yetim sonsuza dek beklerdi.
      const now = new Date();
      const user = await makeUser({ tag: "orphan-cap" });
      const quote = await makeQuote({
        userId: user.id,
        status: "draft",
        expiresAt: new Date(now.getTime() + 20 * DAY),
      });

      for (let i = 0; i < ORPHAN_DIR_BATCH; i++) {
        const id = randomUUID();
        await makePart(quote, { id, sourceKey: writeKey(id, "source.stl") });
        ageDir(id, 30 * DAY);
      }
      // Yetim, canlıların HEPSİNDEN taze: "en eski N" penceresinin dışında.
      const late = randomUUID();
      const lateKey = writeKey(late, "source.stl");
      ageDir(late, (ORPHAN_DIR_GRACE_HOURS + 1) * HOUR);

      assert.equal(await sweepOrphanQuotePartDirs(now), 1, "sıranın sonundaki yetim de bulunur");
      assert.equal(onDisk(lateKey), false);
    });

    // ─── 5) Saatlik turun kendisi ───────────────────────────────────────────

    // ─── 6) Sahipsiz rezervasyon: terfi edemeyen gift_card_full taslağı ─────

    await test("sahipsiz rezervasyon: beklemesi dolmuş gift_card_full taslağı siparişe döner", async () => {
      // Bu aşama para güvenlik ağıdır: bakiye düşmüş ama sipariş doğmamışsa
      // müşterinin hediye kartı harcanmış ve karşılığında hiçbir şey yoktur.
      const user = await makeUser({ tag: "gift-stuck" });
      const stuck = await makeStuckGiftDraft({
        userId: user.id,
        email: user.email,
        ageMs: (STUCK_GIFT_DRAFT_GRACE_MINUTES + 1) * 60_000,
      });
      const fresh = await makeStuckGiftDraft({
        userId: user.id,
        email: user.email,
        ageMs: 60_000,
      });
      const figurine = await makeStuckGiftDraft({
        userId: user.id,
        email: user.email,
        ageMs: (STUCK_GIFT_DRAFT_GRACE_MINUTES + 1) * 60_000,
        bridged: false,
      });

      assert.equal(
        await promoteStuckGiftCoveredDrafts(new Date()),
        1,
        "yalnız beklemesi dolmuş TEKLİF taslağı terfi etti"
      );

      const [confirmed] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.id, stuck.draftId));
      assert.equal(confirmed.status, "confirmed");
      assert.ok(confirmed.promotedOrderId, "sipariş kimliği taslağa yazıldı");
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, confirmed.promotedOrderId!));
      assert.equal(order.orderNumber, stuck.reference);
      assert.equal(order.paymentStatus, "succeeded");
      assert.equal(order.amountKurus, stuck.amountKurus, "BRÜT tutar siparişe taşındı");
      assert.equal(
        order.giftCardAmountKurus,
        stuck.amountKurus,
        "hediye kartı payı siparişe taşındı (iade motoru onu okuyor)"
      );
      // Teklif de bağlandı: müşteri artık siparişini görüyor.
      const [quote] = await db
        .select({ orderId: quotes.orderId, status: quotes.status })
        .from(quotes)
        .where(eq(quotes.id, stuck.quoteId));
      assert.equal(quote.orderId, order.id);
      assert.equal(quote.status, "ordered");
      // Kullanım kaydı taslaktan SİPARİŞE geçti ve iade damgası almadı.
      const [redemption] = await db
        .select()
        .from(giftCardRedemptions)
        .where(eq(giftCardRedemptions.draftId, stuck.draftId));
      assert.equal(redemption.orderId, order.id);
      assert.equal(redemption.refundedAt, null);

      // Beklemesi DOLMAYAN taslağa dokunulmaz: isteğin kendi terfi denemesi
      // (tasarım §5.4, birinci koruma) hâlâ sürüyor olabilir ve iki tarafın aynı
      // saniyede aynı taslağı terfi ettirmesinin bir faydası yok.
      const [young] = await db
        .select({ status: orderDrafts.status })
        .from(orderDrafts)
        .where(eq(orderDrafts.id, fresh.draftId));
      assert.equal(young.status, "pending");
      // Teklif KÖPRÜSÜ olmayan taslak bu turun konusu değil: `/api/orders`
      // yolunun kendi kuralları var (o yol `card-expire` işini de kuyruğa
      // almıyor) ve bu tur teklif motorunun bakımıdır.
      const [other] = await db
        .select({ status: orderDrafts.status })
        .from(orderDrafts)
        .where(eq(orderDrafts.id, figurine.draftId));
      assert.equal(other.status, "pending");
    });

    await test("terfi edemeyen taslak turu KIRMIZI yapar, öteki aşamaları durdurmaz", async () => {
      // Rezervasyonu geri dönmüş taslak terfi EDEMEZ (`order-draft.ts`
      // rezervasyon kapısı). Sessizce yutulursa sahipsiz taslak hiç görünmez:
      // aşama kendi hatasını FIRLATIR, `phase(...)` onu tura taşır ve kuyruk
      // işi kırmızıya döner.
      const user = await makeUser({ tag: "gift-fail" });
      const broken = await makeStuckGiftDraft({
        userId: user.id,
        email: user.email,
        ageMs: (STUCK_GIFT_DRAFT_GRACE_MINUTES + 1) * 60_000,
        returned: true,
      });
      const expiring = await makeQuote({
        userId: user.id,
        status: "quoted",
        expiresAt: new Date(Date.now() - HOUR),
      });

      // Günlük yakalanır: hem çıktı temiz kalır hem de arızanın GERÇEKTEN
      // yazıldığı ölçülür (sessiz yutma yok).
      const logged: unknown[][] = [];
      const realError = console.error;
      console.error = (...args: unknown[]) => void logged.push(args);
      try {
        await assert.rejects(
          runQuoteMaintenance(new Date()),
          (err: unknown) =>
            err instanceof Error &&
            /promoteStuckGiftCoveredDrafts/.test(err.message) &&
            err.message.includes(broken.reference),
          "tur hangi taslağın terfi edemediğini SÖYLER"
        );
      } finally {
        console.error = realError;
      }
      assert.ok(
        logged.some((args) => args.some((arg) => String(arg).includes(broken.reference))),
        "takılan taslak günlüğe referansıyla yazıldı"
      );
      // Öteki aşamalar KOŞTU: süresi geçen teklif yine de kapandı.
      assert.equal(await statusOf(expiring), "expired");
      const [stillPending] = await db
        .select({ status: orderDrafts.status })
        .from(orderDrafts)
        .where(eq(orderDrafts.id, broken.draftId));
      assert.equal(stillPending.status, "pending", "terfi edemeyen taslak yerinde kaldı");

      // Temizlik: bu taslak her turu kırmızı yapardı; kalan vakalar tur
      // koşmuyor ama şemayı kırmızı bırakmak sonraki okuyucuyu yanıltır.
      await db
        .update(orderDrafts)
        .set({ status: "cancelled" })
        .where(eq(orderDrafts.id, broken.draftId));
    });

    await test("saatlik tur altı işi de koşar ve sayıları döner", async () => {
      const now = new Date();
      const user = await makeUser({ marketingConsent: true, tag: "tick" });
      await makeQuote({
        userId: user.id,
        status: "quoted",
        expiresAt: new Date(now.getTime() - HOUR),
      });
      await makeQuote({
        userId: user.id,
        status: "quoted",
        expiresAt: new Date(now.getTime() + 2 * DAY),
        updatedAt: new Date(now.getTime() - 40 * HOUR),
      });
      // Turun BEŞİNCİ işi için toplanacak gerçek bir yetim: satırı olmayan,
      // bekleme süresini geçmiş bir kimlik-biçimli dizin. Sıfır beklemek
      // sayaçın BAŞLANGIÇ değerini doğrulardı, yani aşama bloğu silinse bile
      // test yeşil kalırdı — süpürmeyi tura bağlayan tek iddia bu.
      const tickOrphan = randomUUID();
      const tickOrphanKey = writeKey(tickOrphan, "source.stl");
      ageDir(tickOrphan, (ORPHAN_DIR_GRACE_HOURS + 1) * HOUR);
      // Turun ALTINCI işi için sahipsiz kalmış gerçek bir rezervasyon. Kendi
      // kullanıcısı: terfi kendi e-postalarını gönderiyor ve aşağıdaki mektup
      // sayımı yalnız hatırlatmaları ölçmeli.
      const stuckUser = await makeUser({ tag: "tick-gift" });
      const tickStuck = await makeStuckGiftDraft({
        userId: stuckUser.id,
        email: stuckUser.email,
        ageMs: (STUCK_GIFT_DRAFT_GRACE_MINUTES + 1) * 60_000,
      });

      const outcome = await runQuoteMaintenance(now);
      assert.equal(outcome.expired, 1);
      assert.equal(outcome.expiryReminders, 1);
      assert.equal(outcome.abandonedReminders, 1);
      assert.equal(outcome.purgedParts, 0);
      assert.equal(outcome.orphanDirs, 1, "yetim dizin süpürmesi turda GERÇEKTEN koştu");
      assert.equal(
        outcome.promotedGiftDrafts,
        1,
        "sahipsiz rezervasyon aşaması turda GERÇEKTEN koştu"
      );
      const [tickPromoted] = await db
        .select({ status: orderDrafts.status })
        .from(orderDrafts)
        .where(eq(orderDrafts.id, tickStuck.draftId));
      assert.equal(tickPromoted.status, "confirmed", "tur içinde siparişe döndü");
      assert.equal(onDisk(tickOrphanKey), false, "sahipsiz dosya tur içinde silindi");
      assert.equal(dirOnDisk(tickOrphan), false);
      // Süresi biten teklif ÖNCE kapanır: kapanan teklife "birkaç gün içinde
      // bitiyor" yazılmaz.
      assert.equal(mailsTo(user.email).length, 2);
    });

    // ─── 7) Kaynak denetimi: iş süreçte gerçekten kayıtlı mı ────────────────

    syncTest("workers/start.ts bakım işçisini ve SAATLİK zamanlayıcıyı kurar", () => {
      const src = stripComments(fs.readFileSync(path.join(root, "workers/start.ts"), "utf8"));
      assert.ok(
        /startQuoteMaintenanceWorker\(\)/.test(src),
        "bakım işçisi başlatılmıyor: iş kuyruğa girer ama kimse almaz"
      );
      assert.ok(
        /getQuoteMaintenanceQueue\(\)\s*\.upsertJobScheduler\(\s*"quote-maintenance-hourly",\s*\{\s*every:\s*3_600_000\s*\}/.test(
          src
        ),
        "saatlik zamanlayıcı kayıtlı değil (quote-maintenance-hourly / 3_600_000)"
      );
      assert.ok(/name:\s*"tick"/.test(src), 'zamanlayıcının iş adı "tick" olmalı');
      assert.ok(
        /quoteMaintenanceWorker\.close\(\)/.test(src),
        "işçi kapanışta kapatılmıyor: SIGTERM'de iş yarım kalır"
      );
    });

    // `quote-checkout.ts`e dokunan iki DB paketi `server-only`i TAKLİT ederek
    // (module stub) çalışıyor, yani asıl tuzağı artık yakalayamazlar. Bu
    // yüzden graf STATİK yürünür: hiçbir modül import EDİLMEZ, kaynak okunur.
    syncTest("workers/start.ts grafındaki hiçbir modül `server-only` çekmez", () => {
      const resolveSpec = (from: string, spec: string): string | null => {
        const base = spec.startsWith("@/")
          ? path.join(root, "src", spec.slice(2))
          : spec.startsWith(".")
            ? path.resolve(path.dirname(from), spec)
            : null; // paket adı → node_modules, grafın dışı
        if (base === null) return null;
        for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
          if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
        }
        return null;
      };
      const seen = new Set<string>();
      const offenders: string[] = [];
      const walk = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        const src = stripComments(fs.readFileSync(file, "utf8"));
        if (/(?:^|\n)\s*import\s+"server-only"|from\s+"server-only"/.test(src)) {
          offenders.push(path.relative(root, file));
        }
        // `import x from "y"`, `export … from "y"`, `await import("y")`.
        for (const m of src.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
          const next = resolveSpec(file, m[1]);
          if (next) walk(next);
        }
      };
      walk(path.join(root, "workers/start.ts"));
      // Yürüyüş sessizce kırılırsa (çözümleyici bozulur) dosya sayısı çöker ve
      // test hiçbir şey kanıtlamadan yeşil kalırdı.
      assert.ok(seen.size > 100, `graf çok küçük (${seen.size} modül) — yürüyüş kırık`);
      assert.deepEqual(
        offenders,
        [],
        `worker grafında \`server-only\`: ${offenders.join(", ")} — standalone ` +
          "Node worker'ı açılışta crash-loop'a sokar"
      );
    });

    syncTest("bakım modülü ödeme köprüsünü import ETMEZ (server-only tuzağı)", () => {
      const src = stripComments(
        fs.readFileSync(path.join(root, "src/lib/services/quote-maintenance.ts"), "utf8")
      );
      assert.ok(!/from "server-only"|import "server-only"/.test(src));
      assert.ok(
        !/quote-checkout/.test(src),
        "quote-checkout.ts `attribution-server`i çeker, o da `server-only` — " +
          "standalone worker crash-loop'a girer"
      );
    });

    console.log(`${checks} quote maintenance DB checks passed`);
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
