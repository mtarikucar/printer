/**
 * Teklif ödemesinin GERÇEK yoluyla testi: izole 55433 şeması, gerçek
 * `order_drafts` / `quote_checkouts` yazımı, gerçek fiyat çekirdeği.
 *
 * Taklit edilen yalnız iki DIŞ dünya var: PayTR'ın token ucu (HTTP) ve BullMQ
 * (Redis). İkisi de CJS önbelleğinden değiştirilir, böylece `paytr.ts` ve
 * `queues.ts` kendi kodlarıyla çalışır — yani sepet satırı, merchant oid ve
 * iş kimlikleri gerçekten üretilir ve iddia edilebilir.
 *
 * Buradaki sınavın konusu PARADIR: müşteriye gösterilen tutar ile taslağa
 * yazılan tutar aynı mı, bayat bir tutar reddediliyor mu, süresi dolmuş teklif
 * ödenebiliyor mu, kurumsal fatura doğrulanıyor mu, havale indirimi AYARA
 * bağlı mı ve terk edilen kart taslağı için son tarih işi HER ZAMAN kuyruğa
 * giriyor mu (terk edilen iframe teklifi sonsuza dek kilitlemesin).
 *
 * Kullanıcının dev veritabanına (5432) ya da dev Redis'ine (6379) ASLA
 * bağlanmaz.
 *
 * Çalıştırma:
 *   npx tsx --env-file=<qa.env> scripts/test-quote-checkout-db.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import pg from "pg";
import type { PartGeometry } from "../src/lib/config/quote-types";

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
const namespace = `quote_checkout_${Date.now()}_${process.pid}`;
const ddlOut = fs.mkdtempSync(path.join(os.tmpdir(), "quote-checkout-ddl-"));

process.env.PAYTR_MERCHANT_ID = "123456";
process.env.PAYTR_MERCHANT_KEY = "test-key";
process.env.PAYTR_MERCHANT_SALT = "test-salt";
process.env.PAYTR_TEST_MODE = "1";
process.env.NEXT_PUBLIC_APP_URL = "https://qa.example.test";
process.env.BANK_NAME = "QA Bank";
process.env.BANK_ACCOUNT_HOLDER = "Figurunica QA";
process.env.BANK_IBAN = "TR000000000000000000000000";
process.env.BANK_BRANCH = "QA Şube";

const admin = new pg.Client({ connectionString });
let pool: pg.Pool | undefined;
let checks = 0;

// ─── Dış dünya ──────────────────────────────────────────────────────────────

interface QueuedJob {
  queue: string;
  name: string;
  data: Record<string, unknown>;
  opts: { jobId?: string; delay?: number };
}
const jobs: QueuedJob[] = [];
/** Silinen iş kimlikleri: terfi, planlanmış son tarih işlerini iptal eder. */
const removedJobIds: string[] = [];

const require_ = createRequire(import.meta.url);
{
  // `server-only` bir NPM paketi değil, Next'in derleme sırasında çözdüğü bir
  // takozdur; `attribution-server.ts` onu import ediyor. tsx altında çözülmez,
  // bu yüzden boş bir modüle yönlendirilir — kapı yine derlemede işliyor.
  const loader = require_("node:module") as unknown as {
    _resolveFilename(this: unknown, request: string, ...rest: unknown[]): string;
  };
  const stub = path.join(ddlOut, "server-only-stub.cjs");
  fs.writeFileSync(stub, "module.exports = {};\n");
  const resolve = loader._resolveFilename;
  loader._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === "server-only" ? stub : resolve.call(this, request, ...rest);
  };
}
{
  // BullMQ: Redis'e çıkmadan iş kaydı. `queues.ts` kendi `jobId`/`delay`
  // hesabını yapmaya devam eder; test onları okur.
  const filename = require_.resolve("bullmq");
  require_.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: {
      Queue: class {
        constructor(readonly name: string) {}
        async add(name: string, data: Record<string, unknown>, opts: QueuedJob["opts"] = {}) {
          jobs.push({ queue: this.name, name, data, opts });
          return { id: opts.jobId ?? randomUUID() };
        }
        /** Terfi/süre dolumu planlanmış işleri SİLER (`cancelHavaleJobs`). */
        async remove(jobId: string) {
          removedJobIds.push(jobId);
          return 1;
        }
        async obliterate() {}
        async close() {}
      },
    },
  } as NodeJS.Module;
}

/**
 * Müşteri oturumu: ucun kendi kapılarını sınamanın tek yolu.
 *
 * `getSessionUser` çerezleri `next/headers` üzerinden okur ve bir istek
 * kapsamı olmadan çağrılamaz; taklit YALNIZ oturum okumasıdır — bayrak,
 * erişim çözümü, gövde doğrulaması ve para hesabı gerçek koddan geçer.
 * `getAnonymousId` HER ZAMAN null: anonim çerez sahibinin ödeme yüzeyine
 * girememesi ucun değil erişim matrisinin konusu (`test-quote-api.ts`).
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

/** PayTR token ucu: ağ yok, ama imza/sepet gerçekten üretilir. */
const paytrCalls: Array<Record<string, string>> = [];
let paytrFails = false;
/**
 * PayTR CEVAP VERİRKEN araya giren ikinci sekme (tek atımlık).
 * Gerçek yarışın testte tekrarlanabilir karşılığı: token çağrısı sürerken
 * başka bir istek aynı taslağa dokunur.
 */
