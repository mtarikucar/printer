/**
 * Ödenen teklifin SİPARİŞE dönüşmesi — gerçek yolla, izole 55433 şemasında.
 *
 * Buradaki sınavın konusu PARA ve DOSYADIR:
 *  - iki eşzamanlı `promoteDraftToOrder` TEK sipariş üretiyor mu,
 *  - `kickOffOrderProcessing` teklifi siparişe bir KEZ bağlıyor ve siparişi
 *    `review`'a alıyor mu (ikinci çağrı sessiz),
 *  - `attachQuoteFilesToOrder` TEK sürüm açıyor, ikinci çağrıda hiçbir şey
 *    yapmıyor mu,
 *  - ölçek çarpanı 1 olan parça hardlink'leniyor (bayt bayt aynı), inç parça
 *    25.4 katına ÖLÇEKLENİYOR mu (çıktı binary STL olarak ayrıştırılıp
 *    ölçülür; normaller değişmemeli),
 *  - taslağın para dökümü siparişe bozulmadan geçiyor mu
 *    (`productionBaseKurus + paintingPriceKurus === amountKurus`),
 *  - AYNI teklif için ikinci bir taslak ödendiğinde hata ATILMIYOR ama
 *    `[ÇİFT ÖDEME]` notu düşülüyor mu.
 *
 * Taklit edilen yalnız iki DIŞ dünya var: PayTR'ın token ucu (HTTP) ve BullMQ
 * (Redis kuyruğu). Dosya sistemi GERÇEKTİR: UPLOAD_DIR geçici bir dizine
 * kurulur ve canonical STL'ler diske yazılır.
 *
 * Kullanıcının dev veritabanına (5432) ya da dev Redis'ine (6379) ASLA
 * bağlanmaz.
 *
 * Çalıştırma:
 *   npx tsx --env-file=<qa.env> scripts/test-quote-order-db.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { PartGeometry, QuoteUnits } from "../src/lib/config/quote-types";

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
const namespace = `quote_order_${Date.now()}_${process.pid}`;
const ddlOut = fs.mkdtempSync(path.join(os.tmpdir(), "quote-order-ddl-"));
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-order-uploads-"));

// Depolama kökü MODÜL YÜKLENİRKEN okunuyor (storage.ts) — her `import`tan önce.
process.env.UPLOAD_DIR = uploadDir;
process.env.FILES_SIGNING_SECRET = "qa-signing-secret";
// Uyarısız çıktı: env modülü bu ikisini eksik bulduğunda satır yazıyor.
process.env.AUTH_SECRET = "qa-auth-secret-0123456789abcdef0123456789";
process.env.ADMIN_EMAIL = "qa-admin@example.test";
process.env.PAYTR_MERCHANT_ID = "123456";
process.env.PAYTR_MERCHANT_KEY = "test-key";
process.env.PAYTR_MERCHANT_SALT = "test-salt";
process.env.PAYTR_TEST_MODE = "1";
process.env.NEXT_PUBLIC_APP_URL = "https://qa.example.test";

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
  // takozdur; tsx altında boş bir modüle yönlendirilir.
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
  // BullMQ: Redis'e çıkmadan iş kaydı. Kuyruk modülleri kendi `jobId`
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
        async remove() {}
        async obliterate() {}
        async close() {}
      },
    },
  } as NodeJS.Module;
}

/** PayTR token ucu: ağ yok, ama imza/sepet gerçekten üretilir. */
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (href.includes("paytr.com")) {
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

// ─── Binary STL yardımcıları (gerçek dosya üret, gerçek dosya ölç) ──────────

const STL_HEADER = 84;
const STL_TRI = 50;

/** Eksen hizalı küp: 12 üçgen, GERÇEK birim normaller, binary STL. */
function cubeStl(size: number): Buffer {
  const v: [number, number, number][] = [
    [0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0],
    [0, 0, size], [size, 0, size], [size, size, size], [0, size, size],
  ];
  const tris: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  const buf = Buffer.alloc(STL_HEADER + tris.length * STL_TRI);
  buf.write("figurunica qa cube", 0, "latin1");
  buf.writeUInt32LE(tris.length, 80);
  let off = STL_HEADER;
  for (const [a, b, c] of tris) {
    const [ux, uy, uz] = [v[b][0] - v[a][0], v[b][1] - v[a][1], v[b][2] - v[a][2]];
    const [wx, wy, wz] = [v[c][0] - v[a][0], v[c][1] - v[a][1], v[c][2] - v[a][2]];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let i = 0; i < 3; i++) buf.writeFloatLE(n[i] / len, off + i * 4);
    off += 12;
    for (const idx of [a, b, c]) {
      for (let i = 0; i < 3; i++) buf.writeFloatLE(v[idx][i], off + i * 4);
      off += 12;
    }
    off += 2; // öznitelik sayacı
  }
  return buf;
}

