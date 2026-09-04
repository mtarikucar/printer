/**
 * Atölye iptal/iade akışının DB'li doğrulaması (Görev 12b).
 *
 * NEDEN AYRI BİR BETİK: `scripts/test-workshop.ts` `npm run test:unit` içinde
 * koşuyor ve CI'da Postgres YOK (bkz. .github/workflows/ci.yml — DATABASE_URL
 * yalnızca env ayrıştırmayı memnun etmek için var, ayakta bir sunucu değil).
 * Para yolunu gerçekten çalıştıran testler bu yüzden burada yaşar; saf karar
 * fonksiyonlarının (`participantCancelDisposition`, `seatReturnsToPool`) ve
 * sözleşme merdiveninin testleri test-workshop.ts'te, yani test:unit'te.
 *
 * GEVŞEK ŞEMA: dev veritabanına HİÇBİR migration uygulanmaz. Betik kendi
 * SCRATCH ŞEMASINI açar, `drizzle-kit generate` ile schema.ts'ten ürettiği
 * güncel DDL'i oraya basar, testleri orada koşar ve şemayı düşürür. Bu yüzden
 * dev verisine dokunmaz ve schema.ts değiştiğinde kendiliğinden güncellenir.
 *
 *   DATABASE_URL=... npx tsx scripts/test-workshop-cancel.ts
 *
 * Veritabanına ulaşılamıyorsa test ATLANIR (çıkış 0) — DB'siz bir ortamda
 * yanlışlıkla kırmızı yakmasın.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const BASE_URL = process.env.DATABASE_URL;
const SCHEMA = `ws_cancel_test_${Date.now()}`;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`, extra ?? "");
  }
}

function skip(reason: string): never {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}

/** schema.ts'ten GÜNCEL tam DDL'i üretir (dev DB'ye dokunmaz — tamamen çevrimdışı). */
function generateDdl(): string {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ws-cancel-ddl-"));
  execFileSync(
    "npx",
    ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"],
    { env: { ...process.env, SCRATCH_OUT: out }, stdio: "ignore" }
  );
  const file = fs.readdirSync(out).find((f) => f.endsWith(".sql"));
  if (!file) throw new Error("drizzle-kit generate bir .sql üretmedi");
  const sql = fs.readFileSync(path.join(out, file), "utf8");
  fs.rmSync(out, { recursive: true, force: true });
  // Enum'lar `"public"."x"` olarak nitelenmiş gelir; scratch şemaya basmak için
  // niteleyiciyi düşürüp search_path'e bırakıyoruz.
  return sql.replace(/"public"\./g, "");
}