let paytrDuring: (() => Promise<void>) | null = null;
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (href.includes("paytr.com")) {
      const body = init?.body;
      const form = body instanceof URLSearchParams ? Object.fromEntries(body) : {};
      paytrCalls.push(form as Record<string, string>);
      if (paytrDuring) {
        const during = paytrDuring;
        paytrDuring = null;
        await during();
      }
      if (paytrFails) {
        return new Response(JSON.stringify({ status: "failed", reason: "qa refused" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ status: "success", token: "qa-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

const test = async (name: string, run: () => Promise<void>) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};

/** Analiz raporu taklidi — 20 mm'lik kapalı bir küp. */
const CUBE: PartGeometry = {
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
};

/** İnce duvarlı, ÇOK GÖVDELİ küp: DfM uyarısı üretir (ödeme onay ister). */
const THIN: PartGeometry = { ...CUBE, bodyCount: 3, wallP1: 0.2, wallP5: 0.3 };

/**
 * Servisin isteği OKUDUĞU kadarı: başlıklar (IP, tarayıcı, idempotency) ve
 * çerezler (attribution, dil). `NextRequest`'i kurmak Next'in çalışma zamanını
 * gerektirir; servis ondan yalnız bu iki yüzeyi kullanır.
 */
function fakeRequest(headers: Record<string, string> = {}): import("next/server").NextRequest {
  return {
    headers: new Headers({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "qa-agent",
      ...headers,
    }),
    cookies: { get: () => undefined },
    nextUrl: new URL("https://qa.example.test/api/quotes/x/checkout"),
  } as unknown as import("next/server").NextRequest;
}

/** Rota gövdesini sınayan istek: GERÇEK `NextRequest` (gövde + `nextUrl`). */
function jsonRequest(url: string, payload: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "qa-agent" },
    body: JSON.stringify(payload),
  });
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
    // Katalog tohumu GERÇEK migration'dan gelir: fiyatlar canlıdaki gibi çıksın.
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
    const { and, eq, isNull } = await import("drizzle-orm");
    const {
      analyticsEvents,
      giftCardRedemptions,
      giftCards,
      giftCreditReturns,
      orderDrafts,
      orders,
      quoteCheckouts,
      quoteParts,
      quotes,
      users,
    } = await import("../src/lib/db/schema");
    const { calculateHavaleDiscount } = await import("../src/lib/config/payment");
    const { refundTenderBasis } = await import("../src/lib/config/order-refund");
    const { setFlag } = await import("../src/lib/services/flags");
    const { computeQuote } = await import("../src/lib/config/quote-compute");
    const { defaultPartConfig } = await import("../src/lib/config/quote-compute");
    const { loadActiveSnapshot } = await import("../src/lib/services/quote-catalog");
    const { toPricingInputs } = await import("../src/lib/services/quote-present");
    const { QuoteServiceError } = await import("../src/lib/services/quote-service");
    const { deriveIdempotencyKey } = await import("../src/lib/services/idempotency");
    const {
      GIFT_PREVIEW_RATE_LIMIT,
      cancelPendingQuoteCheckout,
      createQuoteCheckout,
      pendingQuoteCheckout,
      previewQuoteGiftCard,
    } = await import("../src/lib/services/quote-checkout");
    const { expireDraft } = await import("../src/lib/services/order-draft");
    const { GiftCardReservationError, reserveGiftCardTx } = await import(
      "../src/lib/services/gift-card-reservation"
    );
    const { quoteCheckoutSchema } = await import("../src/lib/validators/quote-checkout");

    const snapshot = await loadActiveSnapshot();

    // ─── Sabitler ─────────────────────────────────────────────────────────
    const address = {
      adres: "Atatürk Cad. No:1",
      mahalle: "Merkez",
      ilce: "Kadıköy",
      il: "İstanbul",
      postaKodu: "34000",
      telefon: "+905321234567",
    };

    async function makeUser(): Promise<{ id: string; email: string }> {
      const id = randomUUID();
      const email = `quote-checkout-${id}@example.test`;
      await db.insert(users).values({ id, email, fullName: "Teklif Müşterisi" });
      return { id, email };
    }

    async function makeQuote(
      userId: string,
      parts: Array<{ geometry: PartGeometry; quantity?: number; technologyKey?: string }>
    ): Promise<{ id: string; number: string; version: number }> {
      const now = new Date();
      const [quote] = await db
        .insert(quotes)
        .values({
          userId,
          pricingSnapshot: snapshot,
          snapshotTakenAt: now,
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          termsAcceptedAt: now,
          termsVersion: "qa",
        })
        .returning({ id: quotes.id, number: quotes.number, version: quotes.version });

      for (const [index, spec] of parts.entries()) {
        const config = defaultPartConfig(snapshot, spec.geometry);
        const technologyKey = spec.technologyKey ?? config.technologyKey;
        const tech = snapshot.technologies.find((t) => t.key === technologyKey)!;
        const material = snapshot.materials.find((m) => m.technologyKey === technologyKey)!;
        const finish = snapshot.finishes.find(
          (f) => f.technologyKey === null || f.technologyKey === technologyKey
        )!;
        const partId = randomUUID();
        await db.insert(quoteParts).values({
          id: partId,
          quoteId: quote.id,
          sortOrder: index,
          name: `Parça ${index + 1}`,
          fileName: `parca-${index + 1}.stl`,
          sourceKey: `quote-parts/${partId}/source.stl`,
          sourceFormat: "stl",
          sourceBytes: 684,
          sourceSha256: randomUUID().replace(/-/g, "").repeat(2),
          analysisStatus: "ready",
          geometry: spec.geometry,
          canonicalStlKey: `quote-parts/${partId}/canonical.stl`,
          thumbnailKey: `quote-parts/${partId}/thumb.webp`,
          units: "mm",
          scale: 1,
          technologyKey,
          materialKey: material.key,
          colorKey: material.colors[0].key,
          finishKey: finish.key,
          layerUm: tech.defaultLayerUm,
          infillPct: tech.infillOptionsPct === null ? null : tech.defaultInfillPct,
          quantity: spec.quantity ?? 1,
        });
      }
      return quote;
    }

    /** Teklifin ÖDEME ANINDAKİ hâli — ekranın göreceği sürüm ve tutar. */
    async function expected(quoteId: string) {
      const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
      const parts = await db
        .select()
        .from(quoteParts)
        .where(and(eq(quoteParts.quoteId, quoteId), isNull(quoteParts.deletedAt)))
        .orderBy(quoteParts.sortOrder);
      const computed = computeQuote(quote.pricingSnapshot, toPricingInputs(parts), {
        leadTier: quote.leadTier,
        addonKeys: quote.addonKeys,
      });
      return { quote, parts, computed };
    }

    /**
     * Varsayılan gövde GEÇERLİDİR. Sıfır tutar burada durmaz: aksi hâlde her
     * olumsuz iddia `expectedTotalKurus.min(1)` yüzünden geçer ve mesafeli
     * sözleşme kapısı (MSY m.6/2-a) şemadan silinse bile test yeşil kalırdı.
     */
    function body(overrides: Record<string, unknown> = {}) {
      return {
        expectedVersion: 1,
        expectedTotalKurus: 150_000,
        shippingAddress: address,
        paymentMethod: "card" as const,
        distanceContractConsent: true as const,
        preliminaryInfoConsent: true as const,
        invoice: { type: "individual" as const },
        ...overrides,
      };
    }

    // ─── Doğrulayıcı ──────────────────────────────────────────────────────

    await test("şema onaysız / eksik gövdeyi reddeder, telefonu E.164'e çevirir", async () => {
      // Her olumsuz vakada YALNIZ o alanın şikâyet ettiği iddia edilir; böylece
      // bir kural silindiğinde başka bir kuralın hatası testi ayakta tutamaz.
      const rejectedFor = (input: unknown, field: string, why: string) => {
        const res = quoteCheckoutSchema.safeParse(input);
        assert.equal(res.success, false, why);
        assert.ok(
          res.error!.issues.some((issue) => issue.path[0] === field),
          `${why} — beklenen alan: ${field}, gelen: ${JSON.stringify(
            res.error!.issues.map((i) => i.path.join("."))
          )}`
        );
      };

      // Önce varsayılanın gerçekten geçtiğini göster: olumsuz vakalar ancak o
      // zaman "değiştirdiğim alan yüzünden" düşmüş olur.
      assert.equal(
        quoteCheckoutSchema.safeParse(body()).success,
        true,
        "varsayılan gövde geçerli"
      );
      rejectedFor(
        body({ distanceContractConsent: false }),
        "distanceContractConsent",
        "mesafeli sözleşme onayı olmadan geçmez"
      );
      rejectedFor(
        { ...body(), distanceContractConsent: undefined },
        "distanceContractConsent",
        "mesafeli sözleşme onayı alanı hiç yoksa da geçmez"
      );
      rejectedFor(
        { ...body(), shippingAddress: undefined },
        "shippingAddress",
        "teslimat adresi zorunlu"
      );
      rejectedFor(
        body({ expectedTotalKurus: 0 }),
        "expectedTotalKurus",
        "sıfır tutar beyanı geçmez"
      );
      const parsed = quoteCheckoutSchema.safeParse(
        body({ shippingAddress: { ...address, telefon: "0532 123 45 67" } })
      );
      assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
      assert.equal(parsed.data!.shippingAddress.telefon, "+905321234567");
    });

    // ─── Mutlu kart yolu ──────────────────────────────────────────────────

    const buyer = await makeUser();
    const cardQuote = await makeQuote(buyer.id, [
      { geometry: CUBE, quantity: 2 },
      { geometry: CUBE, quantity: 3 },
    ]);
    let cardReference = "";

    await test("kart yolu TEK taslak + TEK quote_checkouts satırı yazar", async () => {
      const { quote, parts, computed } = await expected(cardQuote.id);
      const total = computed.totals.totalKurus;
      assert.ok(total > 0, "teklif fiyatlanabilir");

      const before = jobs.length;
      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: buyer.id,
        email: buyer.email,
        input: quoteCheckoutSchema.parse(
          body({ expectedVersion: quote.version, expectedTotalKurus: total })
        ),
        req: fakeRequest({ "idempotency-key": `qa-card-${randomUUID()}` }),
      });
      cardReference = result.reference;

      assert.equal(result.paymentMethod, "card");
      assert.equal(result.reused, false);
      assert.equal(result.finalAmountKurus, total);
      assert.equal(result.iframeUrl, "https://www.paytr.com/odeme/guvenli/qa-token");
      assert.equal(result.paytrToken, "qa-token");

      const drafts = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, result.reference));
      assert.equal(drafts.length, 1, "tek taslak");
      const draft = drafts[0];
      assert.equal(draft.orderType, "upload");
      assert.equal(draft.uploadedModelId, null);
      assert.equal(draft.amountKurus, total);
      assert.equal(draft.productionBaseKurus, total, "tamamı üretim payı");
      assert.equal(draft.paintingPriceKurus, 0);
      assert.equal(draft.needsPainting, false);
      assert.equal(draft.quantity, 5, "adetlerin toplamı");
      assert.equal(draft.finish, "raw");
      assert.equal(draft.upsells, null);
      assert.equal(draft.selectedAddons, null);
      assert.equal(draft.giftCardAmountKurus, 0);
      assert.equal(draft.havaleDiscountKurus, 0);
      assert.equal(draft.paymentMethod, "card");
      assert.equal(draft.status, "pending");
      assert.equal(draft.phone, address.telefon);
      assert.equal(draft.productTitleSnapshot, `Teklif ${quote.number} (2 parça)`);
      // Baskın teknolojinin `order_material`ı: iki parça da aynı teknolojide.
      const tech = snapshot.technologies.find((t) => t.key === parts[0].technologyKey)!;
      assert.equal(draft.material, tech.orderMaterial);
      // Onay kolonları: içerik onayı teklifte İSTENMEZ, mesafeli sözleşme alınır.
      assert.equal(draft.contentConsentAt, null);
      assert.equal(draft.contentConsentVersion, null);
      assert.ok(draft.preliminaryInfoAcceptedAt, "ön bilgilendirme damgalandı");
      assert.ok(draft.preliminaryInfoVersion);
      assert.ok(draft.distanceContractVersion);
      assert.equal(draft.consentIp, "203.0.113.7");
      assert.equal(draft.consentUserAgent, "qa-agent");
      assert.ok(draft.paytrMerchantOid, "kart taslağı merchant oid taşır");

      const rows = await db
        .select()
        .from(quoteCheckouts)
        .where(eq(quoteCheckouts.quoteId, quote.id));
      assert.equal(rows.length, 1, "tek köprü satırı");
      assert.equal(rows[0].draftId, draft.id);
      assert.equal(rows[0].amountKurus, total);
      assert.equal(rows[0].quoteVersion, quote.version);
      assert.equal(rows[0].leadTier, quote.leadTier);
      assert.equal(rows[0].leadDays, computed.totals.leadDays);
      assert.equal(rows[0].partsSnapshot.length, 2, "iki parça donduruldu");
      const frozen = rows[0].partsSnapshot[0];
      assert.equal(frozen.partId, parts[0].id);
      assert.equal(frozen.quantity, 2);
      assert.equal(frozen.canonicalStlKey, parts[0].canonicalStlKey);
      assert.equal(frozen.technologyName, tech.name);
      assert.deepEqual(frozen.dimensionsMm, { x: 20, y: 20, z: 20 });
      assert.equal(
        rows[0].partsSnapshot.reduce((sum, p) => sum + p.lineKurus, 0) +
          rows[0].addonsSnapshot.reduce((sum, a) => sum + a.kurus, 0) +
          computed.totals.minOrderTopUpKurus,
        total,
        "dondurulan kalemler toplamı tutarı verir"
      );

      // PayTR sepeti TEK satır ve teklif numarasını taşır.
      const call = paytrCalls.at(-1)!;
      assert.equal(call.payment_amount, String(total));
      const basket = JSON.parse(Buffer.from(call.user_basket, "base64").toString()) as Array<
        [string, string, number]
      >;
      assert.equal(basket.length, 1);
      assert.equal(basket[0][0], `Teklif ${quote.number}`);
      assert.equal(basket[0][1], (total / 100).toFixed(2));
      assert.equal(basket[0][2], 1);

      // Terk edilen iframe teklifi sonsuza dek kilitlemesin: kart taslağında
      // HEDİYE KARTI OLMASA DA son tarih işi kuyruğa girer.
      const queued = jobs.slice(before);
      const expire = queued.find((j) => j.name === "card-expire");
      assert.ok(expire, "card-expire işi kuyruğa alındı");
      assert.equal(expire!.queue, "payment-deadline");
      assert.equal(expire!.opts.jobId, `card-expire-${draft.id}`);
      assert.equal(expire!.data.reference, result.reference);
      assert.equal(
        queued.filter((j) => j.queue === "email").length,
        0,
        "kartta havale talimatı e-postası gitmez"
      );
    });

    await test("ikinci çağrı AYNI referansı döndürür (reused)", async () => {
      const { quote, computed } = await expected(cardQuote.id);
      const before = jobs.length;
      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: buyer.id,
        email: buyer.email,
        input: quoteCheckoutSchema.parse(
          body({ expectedVersion: quote.version, expectedTotalKurus: computed.totals.totalKurus })
        ),
        // YENİ idempotency anahtarı: bu bir tekrar OYNATMA değil, canlı
        // taslağın yeniden bulunmasıdır.
        req: fakeRequest({ "idempotency-key": `qa-card-again-${randomUUID()}` }),
      });
      assert.equal(result.reused, true);
      assert.equal(result.reference, cardReference);
      assert.equal(result.redirectUrl, `/pay/${cardReference}`);
      assert.equal(result.iframeUrl, undefined, "ikinci token basılmaz");

      const drafts = await db
        .select({ id: orderDrafts.id })
        .from(orderDrafts)
        .where(eq(orderDrafts.userId, buyer.id));
      assert.equal(drafts.length, 1, "ikinci taslak YOK");
      assert.equal(jobs.length, before, "ikinci kez iş kuyruğa alınmaz");
    });

    await test("başlıksız istemcide İKİ FARKLI teklif tek anahtara ÇÖKMEZ", async () => {
      // `QuoteCheckoutInput` hangi teklifin ödendiğini söylemez. Başlık
      // göndermeyen bir istemci (admin/WhatsApp köprüsü) aynı kullanıcı için
      // aynı biçimli iki teklifi arka arkaya ödediğinde, anahtar yalnız
      // gövdeden türetilseydi ikinci istek BİRİNCİNİN referansı ve PayTR
      // iframe'iyle tekrar oynatılır, ikinci teklif hiç taslak görmezdi.
      const twin = await makeUser();
      const first = await makeQuote(twin.id, [{ geometry: CUBE }]);
      const second = await makeQuote(twin.id, [{ geometry: CUBE }]);
      const a = await expected(first.id);
      const b = await expected(second.id);
      assert.equal(a.quote.version, b.quote.version, "iki teklif de aynı sürümde");
      assert.equal(
        a.computed.totals.totalKurus,
        b.computed.totals.totalKurus,
        "iki teklif de aynı tutarda — gövdeler birebir aynı"
      );

      const shared = () =>
        quoteCheckoutSchema.parse(
          body({
            expectedVersion: a.quote.version,
            expectedTotalKurus: a.computed.totals.totalKurus,
          })
        );
      // Tuzağın gerçekten kurulduğunun kanıtı: SADECE gövdeden türetilen
      // anahtar bu iki istek için AYNI çıkar.
      assert.equal(
        deriveIdempotencyKey(shared(), twin.id),
        deriveIdempotencyKey(shared(), twin.id),
        "gövdeler aynı özetlenir"
      );
      assert.notEqual(
        deriveIdempotencyKey({ quoteId: first.id, input: shared() }, twin.id),
        deriveIdempotencyKey({ quoteId: second.id, input: shared() }, twin.id),
        "teklif kimliği anahtarı ayırır"
      );

      // Başlık YOK: servisin kendi türettiği anahtar iş başında.
      const one = await createQuoteCheckout({
        quoteId: first.id,
        userId: twin.id,
        email: twin.email,
        input: shared(),
        req: fakeRequest(),
      });
      const two = await createQuoteCheckout({
        quoteId: second.id,
        userId: twin.id,
        email: twin.email,
        input: shared(),
        req: fakeRequest(),
      });

      assert.notEqual(one.reference, two.reference, "ikinci teklif KENDİ referansını alır");
      assert.equal(two.reused, false, "ikinci teklif tekrar oynatma değil");
      assert.ok(two.iframeUrl, "ikinci teklif kendi PayTR token'ını alır");
      const twinDrafts = await db
        .select({ id: orderDrafts.id })
        .from(orderDrafts)
        .where(eq(orderDrafts.userId, twin.id));
      assert.equal(twinDrafts.length, 2, "her teklif için bir taslak");
      for (const quoteId of [first.id, second.id]) {
        const rows = await db
          .select({ id: quoteCheckouts.id })
          .from(quoteCheckouts)
          .where(eq(quoteCheckouts.quoteId, quoteId));
        assert.equal(rows.length, 1, "her teklif için bir köprü satırı");
      }
    });

    await test("bayat expectedTotalKurus 409 ile reddedilir", async () => {
      const seller = await makeUser();
      const q = await makeQuote(seller.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: seller.id,
          email: seller.email,
          input: quoteCheckoutSchema.parse(
            body({
              expectedVersion: quote.version,
              expectedTotalKurus: computed.totals.totalKurus - 100,
            })
          ),
          req: fakeRequest(),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          err.code === "total_mismatch" &&
          /tutar/i.test(err.message)
      );
      const drafts = await db
        .select({ id: orderDrafts.id })
        .from(orderDrafts)
        .where(eq(orderDrafts.userId, seller.id));
      assert.equal(drafts.length, 0, "reddedilen istek taslak bırakmadı");
    });

    await test("bayat expectedVersion 409 ile reddedilir", async () => {
      const other = await makeUser();
      const q = await makeQuote(other.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: other.id,
          email: other.email,
          input: quoteCheckoutSchema.parse(
            body({
              expectedVersion: quote.version + 7,
              expectedTotalKurus: computed.totals.totalKurus,
            })
          ),
          req: fakeRequest(),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          err.code === "version_conflict"
      );
    });

    await test("süresi dolmuş teklif TÜRKÇE bir cümleyle 409 alır", async () => {
      const late = await makeUser();
      const q = await makeQuote(late.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      await db
        .update(quotes)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(quotes.id, quote.id));
      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: late.id,
          email: late.email,
          input: quoteCheckoutSchema.parse(
            body({
              expectedVersion: quote.version,
              expectedTotalKurus: computed.totals.totalKurus,
            })
          ),
          req: fakeRequest(),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          /süresi doldu/i.test(err.message)
      );
    });

    await test("onaylanmamış üretim uyarısı 400 ile durdurur", async () => {
      const warned = await makeUser();
      const q = await makeQuote(warned.id, [{ geometry: THIN }]);
      const { quote, computed } = await expected(q.id);
      assert.ok(
        computed.parts[0].dfm.warningKey,
        "ince duvarlı çok gövdeli parça uyarı üretir"
      );
      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: warned.id,
          email: warned.email,
          input: quoteCheckoutSchema.parse(
            body({
              expectedVersion: quote.version,
              expectedTotalKurus: computed.totals.totalKurus,
            })
          ),
          req: fakeRequest(),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 400 &&
          /üretim uyarılarını onaylamanız/.test(err.message)
      );
    });

    await test("geçersiz VKN ile kurumsal fatura 400 alır, geçerlisi teklife yazılır", async () => {
      const company = await makeUser();
      const q = await makeQuote(company.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      const corporate = (taxId: string) =>
        quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: computed.totals.totalKurus,
            paymentMethod: "bank_transfer",
            poNumber: "PO-2026-42",
            invoice: {
              type: "corporate",
              companyName: "QA Mühendislik A.Ş.",
              taxId,
              taxOffice: "Kadıköy",
              billingAddress: address,
            },
          })
        );

      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: company.id,
          email: company.email,
          input: corporate("1234567891"),
          req: fakeRequest(),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError && err.status === 400 && err.code === "invalid_tax_id"
      );
      assert.equal(
        (await db.select({ id: orderDrafts.id }).from(orderDrafts).where(eq(orderDrafts.userId, company.id)))
          .length,
        0,
        "geçersiz VKN taslak bırakmadı"
      );

      // Eksik vergi dairesi de reddedilir.
      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: company.id,
          email: company.email,
          input: quoteCheckoutSchema.parse(
            body({
              expectedVersion: quote.version,
              expectedTotalKurus: computed.totals.totalKurus,
              invoice: { type: "corporate", companyName: "QA A.Ş.", taxId: "4540536920" },
            })
          ),
          req: fakeRequest(),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError && err.status === 400 && err.code === "tax_office_required"
      );

      const ok = await createQuoteCheckout({
        quoteId: quote.id,
        userId: company.id,
        email: company.email,
        input: corporate("4540536920"),
        req: fakeRequest(),
      });
      assert.equal(ok.paymentMethod, "bank_transfer");

      const [saved] = await db.select().from(quotes).where(eq(quotes.id, quote.id)).limit(1);
      assert.equal(saved.invoiceType, "corporate");
      assert.equal(saved.companyName, "QA Mühendislik A.Ş.");
      assert.equal(saved.taxId, "4540536920");
      assert.equal(saved.taxIdType, "vkn");
      assert.equal(saved.taxOffice, "Kadıköy");
      assert.deepEqual(saved.billingAddress, address);
      assert.equal(saved.poNumber, "PO-2026-42");
    });

    await test("havale yolu %3 indirimi AYARA bağlı uygular ve talimat yollar", async () => {
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE, quantity: 4 }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      assert.equal(
        quote.pricingSnapshot.settings.havaleDiscountApplies,
        true,
        "tohum ayarı indirimi açık tutar"
      );

      const before = jobs.length;
      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: total,
            paymentMethod: "bank_transfer",
          })
        ),
        req: fakeRequest(),
      });

      const discount = Math.floor(total * 0.03);
      assert.equal(result.paymentMethod, "bank_transfer");
      assert.equal(result.finalAmountKurus, total - discount);
      assert.equal(result.redirectUrl, `/havale/${result.reference}`);
      assert.equal(result.iframeUrl, undefined);

      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, result.reference));
      assert.equal(draft.amountKurus, total, "indirim TUTARI düşürmez, kolona yazılır");
      assert.equal(draft.havaleDiscountKurus, discount);
      assert.equal(draft.productionBaseKurus, total, "ortak payı indirim yemez");
      assert.ok(draft.bankTransferDeadline, "havale son tarihi yazıldı");
      assert.equal(draft.paytrMerchantOid, null);

      const queued = jobs.slice(before);
      assert.ok(queued.find((j) => j.opts.jobId === `havale-reminder-${draft.id}`));
      assert.ok(queued.find((j) => j.opts.jobId === `havale-expire-${draft.id}`));
      assert.equal(
        queued.filter((j) => j.name === "card-expire").length,
        0,
        "havalede kart işi yok"
      );
      const mail = queued.find((j) => j.queue === "email");
      assert.ok(mail, "havale talimatı e-postası kuyruğa alındı");
      assert.equal(mail!.data.type, "bank_transfer_instructions");
      assert.equal(mail!.data.to, payer.email);
      assert.equal(mail!.data.orderNumber, result.reference);
      assert.equal(mail!.data.paymentAmountKurus, total - discount);
      assert.equal(mail!.data.bankIban, process.env.BANK_IBAN);
    });

    await test("ayar kapalıyken havale indirimi UYGULANMAZ", async () => {
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE }]);
      const [row] = await db.select().from(quotes).where(eq(quotes.id, q.id)).limit(1);
      const frozen = {
        ...row.pricingSnapshot,
        settings: { ...row.pricingSnapshot.settings, havaleDiscountApplies: false },
      };
      await db.update(quotes).set({ pricingSnapshot: frozen }).where(eq(quotes.id, q.id));

      const { quote, computed } = await expected(q.id);
      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: computed.totals.totalKurus,
            paymentMethod: "bank_transfer",
          })
        ),
        req: fakeRequest(),
      });
      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, result.reference));
      assert.equal(draft.havaleDiscountKurus, 0);
      assert.equal(result.finalAmountKurus, computed.totals.totalKurus);
    });

    await test("başkasının teklifi ödenemez", async () => {
      const stranger = await makeUser();
      const { quote, computed } = await expected(cardQuote.id);
      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: stranger.id,
          email: stranger.email,
          input: quoteCheckoutSchema.parse(
            body({
              expectedVersion: quote.version,
              expectedTotalKurus: computed.totals.totalKurus,
            })
          ),
          req: fakeRequest(),
        }),
        (err: unknown) => err instanceof QuoteServiceError && err.status === 403
      );
    });

    await test("PayTR reddederse taslak PENDING kalır ve sebebi yazılır", async () => {
      const unlucky = await makeUser();
      const q = await makeQuote(unlucky.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      paytrFails = true;
      const before = jobs.length;
      // Servis arızayı BİLEREK günlüğe basar; testin çıktısı temiz kalsın diye
      // yakalanır ve basıldığı burada iddia edilir.
      const logged: unknown[][] = [];
      const realError = console.error;
      console.error = (...args: unknown[]) => void logged.push(args);
      try {
        await assert.rejects(
          createQuoteCheckout({
            quoteId: quote.id,
            userId: unlucky.id,
            email: unlucky.email,
            input: quoteCheckoutSchema.parse(
              body({
                expectedVersion: quote.version,
                expectedTotalKurus: computed.totals.totalKurus,
              })
            ),
            req: fakeRequest(),
          }),
          (err: unknown) => err instanceof QuoteServiceError && err.status === 502
        );
      } finally {
        paytrFails = false;
        console.error = realError;
      }
      assert.equal(logged.length, 1, "arıza bir kez günlüğe yazıldı");
      assert.match(String(logged[0][0]), /PayTR token creation failed/);
      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.userId, unlucky.id));
      assert.equal(draft.status, "pending", "müşteri /pay üzerinden tekrar deneyebilsin");
      assert.match(draft.paytrFailureReason ?? "", /PayTR/);
      // Kilidi açacak tek şey bu iş: token başarısız olsa bile kuyruğa girmeli,
      // yoksa terk edilen taslak teklifi sonsuza dek kilitler.
      assert.ok(
        jobs.slice(before).find((j) => j.opts.jobId === `card-expire-${draft.id}`),
        "token başarısız olsa da card-expire kuyruğa alındı"
      );
    });

    await test("bekleyen ödeme BAŞKA yöntemle istendiğinde 409, taslak YERİNDE kalır", async () => {
      // Ölçülen hâl: (1) müşteri kartı seçiyor, PayTR token vermiyor, taslak
      // BİLEREK `pending` kalıyor; (2) müşteri radyoyu havaleye alıyor ve form
      // artık tutar−%3 gösteriyor; (3) sunucu canlı KART taslağını geri
      // veriyor, ekran `/pay/<ref>`e gidiyor: orada yalnız "Kart ile Öde" ve
      // indirimsiz tutar var, IBAN yok, yöntem değiştirilemiyor — üstelik
      // teklif 72 saat kilitli kalıyor.
      const switcher = await makeUser();
      const q = await makeQuote(switcher.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const key = `qa-switch-${randomUUID()}`;
      const input = (paymentMethod: "card" | "bank_transfer") =>
        quoteCheckoutSchema.parse(
          body({ expectedVersion: quote.version, expectedTotalKurus: total, paymentMethod })
        );

      paytrFails = true;
      const logged: unknown[][] = [];
      const realError = console.error;
      console.error = (...args: unknown[]) => void logged.push(args);
      try {
        await assert.rejects(
          createQuoteCheckout({
            quoteId: quote.id,
            userId: switcher.id,
            email: switcher.email,
            input: input("card"),
            req: fakeRequest({ "idempotency-key": key }),
          }),
          (err: unknown) => err instanceof QuoteServiceError && err.status === 502
        );
      } finally {
        paytrFails = false;
        console.error = realError;
      }
      assert.equal(logged.length, 1, "PayTR arızası bir kez günlüğe yazıldı");

      const before = jobs.length;
      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: switcher.id,
          email: switcher.email,
          input: input("bank_transfer"),
          // AYNI anahtar: `withIdempotency` hata üzerine istemini siler, yani
          // bu bir tekrar oynatma değil gerçek bir ikinci istektir.
          req: fakeRequest({ "idempotency-key": key }),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          err.code === "pending_other_method" &&
          /kart/i.test(err.message) &&
          err.message.includes("/pay/")
      );

      const drafts = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.userId, switcher.id));
      assert.equal(drafts.length, 1, "ikinci taslak açılmadı");
      assert.equal(drafts[0].paymentMethod, "card", "yöntem yerinde DEĞİŞMEDİ");
      assert.equal(drafts[0].status, "pending");
      assert.equal(drafts[0].havaleDiscountKurus, 0);
      assert.equal(jobs.length, before, "havale hatırlatma/süre işleri kuyruğa girmedi");

      // ÇIKIŞ KAPISI: 409 tek başına dar kapıyı yeniden adlandırmaktan ibaret
      // olurdu. PayTR ekranını hiç görmemiş kart taslağı iptal edilebilir.
      const pending = await pendingQuoteCheckout(quote.id);
      assert.ok(pending, "bekleyen ödeme özeti okunur");
      assert.equal(pending!.paymentMethod, "card");
      assert.equal(pending!.paymentUrl, `/pay/${drafts[0].reference}`);
      assert.equal(pending!.cancellable, true);

      await assert.rejects(
        cancelPendingQuoteCheckout({ quoteId: quote.id, userId: (await makeUser()).id }),
        (err: unknown) => err instanceof QuoteServiceError && err.status === 403,
        "başkasının bekleyen ödemesi iptal edilemez"
      );

      const cancelled = await cancelPendingQuoteCheckout({
        quoteId: quote.id,
        userId: switcher.id,
      });
      assert.equal(cancelled.reference, drafts[0].reference);
      const [after] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.id, drafts[0].id));
      assert.equal(after.status, "cancelled");
      assert.equal(await pendingQuoteCheckout(quote.id), null, "teklifin kilidi açıldı");

      const havale = await createQuoteCheckout({
        quoteId: quote.id,
        userId: switcher.id,
        email: switcher.email,
        input: input("bank_transfer"),
        req: fakeRequest({ "idempotency-key": `qa-switch-2-${randomUUID()}` }),
      });
      assert.equal(havale.paymentMethod, "bank_transfer");
      assert.equal(havale.reused, false, "yeni taslak açıldı");
      assert.equal(havale.finalAmountKurus, total - Math.floor(total * 0.03));
    });

    await test("token alınmış kart taslağı İPTAL EDİLEMEZ", async () => {
      // Kapı dar: PayTR ekranını görmüş (dolayısıyla ödemiş olabilecek) bir
      // taslağı müşteri iptal edemez. `paytr_test_mode` ilk başarılı token'la
      // yazılır ve `/pay` yeniden basımında da yazılır.
      const started = await makeUser();
      const q = await makeQuote(started.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: started.id,
        email: started.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: computed.totals.totalKurus,
          })
        ),
        req: fakeRequest(),
      });
      assert.ok(result.paytrToken, "token alındı");
      const pending = await pendingQuoteCheckout(quote.id);
      assert.equal(pending!.cancellable, false);
      await assert.rejects(
        cancelPendingQuoteCheckout({ quoteId: quote.id, userId: started.id }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          err.code === "draft_not_cancellable"
      );
      const [draft] = await db
        .select({ status: orderDrafts.status })
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, result.reference));
      assert.equal(draft.status, "pending", "taslak yerinde kaldı");
    });

    await test("token basılırken İPTAL edilen taslağın token'ı MÜŞTERİYE VERİLMEZ", async () => {
      // İki sekme: A kartla ödemeyi başlatır; PayTR cevaplarken B bekleyen
      // taslağı iptal eder (o an `paytr_test_mode` NULL, yani kapı açık).
      // Koşulsuz yazımda A iframe'i alırdı, müşteri öderdi ve webhook
      // `DRAFT_NOT_PROMOTABLE` alıp 200'le onaylardı: para tahsil, sipariş yok.
      const racer = await makeUser();
      const q = await makeQuote(racer.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      let cancelledReference = "";
      paytrDuring = async () => {
        const out = await cancelPendingQuoteCheckout({
          quoteId: quote.id,
          userId: racer.id,
        });
        cancelledReference = out.reference;
      };
      const callsBefore = paytrCalls.length;

      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: racer.id,
          email: racer.email,
          input: quoteCheckoutSchema.parse(
            body({
              expectedVersion: quote.version,
              expectedTotalKurus: computed.totals.totalKurus,
            })
          ),
          req: fakeRequest(),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          err.code === "draft_cancelled"
      );

      // Yarışın gerçekten kurulduğunun kanıtı: token çağrısı YAPILDI ve iptal
      // tam o sırada çalıştı.
      assert.equal(paytrCalls.length, callsBefore + 1, "PayTR token'ı gerçekten istendi");
      assert.equal(paytrDuring, null, "araya girme çalıştı");
      assert.ok(cancelledReference, "taslak token beklenirken iptal edildi");

      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, cancelledReference));
      assert.equal(draft.status, "cancelled", "iptal yerinde kaldı");
      assert.equal(
        draft.paytrTestMode,
        null,
        "iptal edilmiş taslağa canlı token damgası yazılmaz"
      );
      assert.equal(
        await pendingQuoteCheckout(quote.id),
        null,
        "teklif kilitli kalmadı: müşteri yeniden başlayabilir"
      );

      // Kapı kapandıktan sonra normal yol hâlâ açık: yeni taslak token alır.
      const retry = await createQuoteCheckout({
        quoteId: quote.id,
        userId: racer.id,
        email: racer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: computed.totals.totalKurus,
          })
        ),
        req: fakeRequest(),
      });
      assert.equal(retry.reused, false, "iptalden sonra YENİ taslak açıldı");
      assert.notEqual(retry.reference, cancelledReference);
      assert.equal(retry.paytrToken, "qa-token");
    });

    await test("aynı anahtarla dürüst tekrar oran limitinden JETON YEMEZ", async () => {
      // Oran limiti kapıda dursaydı (saatte 10), aynı isteği aynı anahtarla
      // tekrar gönderen müşteri 11. denemede bir saatlik 429 yerdi — üstelik
      // tekrar oynatma hiçbir maliyetli iş yapmıyor: ne PayTR, ne e-posta.
      const loyal = await makeUser();
      const q = await makeQuote(loyal.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      const key = `qa-replay-${randomUUID()}`;
      const input = quoteCheckoutSchema.parse(
        body({
          expectedVersion: quote.version,
          expectedTotalKurus: computed.totals.totalKurus,
        })
      );
      const paytrBefore = paytrCalls.length;
      const jobsBefore = jobs.length;

      const results = [];
      for (let attempt = 0; attempt < 12; attempt++) {
        results.push(
          await createQuoteCheckout({
            quoteId: quote.id,
            userId: loyal.id,
            email: loyal.email,
            input,
            req: fakeRequest({ "idempotency-key": key }),
          })
        );
      }

      assert.equal(results.length, 12, "on ikisi de cevap aldı (429 yok)");
      for (const r of results) {
        assert.equal(r.reference, results[0].reference, "hepsi AYNI saklı cevap");
      }
      assert.equal(paytrCalls.length, paytrBefore + 1, "tek PayTR token'ı basıldı");
      assert.equal(jobs.length, jobsBefore + 1, "tek son tarih işi kuyruğa alındı");
      const drafts = await db
        .select({ id: orderDrafts.id })
        .from(orderDrafts)
        .where(eq(orderDrafts.userId, loyal.id));
      assert.equal(drafts.length, 1, "tek taslak");
    });

    await test("aynı Idempotency-Key başlığı iki isteği BİRBİRİNE BAĞLAMAZ", async () => {
      // Başlık anahtarın KENDİSİ olsaydı, paylaşılan `quotes.checkout`
      // kapsamında aynı dizgiyi gönderen ikinci çağıran birincinin taslak
      // referansını ve PayTR token'ını tekrar oynatırdı.
      const shared = "paylasilan-idempotency-anahtari";
      const twin = await makeUser();
      const stranger = await makeUser();
      const first = await makeQuote(twin.id, [{ geometry: CUBE }]);
      const second = await makeQuote(twin.id, [{ geometry: CUBE, quantity: 2 }]);
      const third = await makeQuote(stranger.id, [{ geometry: CUBE }]);

      const start = async (quoteId: string, user: { id: string; email: string }) => {
        const { quote, computed } = await expected(quoteId);
        return createQuoteCheckout({
          quoteId: quote.id,
          userId: user.id,
          email: user.email,
          input: quoteCheckoutSchema.parse(
            body({
              expectedVersion: quote.version,
              expectedTotalKurus: computed.totals.totalKurus,
            })
          ),
          req: fakeRequest({ "idempotency-key": shared }),
        });
      };

      const a = await start(first.id, twin);
      const b = await start(second.id, twin); // aynı müşteri, BAŞKA teklif
      const c = await start(third.id, stranger); // başka müşteri
      const references = new Set([a.reference, b.reference, c.reference]);
      assert.equal(references.size, 3, "üç istek üç ayrı referans aldı");
      for (const r of [a, b, c]) {
        assert.equal(r.reused, false);
        assert.ok(r.iframeUrl, "her biri KENDİ PayTR token'ını aldı");
      }
      for (const quoteId of [first.id, second.id, third.id]) {
        const rows = await db
          .select({ id: quoteCheckouts.id })
          .from(quoteCheckouts)
          .where(eq(quoteCheckouts.quoteId, quoteId));
        assert.equal(rows.length, 1, "her teklif için bir köprü satırı");
      }
    });

    await test("havale analitik olayı NET tutarı kaydeder (piksel ile aynı sayı)", async () => {
      // Tarayıcı `add_payment_info`'yu tutar−%3 ile yolluyor ve olay kimliğini
      // sunucuya veriyor; sunucu brüt yazarsa Meta/TikTok aynı kimlikli iki
      // kayıttan birini atar ve havale dönüşümleri rastgele %3 sapar.
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE, quantity: 4 }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const eventId = `qa-payinfo-${randomUUID()}`;
      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: total,
            paymentMethod: "bank_transfer",
            analyticsEventId: eventId,
          })
        ),
        req: fakeRequest(),
      });
      assert.equal(result.finalAmountKurus, total - Math.floor(total * 0.03));

      // `recordEvent` ateşle-unut çağrılır: satır birkaç tik sonra düşer.
      let row: { valueKurus: number | null; reference: string | null } | undefined;
      for (let i = 0; i < 200 && !row; i++) {
        [row] = await db
          .select({
            valueKurus: analyticsEvents.valueKurus,
            reference: analyticsEvents.reference,
          })
          .from(analyticsEvents)
          .where(eq(analyticsEvents.eventId, eventId));
        if (!row) await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(row, "add_payment_info kaydı yazıldı");
      assert.equal(row!.reference, result.reference);
      assert.equal(
        row!.valueKurus,
        result.finalAmountKurus,
        "sunucu kaydı ile pikselin tutarı AYNI olmalı"
      );
    });

    // ─── Hediye kartı (bayrak arkasında) ──────────────────────────────────
    //
    // Buradaki sınavın konusu TAHSİLAT ZİNCİRİDİR: brüt tutar hiç değişmez,
    // hediye kartı ve havale indirimi yalnız TAHSİL EDİLEN nakdi düşürür ve
    // PayTR'a giden tutar ile havale talimatındaki tutar AYNI zincirden çıkar.
    // İki sessiz felaket nöbet altında: PayTR'a brüt gitmesi (webhook farkı
    // yalnız loglar → çifte tahsilat) ve indirimin brütten hesaplanması
    // (`hediye + indirim > brüt` → o siparişin iadesi KALICI olarak reddedilir).

    /** Kart üretir. Vakalar yalnız ilgilendikleri alanı değiştirir. */
    async function makeGiftCard(
      balanceKurus: number,
      over: {
        status?: "active" | "partially_used" | "fully_used" | "expired" | "pending_payment";
        expiresAt?: Date;
        maxRedemptions?: number;
      } = {}
    ): Promise<{ id: string; code: string }> {
      const [card] = await db
        .insert(giftCards)
        .values({
          code: `GC-QA-${randomUUID().slice(0, 8).toUpperCase()}`,
          amountKurus: Math.max(balanceKurus, 1),
          balanceKurus,
          status: over.status ?? "active",
          paidAt: new Date(),
          expiresAt: over.expiresAt ?? new Date(Date.now() + 365 * 86_400_000),
          maxRedemptions: over.maxRedemptions ?? null,
        })
        .returning({ id: giftCards.id, code: giftCards.code });
      return card;
    }

    /**
     * İade motoru bu satırı OKUYABİLİR mi?
     *
     * `refundTenderBasis` `hediye + indirim > brüt` gördüğü an iadeyi
     * `lineage_unknown` ile KALICI olarak reddediyor (`order-refund.ts`), yani
     * hatalı bir zincir müşterinin iadesini imkânsız kılar. Bu yardımcı hem o
     * hatanın atılmadığını hem de motorun saydığı NAKDİN tahsil edilen tutarla
     * aynı olduğunu çiviler.
     */
    function assertRefundable(
      row: { amountKurus: number; havaleDiscountKurus: number; giftCardAmountKurus: number },
      payableKurus: number,
      where: string
    ) {
      const basis = refundTenderBasis(row);
      assert.equal(basis.cashKurus, payableKurus, `${where}: iade nakdi tahsilattan ayrıştı`);
      assert.equal(basis.giftKurus, row.giftCardAmountKurus, `${where}: iade hediye payı`);
      assert.equal(
        basis.invoiceKurus,
        row.amountKurus - row.havaleDiscountKurus,
        `${where}: hediye kartı fatura matrahını DÜŞÜRMEZ`
      );
    }

    await test("bayrak KAPALIYKEN kart kodu 400 alır ve taslak YAZILMAZ", async () => {
      // Sessizce yok saymak, müşterinin kartı uygulandı sanarak tam tutarı
      // ödemesi demek olurdu.
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE }]);
      const card = await makeGiftCard(500_000);
      const { quote, computed } = await expected(q.id);
      const paytrBefore = paytrCalls.length;

      await assert.rejects(
        createQuoteCheckout({
          quoteId: quote.id,
          userId: payer.id,
          email: payer.email,
          input: quoteCheckoutSchema.parse(
            body({
              expectedVersion: quote.version,
              expectedTotalKurus: computed.totals.totalKurus,
              giftCardCode: card.code,
            })
          ),
          req: fakeRequest(),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 400 &&
          err.code === "gift_card_disabled"
      );

      assert.equal(await pendingQuoteCheckout(quote.id), null, "taslak açılmadı");
      assert.equal(
        (await db.select().from(quoteCheckouts).where(eq(quoteCheckouts.quoteId, quote.id)))
          .length,
        0,
        "köprü satırı yazılmadı"
      );
      const [after] = await db.select().from(giftCards).where(eq(giftCards.id, card.id));
      assert.equal(after.balanceKurus, 500_000, "bakiye dokunulmadı");
      assert.equal(paytrCalls.length, paytrBefore, "PayTR çağrılmadı");
    });

    await setFlag("quote_gift_card_enabled", true, "qa");

    await test("kısmi kart: brüt DEĞİŞMEZ, PayTR'a NET tutar gider", async () => {
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE, quantity: 3 }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const gift = Math.floor(total / 4);
      assert.ok(gift > 0 && gift < total, "kart tutarın bir kısmını karşılar");
      const card = await makeGiftCard(gift);
      const before = jobs.length;

      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: total,
            giftCardCode: card.code,
          })
        ),
        req: fakeRequest(),
      });

      assert.equal(result.paymentMethod, "card");
      assert.equal(result.giftCardAmountKurus, gift);
      assert.equal(result.finalAmountKurus, total - gift, "tahsil edilen = brüt − kart");
      assert.equal(result.autoConfirmed, undefined, "kısmi kart siparişi doğurmaz");

      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, result.reference));
      assert.equal(draft.amountKurus, total, "BRÜT tutar kart yüzünden düşmez");
      assert.equal(draft.productionBaseKurus, total, "ortak payı kart yemez");
      assert.equal(draft.paintingPriceKurus, 0);
      assert.equal(draft.giftCardId, card.id);
      assert.equal(draft.giftCardAmountKurus, gift);
      assert.equal(draft.havaleDiscountKurus, 0, "kartta havale indirimi yok");
      assert.equal(draft.paymentMethod, "card");
      assert.ok(draft.paytrMerchantOid, "kart taslağı merchant oid taşır");
      assertRefundable(draft, total - gift, "kısmi kart taslağı");

      const [after] = await db.select().from(giftCards).where(eq(giftCards.id, card.id));
      assert.equal(after.balanceKurus, 0, "bakiye düştü");
      assert.equal(after.status, "fully_used");

      const redemptions = await db
        .select()
        .from(giftCardRedemptions)
        .where(eq(giftCardRedemptions.draftId, draft.id));
      assert.equal(redemptions.length, 1, "tek kullanım kaydı");
      assert.equal(redemptions[0].giftCardId, card.id);
      assert.equal(redemptions[0].amountKurus, gift);
      assert.equal(redemptions[0].redeemedByUserId, payer.id);
      assert.equal(redemptions[0].orderId, null, "terfiye kadar taslak kapsamında");
      assert.equal(redemptions[0].refundedAt, null);

      // ASIL NÖBET: PayTR'a brüt gitmesi sessiz çifte tahsilattır — webhook
      // tutar farkını yalnız loglar, reddetmez.
      const call = paytrCalls.at(-1)!;
      assert.equal(call.payment_amount, String(total - gift), "PayTR NET tutarı ister");
      const basket = JSON.parse(Buffer.from(call.user_basket, "base64").toString()) as Array<
        [string, string, number]
      >;
      assert.equal(basket[0][1], ((total - gift) / 100).toFixed(2), "sepet de NET");

      const queued = jobs.slice(before);
      assert.ok(
        queued.find((j) => j.opts.jobId === `card-expire-${draft.id}`),
        "rezervasyonlu kart taslağı için son tarih işi kuyruğa girer"
      );
    });

    await test("havale + kart: indirim NAKİT üzerinden hesaplanır", async () => {
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE, quantity: 5 }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const gift = Math.floor(total / 2);
      const card = await makeGiftCard(gift);
      const before = jobs.length;

      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: total,
            paymentMethod: "bank_transfer",
            giftCardCode: card.code,
          })
        ),
        req: fakeRequest(),
      });

      const cashDiscount = calculateHavaleDiscount(total - gift);
      const grossDiscount = calculateHavaleDiscount(total);
      assert.ok(cashDiscount < grossDiscount, "vaka iki tabanı gerçekten ayırıyor");

      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, result.reference));
      assert.equal(
        draft.havaleDiscountKurus,
        cashDiscount,
        "indirim brütten DEĞİL kalan nakitten hesaplanır"
      );
      assert.equal(draft.giftCardAmountKurus, gift);
      assert.equal(draft.amountKurus, total);
      assert.equal(result.finalAmountKurus, total - gift - cashDiscount);
      assertRefundable(draft, total - gift - cashDiscount, "havale + kart taslağı");

      const mail = jobs.slice(before).find((j) => j.queue === "email");
      assert.ok(mail, "havale talimatı gitti");
      assert.equal(
        mail!.data.paymentAmountKurus,
        result.finalAmountKurus,
        "talimattaki tutar ile cevaptaki tutar AYNI zincirden çıkar"
      );
    });

    await test("tam karşılama: PayTR yok, taslak ANINDA siparişe döner", async () => {
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const card = await makeGiftCard(total + 10_000);
      const before = jobs.length;
      const paytrBefore = paytrCalls.length;

      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: total,
            giftCardCode: card.code,
          })
        ),
        req: fakeRequest(),
      });

      assert.equal(result.autoConfirmed, true, "sipariş anında doğdu");
      assert.equal(result.paymentMethod, "gift_card_full");
      assert.equal(result.finalAmountKurus, 0, "tahsil edilecek nakit yok");
      assert.equal(result.giftCardAmountKurus, total);
      assert.equal(result.iframeUrl, undefined);
      assert.equal(paytrCalls.length, paytrBefore, "PayTR HİÇ çağrılmadı");

      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, result.reference));
      assert.equal(draft.paymentMethod, "gift_card_full");
      assert.equal(draft.paytrMerchantOid, null);
      assert.equal(draft.bankTransferDeadline, null);
      assert.equal(draft.amountKurus, total, "brüt tutar korunur");
      assert.equal(draft.giftCardAmountKurus, total);
      assert.equal(draft.havaleDiscountKurus, 0, "nakit yoksa indirim de yok");
      assert.equal(draft.status, "confirmed");
      assertRefundable(draft, 0, "tam karşılanan taslak");

      assert.ok(result.orderNumber, "sipariş numarası döndü");
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.orderNumber, result.orderNumber!));
      assert.ok(order, "sipariş satırı yazıldı");
      assert.equal(order.giftCardAmountKurus, total);
      assert.equal(order.amountKurus, total);
      assert.equal(order.paymentMethod, "gift_card_full");
      assert.equal(order.paymentStatus, "succeeded");
      assertRefundable(order, 0, "tam karşılanan sipariş");

      const [linked] = await db.select().from(quotes).where(eq(quotes.id, quote.id));
      assert.equal(linked.status, "ordered");
      assert.equal(linked.orderId, order.id);

      const [spent] = await db.select().from(giftCards).where(eq(giftCards.id, card.id));
      assert.equal(spent.balanceKurus, 10_000, "kalan bakiye kartta kalır");
      assert.equal(spent.status, "partially_used");

      const redemptions = await db
        .select()
        .from(giftCardRedemptions)
        .where(eq(giftCardRedemptions.giftCardId, card.id));
      assert.equal(redemptions.length, 1);
      assert.equal(redemptions[0].orderId, order.id, "terfi kullanımı siparişe taşıdı");

      // §5.4 ikinci koruma: `/api/orders` bu işi tam karşılanan taslak için
      // kuyruğa ALMAZ, teklif yolu ALIR — terfi patlarsa `expireDraft`
      // rezervasyonu geri verir ve teklifin kilidini açar.
      assert.ok(
        jobs.slice(before).find((j) => j.opts.jobId === `card-expire-${draft.id}`),
        "tam karşılanan taslak için de son tarih işi kuyruğa girer"
      );
      // …ve terfi onu SİLER: sipariş doğduktan sonra süre dolumu işi, ödenmiş
      // bir siparişin altından taslağı süresi dolmuşa çeviremez.
      assert.ok(
        removedJobIds.includes(`card-expire-${draft.id}`),
        "terfi son tarih işini kuyruktan kaldırır"
      );
    });

    await test("süre dolumu rezervasyonu KARTA geri yükler (teklif taslağı)", async () => {
      // Rezervasyonun serbest bırakılması TÜR-BAĞIMSIZ olmalı: bugüne kadar bu
      // yol yalnız figür taslağıyla koşmuştu. Teklif taslağı da aynı şekli
      // taşımak zorunda, yoksa müşterinin bakiyesi kartta KİLİTLİ kalır ve
      // teklifi de ödenmiş sayılmadığı için kilitli kalırdı.
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const gift = Math.floor(total / 5);
      const card = await makeGiftCard(gift);

      const result = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: total,
            giftCardCode: card.code,
          })
        ),
        req: fakeRequest(),
      });
      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, result.reference));

      await expireDraft(draft.id);

      const [restored] = await db.select().from(giftCards).where(eq(giftCards.id, card.id));
      assert.equal(restored.balanceKurus, gift, "bakiye karta geri yüklendi");
      assert.equal(restored.status, "active", "tamamı geri dönen kart yeniden aktif");
      const [redemption] = await db
        .select()
        .from(giftCardRedemptions)
        .where(eq(giftCardRedemptions.draftId, draft.id));
      assert.ok(redemption.refundedAt, "kullanım kaydı iade damgası aldı");
      const returns = await db
        .select()
        .from(giftCreditReturns)
        .where(eq(giftCreditReturns.expiredDraftId, draft.id));
      assert.equal(returns.length, 1, "tek denetim satırı");
      assert.equal(returns[0].amountKurus, gift);
      assert.equal(returns[0].balanceEffect, "restore");
      const [expired] = await db.select().from(orderDrafts).where(eq(orderDrafts.id, draft.id));
      assert.equal(expired.status, "expired");
      // Teklifin kilidi açıldı: müşteri yeniden düzenleyebilir/ödeyebilir.
      assert.equal(await pendingQuoteCheckout(quote.id), null);
    });

    await test("terfi edemeyen gift_card_full taslağı 0 TL'lik KART sayfasına düşmez", async () => {
      // Terfi patlarsa taslak `pending` kalır ve teklif kilitlidir; bekleyen
      // ödemeyi geri vermek müşteriyi `/pay/<ref>`e, yani tahsil edilecek nakit
      // OLMAYAN bir "kart ile öde" sayfasına yollardı (`draftMethod`
      // `gift_card_full`ü kart sayar). Doğru davranış terfiyi yeniden denemek.
      //
      // O hâl burada ELLE kurulur: taslak gerçek yolla açılır (kısmi kart),
      // sonra tamamı karşılanmış ama terfi edememiş bir taslağın şekline
      // çevrilir. Terfinin kendisini testte patlatmanın kancası yok.
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE, quantity: 2 }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const card = await makeGiftCard(Math.floor(total / 3));

      const first = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: total,
            giftCardCode: card.code,
          })
        ),
        req: fakeRequest({ "idempotency-key": `qa-stuck-1-${randomUUID()}` }),
      });
      const [pending] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, first.reference));
      await db
        .update(orderDrafts)
        .set({
          paymentMethod: "gift_card_full",
          giftCardAmountKurus: pending.amountKurus,
          paytrMerchantOid: null,
          paytrTestMode: null,
        })
        .where(eq(orderDrafts.id, pending.id));
      // Kullanım kaydı da aynı tutarı taşımalı: iade motorunun kapsam kontrolü
      // `Σ redemption.amount_kurus === draft.gift_card_amount_kurus` istiyor.
      await db
        .update(giftCardRedemptions)
        .set({ amountKurus: pending.amountKurus })
        .where(eq(giftCardRedemptions.draftId, pending.id));

      const retry = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({ expectedVersion: quote.version, expectedTotalKurus: total })
        ),
        req: fakeRequest({ "idempotency-key": `qa-stuck-2-${randomUUID()}` }),
      });

      assert.equal(retry.reference, first.reference, "yeni taslak açılmadı");
      assert.equal(retry.reused, true, "bekleyen taslak yeniden kullanıldı");
      assert.equal(retry.paymentMethod, "gift_card_full");
      assert.equal(retry.redirectUrl, undefined, "kart ödeme sayfasına yollanmaz");
      assert.equal(retry.finalAmountKurus, 0, "tahsil edilecek nakit yok");
      assert.equal(retry.autoConfirmed, true, "terfi yeniden denendi ve tuttu");
      assert.ok(retry.orderNumber, "sipariş numarası döndü");

      const [healed] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.id, pending.id));
      assert.equal(healed.status, "confirmed");
      assert.ok(healed.promotedOrderId, "taslak siparişe bağlandı");
    });

    await test("harcanamaz kart 400 alır ve teklif ÖDENEBİLİR kalır", async () => {
      const payer = await makeUser();
      const filler = await makeUser();
      const expired = await makeGiftCard(500_000, {
        expiresAt: new Date(Date.now() - 86_400_000),
      });
      const drained = await makeGiftCard(0);
      const limited = await makeGiftCard(500_000, { maxRedemptions: 1 });
      // Limiti dolduran CANLI kullanım: sayım paylaşılan sayaçtan geçiyor.
      await db.insert(giftCardRedemptions).values({
        giftCardId: limited.id,
        amountKurus: 1_000,
        redeemedByUserId: filler.id,
      });

      const cases: Array<[string, string]> = [
        [expired.code, "gift_card_expired"],
        // Bakiyesi 0 ama durumu `active`: ön kontrol GEÇER, kartı reddeden
        // şey işlem içindeki KİLİTLİ bakiye kapısıdır.
        [drained.code, "gift_card_insufficient"],
        [limited.code, "gift_card_limit_reached"],
        ["GC-QA-YOKBOYLE", "gift_card_not_found"],
      ];
      for (const [code, expectedCode] of cases) {
        const q = await makeQuote(payer.id, [{ geometry: CUBE }]);
        const { quote, computed } = await expected(q.id);
        await assert.rejects(
          createQuoteCheckout({
            quoteId: quote.id,
            userId: payer.id,
            email: payer.email,
            input: quoteCheckoutSchema.parse(
              body({
                expectedVersion: quote.version,
                expectedTotalKurus: computed.totals.totalKurus,
                giftCardCode: code,
              })
            ),
            req: fakeRequest(),
          }),
          (err: unknown) =>
            err instanceof QuoteServiceError &&
            err.status === 400 &&
            err.code === expectedCode &&
            /[çğıöşüÇĞİÖŞÜ]/.test(err.message),
          `${code} → ${expectedCode}`
        );
        // Teklif hâlâ düzenlenebilir/ödenebilir: yarım taslak bırakmadık.
        assert.equal(await pendingQuoteCheckout(quote.id), null, `${code}: taslak yok`);
      }

      const [stillZero] = await db.select().from(giftCards).where(eq(giftCards.id, drained.id));
      assert.equal(stillZero.balanceKurus, 0);
      const [stillFull] = await db.select().from(giftCards).where(eq(giftCards.id, limited.id));
      assert.equal(stillFull.balanceKurus, 500_000, "reddedilen kartın bakiyesi dokunulmadı");
    });

    await test("rezervasyon reddinin SIRASI /api/orders ile aynı (SERVİS üzerinden)", async () => {
      // Kilitli bloktaki kapılar ancak YARIŞTA konuşur: ön kontrol
      // (`validateGiftCard`) süresi geçmiş / limiti dolmuş kartı zaten yakalar.
      // Bu yüzden vaka `createQuoteCheckout` yerine rezervasyon servisini
      // DOĞRUDAN çağırıyor — üretimde koşan yol o.
      //
      // Sınavın konusu müşterinin göreceği CÜMLE: `/api/orders:660-695` sırası
      // bakiye → durum → süre → limit. Servis limiti karardan önce kapatırsa,
      // hem bakiyesi 0 hem limiti dolmuş kart burada "limit doldu",
      // `/api/orders`ta "bakiye yetersiz" der.
      const filler = await makeUser();
      const drainedAndLimited = await makeGiftCard(0, { maxRedemptions: 1 });
      const expiredAndLimited = await makeGiftCard(500_000, {
        maxRedemptions: 1,
        expiresAt: new Date(Date.now() - 86_400_000),
      });
      const onlyLimited = await makeGiftCard(500_000, { maxRedemptions: 1 });
      const cards: Array<[{ id: string }, number, string]> = [
        [drainedAndLimited, 0, "insufficient"],
        [expiredAndLimited, 500_000, "insufficient"],
        // Limit YALNIZ öteki kapılar geçtiğinde konuşur — kapı hâlâ işliyor.
        [onlyLimited, 500_000, "limit_reached"],
      ];
      for (const [card] of cards) {
        await db.insert(giftCardRedemptions).values({
          giftCardId: card.id,
          amountKurus: 1_000,
          redeemedByUserId: filler.id,
        });
      }

      const reserve = (giftCardId: string) =>
        db.transaction((tx) =>
          reserveGiftCardTx(tx, {
            giftCardId,
            amountKurus: 20_000,
            paymentMethod: "card",
            havaleDiscountApplies: false,
          })
        );

      for (const [card, balanceKurus, code] of cards) {
        await assert.rejects(
          reserve(card.id),
          (err: unknown) =>
            err instanceof GiftCardReservationError && err.code === code,
          `kilitli kart → ${code}`
        );
        const [row] = await db.select().from(giftCards).where(eq(giftCards.id, card.id));
        assert.equal(row.balanceKurus, balanceKurus, `${code}: bakiye dokunulmadı`);
        assert.equal(row.status, "active", `${code}: kartın durumu da dokunulmadı`);
      }

      // Kaybolmuş satır: `/api/orders` bunu `INSUFFICIENT_BALANCE` sayıyor, bu
      // yol ayrı bir kodu OLDUĞU için `not_found` diyor (servis başlığındaki
      // gerekçe). Bilinçli sapma, çivilenmiş hâli.
      await assert.rejects(
        reserve(randomUUID()),
        (err: unknown) =>
          err instanceof GiftCardReservationError && err.code === "not_found",
        "kilit altında kaybolan kart → not_found"
      );
    });

    await test("iptal rezervasyonu KARTA geri verir; ikinci iptal bakiyeyi iki kez artırmaz", async () => {
      // Bu vakanın konusu müşterinin PARASI: rezervasyonlu taslak dururken
      // teklif salt okunurdur, yani iptal kapısı kapalı olsaydı müşteri ne
      // ödeyebilir ne düzenleyebilir hâlde kalır ve bakiyesi
      // `CARD_DEADLINE_HOURS` boyunca kartta kilitli durur.
      //
      // İptal edilebilir kart taslağının tek gerçekçi yolu token'ın
      // reddedilmesidir: rezervasyon commit oldu (`freezeCheckout`), ama
      // `paytr_test_mode` NULL kaldı, yani müşteri PayTR ekranını hiç görmedi.
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE, quantity: 2 }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const gift = Math.floor(total / 4);
      const card = await makeGiftCard(gift);
      const input = quoteCheckoutSchema.parse(
        body({
          expectedVersion: quote.version,
          expectedTotalKurus: total,
          giftCardCode: card.code,
        })
      );

      paytrFails = true;
      const realError = console.error;
      console.error = () => {};
      try {
        await assert.rejects(
          createQuoteCheckout({
            quoteId: quote.id,
            userId: payer.id,
            email: payer.email,
            input,
            req: fakeRequest({ "idempotency-key": `qa-gift-cancel-${randomUUID()}` }),
          }),
          (err: unknown) => err instanceof QuoteServiceError && err.status === 502
        );
      } finally {
        paytrFails = false;
        console.error = realError;
      }

      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.userId, payer.id));
      assert.equal(draft.status, "pending");
      assert.equal(draft.paytrTestMode, null, "PayTR ekranı hiç açılmadı");
      assert.equal(draft.giftCardAmountKurus, gift);
      const [reserved] = await db.select().from(giftCards).where(eq(giftCards.id, card.id));
      assert.equal(reserved.balanceKurus, 0, "rezervasyon kartta duruyor");

      const pending = await pendingQuoteCheckout(quote.id);
      assert.ok(pending, "bekleyen ödeme özeti okunur");
      assert.equal(pending!.cancellable, true, "rezervasyonlu taslak da iptal EDİLEBİLİR");
      assert.equal(
        pending!.giftCardAmountKurus,
        gift,
        "ekran 'iptal ederseniz ₺X geri yüklenir' diyebilsin"
      );

      const cancelled = await cancelPendingQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
      });
      assert.equal(cancelled.reference, draft.reference);

      const [restored] = await db.select().from(giftCards).where(eq(giftCards.id, card.id));
      assert.equal(restored.balanceKurus, gift, "bakiye KARTA geri döndü");
      assert.equal(restored.status, "active", "tamamı geri dönen kart yeniden aktif");
      const [redemption] = await db
        .select()
        .from(giftCardRedemptions)
        .where(eq(giftCardRedemptions.draftId, draft.id));
      assert.ok(redemption.refundedAt, "kullanım kaydı iade damgası aldı");
      const returns = await db
        .select()
        .from(giftCreditReturns)
        .where(eq(giftCreditReturns.expiredDraftId, draft.id));
      assert.equal(returns.length, 1, "tek denetim satırı");
      assert.equal(returns[0].amountKurus, gift);
      assert.equal(returns[0].balanceEffect, "restore");
      const [after] = await db.select().from(orderDrafts).where(eq(orderDrafts.id, draft.id));
      assert.equal(after.status, "cancelled");
      assert.equal(await pendingQuoteCheckout(quote.id), null, "teklifin kilidi açıldı");

      // İkinci iptal: bekleyen ödeme YOK. `(expired_draft_id, redemption_id)`
      // tekil indeksi olmasa bile buraya gelinmez, ama bakiyenin iki kez
      // artmadığı ÖLÇÜLÜR — iki kez artan bir bakiye, kartın bedava para
      // basması demektir.
      await assert.rejects(
        cancelPendingQuoteCheckout({ quoteId: quote.id, userId: payer.id }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 409 &&
          err.code === "no_pending_draft"
      );
      const [once] = await db.select().from(giftCards).where(eq(giftCards.id, card.id));
      assert.equal(once.balanceKurus, gift, "bakiye İKİ KEZ artmadı");

      // …ve teklif AYNI kartla yeniden ödenebilir: kilit gerçekten açıldı.
      const retry = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input,
        req: fakeRequest({ "idempotency-key": `qa-gift-cancel-2-${randomUUID()}` }),
      });
      assert.equal(retry.reused, false, "iptalden sonra YENİ taslak açıldı");
      assert.equal(retry.giftCardAmountKurus, gift, "kart yeniden rezerve edildi");
      assert.equal(retry.finalAmountKurus, total - gift);
    });

    // ─── Ön izleme ucu (rezervasyon YOK) ──────────────────────────────────
    //
    // Ön izlemenin tek işi, müşteriye ödeme yükümlülüğünden ÖNCE ödeyeceği
    // tutarı göstermek (MSY m.6/2-a). Bu yüzden iki şey birden sınanır: aynı
    // kartla yapılan GERÇEK ödemenin yazdığı rakamlarla birebir aynı olması ve
    // hiçbir şey YAZMAMASI — ön izlemede düşen bir bakiye, müşterinin ödeme
    // yapmadan parasını kilitlemek demek olurdu.

    await test("ön izleme ödeme anındaki tutarları REZERVASYONSUZ gösterir", async () => {
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE, quantity: 4 }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const gift = Math.floor(total / 3);
      assert.ok(gift > 0 && gift < total, "kart tutarın bir kısmını karşılar");
      assert.equal(
        quote.pricingSnapshot.settings.havaleDiscountApplies,
        true,
        "vakanın anlamı havale indiriminin AÇIK olmasına bağlı"
      );
      const card = await makeGiftCard(gift);

      const preview = await previewQuoteGiftCard({
        quoteId: quote.id,
        userId: payer.id,
        // Küçük harfle girilen kod da çalışır (`validateGiftCard` büyütür).
        code: card.code.toLowerCase(),
        req: fakeRequest(),
      });
      assert.equal(preview.valid, true);
      assert.equal(preview.code, card.code, "kod normalleştirilmiş hâliyle döner");
      assert.equal(preview.balanceKurus, gift);
      assert.equal(preview.giftCardAmountKurus, gift);
      assert.equal(preview.fullyCovered, false);
      assert.equal(preview.card.havaleDiscountKurus, 0, "kartta havale indirimi yok");
      assert.equal(preview.card.payableKurus, total - gift);
      const discount = calculateHavaleDiscount(total - gift);
      assert.ok(discount > 0, "havale indirimi gerçekten hesaplanıyor");
      assert.equal(
        preview.bankTransfer.havaleDiscountKurus,
        discount,
        "havale indirimi kartın düştüğü NAKİT üzerinden"
      );
      assert.equal(preview.bankTransfer.payableKurus, total - gift - discount);

      // REZERVASYON YOK: bakiye, kullanım kaydı, taslak ve köprü satırı el
      // değmemiş. Ön izleme kilit de almaz, yazım da yapmaz.
      const [untouched] = await db.select().from(giftCards).where(eq(giftCards.id, card.id));
      assert.equal(untouched.balanceKurus, gift, "ön izleme bakiyeye DOKUNMAZ");
      assert.equal(untouched.status, "active");
      assert.equal(
        (
          await db
            .select()
            .from(giftCardRedemptions)
            .where(eq(giftCardRedemptions.giftCardId, card.id))
        ).length,
        0,
        "ön izleme kullanım kaydı yazmaz"
      );
      assert.equal(await pendingQuoteCheckout(quote.id), null, "taslak açılmadı");

      // …ve ödeme AYNI rakamları yazar: ekranda gösterilen tutar ile tahsil
      // edilen tutarın ayrışması bu özelliğin en pahalı hatası olurdu.
      const paid = await createQuoteCheckout({
        quoteId: quote.id,
        userId: payer.id,
        email: payer.email,
        input: quoteCheckoutSchema.parse(
          body({
            expectedVersion: quote.version,
            expectedTotalKurus: total,
            paymentMethod: "bank_transfer",
            giftCardCode: card.code,
          })
        ),
        req: fakeRequest(),
      });
      assert.equal(paid.finalAmountKurus, preview.bankTransfer.payableKurus);
      assert.equal(paid.giftCardAmountKurus, preview.giftCardAmountKurus);
      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, paid.reference));
      assert.equal(draft.giftCardAmountKurus, preview.giftCardAmountKurus);
      assert.equal(draft.havaleDiscountKurus, preview.bankTransfer.havaleDiscountKurus);
      assertRefundable(draft, preview.bankTransfer.payableKurus, "ön izlemeli havale taslağı");
    });

    await test("ön izleme: tam karşılamada ödenecek tutar 0, havale indirimi yok", async () => {
      // Sıfır nakde %3 indirim vermek, hediye kartına prim vermek olurdu.
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const card = await makeGiftCard(total + 50_000);

      const preview = await previewQuoteGiftCard({
        quoteId: quote.id,
        userId: payer.id,
        code: card.code,
        req: fakeRequest(),
      });
      assert.equal(preview.fullyCovered, true);
      assert.equal(preview.giftCardAmountKurus, total, "kart tutarın ötesine geçmez");
      assert.equal(preview.balanceKurus, total + 50_000);
      assert.equal(preview.card.payableKurus, 0);
      assert.equal(preview.bankTransfer.payableKurus, 0);
      assert.equal(preview.bankTransfer.havaleDiscountKurus, 0);
    });

    await test("ön izleme harcanamaz kartı ödeme ile AYNI kodla reddeder", async () => {
      // Ön izleme "₺0 karşılanan" diyip ödemeyi 400'e bırakırsa müşteri kartını
      // uygulanmış sanar. Reddin tek yetkilisi karar modülüdür ve ön izleme de
      // ONU okur, yani iki yüzey aynı cümleyi söyler.
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE }]);
      const { quote } = await expected(q.id);
      const drained = await makeGiftCard(0);
      const expiredCard = await makeGiftCard(500_000, {
        expiresAt: new Date(Date.now() - 86_400_000),
      });
      const limited = await makeGiftCard(500_000, { maxRedemptions: 1 });
      await db.insert(giftCardRedemptions).values({
        giftCardId: limited.id,
        amountKurus: 1_000,
        redeemedByUserId: payer.id,
      });

      const cases: Array<[string, string]> = [
        [drained.code, "gift_card_insufficient"],
        [expiredCard.code, "gift_card_expired"],
        [limited.code, "gift_card_limit_reached"],
        ["GC-YOK-YOK", "gift_card_not_found"],
      ];
      for (const [code, expectedCode] of cases) {
        await assert.rejects(
          previewQuoteGiftCard({
            quoteId: quote.id,
            userId: payer.id,
            code,
            req: fakeRequest(),
          }),
          (err: unknown) =>
            err instanceof QuoteServiceError &&
            err.status === 400 &&
            err.code === expectedCode &&
            /[çğıöşüÇĞİÖŞÜ]/.test(err.message),
          `ön izleme → ${expectedCode}`
        );
      }
      const [stillZero] = await db.select().from(giftCards).where(eq(giftCards.id, drained.id));
      assert.equal(stillZero.balanceKurus, 0, "reddedilen ön izleme de yazmaz");
      assert.equal(await pendingQuoteCheckout(quote.id), null, "teklif ÖDENEBİLİR kaldı");
    });

    await test("ön izleme oran limiti kod taramasını kapatır", async () => {
      // Kart kodları kısa ve tahmin edilebilir; ön izleme oturum + sahiplik
      // arkasında olsa bile kendi jetonu olmadan bir kod tarayıcısına dönerdi.
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE }]);
      const { quote } = await expected(q.id);
      const card = await makeGiftCard(10_000);

      for (let attempt = 0; attempt < GIFT_PREVIEW_RATE_LIMIT; attempt++) {
        const preview = await previewQuoteGiftCard({
          quoteId: quote.id,
          userId: payer.id,
          code: card.code,
          req: fakeRequest(),
        });
        assert.equal(preview.giftCardAmountKurus, 10_000, `${attempt + 1}. deneme geçti`);
      }
      await assert.rejects(
        previewQuoteGiftCard({
          quoteId: quote.id,
          userId: payer.id,
          code: card.code,
          req: fakeRequest(),
        }),
        (err: unknown) =>
          err instanceof QuoteServiceError &&
          err.status === 429 &&
          err.code === "rate_limited",
        "limitin üstündeki deneme 429"
      );
    });

    await test("ön izleme ucu: bayrak, oturum, erişim ve gövde kapıları", async () => {
      // Gerçek rota gövdesi koşar (`quoteRouteBody` + `accessOr404`), yalnız
      // oturum okuması taklit edilir: kapıların sırası ucun kendi dosyasında.
      const route = await import("../src/app/api/quotes/[id]/gift-card/route");
      // Teklif uçlarının ortak bayrağı: kapalıyken `quoteRouteBody` her şeye
      // 404 der ve vaka hiçbir şey kanıtlamazdı.
      await setFlag("instant_quote_enabled", true, "qa");
      const payer = await makeUser();
      const q = await makeQuote(payer.id, [{ geometry: CUBE }]);
      const { quote, computed } = await expected(q.id);
      const total = computed.totals.totalKurus;
      const card = await makeGiftCard(Math.floor(total / 2));
      const post = (payload: unknown) =>
        route.POST(
          jsonRequest(`https://qa.example.test/api/quotes/${quote.id}/gift-card`, payload),
          { params: Promise.resolve({ id: quote.id }) }
        );

      session = null;
      let response = await post({ code: card.code });
      assert.equal(response.status, 401, "oturumsuz ön izleme yok");
      assert.equal((await response.json()).code, "auth_required");

      session = { userId: (await makeUser()).id, email: "yabanci@example.test" };
      response = await post({ code: card.code });
      assert.equal(response.status, 404, "başkasının teklifi YOK gibi davranır");

      session = { userId: payer.id, email: payer.email };
      await setFlag("quote_gift_card_enabled", false, "qa");
      try {
        response = await post({ code: card.code });
        assert.equal(response.status, 404, "bayrak kapalıyken uç YOKTUR");
      } finally {
        await setFlag("quote_gift_card_enabled", true, "qa");
      }

      response = await post({ code: "AB" });
      assert.equal(response.status, 400, "üç karakterden kısa kod reddedilir");
      assert.equal((await response.json()).code, "invalid_body");

      response = await post({ code: card.code });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.deepEqual(Object.keys(payload).sort(), [
        "balanceKurus",
        "bankTransfer",
        "card",
        "code",
        "fullyCovered",
        "giftCardAmountKurus",
        "valid",
      ]);
      assert.equal(payload.giftCardAmountKurus, Math.floor(total / 2));
      assert.equal(payload.card.payableKurus, total - Math.floor(total / 2));
      session = null;
    });

    console.log(`${checks} quote checkout DB checks passed`);
  } finally {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end();
    fs.rmSync(ddlOut, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
