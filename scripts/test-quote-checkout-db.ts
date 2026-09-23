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
        async obliterate() {}
        async close() {}
      },
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
    const { analyticsEvents, orderDrafts, quoteCheckouts, quoteParts, quotes, users } =
      await import("../src/lib/db/schema");
    const { computeQuote } = await import("../src/lib/config/quote-compute");
    const { defaultPartConfig } = await import("../src/lib/config/quote-compute");
    const { loadActiveSnapshot } = await import("../src/lib/services/quote-catalog");
    const { toPricingInputs } = await import("../src/lib/services/quote-present");
    const { QuoteServiceError } = await import("../src/lib/services/quote-service");
    const { deriveIdempotencyKey } = await import("../src/lib/services/idempotency");
    const { cancelPendingQuoteCheckout, createQuoteCheckout, pendingQuoteCheckout } =
      await import("../src/lib/services/quote-checkout");
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