async function main() {
  if (!BASE_URL) skip("DATABASE_URL tanımlı değil");

  const admin = new pg.Client({ connectionString: BASE_URL });
  try {
    await admin.connect();
  } catch (e) {
    skip(`veritabanına bağlanılamadı: ${(e as Error).message}`);
  }

  const scratchUrl = new URL(BASE_URL);
  scratchUrl.searchParams.set("options", `-c search_path=${SCHEMA}`);

  try {
    const ddl = generateDdl();
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(`SET search_path TO ${SCHEMA}`);
    for (const stmt of ddl
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await admin.query(stmt);
    }

    // Uygulama kodu ancak env HAZIR olduktan SONRA import edilebilir: `db`
    // havuzu da nodemailer taşıyıcısı da modül yüklenirken kurulur.
    process.env.DATABASE_URL = scratchUrl.toString();
    // Dev kuyruklarını kirletmeme (ve gerçek e-posta göndermeme) sigortası:
    // BullMQ işleri 15 numaralı Redis veritabanına, SMTP hiçbir yere gider.
    process.env.REDIS_URL = (process.env.REDIS_URL ?? "redis://127.0.0.1:6379").replace(
      /\/\d+$/,
      ""
    ) + "/15";
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1";

    await run();
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await admin.end().catch(() => {});
    await cleanupTestRedis();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

/**
 * Testin 15 numaralı Redis veritabanına bıraktığı e-posta kuyruğu anahtarlarını
 * siler. FLUSHDB DEĞİL: yalnızca bu betiğin dokunduğu `bull:email:*` desenini
 * temizler, başkasının verisini süpürmez.
 */
async function cleanupTestRedis() {
  try {
    const { default: IORedis } = await import("ioredis");
    const r = new IORedis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    await r.connect();
    const keys = await r.keys("bull:email:*");
    if (keys.length > 0) await r.del(...keys);
    await r.quit();
  } catch {
    // Redis yoksa temizlenecek bir şey de yok.
  }
}

async function run() {
  const { db } = await import("../src/lib/db");
  const schema = await import("../src/lib/db/schema");
  const { users, manufacturers, manufacturerNotifications, orders, orderDrafts, workshopVenues, workshopSessions, workshopParticipants, manufacturerEarnings, adminActions } =
    schema;
  const { cancelWorkshopSession, cancelWorkshopParticipant } = await import(
    "../src/lib/services/workshop-cancel"
  );
  const { promoteDraftToOrder, expireDraft } = await import(
    "../src/lib/services/order-draft"
  );
  const { accrueEarning } = await import("../src/lib/services/payouts");
  const { eq } = await import("drizzle-orm");

  const ADMIN = "test-admin@figurunica.test";
  const ADDRESS = {
    adres: "Test Sokak 1",
    mahalle: "Merkez",
    ilce: "Çankaya",
    il: "Ankara",
    postaKodu: "06000",
    telefon: "+905000000000",
  };

  const [user] = await db
    .insert(users)
    .values({ email: "ws-cancel@example.test", fullName: "Test Müşteri" })
    .returning();

  const [mfg] = await db
    .insert(manufacturers)
    .values({
      email: "ws-cancel-mfg@example.test",
      passwordHash: "x",
      companyName: "Test Üretim",
      contactPerson: "Test",
      phone: "+905000000001",
      status: "active",
    })
    .returning();

  const [venue] = await db
    .insert(workshopVenues)
    .values({
      name: "Test Mekan",
      contactName: "Mekan Yetkilisi",
      contactEmail: "venue@example.test",
      contactPhone: "+905000000002",
      address: ADDRESS,
    })
    .returning();

  let orderSeq = 0;
  async function seedSession(status: "open" | "closed" | "in_production", bookedCount: number) {
    const startsAt = new Date(Date.now() + 20 * 24 * 3600 * 1000);
    const [s] = await db
      .insert(workshopSessions)
      .values({
        venueId: venue.id,
        startsAt,
        capacity: 20,
        bookedCount,
        joinToken: `tok-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        joinClosesAt: new Date(startsAt.getTime() - 5 * 24 * 3600 * 1000),
        deliverBy: new Date(startsAt.getTime() - 24 * 3600 * 1000),
        pricePerSeatKurus: 135000,
        manufacturerId: mfg.id,
        status,
      })
      .returning();
    return s;
  }

  let draftSeq = 0;
  /** Ödemesi SÜREN katılımcının taslağı — iptalin kapatmak zorunda olduğu çıkış. */
  async function seedDraft() {
    draftSeq++;
    const [d] = await db
      .insert(orderDrafts)
      .values({
        reference: `WSD-${Date.now()}-${draftSeq}`,
        userId: user.id,
        email: `d${draftSeq}@example.test`,
        customerName: "Taslak Sahibi",
        shippingAddress: ADDRESS,
        amountKurus: 135000,
        paymentMethod: "card",
        status: "pending",
      })
      .returning();
    return d;
  }

  async function seedParticipant(
    sessionId: string,
    fullName: string,
    opts: { orderStatus?: string; participantStatus?: string; withDraft?: boolean } = {}
  ) {
    let orderId: string | null = null;
    const draft = opts.withDraft ? await seedDraft() : null;
    if (opts.orderStatus) {
      orderSeq++;
      const [o] = await db
        .insert(orders)
        .values({
          orderNumber: `WSC-${Date.now()}-${orderSeq}`,
          userId: user.id,
          email: `p${orderSeq}@example.test`,
          customerName: fullName,
          shippingAddress: ADDRESS,
          paymentMethod: "card",
          amountKurus: 135000,
          productionBaseKurus: 135000,
          paintingPriceKurus: 0,
          status: opts.orderStatus as "paid",
          manufacturerId: mfg.id,
          manufacturerStatus: "accepted",
          workshopSessionId: sessionId,
          commissionRateBps: 4000,
        })
        .returning();
      orderId = o.id;
    }
    const [p] = await db
      .insert(workshopParticipants)
      .values({
        sessionId,
        orderId,
        draftId: draft?.id ?? null,
        fullName,
        email: `${fullName.toLowerCase().replace(/\s+/g, ".")}@example.test`,
        phone: "+905000000003",
        photoKey: "photos/test.jpg",
        kvkkConsentAt: new Date(),
        contentConsentAt: new Date(),
        status: opts.participantStatus ?? (orderId ? "paid" : "pending_payment"),
      })
      .returning();
    return { participant: p, orderId, draftId: draft?.id ?? null };
  }

  const participantStatus = async (id: string) =>
    (
      await db.query.workshopParticipants.findFirst({
        where: eq(workshopParticipants.id, id),
        columns: { status: true },
      })
    )?.status;
  const orderPayment = async (id: string) =>
    (
      await db.query.orders.findFirst({
        where: eq(orders.id, id),
        columns: { paymentStatus: true },
      })
    )?.paymentStatus;
  const draftStatus = async (id: string) =>
    (
      await db.query.orderDrafts.findFirst({
        where: eq(orderDrafts.id, id),
        columns: { status: true },
      })
    )?.status;
  const participantOrderId = async (id: string) =>
    (
      await db.query.workshopParticipants.findFirst({
        where: eq(workshopParticipants.id, id),
        columns: { orderId: true },
      })
    )?.orderId ?? null;
  const sessionRow = async (id: string) =>
    await db.query.workshopSessions.findFirst({
      where: eq(workshopSessions.id, id),
      columns: { status: true, bookedCount: true },
    });

  // ── 1) Seans iptali: 2 ödenmiş + 1 sevk edilmiş + 1 ödemesiz ─────────────
  console.log("\n1) Seans iptali");
  const s1 = await seedSession("in_production", 5);
  const paidA = await seedParticipant(s1.id, "Ayse Yilmaz", { orderStatus: "approved" });
  const paidB = await seedParticipant(s1.id, "Burak Demir", { orderStatus: "approved" });
  const shipped = await seedParticipant(s1.id, "Ceren Kaya", { orderStatus: "shipped" });
  // Ödemesi SÜREN katılımcı: taslağı `pending`, koltuğu tutuluyor. Bu, iptalin
  // kapatmak ZORUNDA olduğu çıkış — taslak açık kalırsa geciken bir PayTR
  // webhook'u iptal edilmiş seansa gerçek bir sipariş bağlar.
  const pendingDraft = await seedParticipant(s1.id, "Deniz Ak", { withDraft: true });
  // Taslaksız katılımcı (elle eklenmiş / bozuk satır) — geri düşüş yolu.
  const unpaid = await seedParticipant(s1.id, "Emre Sonmez");

  // Üreticinin hakedişi tahakkuk etmiş olsun ki iade onu geri alsın.
  await accrueEarning(paidA.orderId!, mfg.id, 135000);

  const r1 = await cancelWorkshopSession({ sessionId: s1.id, adminEmail: ADMIN });
  assert.ok(r1.ok);
  ok(
    "2 ödenmiş katılımcı iade edildi",
    r1.report.refunded.length === 2 &&
      r1.report.refunded.includes("Ayse Yilmaz") &&
      r1.report.refunded.includes("Burak Demir"),
    r1.report
  );
  ok(
    "sevk edilmiş katılımcı isimle raporlandı, iade EDİLMEDİ",
    r1.report.alreadyShipped.length === 1 && r1.report.alreadyShipped[0] === "Ceren Kaya",
    r1.report
  );
  ok("başarısız çıkış yok", r1.report.failed.length === 0, r1.report);
  ok(
    "ilk çağrıda 'zaten iade edilmiş' kimse yok",
    r1.report.alreadyRefunded.length === 0,
    r1.report
  );
  ok(
    "sevk edilmiş siparişin ödemesi ELLENMEDİ",
    (await orderPayment(shipped.orderId!)) === "succeeded"
  );
  ok(
    "sevk edilmiş katılımcı `cancelled` YAPILMADI",
    (await participantStatus(shipped.participant.id)) !== "cancelled"
  );
  ok(
    "taslaksız ödemesiz katılımcı `cancelled`",
    (await participantStatus(unpaid.participant.id)) === "cancelled"
  );
  ok(
    "ödemesi süren katılımcı `cancelled`",
    (await participantStatus(pendingDraft.participant.id)) === "cancelled"
  );
  ok(
    "ödemesi süren katılımcının TASLAĞI `expired` (çıkış kapandı)",
    (await draftStatus(pendingDraft.draftId!)) === "expired",
    await draftStatus(pendingDraft.draftId!)
  );
  ok(
    "taslak sonlandırılırken koltuk BİR kez bırakıldı (bookedCount 5 → 4)",
    (await sessionRow(s1.id))?.bookedCount === 4,
    { bookedCount: (await sessionRow(s1.id))?.bookedCount }
  );
  ok(
    "iade edilen katılımcılar `cancelled`",
    (await participantStatus(paidA.participant.id)) === "cancelled" &&
      (await participantStatus(paidB.participant.id)) === "cancelled"
  );
  ok(
    "iade edilen siparişler `refunded`",
    (await orderPayment(paidA.orderId!)) === "refunded" &&
      (await orderPayment(paidB.orderId!)) === "refunded"
  );
  ok("seans `cancelled`", (await sessionRow(s1.id))?.status === "cancelled");

  // Üretici haber aldı mı? İade her siparişin `manufacturerId`sini NULL yapar,
  // yani parti üreticinin kuyruğundan sessizce buharlaşır; kapasitesini
  // serbest bırakabilmesi için bildirim ZORUNLU.
  const mfgNotes = await db
    .select()
    .from(manufacturerNotifications)
    .where(eq(manufacturerNotifications.manufacturerId, mfg.id));
  ok(
    "üreticiye seans iptal bildirimi gitti",
    mfgNotes.some(
      (n) => n.type === "workshop_session" && n.subject.includes("iptal edildi")
    ),
    mfgNotes.map((n) => n.subject)
  );

  // ── 1b) ASIL KAPATILAN AÇIK: iptalden SONRA gelen ödeme reddedilir ────────
  // Bu, düzeltmenin var oluş sebebi. Taslak `pending` kalsaydı
  // `promoteDraftToOrder` yalnızca taslağın durumuna bakar, katılımcıyı
  // SÜZGEÇSİZ `paid` yapar ve iptal edilmiş seansa gerçek bir sipariş bağlardı.
  console.log("\n1b) İptalden sonra gelen ödeme");
  let promotionError: string | null = null;
  try {
    await promoteDraftToOrder(pendingDraft.draftId!);
  } catch (e) {
    promotionError = (e as Error).message;
  }
  ok(
    "iptalden sonra terfi REDDEDİLDİ (DRAFT_NOT_PROMOTABLE)",
    promotionError !== null && promotionError.startsWith("DRAFT_NOT_PROMOTABLE"),
    promotionError
  );
  ok(
    "katılımcı diriltilmedi — hâlâ `cancelled`",
    (await participantStatus(pendingDraft.participant.id)) === "cancelled"
  );
  ok(
    "katılımcıya sipariş BAĞLANMADI",
    (await participantOrderId(pendingDraft.participant.id)) === null
  );
  ok(
    "koltuk ikinci kez sayılmadı (bookedCount hâlâ 4)",
    (await sessionRow(s1.id))?.bookedCount === 4,
    { bookedCount: (await sessionRow(s1.id))?.bookedCount }
  );

  // ── 2) İkinci çağrı idempotent: çift ters kayıt YOK ───────────────────────
  console.log("\n2) İkinci çağrı (idempotens)");
  const earningsBefore = await db
    .select()
    .from(manufacturerEarnings)
    .where(eq(manufacturerEarnings.manufacturerId, mfg.id));
  const refundActionsBefore = await db
    .select()
    .from(adminActions)
    .where(eq(adminActions.action, "refund"));

  const r2 = await cancelWorkshopSession({ sessionId: s1.id, adminEmail: ADMIN });
  assert.ok(r2.ok);
  ok(
    "`already_refunded` BAŞARI sayılır ama YENİ iade olarak raporlanmaz",
    r2.report.refunded.length === 0 &&
      r2.report.alreadyRefunded.length === 2 &&
      r2.report.failed.length === 0,
    r2.report
  );
  ok(
    "ikinci çağrı taslağı yeniden sonlandırmaya kalkıp koltuğu düşürmedi",
    (await sessionRow(s1.id))?.bookedCount === 4,
    { bookedCount: (await sessionRow(s1.id))?.bookedCount }
  );

  const earningsAfter = await db
    .select()
    .from(manufacturerEarnings)
    .where(eq(manufacturerEarnings.manufacturerId, mfg.id));
  const sum = (rows: Array<{ netKurus: number }>) =>
    rows.reduce((a, b) => a + b.netKurus, 0);
  ok(
    "manufacturer_earnings satır SAYISI değişmedi",
    earningsAfter.length === earningsBefore.length,
    { before: earningsBefore.length, after: earningsAfter.length }
  );
  ok(
    "manufacturer_earnings net TOPLAMI değişmedi",
    sum(earningsAfter) === sum(earningsBefore),
    { before: sum(earningsBefore), after: sum(earningsAfter) }
  );
  ok(
    "hakediş tek seferde `reversed` oldu ve orada kaldı",
    earningsAfter.every((e) => e.status === "reversed") && earningsAfter.length === 1,
    earningsAfter.map((e) => e.status)
  );
  const refundActionsAfter = await db
    .select()
    .from(adminActions)
    .where(eq(adminActions.action, "refund"));
  ok(
    "ikinci çağrı yeni bir `refund` admin aksiyonu YAZMADI",
    refundActionsAfter.length === refundActionsBefore.length,
    { before: refundActionsBefore.length, after: refundActionsAfter.length }
  );

  // ── 3) Katılımcı iptali — `open` seans: koltuk havuza döner ───────────────
  console.log("\n3) Katılımcı iptali (open seans)");
  const s3 = await seedSession("open", 2);
  const openP = await seedParticipant(s3.id, "Elif Sahin", { orderStatus: "approved" });
  const r3 = await cancelWorkshopParticipant({
    sessionId: s3.id,
    participantId: openP.participant.id,
    adminEmail: ADMIN,
  });
  ok("open seansta iptal başarılı", r3.ok, r3);
  ok("koltuk havuza döndü (bookedCount 2 → 1)", (await sessionRow(s3.id))?.bookedCount === 1, {
    bookedCount: (await sessionRow(s3.id))?.bookedCount,
  });
  ok("sipariş iade edildi", (await orderPayment(openP.orderId!)) === "refunded");
  ok(
    "katılımcı `cancelled`",
    (await participantStatus(openP.participant.id)) === "cancelled"
  );

  const r3b = await cancelWorkshopParticipant({
    sessionId: s3.id,
    participantId: openP.participant.id,
    adminEmail: ADMIN,
  });
  ok("ikinci çağrı da başarılı (idempotent)", r3b.ok, r3b);
  ok(
    "koltuk İKİNCİ kez bırakılmadı (bookedCount hâlâ 1)",
    (await sessionRow(s3.id))?.bookedCount === 1,
    { bookedCount: (await sessionRow(s3.id))?.bookedCount }
  );

  // ── 4) Katılımcı iptali — `closed` seans: koltuk DÖNMEZ ───────────────────
  console.log("\n4) Katılımcı iptali (closed seans)");
  const s4 = await seedSession("closed", 3);
  const closedP = await seedParticipant(s4.id, "Fatma Oz", { orderStatus: "approved" });
  const r4 = await cancelWorkshopParticipant({
    sessionId: s4.id,
    participantId: closedP.participant.id,
    adminEmail: ADMIN,
  });
  ok("closed seansta iptal başarılı", r4.ok, r4);
  ok("koltuk havuza DÖNMEDİ (bookedCount 3)", (await sessionRow(s4.id))?.bookedCount === 3, {
    bookedCount: (await sessionRow(s4.id))?.bookedCount,
  });
  ok("sipariş yine de iade edildi", (await orderPayment(closedP.orderId!)) === "refunded");
  ok(
    "katılımcı `cancelled`",
    (await participantStatus(closedP.participant.id)) === "cancelled"
  );
  ok("iptal başarılıysa `seatReleased` false", r4.ok && r4.seatReleased === false, r4);

  // ── 4b) Katılımcı iptali — ödemesi SÜREN katılımcı ───────────────────────
  console.log("\n4b) Katılımcı iptali (ödemesi süren)");
  const s4b = await seedSession("open", 2);
  const pendingP = await seedParticipant(s4b.id, "Hakan Er", { withDraft: true });
  const r4b = await cancelWorkshopParticipant({
    sessionId: s4b.id,
    participantId: pendingP.participant.id,
    adminEmail: ADMIN,
  });
  ok("ödemesi süren katılımcı iptal edildi", r4b.ok, r4b);
  ok(
    "taslak `expired` — geciken ödeme artık sipariş yaratamaz",
    (await draftStatus(pendingP.draftId!)) === "expired"
  );
  ok(
    "katılımcı `cancelled`",
    (await participantStatus(pendingP.participant.id)) === "cancelled"
  );
  ok("koltuk BİR kez bırakıldı (bookedCount 2 → 1)", (await sessionRow(s4b.id))?.bookedCount === 1, {
    bookedCount: (await sessionRow(s4b.id))?.bookedCount,
  });
  let promo4b: string | null = null;
  try {
    await promoteDraftToOrder(pendingP.draftId!);
  } catch (e) {
    promo4b = (e as Error).message;
  }
  ok(
    "iptalden sonra terfi REDDEDİLDİ",
    promo4b !== null && promo4b.startsWith("DRAFT_NOT_PROMOTABLE"),
    promo4b
  );
  const r4bAgain = await cancelWorkshopParticipant({
    sessionId: s4b.id,
    participantId: pendingP.participant.id,
    adminEmail: ADMIN,
  });
  ok("ikinci çağrı da başarılı (idempotent)", r4bAgain.ok, r4bAgain);
  ok(
    "koltuk İKİNCİ kez bırakılmadı (bookedCount hâlâ 1)",
    (await sessionRow(s4b.id))?.bookedCount === 1,
    { bookedCount: (await sessionRow(s4b.id))?.bookedCount }
  );

  // ── 5) Sevk edilmiş katılımcı reddedilir (rota 409'a eşler) ───────────────
  console.log("\n5) Sevk edilmiş katılımcı");
  const s5 = await seedSession("in_production", 1);
  const shippedP = await seedParticipant(s5.id, "Gizem Yuce", { orderStatus: "shipped" });
  const r5 = await cancelWorkshopParticipant({
    sessionId: s5.id,
    participantId: shippedP.participant.id,
    adminEmail: ADMIN,
  });
  ok("sevk edilmiş katılımcı reddedildi (`already_shipped` → 409)", !r5.ok && r5.reason === "already_shipped", r5);
  ok("sipariş ELLENMEDİ", (await orderPayment(shippedP.orderId!)) === "succeeded");
  ok(
    "katılımcı `cancelled` YAPILMADI",
    (await participantStatus(shippedP.participant.id)) !== "cancelled"
  );
  ok("koltuk bırakılmadı (bookedCount 1)", (await sessionRow(s5.id))?.bookedCount === 1);

  // ── 6) Bilinmeyen kayıtlar ────────────────────────────────────────────────
  console.log("\n6) Bulunamayan kayıtlar");
  const missing = await cancelWorkshopSession({
    sessionId: "00000000-0000-0000-0000-000000000000",
    adminEmail: ADMIN,
  });
  ok("olmayan seans → not_found", !missing.ok && missing.reason === "not_found", missing);
  for (const st of ["delivered", "completed"] as const) {
    const done = await seedSession("closed", 1);
    await db
      .update(workshopSessions)
      .set({ status: st })
      .where(eq(workshopSessions.id, done.id));
    const res = await cancelWorkshopSession({ sessionId: done.id, adminEmail: ADMIN });
    ok(
      `${st} seans iptal edilemez (not_cancellable → 409)`,
      !res.ok && res.reason === "not_cancellable",
      res
    );
    ok(
      `${st} seansın durumu DEĞİŞMEDİ`,
      (await sessionRow(done.id))?.status === st
    );
  }

  const wrongSession = await cancelWorkshopParticipant({
    sessionId: s5.id,
    participantId: closedP.participant.id, // başka seansın katılımcısı
    adminEmail: ADMIN,
  });
  ok(
    "başka seansın katılımcısı bu seanstan iptal edilemez",
    !wrongSession.ok && wrongSession.reason === "not_found",
    wrongSession
  );

  // 7) `expireDraft`'ın VARSAYILANLARI.
  //
  // İptal yolu bu fonksiyona üç opsiyonel parametre ekledi. Fonksiyonu ayrıca
  // ödeme-süresi worker'ı, atölye kapanış worker'ı ve admin force-expire rotası
  // ÇIPLAK çağırıyor — yani canlıda gerçek müşterilerin ödenmemiş siparişlerine
  // ne olduğu bu varsayılanlara bağlı. Buradaki iddialar o üç çağrıyı korur:
  // varsayılanlar kayarsa test kırılır, canlı davranış sessizce değişmez.
  console.log("\n7) expireDraft varsayılanları (canlı ödeme yollarını korur)");

  const s7 = await seedSession("open", 1);
  const bare = await seedParticipant(s7.id, "Sinem Aydin", { withDraft: true });

  await expireDraft(bare.draftId!);

  const bareDraft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.id, bare.draftId!),
  });
  ok("çıplak çağrı taslağı `expired` yapar", bareDraft?.status === "expired");
  ok(
    "kart taslağının varsayılan hata metni korunur",
    bareDraft?.paytrFailureReason === "Kart ödeme süresi doldu",
    bareDraft?.paytrFailureReason
  );

  const bareParticipant = await db.query.workshopParticipants.findFirst({
    where: eq(workshopParticipants.id, bare.participant.id),
  });
  ok(
    "varsayılan iptal gerekçesi korunur",
    bareParticipant?.cancelReason === "Ödeme süresi doldu",
    bareParticipant?.cancelReason
  );
  ok(
    "çıplak çağrı koltuğu bırakır (bookedCount 1 → 0)",
    (await sessionRow(s7.id))?.bookedCount === 0
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