function stlTriangleCount(buf: Buffer): number {
  return buf.readUInt32LE(80);
}

/** Dosyadaki köşelerin eksen hizalı kutusu. */
function stlExtents(buf: Buffer): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < stlTriangleCount(buf); t++) {
    const base = STL_HEADER + t * STL_TRI + 12;
    for (let corner = 0; corner < 3; corner++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = buf.readFloatLE(base + corner * 12 + axis * 4);
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  return { min, max };
}

/** İlk üçgenin normali — ölçekleme onu DEĞİŞTİRMEMELİ. */
function stlFirstNormal(buf: Buffer): number[] {
  const base = STL_HEADER;
  return [0, 1, 2].map((i) => buf.readFloatLE(base + i * 4));
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
    const { and, eq } = await import("drizzle-orm");
    const {
      orderDrafts,
      orderModelFiles,
      orderModelRevisions,
      orders,
      quoteCheckouts,
      quoteParts,
      quotes,
      users,
    } = await import("../src/lib/db/schema");
    const { defaultPartConfig } = await import("../src/lib/config/quote-compute");
    const { loadActiveSnapshot } = await import("../src/lib/services/quote-catalog");
    const { createQuoteCheckout } = await import("../src/lib/services/quote-checkout");
    const { quoteCheckoutSchema } = await import("../src/lib/validators/quote-checkout");
    const { promoteDraftToOrder, buildDraftReference } = await import(
      "../src/lib/services/order-draft"
    );
    const { kickOffOrderProcessing } = await import("../src/lib/services/order-confirm");
    const {
      attachQuoteFilesToOrder,
      findQuoteOrdersMissingFiles,
      quotePartFileName,
      scaleBinaryStl,
    } = await import("../src/lib/services/quote-order");

    const snapshot = await loadActiveSnapshot();

    const address = {
      adres: "Atatürk Cad. No:1",
      mahalle: "Merkez",
      ilce: "Kadıköy",
      il: "İstanbul",
      postaKodu: "34000",
      telefon: "+905321234567",
    };

    /** Milimetre biriminde 20 mm'lik kapalı küp. */
    const MM_CUBE: PartGeometry = {
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
    /** İNÇ biriminde 1 birimlik küp: milimetreye çevrilince 25.4 mm. */
    const INCH_CUBE: PartGeometry = {
      ...MM_CUBE,
      volume: 1,
      area: 6,
      extents: { x: 1, y: 1, z: 1 },
      wallP1: 1,
      wallP5: 1,
      overhangArea: 1,
    };

    async function makeUser(): Promise<{ id: string; email: string }> {
      const id = randomUUID();
      const email = `quote-order-${id}@example.test`;
      await db.insert(users).values({ id, email, fullName: "Teklif Müşterisi" });
      return { id, email };
    }

    /** Teklif + parçalar + parçaların GERÇEK canonical STL dosyaları. */
    async function makeQuote(
      userId: string,
      parts: Array<{
        name: string;
        geometry: PartGeometry;
        units: QuoteUnits;
        /** canonical.stl içindeki küpün kenarı (dosya biriminde). */
        cubeEdge: number;
        quantity: number;
      }>
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
        const tech = snapshot.technologies.find((t) => t.key === config.technologyKey)!;
        const material = snapshot.materials.find((m) => m.technologyKey === tech.key)!;
        const finish = snapshot.finishes.find(
          (f) => f.technologyKey === null || f.technologyKey === tech.key
        )!;
        const partId = randomUUID();
        const canonicalStlKey = `quote-parts/${partId}/canonical.stl`;
        fs.mkdirSync(path.join(uploadDir, `quote-parts/${partId}`), { recursive: true });
        fs.writeFileSync(path.join(uploadDir, canonicalStlKey), cubeStl(spec.cubeEdge));
        await db.insert(quoteParts).values({
          id: partId,
          quoteId: quote.id,
          sortOrder: index,
          name: spec.name,
          fileName: `parca-${index + 1}.stl`,
          sourceKey: `quote-parts/${partId}/source.stl`,
          sourceFormat: "stl",
          sourceBytes: 684,
          sourceSha256: randomUUID().replace(/-/g, "").repeat(2),
          analysisStatus: "ready",
          geometry: spec.geometry,
          canonicalStlKey,
          thumbnailKey: `quote-parts/${partId}/thumb.webp`,
          units: spec.units,
          scale: 1,
          technologyKey: tech.key,
          materialKey: material.key,
          colorKey: material.colors[0].key,
          finishKey: finish.key,
          layerUm: tech.defaultLayerUm,
          infillPct: tech.infillOptionsPct === null ? null : tech.defaultInfillPct,
          quantity: spec.quantity,
        });
      }
      return quote;
    }

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

    // ─── Ödenen teklif ────────────────────────────────────────────────────

    const buyer = await makeUser();
    const quote = await makeQuote(buyer.id, [
      // Ad bilerek Türkçe + boşluklu: görünen ad korunmalı, diskteki ad ASCII olmalı.
      { name: "Gövde Üst", geometry: MM_CUBE, units: "mm", cubeEdge: 20, quantity: 2 },
      { name: "Kapak", geometry: INCH_CUBE, units: "in", cubeEdge: 1, quantity: 1 },
    ]);

    const [quoteRow] = await db.select().from(quotes).where(eq(quotes.id, quote.id)).limit(1);
    const { computeQuote } = await import("../src/lib/config/quote-compute");
    const { toPricingInputs } = await import("../src/lib/services/quote-present");
    const seeded = await db
      .select()
      .from(quoteParts)
      .where(eq(quoteParts.quoteId, quote.id))
      .orderBy(quoteParts.sortOrder);
    const computed = computeQuote(quoteRow.pricingSnapshot, toPricingInputs(seeded), {
      leadTier: quoteRow.leadTier,
      addonKeys: quoteRow.addonKeys,
    });
    assert.equal(computed.totals.allPriced, true, "iki parça da fiyatlanabilmeli");
    const total = computed.totals.totalKurus;

    const checkout = await createQuoteCheckout({
      quoteId: quote.id,
      userId: buyer.id,
      email: buyer.email,
      input: quoteCheckoutSchema.parse({
        expectedVersion: quoteRow.version,
        expectedTotalKurus: total,
        shippingAddress: address,
        paymentMethod: "card" as const,
        distanceContractConsent: true as const,
        preliminaryInfoConsent: true as const,
        invoice: { type: "individual" as const },
      }),
      req: fakeRequest({ "idempotency-key": `qa-order-${randomUUID()}` }),
    });

    const [draft] = await db
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.reference, checkout.reference))
      .limit(1);

    let orderId = "";
    // `promoteDraftToOrder` kendi sonunda `kickOffOrderProcessing`i çağırıyor
    // (özel sipariş yolu): dosya işi ORADA kuyruğa girer. Sayaç bu yüzden
    // yükseltmeden ÖNCE alınır.
    const jobsBeforePromote = jobs.length;
    await test("iki eşzamanlı promoteDraftToOrder TEK sipariş üretir", async () => {
      const [a, b] = await Promise.all([
        promoteDraftToOrder(draft.id),
        promoteDraftToOrder(draft.id),
      ]);
      assert.equal(a.orderId, b.orderId, "ikinci çağrı var olan siparişi döner");
      orderId = a.orderId;
      const rows = await db.select({ id: orders.id }).from(orders).where(eq(orders.draftId, draft.id));
      assert.equal(rows.length, 1, "taslak başına tek sipariş satırı");
    });

    await test("para dökümü siparişe bozulmadan geçer", async () => {
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      assert.equal(order.amountKurus, total, "tahsil edilen tutar teklifin tutarı");
      assert.equal(
        (order.productionBaseKurus ?? 0) + order.paintingPriceKurus,
        order.amountKurus,
        "üretim + boyama = toplam (teklif siparişinde boyama yok)"
      );
      assert.equal(order.paintingPriceKurus, 0);
      assert.equal(order.orderType, "upload");
      assert.equal(
        order.quantity,
        seeded.reduce((sum, p) => sum + p.quantity, 0),
        "kapasite sayacı Σ adet okur"
      );
    });

    await test("kickOffOrderProcessing teklifi BİR KEZ bağlar, sipariş review'a geçer", async () => {
      // Yükseltme sırasında bir kez çalıştı; buradaki iki çağrı (admin tekrarı /
      // webhook yarışı) sessiz olmalı.
      await kickOffOrderProcessing(orderId, "tr");
      await kickOffOrderProcessing(orderId, "tr");

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      assert.equal(order.status, "review", "teklif siparişi yükleme siparişi gibi incelemeye gider");
      assert.equal(order.adminNotes ?? null, null, "tek ödemede çift ödeme notu YOK");

      const [linked] = await db.select().from(quotes).where(eq(quotes.id, quote.id)).limit(1);
      assert.equal(linked.orderId, orderId, "quotes.order_id yazıldı");
      assert.equal(linked.status, "ordered");
      const baked = jobs
        .slice(jobsBeforePromote)
        .filter((j) => j.queue === "quote-order-files" && j.name === "bake");
      assert.equal(baked.length, 1, "dosya işi TOPLAM bir kez kuyruğa alındı");
      assert.equal(baked[0].opts.jobId, `quote-order-files-${orderId}`);
      assert.deepEqual(baked[0].data, { orderId, quoteId: quote.id });
    });

    await test("dosyasız teklif siparişi kurtarma taramasında görünür", async () => {
      const pending = await findQuoteOrdersMissingFiles(20);
      assert.ok(
        pending.some((row) => row.orderId === orderId && row.quoteId === quote.id),
        "henüz dosyası olmayan sipariş listelenir"
      );
    });

    await test("onay rotası dosyasız teklif siparişini REDDEDER", async () => {
      // Rotanın kendisi admin oturumu ister; burada kapının okuduğu iki koşulun
      // (teklif siparişi + sürüm yok) gerçekten sağlandığı doğrulanır ve
      // metnin route'ta durduğu kaynaktan okunur.
      const { latestModelFiles } = await import("../src/lib/services/order-model");
      const [isQuoteOrder] = await db
        .select({ id: quotes.id })
        .from(quotes)
        .where(eq(quotes.orderId, orderId))
        .limit(1);
      assert.ok(isQuoteOrder, "sipariş teklif siparişi olarak tanınır");
      assert.equal((await latestModelFiles(orderId)).files.length, 0, "henüz sürüm yok");
      const route = fs.readFileSync(
        path.join(root, "src/app/api/admin/orders/[id]/approve/route.ts"),
        "utf8"
      );
      assert.match(route, /quote_files_pending/);
      assert.match(route, /Teklif dosyaları henüz siparişe eklenmedi/);
    });

    let attachedNames: string[] = [];
    await test("attachQuoteFilesToOrder TEK sürüm açar; ikinci çağrı no-op", async () => {
      assert.equal(await attachQuoteFilesToOrder(orderId), "attached");
      assert.equal(await attachQuoteFilesToOrder(orderId), "already", "ikinci çağrı yazmaz");

      const revisions = await db
        .select()
        .from(orderModelRevisions)
        .where(eq(orderModelRevisions.orderId, orderId));
      assert.equal(revisions.length, 1, "tek revizyon");
      assert.equal(revisions[0].revision, 1);
      assert.equal(revisions[0].uploadedByEmail, null, "sürümü bir insan yüklemedi");

      const files = await db
        .select()
        .from(orderModelFiles)
        .where(and(eq(orderModelFiles.orderId, orderId), eq(orderModelFiles.revision, 1)))
        .orderBy(orderModelFiles.sortOrder);
      assert.equal(files.length, seeded.length, "her parça için bir STL");
      assert.deepEqual([...new Set(files.map((f) => f.kind))], ["stl"]);
      attachedNames = files.map((f) => f.fileName);
      assert.deepEqual(
        attachedNames,
        ["P01_Gövde Üst_x2.stl", "P02_Kapak_x1.stl"],
        "üreticinin gördüğü ad: sıra + parça adı + adet"
      );
      // Diskteki ad ASCII'dir: imzalı dosya URL'i anahtarı ham gömüyor.
      for (const file of files) {
        assert.match(file.fileKey, new RegExp(`^models/${orderId}/[A-Za-z0-9._-]+\\.stl$`));
        assert.ok(fs.existsSync(path.join(uploadDir, file.fileKey)), file.fileKey);
      }

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      assert.equal(order.modelStlKey, files[0].fileKey, "siparişin canlı STL'i ilk parça");
      assert.ok(order.modelStlUrl?.includes("/api/files/"), "imzalı URL yazıldı");
      assert.equal(order.modelSource, "customer_quote");
      assert.equal(order.modelGlbKey, null, "teklif siparişinde GLB yok");
    });

    await test("çarpan 1: dosya bayt bayt aynı; inç parça 25.4 katına ölçeklenir", async () => {
      const files = await db
        .select()
        .from(orderModelFiles)
        .where(and(eq(orderModelFiles.orderId, orderId), eq(orderModelFiles.revision, 1)))
        .orderBy(orderModelFiles.sortOrder);

      const [mmPart, inchPart] = seeded;
      const source = (key: string) => fs.readFileSync(path.join(uploadDir, key));

      const mmOut = source(files[0].fileKey);
      assert.deepEqual(
        mmOut,
        source(mmPart.canonicalStlKey!),
        "ölçek 1 → hardlink/kopya, içerik değişmez"
      );

      const inchSource = source(inchPart.canonicalStlKey!);
      const inchOut = source(files[1].fileKey);
      assert.equal(
        stlTriangleCount(inchOut),
        stlTriangleCount(inchSource),
        "üçgen sayısı korunur"
      );
      const before = stlExtents(inchSource);
      const after = stlExtents(inchOut);
      for (let axis = 0; axis < 3; axis++) {
        const size = after.max[axis] - after.min[axis];
        assert.ok(
          Math.abs(size - 25.4) < 1e-3,
          `eksen ${axis}: ${size} mm (25.4 bekleniyordu, ${before.max[axis] - before.min[axis]} inçten)`
        );
      }
      assert.deepEqual(
        stlFirstNormal(inchOut),
        stlFirstNormal(inchSource),
        "tekdüze ölçekleme normalin YÖNÜNÜ değiştirmez: normaller çarpılmaz"
      );
      assert.equal(files[1].sizeBytes, inchOut.length, "boyut kaydı gerçek dosyayı gösterir");
    });

    await test("kurtarma taraması dosyaları eklenen siparişi ARTIK listelemez", async () => {
      const pending = await findQuoteOrdersMissingFiles(20);
      assert.equal(
        pending.some((row) => row.orderId === orderId),
        false
      );
    });

    await test("iki eşzamanlı dosya pişirme TEK sürüm bırakır", async () => {
      // İş kuyruğu ile beş dakikalık kurtarma taraması aynı siparişte
      // buluşabilir: "sürüm var mı" kapısı işlem DIŞINDA okunuyor ve dosya
      // yazmak dakikalar sürebiliyor. Kaybeden, kazananın dosyalarını da
      // silmeden geri çekilmeli.
      const racer = await makeUser();
      const raceQuote = await makeQuote(racer.id, [
        { name: "Yarış Parçası", geometry: MM_CUBE, units: "mm", cubeEdge: 20, quantity: 1 },
      ]);
      const [row] = await db.select().from(quotes).where(eq(quotes.id, raceQuote.id)).limit(1);
      const raceParts = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, raceQuote.id));
      const raceTotal = computeQuote(row.pricingSnapshot, toPricingInputs(raceParts), {
        leadTier: row.leadTier,
        addonKeys: row.addonKeys,
      }).totals.totalKurus;
      const raceCheckout = await createQuoteCheckout({
        quoteId: raceQuote.id,
        userId: racer.id,
        email: racer.email,
        input: quoteCheckoutSchema.parse({
          expectedVersion: row.version,
          expectedTotalKurus: raceTotal,
          shippingAddress: address,
          paymentMethod: "card" as const,
          distanceContractConsent: true as const,
          preliminaryInfoConsent: true as const,
          invoice: { type: "individual" as const },
        }),
        req: fakeRequest({ "idempotency-key": `qa-race-${randomUUID()}` }),
      });
      const [raceDraft] = await db
        .select({ id: orderDrafts.id })
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, raceCheckout.reference))
        .limit(1);
      const { orderId: raceOrderId } = await promoteDraftToOrder(raceDraft.id);

      const outcomes = await Promise.all([
        attachQuoteFilesToOrder(raceOrderId),
        attachQuoteFilesToOrder(raceOrderId),
      ]);
      assert.deepEqual(
        [...outcomes].sort(),
        ["already", "attached"],
        `biri yazar biri geri çekilir: ${outcomes.join(",")}`
      );
      const revisions = await db
        .select({ revision: orderModelRevisions.revision })
        .from(orderModelRevisions)
        .where(eq(orderModelRevisions.orderId, raceOrderId));
      assert.equal(revisions.length, 1, "tek sürüm");

      const raceFiles = await db
        .select()
        .from(orderModelFiles)
        .where(eq(orderModelFiles.orderId, raceOrderId));
      assert.equal(raceFiles.length, 1);
      // Kaybeden temizlik yapsaydı kazananın kayıtlı dosyası diskten silinirdi.
      assert.ok(
        fs.existsSync(path.join(uploadDir, raceFiles[0].fileKey)),
        "kayıtlı dosya diskte duruyor"
      );
    });

    // ─── Çift ödeme ───────────────────────────────────────────────────────

    await test("aynı teklif için ikinci ödeme: hata YOK, [ÇİFT ÖDEME] notu VAR", async () => {
      // İkinci taslak ekrandan açılamaz (teklif artık `ordered`), ama bir PayTR
      // yeniden denemesi / elle açılmış eski bir taslak ödenebilir. Kurgu tam
      // olarak budur: aynı teklifi gösteren İKİNCİ bir ödeme köprüsü.
      const [firstCheckout] = await db
        .select()
        .from(quoteCheckouts)
        .where(eq(quoteCheckouts.quoteId, quote.id))
        .limit(1);
      const secondDraftId = randomUUID();
      await db.insert(orderDrafts).values({
        ...draft,
        id: secondDraftId,
        reference: buildDraftReference(),
        status: "pending",
        promotedOrderId: null,
        promotedAt: null,
        paytrMerchantOid: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.insert(quoteCheckouts).values({
        ...firstCheckout,
        id: randomUUID(),
        draftId: secondDraftId,
        createdAt: new Date(),
      });

      const second = await promoteDraftToOrder(secondDraftId);
      // FIRLATMAZ: para çoktan alınmıştır, ödeme yolunu patlatmak webhook'a
      // 500 döndürmek olurdu.
      await kickOffOrderProcessing(second.orderId, "tr");

      const [secondOrder] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, second.orderId))
        .limit(1);
      assert.equal(secondOrder.status, "review", "ikinci sipariş de incelemeye düşer");
      assert.match(
        secondOrder.adminNotes ?? "",
        /\[ÇİFT ÖDEME\] Teklif T-\d+ başka bir siparişe bağlı \(FIG-[A-Z0-9_-]+\)/,
        `not yazılmadı: ${secondOrder.adminNotes}`
      );
      assert.equal(
        (secondOrder.adminNotes ?? "").match(/\[ÇİFT ÖDEME\]/g)?.length,
        1,
        "tekrarlanan kickoff notu ikinci kez yazmaz"
      );

      const [linked] = await db.select().from(quotes).where(eq(quotes.id, quote.id)).limit(1);
      assert.equal(linked.orderId, orderId, "teklif İLK siparişte kalır");

      // Dosyalar ikinci siparişe EKLENMEZ: teklif oraya bağlı değil.
      assert.equal(await attachQuoteFilesToOrder(second.orderId), "not_quote");
      const files = await db
        .select({ id: orderModelFiles.id })
        .from(orderModelFiles)
        .where(eq(orderModelFiles.orderId, second.orderId));
      assert.equal(files.length, 0);
    });

    // ─── Ölçekleyicinin kendi kapıları ────────────────────────────────────

    await test("scaleBinaryStl ASCII STL'i ve kesik dosyayı REDDEDER", async () => {
      const ascii = path.join(uploadDir, "ascii.stl");
      fs.writeFileSync(ascii, "solid qa\nfacet normal 0 0 1\nendsolid qa\n".padEnd(200, " "));
      await assert.rejects(
        () => scaleBinaryStl(ascii, path.join(uploadDir, "ascii-out.stl"), 2),
        /ASCII STL/
      );

      const truncated = path.join(uploadDir, "truncated.stl");
      const full = cubeStl(10);
      fs.writeFileSync(truncated, full.subarray(0, full.length - 20));
      const out = path.join(uploadDir, "truncated-out.stl");
      await assert.rejects(() => scaleBinaryStl(truncated, out, 2), /truncated/);
      assert.equal(fs.existsSync(out), false, "yarım çıktı geride bırakılmaz");
    });

    await test("dosya adı kuralı: sıra numarası adı TEKİL yapar", async () => {
      // İki parça aynı adı taşısa bile dosyalar karışmaz.
      const name = (position: number, partName: string, quantity: number) =>
        quotePartFileName({
          position,
          name: partName,
          quantity,
        } as Parameters<typeof quotePartFileName>[0]);
      assert.equal(name(0, "gövde", 3), "P01_gövde_x3.stl");
      assert.equal(name(1, "gövde", 3), "P02_gövde_x3.stl");
      // Zaten .stl uzantılı bir ad iki kez uzantı almaz.
      assert.equal(name(9, "taban.stl", 1), "P10_taban_x1.stl");
      // Yol parçaları ve kontrol karakterleri temizlenir (safeModelFileName).
      assert.equal(name(0, "../../etc/passwd", 1), "P01_passwd_x1.stl");
    });

    console.log(`${checks} quote order DB checks passed`);
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
