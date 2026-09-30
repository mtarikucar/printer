/**
 * ÇERÇEVE ANLAŞMALAR — GERÇEK yolla testi: izole 55433 şeması, gerçek
 * `quote_frameworks` / `quote_framework_batches` yazımı, gerçek fiyat
 * çekirdeği, gerçek ödeme yolu.
 *
 * ─── BU DOSYANIN KONUSU TEK BİR ŞEY: FİYAT KİLİDİ ───────────────────────────
 *
 * Kanıtlanacak değişmez şudur: **parti, anlaşma imzalandığı gündeki ₺ tutarını
 * öder.** Katalog anlaşmadan sonra değişse bile serbest bırakılan partinin
 * tutarı KIPIRDAMAZ, ve o tutar ödeme yolundan (`createQuoteCheckout` →
 * `order_drafts` → `orders`) DEĞİŞMEDEN geçer.
 *
 * Kilidi gerçek yapan üç şeyin her biri ayrı ayrı sınanır:
 *   1. klonun `pricing_snapshot`ı ANLAŞMANIN snapshot'ı (byte-eş),
 *   2. klon parçanın manuel fiyatı + anahtarı PARTİ ADEDİYLE yazılmış,
 *   3. EŞİTLİK KAPISI: klonun bugün hesaplanan BRÜTÜ ≠ kilitli tutar → 409
 *      `framework_price_drift`, hem serbest bırakmada hem ödemede.
 *
 * Ayrıca: iki eşzamanlı serbest bırakma TEK klon üretir (R4), `expired`
 * anlaşma reddeder (R5), parti klonu DÜZENLENEMEZ (R1), anlaşma iptali ödenmiş
 * partiye DOKUNMAZ, hediye kartlı parti kapıyı YANLIŞ ALARMA düşürmez (kapı
 * BRÜTÜ karşılaştırıyor) ve `Σ parti tutarı` ile `committed_total_kurus` AYRI
 * iki rakamdır.
 *
 * Taklit edilen yalnız iki DIŞ dünya var: PayTR'ın token ucu (HTTP) ve BullMQ
 * (Redis). Dosya sistemi GERÇEKTİR: UPLOAD_DIR geçici bir dizine kurulur ve
 * canonical STL'ler diske yazılır (klon parçaları hardlink'lenir).
 *
 * Kullanıcının dev veritabanına (5432) ya da dev Redis'ine (6379) ASLA
 * bağlanmaz.
 *
 * Çalıştırma:
 *   npx tsx --env-file=<qa.env> scripts/test-quote-framework-db.ts
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
const namespace = `quote_framework_${Date.now()}_${process.pid}`;
const ddlOut = fs.mkdtempSync(path.join(os.tmpdir(), "quote-framework-ddl-"));
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-framework-uploads-"));

// Depolama kökü MODÜL YÜKLENİRKEN okunuyor (storage.ts) — her `import`tan önce.
process.env.UPLOAD_DIR = uploadDir;
process.env.FILES_SIGNING_SECRET = "qa-signing-secret";
process.env.AUTH_SECRET = "qa-auth-secret-0123456789abcdef0123456789";
process.env.ADMIN_EMAIL = "qa-admin@example.test";
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
  opts: { jobId?: string; delay?: number };
}
const jobs: QueuedJob[] = [];

const require_ = createRequire(import.meta.url);
{
  // `server-only` bir NPM paketi değil, Next'in derleme sırasında çözdüğü bir
  // takozdur; tsx altında boş bir modüle yönlendirilir. (Kapının KENDİSİ
  // `scripts/test-quote-framework.ts`in kaynak denetiminde sınanıyor: bu takoz
  // onu gizler, o yüzden asıl çivi orada durur.)
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
  const filename = require_.resolve("bullmq");
  require_.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: {
      Queue: class {
        constructor(readonly name: string) {}
        async add(name: string, _data: unknown, opts: QueuedJob["opts"] = {}) {
          jobs.push({ queue: this.name, name, opts });
          return { id: opts.jobId ?? randomUUID() };
        }
        async remove() {}
        async obliterate() {}
        async close() {}
      },
    },
  } as NodeJS.Module;
}
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

/**
 * Müşteri oturumu: `resolveQuoteAccess` çerezleri `next/headers` üzerinden
 * okuyor ve bir istek kapsamı olmadan çağrılamaz. Taklit YALNIZ oturum
 * okumasıdır — erişim çözümü, izin motoru ve para hesabı gerçek koddan geçer.
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

// ─── Binary STL: gerçek dosya üret (klon hardlink'leyecek) ──────────────────

const STL_HEADER = 84;
const STL_TRI = 50;

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
    off += 2;
  }
  return buf;
}

/** 20 mm'lik kapalı küp — worker raporunun taklidi. */
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
  tessellation: null,
  solidCount: null,
};

const address = {
  adres: "Atatürk Cad. No:1",
  mahalle: "Merkez",
  ilce: "Kadıköy",
  il: "İstanbul",
  postaKodu: "34000",
  telefon: "+905321234567",
};

const REASON = "QA: çerçeve anlaşma testi, en az on karakter gerekçe";

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

/**
 * Fiyat sapması ADMİN'E UYARI düşürüyor (`console.error`) ve o uyarı bu turun
 * bir GEREĞİ: sessizce 409 dönmek, kimsenin bakmadığı bir para hatası
 * bırakmak olurdu. Uyarı burada YAKALANIR — hem çıktı temiz kalsın hem içeriği
 * iddia edilebilsin.
 */
const warnings: string[] = [];
async function capturingWarnings<T>(run: () => Promise<T>): Promise<T> {
  const real = console.error;
  warnings.length = 0;
  console.error = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    return await run();
  } finally {
    console.error = real;
  }
}

/** Beklenen hatayı DEĞER olarak yakalar: kod ve durum ayrı ayrı iddia edilsin. */
async function refusal(run: () => Promise<unknown>): Promise<{ status: number; code?: string; message: string }> {
  try {
    await run();
  } catch (err) {
    const e = err as { status?: number; code?: string; message?: string };
    return { status: e.status ?? 0, code: e.code, message: e.message ?? String(err) };
  }
  throw new Error("beklenen ret gelmedi");
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
    const { and, asc, eq, isNull, sql } = await import("drizzle-orm");
    const {
      fxRates,
      manufacturers,
      orderDrafts,
      orders,
      printAddons,
      printMaterials,
      quoteAdminActions,
      quoteFrameworkBatchLines,
      quoteFrameworkBatches,
      quoteFrameworks,
      quoteParts,
      quotes,
      users,
    } = await import("../src/lib/db/schema");
    const { addBusinessDays, istanbulDateKey } = await import("../src/lib/config/business-days");
    const { computeQuote, defaultPartConfig } = await import("../src/lib/config/quote-compute");
    const { partPricingKey } = await import("../src/lib/config/quote-keys");
    const { quotePermissions } = await import("../src/lib/config/quote-policy");
    const { frameworkBatchDriftCode } = await import("../src/lib/config/quote-framework");
    const { loadActiveSnapshot } = await import("../src/lib/services/quote-catalog");
    const { toPricingPartInput } = await import("../src/lib/services/quote-cache");
    const { adminManualPriceKey } = await import("../src/lib/services/quote-admin");
    const {
      parsePartPatch,
      quoteHasLiveFramework,
      quoteIsFrameworkBatch,
      repriceQuote,
      updatePart,
    } = await import("../src/lib/services/quote-service");
    const { resolveQuoteAccess } = await import("../src/lib/services/quote-access");
    const {
      activateFramework,
      cancelBatch,
      cancelFramework,
      createFrameworkFromQuote,
      extendFrameworkLock,
      listAdminFrameworks,
      listCustomerFrameworks,
      loadFrameworkAudit,
      loadFrameworkDetail,
      loadFrameworkEntry,
      loadFrameworkForwardLoad,
      loadManufacturerPlannedBatches,
      loadOrderFrameworkCard,
      planBatches,
      releasableBatchCount,
      releaseBatch,
      setFrameworkPreferences,
    } = await import("../src/lib/services/quote-framework");
    const { createQuoteCheckout } = await import("../src/lib/services/quote-checkout");
    const { quoteCheckoutSchema } = await import("../src/lib/validators/quote-checkout");
    const { promoteDraftToOrder } = await import("../src/lib/services/order-draft");
    const { attachQuoteFilesToOrder, quotePartFileName } = await import(
      "../src/lib/services/quote-order"
    );
    const { orderModelFiles } = await import("../src/lib/db/schema");

    const snapshot = await loadActiveSnapshot();
    const ADDON_KEY = "uygunluk_sertifikasi"; // `fixed`, 35000 kuruş
    const addon = snapshot.addons.find((a) => a.key === ADDON_KEY)!;
    assert.equal(addon.priceType, "fixed", "vaka `fixed` ek hizmete dayanıyor");

    async function makeUser(): Promise<{ id: string; email: string }> {
      const id = randomUUID();
      const email = `quote-framework-${id}@example.test`;
      await db.insert(users).values({ id, email, fullName: "Kurumsal Müşteri" });
      return { id, email };
    }

    /**
     * FİYATLANMIŞ (`status='quoted'`) bir teklif + GERÇEK canonical STL'ler.
     *
     * Parçaların fiyatı OTOMATİKTİR (manuel fiyat yok): anlaşmanın kilitlediği
     * birim fiyat böylece motorun kendi hesabıdır, testin uydurduğu bir sayı
     * değil.
     */
    async function makeQuote(
      userId: string,
      parts: Array<{ name: string; quantity: number }>,
      over: { addonKeys?: string[]; status?: "quoted" | "draft"; fxSnapshot?: unknown } = {}
    ) {
      const now = new Date();
      const [quote] = await db
        .insert(quotes)
        .values({
          userId,
          status: over.status ?? "quoted",
          addonKeys: over.addonKeys ?? [ADDON_KEY],
          pricingSnapshot: snapshot,
          snapshotTakenAt: now,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fxSnapshot: (over.fxSnapshot ?? null) as any,
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          termsAcceptedAt: now,
          termsVersion: "qa",
        })
        .returning({ id: quotes.id, number: quotes.number, version: quotes.version });

      const config = defaultPartConfig(snapshot, CUBE);
      const tech = snapshot.technologies.find((t) => t.key === config.technologyKey)!;
      const material = snapshot.materials.find((m) => m.technologyKey === tech.key)!;
      const finish = snapshot.finishes.find(
        (f) => f.key === "ham" && (f.technologyKey === null || f.technologyKey === tech.key)
      )!;
      assert.equal(finish.costLineKind, "production", "çerçevede boyama YASAK");

      const partIds: string[] = [];
      for (const [index, spec] of parts.entries()) {
        const partId = randomUUID();
        const canonicalStlKey = `quote-parts/${partId}/canonical.stl`;
        fs.mkdirSync(path.join(uploadDir, `quote-parts/${partId}`), { recursive: true });
        fs.writeFileSync(path.join(uploadDir, canonicalStlKey), cubeStl(20));
        fs.writeFileSync(path.join(uploadDir, `quote-parts/${partId}/source.stl`), cubeStl(20));
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
          geometry: CUBE,
          canonicalStlKey,
          units: "mm",
          scale: 1,
          technologyKey: tech.key,
          materialKey: material.key,
          colorKey: material.colors[0].key,
          finishKey: finish.key,
          layerUm: tech.defaultLayerUm,
          infillPct: tech.infillOptionsPct === null ? null : tech.defaultInfillPct,
          quantity: spec.quantity,
        });
        partIds.push(partId);
      }
      return { ...quote, partIds };
    }

    /** Bir teklifin BUGÜNKÜ hâlinin hesabı (kendi snapshot'ıyla). */
    async function computeOf(quoteId: string) {
      const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
      const live = await db
        .select()
        .from(quoteParts)
        .where(and(eq(quoteParts.quoteId, quoteId), isNull(quoteParts.deletedAt)))
        .orderBy(asc(quoteParts.sortOrder));
      return {
        quote: row,
        parts: live,
        computed: computeQuote(row.pricingSnapshot, live.map(toPricingPartInput), {
          leadTier: row.leadTier,
          addonKeys: row.addonKeys,
        }),
      };
    }

    /** Teslim süresine uyan, güvenli bir sevk tarihi (donmuş takvimle). */
    function shipDate(leadDays: number, extraDays = 7): string {
      return istanbulDateKey(
        addBusinessDays(
          new Date(Date.now() + extraDays * 86_400_000),
          leadDays,
          snapshot.settings.holidays,
          snapshot.settings.cutoffHour
        )
      );
    }

    const LOCK_UNTIL = istanbulDateKey(new Date(Date.now() + 200 * 86_400_000));

    // AĞDA EN AZ BİR ATÖLYE: tercih edilen atölye verilmediğinde plan kapısı
    // ağdaki EN BÜYÜK `maxConcurrentOrders`a bakıyor ve hiç atölye yoksa
    // FAIL-CLOSED davranıyor (sığdığını kanıtlayamadığımız partiyi
    // planlamıyoruz). Tavan 50, partner formundaki üst sınırla aynı.
    await db.insert(manufacturers).values({
      companyName: "QA Ağ Atölyesi",
      email: `mfg-network-${randomUUID()}@example.test`,
      passwordHash: "x",
      contactPerson: "QA Yetkili",
      phone: "+905321234500",
      status: "active",
      maxConcurrentOrders: 50,
    });

    // ═══ 1) Anlaşma kur → 3 parti planla → parti 1'i serbest bırak ═══════════

    const buyer = await makeUser();
    const sourceQuote = await makeQuote(buyer.id, [
      { name: "Gövde", quantity: 120 },
      { name: "Kapak", quantity: 40 },
    ]);
    const base = await computeOf(sourceQuote.id);
    assert.equal(base.computed.totals.allPriced, true, "iki parça da fiyatlanabilmeli");

    let frameworkId = "";
    await test("fiyatlanmış teklif çerçeve anlaşmaya dönüşür", async () => {
      const out = await createFrameworkFromQuote({
        quoteId: sourceQuote.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
        title: "QA çerçeve",
      });
      assert.equal(out.ok, true, `ret: ${JSON.stringify(out)}`);
      if (!out.ok) return;
      frameworkId = out.id;
      assert.match(out.number, /^C-\d{6,}$/, "anlaşma numarası C- biçiminde");
      const [row] = await db
        .select()
        .from(quoteFrameworks)
        .where(eq(quoteFrameworks.id, frameworkId))
        .limit(1);
      assert.equal(row.status, "draft", "anlaşma TASLAK doğar");
      assert.equal(row.committedUnits, 160, "taahhüt Σ parça adedi");
      assert.equal(
        row.committedTotalKurus,
        base.computed.totals.totalKurus,
        "committed_total_kurus TEK-SEVKİYAT projeksiyonudur"
      );
      assert.deepEqual(
        row.pricingSnapshot,
        base.quote.pricingSnapshot,
        "anlaşma kaynak teklifin snapshot'ını KOPYALAR"
      );
      assert.equal(row.partsSnapshot.length, 2);
      assert.equal(row.partsSnapshot[0].quantity, 120);
      assert.ok(row.partsSnapshot[0].unitKurus > 0, "kilitli birim fiyat yazılı");
    });

    await test("anlaşma kurulumu denetim izi bırakır", async () => {
      const rows = await db
        .select({ action: quoteAdminActions.action, reason: quoteAdminActions.reason })
        .from(quoteAdminActions)
        .where(eq(quoteAdminActions.quoteId, sourceQuote.id));
      assert.deepEqual(
        rows.map((r) => r.action),
        ["framework_create"]
      );
      assert.equal(rows[0].reason, REASON);
    });

    await test("aynı teklif İKİNCİ bir anlaşmaya dönüştürülemez", async () => {
      const ret = await refusal(() =>
        createFrameworkFromQuote({
          quoteId: sourceQuote.id,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
          priceLockedUntil: LOCK_UNTIL,
          shippingAddress: address,
        })
      );
      assert.equal(ret.code, "framework_exists");
      assert.equal(ret.status, 409);
    });

    await test("taslak anlaşma aktifleşir", async () => {
      const out = await activateFramework({
        frameworkId,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      assert.equal(out.id, frameworkId);
      const [row] = await db
        .select()
        .from(quoteFrameworks)
        .where(eq(quoteFrameworks.id, frameworkId))
        .limit(1);
      assert.equal(row.status, "active");
      assert.equal(row.activatedByEmail, "qa-admin@example.test");
    });

    const leadDays = base.computed.totals.leadDays ?? 5;
    const batchIds: string[] = [];
    let plannedAmounts: number[] = [];
    await test("üç parti planlanır: Σ adet taahhüde eşit", async () => {
      const out = await planBatches({
        frameworkId,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          {
            plannedShipDate: shipDate(leadDays, 10),
            lines: [
              { partId: sourceQuote.partIds[0], quantity: 40 },
              { partId: sourceQuote.partIds[1], quantity: 10 },
            ],
          },
          {
            plannedShipDate: shipDate(leadDays, 40),
            lines: [
              { partId: sourceQuote.partIds[0], quantity: 40 },
              { partId: sourceQuote.partIds[1], quantity: 10 },
            ],
          },
          {
            plannedShipDate: shipDate(leadDays, 70),
            lines: [
              { partId: sourceQuote.partIds[0], quantity: 40 },
              { partId: sourceQuote.partIds[1], quantity: 20 },
            ],
          },
        ],
      });
      assert.equal(out.ok, true, `ret: ${JSON.stringify(out)}`);
      if (!out.ok) return;
      assert.equal(out.batches.length, 3);
      assert.deepEqual(
        out.batches.map((b) => b.position),
        [1, 2, 3]
      );
      assert.deepEqual(
        out.batches.map((b) => b.units),
        [50, 50, 60]
      );
      for (const b of out.batches) {
        assert.ok(b.id !== null);
        batchIds.push(b.id!);
      }
      plannedAmounts = out.batches.map((b) => b.amountKurus);
    });

    await test("dördüncü parti TAAHHÜDÜ AŞAR; kurallar birbirini MASKELEMEZ", async () => {
      const out = await planBatches({
        frameworkId,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          {
            // İki kural birden bozuk: taahhüt DOLDU ve tarih BUGÜN (teslim
            // süresinden önce). Admin ikisini birden görmeli, yoksa bir
            // düzeltmeden sonra ikinci duvara toslar.
            plannedShipDate: istanbulDateKey(new Date()),
            lines: [{ partId: sourceQuote.partIds[0], quantity: 1 }],
          },
        ],
      });
      assert.equal(out.ok, false);
      if (out.ok) return;
      assert.deepEqual(
        out.refusals.map((r) => r.code),
        ["commitment_exceeded", "ship_date_too_early"]
      );
      const written = await db
        .select({ id: quoteFrameworkBatches.id })
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.frameworkId, frameworkId));
      assert.equal(written.length, 3, "reddedilen plan HİÇBİR satır yazmadı");
    });

    await test("§4.9: Σ parti tutarı > committed_total_kurus (fixed ek hizmet)", async () => {
      const [row] = await db
        .select()
        .from(quoteFrameworks)
        .where(eq(quoteFrameworks.id, frameworkId))
        .limit(1);
      const sum = plannedAmounts.reduce((a, b) => a + b, 0);
      // `fixed` bir ek hizmet HER PARTİDE yeniden tahsil edilir (`addonLines`
      // çarpanı 1'dir), yani üç parti üç sertifika demektir.
      assert.ok(
        sum > row.committedTotalKurus,
        `Σ parti (${sum}) tek-sevkiyat projeksiyonundan (${row.committedTotalKurus}) büyük olmalı`
      );
      assert.equal(
        sum - row.committedTotalKurus,
        2 * addon.priceKurus,
        "fark TAM OLARAK iki ek sertifika"
      );
      const detail = (await loadFrameworkDetail(frameworkId))!;
      assert.equal(detail.committedTotalKurus, row.committedTotalKurus);
      assert.equal(detail.batchesTotalKurus, sum);
      assert.notEqual(
        detail.committedTotalKurus,
        detail.batchesTotalKurus,
        "iki rakam AYRI alanlarda durur; biri ötekinin yerine geçmez"
      );
    });

    let clone1 = { quoteId: "", quoteNumber: "", amountKurus: 0 };
    await test("parti 1 serbest bırakılır: klonun BRÜTÜ kilitli tutara EŞİT", async () => {
      const out = await releaseBatch({
        frameworkId,
        batchId: batchIds[0],
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      clone1 = out;
      const [batch] = await db
        .select()
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.id, batchIds[0]))
        .limit(1);
      assert.equal(batch.status, "released");
      assert.equal(batch.quoteId, out.quoteId);
      assert.ok(batch.releasedAt !== null);
      assert.equal(batch.releasedByEmail, "qa-admin@example.test");

      const cloneState = await computeOf(out.quoteId);
      assert.equal(
        cloneState.computed.totals.totalKurus,
        batch.amountKurus,
        "BU TURUN ASIL DEĞİŞMEZİ: klonun brütü partinin kilitli tutarı"
      );
      assert.equal(frameworkBatchDriftCode(cloneState.computed.totals.totalKurus, batch.amountKurus), null);
      assert.equal(cloneState.quote.status, "quoted", "klon `quoted` doğar (adminPriced muafiyeti)");
      assert.equal(cloneState.quote.sourceQuoteId, sourceQuote.id);
      assert.equal(cloneState.quote.userId, buyer.id);
    });

    await test("klonun pricing_snapshot'ı ANLAŞMANINKİYLE byte-eş", async () => {
      const [framework] = await db
        .select()
        .from(quoteFrameworks)
        .where(eq(quoteFrameworks.id, frameworkId))
        .limit(1);
      const [clone] = await db.select().from(quotes).where(eq(quotes.id, clone1.quoteId)).limit(1);
      assert.equal(
        JSON.stringify(clone.pricingSnapshot),
        JSON.stringify(framework.pricingSnapshot),
        "`loadActiveSnapshot()` sızmadı"
      );
      assert.equal(
        clone.snapshotTakenAt.getTime(),
        base.quote.snapshotTakenAt.getTime(),
        "damga ANLAŞMANIN snapshot yaşı (klon tarihi DEĞİL)"
      );
    });

    await test("klon parçanın manuel fiyat anahtarı PARTİ ADEDİYLE üretildi", async () => {
      const cloneParts = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, clone1.quoteId))
        .orderBy(asc(quoteParts.sortOrder));
      assert.equal(cloneParts.length, 2);
      const [framework] = await db
        .select()
        .from(quoteFrameworks)
        .where(eq(quoteFrameworks.id, frameworkId))
        .limit(1);
      const locked = new Map(framework.partsSnapshot.map((p) => [p.name, p.unitKurus]));
      for (const part of cloneParts) {
        assert.equal(part.quantity, part.name === "Gövde" ? 40 : 10, "adet PARTİ satırının adedi");
        assert.equal(
          part.manualUnitPriceKurus,
          locked.get(part.name),
          "manuel fiyat anlaşmanın KİLİTLİ birim fiyatı"
        );
        assert.equal(
          part.manualPriceKey,
          adminManualPriceKey(
            {
              sourceSha256: part.sourceSha256,
              config: {
                technologyKey: part.technologyKey,
                materialKey: part.materialKey,
                colorKey: part.colorKey,
                finishKey: part.finishKey,
                layerUm: part.layerUm,
                infillPct: part.infillPct,
                quantity: part.quantity,
                units: part.units,
                scale: part.scale,
                criticalTolerance: part.criticalTolerance,
              },
            },
            framework.leadTier
          ),
          "anahtar `adminManualPriceKey`in ürettiğiyle BİREBİR aynı"
        );
        assert.equal(part.dfmAckKey, null, "uyarı onayı KOPYALANMAZ: müşterinin kaydıdır");
      }
      const cloneState = await computeOf(clone1.quoteId);
      for (const p of cloneState.computed.parts) {
        assert.equal(p.price.ok, true);
        if (p.price.ok) assert.equal(p.price.source, "manual", "manuel fiyat DÜŞMEDİ");
      }
    });

    await test("ANLAŞMANIN adediyle yazılmış anahtar manuel fiyatı DÜŞÜRÜR", async () => {
      // Fark #2'nin gerekçesi, saf olarak: anlaşmanın anahtarını kopyalamak
      // `computeQuote`u canlı katalog fiyatına döndürür ve tutar SAPAR.
      const cloneParts = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, clone1.quoteId))
        .orderBy(asc(quoteParts.sortOrder));
      const [framework] = await db
        .select()
        .from(quoteFrameworks)
        .where(eq(quoteFrameworks.id, frameworkId))
        .limit(1);
      const committed = new Map(framework.partsSnapshot.map((p) => [p.name, p.quantity]));
      const wrong = cloneParts.map((part) => {
        const input = toPricingPartInput(part);
        return {
          ...input,
          // ANLAŞMA adediyle üretilmiş anahtar: parti adedinde TUTMAZ.
          manualPriceKey: partPricingKey(
            {
              sourceSha256: part.sourceSha256,
              config: { ...input.config, quantity: committed.get(part.name)! },
            },
            framework.leadTier
          ),
        };
      });
      const drifted = computeQuote(framework.pricingSnapshot, wrong, {
        leadTier: framework.leadTier,
        addonKeys: framework.addonKeys,
      });
      for (const p of drifted.parts) {
        assert.equal(p.price.ok, true);
        if (p.price.ok) assert.equal(p.price.source, "auto", "manuel fiyat SESSİZCE düştü");
      }
      assert.notEqual(
        drifted.totals.totalKurus,
        clone1.amountKurus,
        "ve tutar SAPTI — kapının sınadığı şey tam olarak budur"
      );
      assert.equal(
        frameworkBatchDriftCode(drifted.totals.totalKurus, clone1.amountKurus),
        "framework_price_drift"
      );
    });

    // ═══ 2) EŞİTLİK KAPISI: serbest bırakma ve ödeme ═════════════════════════

    await test("kilitli tutar BOZULURSA serbest bırakma 409 verir ve GERİ ALINIR", async () => {
      const quotesBefore = (await db.select({ id: quotes.id }).from(quotes)).length;
      // Partinin tutarını elle bozuyoruz: klon doğru hesaplanacak ama kilitli
      // tutara EŞİT OLMAYACAK.
      await db
        .update(quoteFrameworkBatches)
        .set({ amountKurus: plannedAmounts[1] + 12_345 })
        .where(eq(quoteFrameworkBatches.id, batchIds[1]));
      const ret = await capturingWarnings(() =>
        refusal(() =>
          releaseBatch({
            frameworkId,
            batchId: batchIds[1],
            adminEmail: "qa-admin@example.test",
            reason: REASON,
          })
        )
      );
      assert.equal(ret.code, "framework_price_drift");
      assert.equal(ret.status, 409);
      assert.equal(warnings.length, 1, "ADMİN'E UYARI düşmeli: sessiz 409 yasak");
      assert.match(warnings[0], /fiyat sapması/);
      assert.match(warnings[0], /GERİ ALINDI/);
      const [batch] = await db
        .select()
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.id, batchIds[1]))
        .limit(1);
      assert.equal(batch.status, "planned", "parti PLANLI kaldı");
      assert.equal(batch.quoteId, null, "yarım klon BAĞLANMADI");
      const quotesAfter = (await db.select({ id: quotes.id }).from(quotes)).length;
      assert.equal(quotesAfter, quotesBefore, "klon satırı da GERİ ALINDI");
      // Tutarı geri koy.
      await db
        .update(quoteFrameworkBatches)
        .set({ amountKurus: plannedAmounts[1] })
        .where(eq(quoteFrameworkBatches.id, batchIds[1]));
    });

    await test("ödeme yolunda da kapı var: sapmış klon 409 ile reddedilir", async () => {
      // Klonun manuel fiyatını düşürüyoruz (müşterinin bir düzenlemeyle
      // yapabileceği şeyin ta kendisi): tutar canlı katalog fiyatına döner.
      const cloneParts = await db
        .select({ id: quoteParts.id })
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, clone1.quoteId));
      await db
        .update(quoteParts)
        .set({ manualPriceKey: "v1|price|bozuk" })
        .where(eq(quoteParts.id, cloneParts[0].id));
      const after = await computeOf(clone1.quoteId);
      assert.notEqual(after.computed.totals.totalKurus, clone1.amountKurus, "tutar SAPTI");
      const ret = await capturingWarnings(() =>
        refusal(() =>
          createQuoteCheckout({
            quoteId: clone1.quoteId,
            userId: buyer.id,
            email: buyer.email,
            input: quoteCheckoutSchema.parse({
              expectedVersion: after.quote.version,
              expectedTotalKurus: after.computed.totals.totalKurus,
              shippingAddress: address,
              paymentMethod: "card" as const,
              distanceContractConsent: true as const,
              preliminaryInfoConsent: true as const,
              invoice: { type: "individual" as const },
            }),
            req: fakeRequest({ "idempotency-key": `qa-drift-${randomUUID()}` }),
          })
        )
      );
      assert.equal(ret.code, "framework_price_drift");
      assert.equal(ret.status, 409);
      assert.equal(warnings.length, 1, "ödeme yolunda da ADMİN'E UYARI düşer");
      assert.match(warnings[0], /ödeme reddedildi/);
      const drafts = await db
        .select({ id: orderDrafts.id })
        .from(orderDrafts)
        .where(eq(orderDrafts.userId, buyer.id));
      assert.equal(drafts.length, 0, "taslak AÇILMADI: tahsilat hiç başlamadı");
    });

    // ═══ 3) Parti klonu DÜZENLENEMEZ (R1) ════════════════════════════════════

    await test("quoteIsFrameworkBatch klonu tanır, kaynak teklifi tanımaz", async () => {
      assert.equal(await quoteIsFrameworkBatch(clone1.quoteId), true);
      assert.equal(await quoteIsFrameworkBatch(sourceQuote.id), false);
    });

    await test("quotePermissions: parti düzenlenemez, ödenebilir", async () => {
      const [clone] = await db.select().from(quotes).where(eq(quotes.id, clone1.quoteId)).limit(1);
      const p = quotePermissions(
        { status: clone.status, expiresAt: clone.expiresAt, orderId: clone.orderId },
        {
          hasLiveDraft: false,
          now: new Date(),
          isFrameworkBatch: true,
          hasLiveFramework: false,
        }
      );
      assert.equal(p.canEdit, false);
      assert.equal(p.canCheckout, true);
      assert.equal(p.blockedReason, "Bu teklif bir çerçeve anlaşmanın partisidir; düzenlenemez.");
    });

    await test("klon teklife düzenleme 409 döner: demoteQuotedToDraft ÇALIŞMAZ", async () => {
      const [before] = await db.select().from(quotes).where(eq(quotes.id, clone1.quoteId)).limit(1);
      session = { userId: buyer.id, email: buyer.email };
      const access = await resolveQuoteAccess(clone1.quoteId);
      assert.ok(access !== null, "sahip erişimi çözülmeli");
      assert.equal(access!.viewer.isOwner, true, "alıcı klonun SAHİBİ");
      const cloneParts = await db
        .select({ id: quoteParts.id })
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, clone1.quoteId))
        .orderBy(asc(quoteParts.sortOrder));
      const ret = await refusal(() =>
        updatePart(access!, cloneParts[0].id, parsePartPatch({ quantity: 7 }))
      );
      assert.equal(ret.status, 409);
      assert.equal(ret.code, "quote_locked");
      assert.equal(
        ret.message,
        "Bu teklif bir çerçeve anlaşmanın partisidir; düzenlenemez.",
        "uç EKRANLA aynı cümleyi söyler"
      );
      const [after] = await db.select().from(quotes).where(eq(quotes.id, clone1.quoteId)).limit(1);
      assert.equal(after.status, "quoted", "`quoted` KALDI: fiyat düşmedi");
      assert.equal(after.version, before.version, "sürüm de artmadı (hiçbir yazım olmadı)");
      const [part] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, cloneParts[0].id))
        .limit(1);
      assert.equal(part.quantity, 40, "adet DEĞİŞMEDİ");
    });

    // Bozduğumuz anahtarı geri kur: sonraki vakalar temiz bir klon istiyor.
    await test("bozulan anahtar onarılınca klon yine kilitli tutarı hesaplar", async () => {
      const [framework] = await db
        .select()
        .from(quoteFrameworks)
        .where(eq(quoteFrameworks.id, frameworkId))
        .limit(1);
      const cloneParts = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, clone1.quoteId))
        .orderBy(asc(quoteParts.sortOrder));
      for (const part of cloneParts) {
        await db
          .update(quoteParts)
          .set({
            manualPriceKey: partPricingKey(
              { sourceSha256: part.sourceSha256, config: toPricingPartInput(part).config },
              framework.leadTier
            ),
          })
          .where(eq(quoteParts.id, part.id));
      }
      const after = await computeOf(clone1.quoteId);
      assert.equal(after.computed.totals.totalKurus, clone1.amountKurus);
    });

    // ═══ 4) Parti bugünkü ödeme yolundan DEĞİŞMEDEN geçer ════════════════════

    let paidOrderId = "";
    await test("parti: createQuoteCheckout → taslak → sipariş → dosyalar", async () => {
      const state = await computeOf(clone1.quoteId);
      const checkout = await createQuoteCheckout({
        quoteId: clone1.quoteId,
        userId: buyer.id,
        email: buyer.email,
        input: quoteCheckoutSchema.parse({
          expectedVersion: state.quote.version,
          expectedTotalKurus: state.computed.totals.totalKurus,
          shippingAddress: address,
          paymentMethod: "card" as const,
          distanceContractConsent: true as const,
          preliminaryInfoConsent: true as const,
          invoice: { type: "individual" as const },
        }),
        req: fakeRequest({ "idempotency-key": `qa-pay-${randomUUID()}` }),
      });
      assert.equal(checkout.finalAmountKurus, clone1.amountKurus, "tahsil edilen tutar KİLİTLİ tutar");
      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, checkout.reference))
        .limit(1);
      assert.equal(draft.amountKurus, clone1.amountKurus, "BRÜT taslağa bozulmadan geçti");
      assert.equal(draft.productionBaseKurus, draft.amountKurus, "çerçevede boyama YOK");
      assert.equal(draft.paintingPriceKurus, 0);
      assert.equal(draft.quantity, 50, "kapasite sayacı Σ parti adedi");

      // KÖPRÜNÜN İLK YARISI, ÜRETİM KODUNUN ELİYLE: taslak doğduğu işlemde
      // partiye bağlandı. Test HİÇBİR ŞEY yazmıyor.
      const [withDraft] = await db
        .select({ draftId: quoteFrameworkBatches.draftId })
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.id, batchIds[0]))
        .limit(1);
      assert.equal(withDraft.draftId, draft.id, "parti kendi TASLAĞINA bağlandı");

      const promoted = await promoteDraftToOrder(draft.id);
      paidOrderId = promoted.orderId;
      const [order] = await db.select().from(orders).where(eq(orders.id, paidOrderId)).limit(1);
      assert.equal(order.amountKurus, clone1.amountKurus);
      const [linked] = await db.select().from(quotes).where(eq(quotes.id, clone1.quoteId)).limit(1);
      assert.equal(linked.orderId, paidOrderId, "linkQuoteToOrderTx klonu siparişe bağladı");
      assert.equal(linked.status, "ordered");

      const outcome = await attachQuoteFilesToOrder(paidOrderId);
      assert.equal(outcome, "attached", String(outcome));
      const files = await db
        .select({ fileName: orderModelFiles.fileName })
        .from(orderModelFiles)
        .orderBy(asc(orderModelFiles.fileName));
      const [framework] = await db
        .select()
        .from(quoteFrameworks)
        .where(eq(quoteFrameworks.id, frameworkId))
        .limit(1);
      const expected = framework.partsSnapshot
        .map((p, index) => quotePartFileName({ ...p, position: index, quantity: index === 0 ? 40 : 10 }))
        .sort();
      assert.deepEqual(files.map((f) => f.fileName).sort(), expected);
      assert.ok(
        files.some((f) => /_x40\.stl$/.test(f.fileName)),
        "dosya adı PARTİ adedini taşır (üretici kaç kopya basacağını adından görür)"
      );
    });

    await test("parti siparişinin çerçeveye bağı ÜRETİM KODUNDA kurulur", async () => {
      // KÖPRÜNÜN İKİNCİ YARISI: `linkQuoteToOrderTx` (`quote-order.ts`)
      // taslağın siparişe terfisiyle AYNI işlemde partinin `order_id`ini
      // yazdı. Test burada HİÇBİR ŞEY yazmıyor — yazsa, olmayan bir davranışı
      // var gibi okuturdu ve üretimde ödenmiş parti sonsuza dek "ödeme
      // bekliyor" kovasında kalırdı.
      const [bridged] = await db
        .select({ orderId: quoteFrameworkBatches.orderId })
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.id, batchIds[0]))
        .limit(1);
      assert.equal(bridged.orderId, paidOrderId, "köprüyü ÜRETİM kodu yazdı");
      const detail = (await loadFrameworkDetail(frameworkId))!;
      const batch = detail.batches.find((b) => b.id === batchIds[0])!;
      assert.equal(batch.orderId, paidOrderId);
      assert.equal(batch.paymentStatus, "succeeded");
      assert.equal(detail.progress.total.committedUnits, 160);
      assert.equal(
        detail.progress.total.inProductionUnits,
        50,
        "ödenmiş parti ÜRETİMDE kovasında"
      );
      const sum =
        detail.progress.total.unplannedUnits +
        detail.progress.total.plannedUnits +
        detail.progress.total.awaitingPaymentUnits +
        detail.progress.total.inProductionUnits +
        detail.progress.total.shippedUnits +
        detail.progress.total.deliveredUnits +
        detail.progress.total.cancelledOrRefundedUnits;
      assert.equal(sum, 160, "kovalar DAİMA taahhüde toplanır");
    });

    // ═══ 5) Hediye kartı: kapı BRÜTÜ karşılaştırıyor ═════════════════════════

    await test("hediye kartlı parti: amount_kurus aynı, payable DÜŞER, kapı 409 VERMEZ", async () => {
      const { setFlag } = await import("../src/lib/services/flags");
      await setFlag("quote_gift_card_enabled", true, "qa-admin@example.test");
      const out = await releaseBatch({
        frameworkId,
        batchId: batchIds[1],
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      const [batch] = await db
        .select()
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.id, batchIds[1]))
        .limit(1);
      const state = await computeOf(out.quoteId);
      assert.equal(state.computed.totals.totalKurus, batch.amountKurus);

      const { giftCards } = await import("../src/lib/db/schema");
      const code = `GC-QA-${randomUUID().slice(0, 8).toUpperCase()}`;
      const giftKurus = Math.floor(batch.amountKurus / 4);
      await db.insert(giftCards).values({
        code,
        amountKurus: giftKurus,
        balanceKurus: giftKurus,
        status: "active",
        expiresAt: new Date(Date.now() + 365 * 86_400_000),
      });

      const checkout = await createQuoteCheckout({
        quoteId: out.quoteId,
        userId: buyer.id,
        email: buyer.email,
        input: quoteCheckoutSchema.parse({
          expectedVersion: state.quote.version,
          expectedTotalKurus: state.computed.totals.totalKurus,
          shippingAddress: address,
          paymentMethod: "card" as const,
          distanceContractConsent: true as const,
          preliminaryInfoConsent: true as const,
          invoice: { type: "individual" as const },
          giftCardCode: code,
        }),
        req: fakeRequest({ "idempotency-key": `qa-gift-${randomUUID()}` }),
      });
      assert.equal(checkout.giftCardAmountKurus, giftKurus, "kart tahsilata girdi");
      assert.equal(
        checkout.finalAmountKurus,
        batch.amountKurus - giftKurus,
        "tahsil edilen nakit DÜŞTÜ"
      );
      const [draft] = await db
        .select()
        .from(orderDrafts)
        .where(eq(orderDrafts.reference, checkout.reference))
        .limit(1);
      assert.equal(draft.amountKurus, batch.amountKurus, "BRÜT KIPIRDAMADI: kapı bunu okuyor");
      assert.ok(
        checkout.finalAmountKurus < batch.amountKurus,
        "`payableKurus` ile karşılaştıran bir kapı burada YANLIŞ ALARM verirdi"
      );
      await setFlag("quote_gift_card_enabled", false, "qa-admin@example.test");
    });

    // ═══ 6) İki eşzamanlı serbest bırakma → TEK klon (R4) ════════════════════

    await test("iki eşzamanlı releaseBatch: TEK klon, öteki 409", async () => {
      const before = (await db.select({ id: quotes.id }).from(quotes)).length;
      const results = await Promise.allSettled([
        releaseBatch({
          frameworkId,
          batchId: batchIds[2],
          adminEmail: "qa-admin@example.test",
          reason: REASON,
        }),
        releaseBatch({
          frameworkId,
          batchId: batchIds[2],
          adminEmail: "qa-admin2@example.test",
          reason: REASON,
        }),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      assert.equal(ok.length, 1, "TEK başarı");
      assert.equal(failed.length, 1, "öteki reddedildi");
      const err = (failed[0] as PromiseRejectedResult).reason as { status?: number; code?: string };
      assert.equal(err.status, 409);
      assert.equal(err.code, "batch_not_planned");
      const after = (await db.select({ id: quotes.id }).from(quotes)).length;
      assert.equal(after, before + 1, "YALNIZ BİR klon teklif doğdu");
      const [batch] = await db
        .select()
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.id, batchIds[2]))
        .limit(1);
      assert.equal(batch.status, "released");
    });

    // ═══ 7) Katalog SONRADAN değişirse tutar KIPIRDAMAZ ══════════════════════

    await test("anlaşmadan SONRA katalog yükselse bile parti tutarı DEĞİŞMEZ", async () => {
      const owner = await makeUser();
      const q = await makeQuote(owner.id, [{ name: "Blok", quantity: 60 }]);
      const before = await computeOf(q.id);
      const created = await createFrameworkFromQuote({
        quoteId: q.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await activateFramework({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      const lead = before.computed.totals.leadDays ?? 5;
      const planned = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 10), lines: [{ partId: q.partIds[0], quantity: 20 }] },
          { plannedShipDate: shipDate(lead, 40), lines: [{ partId: q.partIds[0], quantity: 20 }] },
          { plannedShipDate: shipDate(lead, 70), lines: [{ partId: q.partIds[0], quantity: 20 }] },
        ],
      });
      assert.equal(planned.ok, true, JSON.stringify(planned));
      if (!planned.ok) return;
      const lockedAmount = planned.batches[2].amountKurus;

      // CANLI KATALOĞU YÜKSELT: malzeme gramajı %60, ek hizmet iki katı.
      // Malzeme fiyatı manuel dalı etkilemez (manuel fiyat KDV dâhil nihai
      // birim fiyattır) ama OTOMATİK fiyatı etkiler — yani "bugünün
      // kataloğuyla hesaplanan tutar" gerçekten farklı olur. Ek hizmet ise
      // snapshot'tan geldiği için TUTARI da etkiler: klon canlı kataloğa
      // bakarsa tutar SAPAR.
      await db
        .update(printMaterials)
        .set({ priceKurusPerGram: sql`round(${printMaterials.priceKurusPerGram} * 1.6)::int` });
      await db
        .update(printAddons)
        .set({ priceKurus: sql`${printAddons.priceKurus} * 2` })
        .where(eq(printAddons.key, ADDON_KEY));
      const liveSnapshot = await loadActiveSnapshot();
      assert.notEqual(
        liveSnapshot.materials[0].priceKurusPerGram,
        snapshot.materials[0].priceKurusPerGram,
        "canlı katalog GERÇEKTEN değişti"
      );

      const released = await releaseBatch({
        frameworkId: created.id,
        batchId: planned.batches[2].id!,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      assert.equal(
        released.amountKurus,
        lockedAmount,
        "PARTİ 3 İMZA GÜNÜNDEKİ FİYATI ÖDER"
      );
      const cloneState = await computeOf(released.quoteId);
      assert.equal(cloneState.computed.totals.totalKurus, lockedAmount);

      // …ve bugünün kataloğuyla hesaplanan tutar FARKLI olurdu.
      const cloneParts = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, released.quoteId));
      const todays = computeQuote(liveSnapshot, cloneParts.map(toPricingPartInput), {
        leadTier: cloneState.quote.leadTier,
        addonKeys: cloneState.quote.addonKeys,
      });
      assert.notEqual(
        todays.totals.totalKurus,
        lockedAmount,
        "bugünün kataloğu FARKLI bir tutar verirdi — kilit gerçekten iş yapıyor"
      );

      // Kataloğu geri al: sonraki vakalar tohum fiyatlarıyla çalışsın.
      await db
        .update(printMaterials)
        .set({ priceKurusPerGram: sql`round(${printMaterials.priceKurusPerGram} / 1.6)::int` });
      await db
        .update(printAddons)
        .set({ priceKurus: sql`${printAddons.priceKurus} / 2` })
        .where(eq(printAddons.key, ADDON_KEY));
    });

    // ═══ 8) Kilit süresi: expired REDDEDER, extend GEÇİRİR (R5) ══════════════

    await test("expired anlaşma REDDEDER; framework_extend sonrası GEÇER", async () => {
      const owner = await makeUser();
      const q = await makeQuote(owner.id, [{ name: "Ayak", quantity: 30 }]);
      const st = await computeOf(q.id);
      const created = await createFrameworkFromQuote({
        quoteId: q.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await activateFramework({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      const lead = st.computed.totals.leadDays ?? 5;
      const planned = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 10), lines: [{ partId: q.partIds[0], quantity: 30 }] },
        ],
      });
      assert.equal(planned.ok, true, JSON.stringify(planned));
      if (!planned.ok) return;

      // Kilidi GEÇMİŞE çek ve anlaşmayı `expired` yap (bakım turunun yaptığı şey).
      await db
        .update(quoteFrameworks)
        .set({ status: "expired", priceLockedUntil: new Date(Date.now() - 86_400_000) })
        .where(eq(quoteFrameworks.id, created.id));
      const ret = await refusal(() =>
        releaseBatch({
          frameworkId: created.id,
          batchId: planned.batches[0].id!,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
        })
      );
      assert.equal(ret.code, "framework_expired");
      assert.equal(ret.status, 409);

      const extended = await extendFrameworkLock({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
      });
      assert.equal(extended.status, "active", "uzatma anlaşmayı YENİDEN AKTİF eder");
      const out = await releaseBatch({
        frameworkId: created.id,
        batchId: planned.batches[0].id!,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      assert.equal(out.amountKurus, planned.batches[0].amountKurus, "uzatma FİYATI DEĞİŞTİRMEZ");

      const actions = await db
        .select({ action: quoteAdminActions.action })
        .from(quoteAdminActions)
        .where(eq(quoteAdminActions.quoteId, q.id));
      assert.deepEqual(actions.map((a) => a.action).sort(), [
        "framework_activate",
        "framework_batch_plan",
        "framework_batch_release",
        "framework_create",
        "framework_extend",
      ]);

      // Kilidi GERİYE almak yasak.
      const back = await refusal(() =>
        extendFrameworkLock({
          frameworkId: created.id,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
          priceLockedUntil: istanbulDateKey(new Date(Date.now() + 5 * 86_400_000)),
        })
      );
      assert.equal(back.code, "lock_not_extended");
    });

    // ═══ 9) FX: ₺ DONAR, KUR DONMAZ ══════════════════════════════════════════

    await test("klonun kuru SERBEST BIRAKMA GÜNÜNÜN bülteni; ₺ DONMUŞ kalır", async () => {
      const owner = await makeUser();
      // Kaynak teklif ESKİ bir bülten taşıyor: klon onu KOPYALAMAMALI.
      const stale = {
        version: 1 as const,
        source: "tcmb" as const,
        bulletinDate: "2026-01-02",
        takenAt: new Date("2026-01-02T12:00:00Z").toISOString(),
        rates: [
          { currency: "EUR" as const, microTryPerUnit: 30_000_000 },
          { currency: "USD" as const, microTryPerUnit: 28_000_000 },
          { currency: "GBP" as const, microTryPerUnit: 35_000_000 },
        ],
      };
      const q = await makeQuote(owner.id, [{ name: "Ağırlık", quantity: 25 }], {
        fxSnapshot: stale,
      });
      const st = await computeOf(q.id);
      const created = await createFrameworkFromQuote({
        quoteId: q.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await activateFramework({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      const lead = st.computed.totals.leadDays ?? 5;
      const planned = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 10), lines: [{ partId: q.partIds[0], quantity: 25 }] },
        ],
      });
      assert.equal(planned.ok, true, JSON.stringify(planned));
      if (!planned.ok) return;

      // BUGÜNÜN bülteni.
      const today = istanbulDateKey(new Date());
      for (const [currency, micro] of [
        ["EUR", 48_000_000],
        ["USD", 44_000_000],
        ["GBP", 56_000_000],
      ] as const) {
        await db
          .insert(fxRates)
          .values({ currency, bulletinDate: today, microTryPerUnit: micro, bulletinUnit: 1 })
          .onConflictDoNothing();
      }

      const out = await releaseBatch({
        frameworkId: created.id,
        batchId: planned.batches[0].id!,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      assert.equal(out.amountKurus, planned.batches[0].amountKurus, "BAĞLAYICI ₺ DONMUŞ");
      const [clone] = await db.select().from(quotes).where(eq(quotes.id, out.quoteId)).limit(1);
      assert.ok(clone.fxSnapshot !== null, "kur gösterimi var");
      assert.equal(clone.fxSnapshot!.bulletinDate, today, "SERBEST BIRAKMA GÜNÜNÜN bülteni");
      assert.notEqual(
        clone.fxSnapshot!.bulletinDate,
        stale.bulletinDate,
        "imza günündeki kur KOPYALANMADI (kilitlenmemiş bir rakamı kilitli gibi sunmak olurdu)"
      );
    });

    // ═══ 10) Anlaşma iptali ödenmiş partiye DOKUNMAZ ═════════════════════════

    await test("anlaşma iptali: planlı partiler iptal, ÖDENMİŞ parti AYNEN kalır", async () => {
      const [orderBefore] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, paidOrderId))
        .limit(1);
      // Kalan planlı bir parti kurulsun (üçü de bırakıldı): yeni bir parti
      // planlayamayız (taahhüt doldu), o yüzden iptalin planlıya etkisi ayrı
      // bir anlaşmada sınanır.
      const out = await cancelFramework({
        frameworkId,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      assert.equal(out.id, frameworkId);
      const [framework] = await db
        .select()
        .from(quoteFrameworks)
        .where(eq(quoteFrameworks.id, frameworkId))
        .limit(1);
      assert.equal(framework.status, "cancelled");
      const [orderAfter] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, paidOrderId))
        .limit(1);
      assert.equal(orderAfter.status, orderBefore.status, "sipariş DURUMU aynı");
      assert.equal(orderAfter.paymentStatus, orderBefore.paymentStatus, "ödeme durumu aynı");
      assert.equal(orderAfter.amountKurus, orderBefore.amountKurus, "TUTAR aynı (clawback YOK)");
      const batches = await db
        .select({ status: quoteFrameworkBatches.status })
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.frameworkId, frameworkId));
      assert.ok(
        batches.every((b) => b.status === "released"),
        "serbest bırakılmış partiler İPTAL EDİLMEZ"
      );
    });

    await test("planlı parti iptali taahhüdü SERBEST bırakır, ödenmişi değil", async () => {
      const owner = await makeUser();
      const q = await makeQuote(owner.id, [{ name: "Pim", quantity: 40 }]);
      const st = await computeOf(q.id);
      const created = await createFrameworkFromQuote({
        quoteId: q.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await activateFramework({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      const lead = st.computed.totals.leadDays ?? 5;
      const planned = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 10), lines: [{ partId: q.partIds[0], quantity: 40 }] },
        ],
      });
      assert.equal(planned.ok, true, JSON.stringify(planned));
      if (!planned.ok) return;

      let detail = (await loadFrameworkDetail(created.id))!;
      assert.equal(detail.progress.total.plannedUnits, 40);
      assert.equal(detail.progress.total.unplannedUnits, 0);

      await cancelBatch({
        frameworkId: created.id,
        batchId: planned.batches[0].id!,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      detail = (await loadFrameworkDetail(created.id))!;
      assert.equal(detail.progress.total.plannedUnits, 0);
      assert.equal(
        detail.progress.total.unplannedUnits,
        40,
        "serbest bırakılMAMIŞ iptal taahhüdü tüketmez: admin yeniden planlayabilir"
      );
      assert.equal(detail.progress.total.cancelledOrRefundedUnits, 0);

      // Aynı adet yeniden planlanabilir olmalı.
      const again = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 20), lines: [{ partId: q.partIds[0], quantity: 40 }] },
        ],
      });
      assert.equal(again.ok, true, JSON.stringify(again));

      // Serbest bırakılmış bir parti iptal EDİLEMEZ (iade motorunun işi).
      if (!again.ok) return;
      await releaseBatch({
        frameworkId: created.id,
        batchId: again.batches[0].id!,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      const ret = await refusal(() =>
        cancelBatch({
          frameworkId: created.id,
          batchId: again.batches[0].id!,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
        })
      );
      assert.equal(ret.code, "batch_not_planned");
    });

    // ═══ 11) İade kovası + farklı komisyon oranı ══════════════════════════════

    await test("iade edilen partinin kovası İADE; taahhüt DEĞİŞMEZ", async () => {
      const { orderRefundRecords, orderRefundAllocations } = await import("../src/lib/db/schema");
      const recordId = randomUUID();
      await db.insert(orderRefundRecords).values({
        id: recordId,
        operationKey: randomUUID(),
        requestHash: "qa-hash",
        kind: "refund",
        paymentScopeKey: `order:${paidOrderId}`,
        standaloneOrderId: paidOrderId,
        cashAmountKurus: 100,
        giftAmountKurus: 0,
        method: "bank_transfer",
        externalReference: "QA-REF-1",
        externalReferenceKey: "qa-ref-1",
        occurredAt: new Date(),
        confirmedAt: new Date(),
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        sourceSnapshot: {},
        resultSnapshot: {},
      });
      await db.insert(orderRefundAllocations).values({
        refundId: recordId,
        kind: "refund",
        orderId: paidOrderId,
        cashKurus: 100,
        giftKurus: 0,
        basisSnapshot: {},
      });
      await db
        .update(orders)
        .set({ paymentStatus: "refunded" })
        .where(eq(orders.id, paidOrderId));

      const detail = (await loadFrameworkDetail(frameworkId))!;
      assert.equal(detail.progress.total.committedUnits, 160, "taahhüt DEĞİŞMEDİ");
      assert.equal(
        detail.progress.total.cancelledOrRefundedUnits,
        50,
        "iade edilen parti AYRIK kovada"
      );
      assert.equal(detail.progress.total.inProductionUnits, 0, "çifte sayım YOK");
      const lines = await db
        .select({ id: quoteFrameworkBatchLines.id })
        .from(quoteFrameworkBatchLines)
        .where(eq(quoteFrameworkBatchLines.batchId, batchIds[0]));
      assert.equal(lines.length, 2, "iade parti satırlarını SİLMEZ");
    });

    await test("aynı anlaşmanın iki partisi FARKLI commissionRateBps taşıyabilir", async () => {
      // Oran üretici KABULÜNDE donar (`orders.commissionRateBps`): çerçeve
      // müşteri fiyatını kilitler, PARTNER ORANINI kilitlemez. Bu bir hata
      // değil ve ekran onu hata gibi göstermez.
      const [second] = await db
        .select({ quoteId: quoteFrameworkBatches.quoteId, id: quoteFrameworkBatches.id })
        .from(quoteFrameworkBatches)
        .where(
          and(
            eq(quoteFrameworkBatches.frameworkId, frameworkId),
            eq(quoteFrameworkBatches.id, batchIds[1])
          )
        )
        .limit(1);
      const [draft] = await db
        .select({ id: orderDrafts.id })
        .from(orderDrafts)
        .where(eq(orderDrafts.userId, buyer.id))
        .orderBy(asc(orderDrafts.createdAt));
      assert.ok(draft, "ilk taslak duruyor");
      const secondOrderId = randomUUID();
      await db.insert(orders).values({
        id: secondOrderId,
        orderNumber: `QA-${randomUUID().slice(0, 8)}`,
        userId: buyer.id,
        email: buyer.email,
        customerName: "Kurumsal Müşteri",
        phone: address.telefon,
        material: "resin",
        finish: "raw",
        shippingAddress: address,
        paymentMethod: "card",
        amountKurus: 100_000,
        productionBaseKurus: 100_000,
        paintingPriceKurus: 0,
        commissionRateBps: 4000,
      });
      await db
        .update(quoteFrameworkBatches)
        .set({ orderId: secondOrderId })
        .where(eq(quoteFrameworkBatches.id, second.id));
      await db
        .update(orders)
        .set({ commissionRateBps: 3500 })
        .where(eq(orders.id, paidOrderId));

      const detail = (await loadFrameworkDetail(frameworkId))!;
      const rates = detail.batches
        .map((b) => b.commissionRateBps)
        .filter((r): r is number => r !== null)
        .sort((a, b) => a - b);
      assert.deepEqual(rates, [3500, 4000], "iki parti, iki AYRI oran — ve bu doğru");
    });

    // ═══ 12) Kapılar: boyama, karışık teknoloji, anonim, files_purged ════════

    await test("boyama kalemi olan teklif çerçeveye dönüşmez", async () => {
      const owner = await makeUser();
      const q = await makeQuote(owner.id, [{ name: "Boyalı", quantity: 30 }]);
      await db
        .update(quoteParts)
        .set({ finishKey: "boyali", manualUnitPriceKurus: 5000 })
        .where(eq(quoteParts.quoteId, q.id));
      // `boyali` manuel fiyat ister; anahtarı da yazalım ki fiyat çıksın.
      const [part] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, q.id))
        .limit(1);
      await db
        .update(quoteParts)
        .set({
          manualPriceKey: partPricingKey(
            { sourceSha256: part.sourceSha256, config: toPricingPartInput(part).config },
            "standard"
          ),
        })
        .where(eq(quoteParts.id, part.id));
      const out = await createFrameworkFromQuote({
        quoteId: q.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
      });
      assert.equal(out.ok, false);
      if (out.ok) return;
      assert.deepEqual(
        out.refusals.map((r) => r.code),
        ["painting_forbidden"]
      );
    });

    await test("karışık teknolojili teklif çerçeveye dönüşmez", async () => {
      const owner = await makeUser();
      const q = await makeQuote(owner.id, [
        { name: "A", quantity: 20 },
        { name: "B", quantity: 20 },
      ]);
      const other = snapshot.technologies.find((t) => t.key !== snapshot.technologies[0].key)!;
      const otherMaterial = snapshot.materials.find((m) => m.technologyKey === other.key)!;
      await db
        .update(quoteParts)
        .set({
          technologyKey: other.key,
          materialKey: otherMaterial.key,
          colorKey: otherMaterial.colors[0].key,
          layerUm: other.defaultLayerUm,
          infillPct: other.infillOptionsPct === null ? null : other.defaultInfillPct,
        })
        .where(eq(quoteParts.id, q.partIds[1]));
      const ret = await refusal(() =>
        createFrameworkFromQuote({
          quoteId: q.id,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
          priceLockedUntil: LOCK_UNTIL,
          shippingAddress: address,
        })
      );
      assert.equal(ret.code, "mixed_technology");
      assert.equal(ret.status, 409);
    });

    await test("anonim teklif ve `quoted` OLMAYAN teklif reddedilir", async () => {
      const owner = await makeUser();
      const draftQuote = await makeQuote(owner.id, [{ name: "Taslak", quantity: 30 }], {
        status: "draft",
      });
      const notQuoted = await refusal(() =>
        createFrameworkFromQuote({
          quoteId: draftQuote.id,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
          priceLockedUntil: LOCK_UNTIL,
          shippingAddress: address,
        })
      );
      assert.equal(notQuoted.code, "quote_not_quoted");

      const anon = await makeQuote(owner.id, [{ name: "Anonim", quantity: 30 }]);
      await db.update(quotes).set({ userId: null, anonymousId: "anon-qa" }).where(eq(quotes.id, anon.id));
      const ret = await refusal(() =>
        createFrameworkFromQuote({
          quoteId: anon.id,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
          priceLockedUntil: LOCK_UNTIL,
          shippingAddress: address,
        })
      );
      assert.equal(ret.code, "anonymous_quote");
    });

    await test("kaynak dosyaları silinmiş anlaşmada serbest bırakma 409 `files_purged`", async () => {
      const owner = await makeUser();
      const q = await makeQuote(owner.id, [{ name: "Süpürülen", quantity: 30 }]);
      const st = await computeOf(q.id);
      const created = await createFrameworkFromQuote({
        quoteId: q.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      await activateFramework({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      const lead = st.computed.totals.leadDays ?? 5;
      const planned = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 10), lines: [{ partId: q.partIds[0], quantity: 30 }] },
        ],
      });
      assert.equal(planned.ok, true, JSON.stringify(planned));
      if (!planned.ok) return;
      await db
        .update(quoteParts)
        .set({ filesPurgedAt: new Date() })
        .where(eq(quoteParts.id, q.partIds[0]));
      const ret = await refusal(() =>
        releaseBatch({
          frameworkId: created.id,
          batchId: planned.batches[0].id!,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
        })
      );
      assert.equal(ret.code, "files_purged");
      assert.equal(ret.status, 409);
      const [batch] = await db
        .select()
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.id, planned.batches[0].id!))
        .limit(1);
      assert.equal(batch.status, "planned", "reddedilen serbest bırakma partiyi BOZMADI");
    });

    // ═══ 13) Kapasite kapısı ve okuma yüzeyleri ══════════════════════════════

    await test("tezgâha sığmayan parti PLANLANAMAZ (bench_full)", async () => {
      const owner = await makeUser();
      const q = await makeQuote(owner.id, [{ name: "Büyük", quantity: 900 }]);
      const st = await computeOf(q.id);
      assert.equal(st.computed.totals.allPriced, true);
      const [mfg] = await db
        .insert(manufacturers)
        .values({
          companyName: "QA Atölye",
          email: `mfg-${randomUUID()}@example.test`,
          passwordHash: "x",
          contactPerson: "QA Yetkili",
          phone: "+905321234567",
          status: "active",
          maxConcurrentOrders: 3,
        })
        .returning({ id: manufacturers.id });
      const created = await createFrameworkFromQuote({
        quoteId: q.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
        preferredManufacturerId: mfg.id,
      });
      assert.equal(created.ok, true, JSON.stringify(created));
      if (!created.ok) return;
      await activateFramework({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      const lead = st.computed.totals.leadDays ?? 5;
      // 900 adet → `painterLoadUnits(900)` = 1 + 45 = 46 birim > 3.
      const out = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 10), lines: [{ partId: q.partIds[0], quantity: 900 }] },
        ],
      });
      assert.equal(out.ok, false);
      if (out.ok) return;
      assert.ok(
        out.refusals.some((r) => r.code === "bench_full"),
        `bench_full bekleniyordu: ${JSON.stringify(out.refusals)}`
      );

      // Aynı atölye 40 adetlik bir partiyi ALIR (1 + 2 = 3 birim değil, 1+2=3 → sınırda).
      const small = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 10), lines: [{ partId: q.partIds[0], quantity: 30 }] },
        ],
        dryRun: true,
      });
      assert.equal(small.ok, true, JSON.stringify(small));
      if (!small.ok) return;
      assert.equal(small.batches[0].id, null, "dryRun HİÇBİR satır yazmaz");
      const written = await db
        .select({ id: quoteFrameworkBatches.id })
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.frameworkId, created.id));
      assert.equal(written.length, 0, "dryRun sonrası parti YOK");

      // Üreticinin ileriye dönük görünümü: fiyat ve müşteri kimliği YOK.
      const real = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 10), lines: [{ partId: q.partIds[0], quantity: 30 }] },
        ],
      });
      assert.equal(real.ok, true);
      const view = await loadManufacturerPlannedBatches(mfg.id);
      assert.equal(view.length, 1);
      assert.equal(view[0].units, 30);
      assert.equal(view[0].loadUnits, 2, "1 + floor(30/20) = 2");
      for (const key of Object.keys(view[0])) {
        assert.ok(!key.endsWith("Kurus"), `üreticiye fiyat sızdı: ${key}`);
      }
    });

    // ═══ 14) TANIM da kilitli: repriceQuote ve kaynak teklif ═════════════════
    //
    // Fiyat kilidinin İKİ deliği bu bölümde kapanıyor:
    //  1. `repriceQuote` `assertEditable` KOŞMAZ (`requireEdit: false`), yani
    //     parti kapısı o yola hiç uğramıyordu: müşteri kendi partisini
    //     yeniden fiyatlayıp kilitli fiyatı YOK EDEBİLİRDİ (parti de kalıcı
    //     olarak ödenemez hâle gelirdi — `releaseBatch` `planned` olmayan
    //     partiyi bırakmaz).
    //  2. Klon yapılandırmayı CANLI kaynak parçadan okuyor. Kaynak teklif
    //     düzenlenebilir kalırsa müşteri imzadan SONRA malzemeyi/ölçeği
    //     değiştirir, sonraki parti YENİ tanımla üretilir ve ESKİ kilitli
    //     birim fiyatla faturalanır. EŞİTLİK KAPISI BUNU GÖREMEZ: manuel
    //     anahtar yazılan konfigürasyondan yeniden üretildiği için toplam yine
    //     `amount_kurus`a EŞİT çıkar.
    let owner = { id: "", email: "" };
    let q = { id: "", number: "", version: 0, partIds: [] as string[] };
    let lockId = "";
    let plannedIds: string[] = [];
    let plannedSums: number[] = [];
    let released = { quoteId: "", amountKurus: 0 };
    await test("anlaşma kurulur ve parti 1 serbest bırakılır (kurulum)", async () => {
      owner = await makeUser();
      q = await makeQuote(owner.id, [{ name: "Kapak", quantity: 40 }]);
      const st = await computeOf(q.id);
      const created = await createFrameworkFromQuote({
        quoteId: q.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
      });
      assert.equal(created.ok, true, JSON.stringify(created));
      if (!created.ok) return;
      lockId = created.id;
      await activateFramework({
        frameworkId: lockId,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      const lead = st.computed.totals.leadDays ?? 5;
      const planned = await planBatches({
        frameworkId: lockId,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: shipDate(lead, 10), lines: [{ partId: q.partIds[0], quantity: 20 }] },
          { plannedShipDate: shipDate(lead, 40), lines: [{ partId: q.partIds[0], quantity: 20 }] },
        ],
      });
      assert.equal(planned.ok, true, JSON.stringify(planned));
      if (!planned.ok) return;
      plannedIds = planned.batches.map((b) => b.id!);
      plannedSums = planned.batches.map((b) => b.amountKurus);
      released = await releaseBatch({
        frameworkId: lockId,
        batchId: plannedIds[0],
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      assert.equal(released.amountKurus, plannedSums[0]);
    });

    await test("iki ölçü AYRI: klon parti, kaynak teklif ANLAŞMA", async () => {
      assert.equal(await quoteIsFrameworkBatch(released.quoteId), true);
      assert.equal(await quoteHasLiveFramework(released.quoteId), false);
      assert.equal(await quoteIsFrameworkBatch(q.id), false);
      assert.equal(await quoteHasLiveFramework(q.id), true, "kaynak: anlaşma SÜRÜYOR");
    });

    await test("parti klonuna repriceQuote 409: kilitli fiyat YOK OLMAZ", async () => {
      const [before] = await db
        .select()
        .from(quotes)
        .where(eq(quotes.id, released.quoteId))
        .limit(1);
      const [partBefore] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.quoteId, released.quoteId))
        .limit(1);
      session = { userId: owner.id, email: owner.email };
      const access = await resolveQuoteAccess(released.quoteId);
      assert.ok(access !== null);
      const ret = await refusal(() => repriceQuote(access!));
      assert.equal(ret.status, 409);
      assert.equal(ret.code, "quote_locked");
      assert.equal(
        ret.message,
        "Bu teklif bir çerçeve anlaşmanın partisidir; düzenlenemez.",
        "uç EKRANLA aynı cümleyi söyler"
      );
      const [after] = await db
        .select()
        .from(quotes)
        .where(eq(quotes.id, released.quoteId))
        .limit(1);
      assert.equal(after.status, "quoted", "`draft`a DÜŞMEDİ");
      assert.deepEqual(
        after.pricingSnapshot,
        before.pricingSnapshot,
        "snapshot CANLI kataloğa dönmedi"
      );
      assert.equal(
        after.snapshotTakenAt.getTime(),
        before.snapshotTakenAt.getTime(),
        "damga bugüne kaymadı"
      );
      assert.equal(
        after.expiresAt.getTime(),
        before.expiresAt.getTime(),
        "geçerlilik kilidi AŞMADI"
      );
      const [partAfter] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, partBefore.id))
        .limit(1);
      assert.equal(partAfter.manualPriceKey, partBefore.manualPriceKey, "anahtar NULL'lanmadı");
      assert.equal(partAfter.manualUnitPriceKurus, partBefore.manualUnitPriceKurus);
      const state = await computeOf(released.quoteId);
      assert.equal(
        state.computed.totals.totalKurus,
        released.amountKurus,
        "parti hâlâ KİLİTLİ tutarı hesaplıyor (yani hâlâ ödenebilir)"
      );
    });

    await test("anlaşmanın KAYNAK teklifine repriceQuote 409: damga KAYMAZ", async () => {
      const [before] = await db.select().from(quotes).where(eq(quotes.id, q.id)).limit(1);
      session = { userId: owner.id, email: owner.email };
      const access = await resolveQuoteAccess(q.id);
      assert.ok(access !== null);
      const ret = await refusal(() => repriceQuote(access!));
      assert.equal(ret.status, 409);
      assert.equal(ret.code, "quote_locked");
      assert.equal(
        ret.message,
        "Bu teklif bir çerçeve anlaşmanın tanımıdır; anlaşma sürerken düzenlenemez."
      );
      const [after] = await db.select().from(quotes).where(eq(quotes.id, q.id)).limit(1);
      assert.equal(after.status, "quoted");
      assert.equal(
        after.snapshotTakenAt.getTime(),
        before.snapshotTakenAt.getTime(),
        // Klonun damgası BURADAN okunuyor (`releaseBatch`): kaynak yeniden
        // fiyatlanırsa sonraki her parti anlaşmanın ESKİ kataloğunu taşırken
        // TAZE damgalı görünürdü.
        "kaynağın damgası KAYMADI"
      );
    });

    await test("kaynak teklifin parçası DÜZENLENEMEZ: tanım da kilitli", async () => {
      const [partBefore] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, q.partIds[0]))
        .limit(1);
      session = { userId: owner.id, email: owner.email };
      const access = await resolveQuoteAccess(q.id);
      assert.ok(access !== null);
      const ret = await refusal(() =>
        updatePart(access!, q.partIds[0], parsePartPatch({ scale: 1.1 }))
      );
      assert.equal(ret.status, 409);
      assert.equal(ret.code, "quote_locked");
      assert.equal(
        ret.message,
        "Bu teklif bir çerçeve anlaşmanın tanımıdır; anlaşma sürerken düzenlenemez."
      );
      const [partAfter] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, q.partIds[0]))
        .limit(1);
      assert.equal(partAfter.scale, partBefore.scale, "ölçek DEĞİŞMEDİ");
    });

    await test("tanım BAŞKA bir yolla saparsa serbest bırakma 409 `framework_part_changed`", async () => {
      // Kapıyı ATLAYARAK (doğrudan SQL — ileride bir admin ucu ya da elle
      // bir onarım) kaynak parçanın ölçeğini değiştiriyoruz. Bu, tutarı
      // BOZMAYAN bir sapmadır: manuel anahtar yazılan konfigürasyondan
      // yeniden üretilir, yani eşitlik kapısı sessiz kalır. Yakalayan şey
      // TANIM KAPISI olmak zorunda.
      await db
        .update(quoteParts)
        .set({ scale: 1.1 })
        .where(eq(quoteParts.id, q.partIds[0]));
      const quotesBefore = (await db.select({ id: quotes.id }).from(quotes)).length;
      const ret = await refusal(() =>
        releaseBatch({
          frameworkId: lockId,
          batchId: plannedIds[1],
          adminEmail: "qa-admin@example.test",
          reason: REASON,
        })
      );
      assert.equal(ret.status, 409);
      assert.equal(
        ret.code,
        "framework_part_changed",
        "fiyat kapısı DEĞİL tanım kapısı yakaladı"
      );
      assert.match(ret.message, /scaleFactor/, "sapan alan ADIYLA söylenir");
      const [batch] = await db
        .select()
        .from(quoteFrameworkBatches)
        .where(eq(quoteFrameworkBatches.id, plannedIds[1]))
        .limit(1);
      assert.equal(batch.status, "planned", "parti PLANLI kaldı");
      assert.equal(batch.quoteId, null, "yarım klon BAĞLANMADI");
      const quotesAfter = (await db.select({ id: quotes.id }).from(quotes)).length;
      assert.equal(quotesAfter, quotesBefore, "klon satırı da GERİ ALINDI");

      // Tanım geri alınınca parti yine KİLİTLİ tutarla serbest bırakılır.
      await db.update(quoteParts).set({ scale: 1 }).where(eq(quoteParts.id, q.partIds[0]));
      const out = await releaseBatch({
        frameworkId: lockId,
        batchId: plannedIds[1],
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      assert.equal(out.amountKurus, plannedSums[1]);
      const state = await computeOf(out.quoteId);
      assert.equal(state.computed.totals.totalKurus, out.amountKurus);
    });

    await test("anlaşma iptal edilince kaynak teklif YİNE düzenlenebilir", async () => {
      await cancelFramework({
        frameworkId: lockId,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });
      assert.equal(await quoteHasLiveFramework(q.id), false, "kapanmış anlaşma SAYILMAZ");
      session = { userId: owner.id, email: owner.email };
      const access = await resolveQuoteAccess(q.id);
      assert.ok(access !== null);
      await updatePart(access!, q.partIds[0], parsePartPatch({ scale: 1.05 }));
      const [part] = await db
        .select()
        .from(quoteParts)
        .where(eq(quoteParts.id, q.partIds[0]))
        .limit(1);
      assert.equal(part.scale, 1.05, "kilit anlaşmayla birlikte DÜŞTÜ");
    });

    await test("listeler: müşteri kendi anlaşmalarını, admin hepsini görür", async () => {
      const mine = await listCustomerFrameworks(buyer.id);
      assert.equal(mine.items.length, 1, "alıcının TEK anlaşması");
      assert.equal(mine.items[0].id, frameworkId);
      assert.equal(mine.items[0].committedUnits, 160);

      const all = await listAdminFrameworks();
      assert.ok(all.items.length >= 6, `admin listesi: ${all.items.length}`);
      const cancelledOnly = await listAdminFrameworks({ status: "cancelled" });
      assert.ok(
        cancelledOnly.items.every((i) => i.status === "cancelled"),
        "süzgeç çalışıyor"
      );
      assert.ok(cancelledOnly.items.some((i) => i.id === frameworkId));
    });

    // ═══ 16) F3'ÜN OKUMA/YAZMA YÜZEYLERİ ════════════════════════
    //
    // Admin ekranlarını besleyen yeni sorguların HEPSİ burada GERÇEK
    // veritabanına karşı koşuyor. Gerekçe: dördü de elle yazılmış SQL
    // (korelasyonlu alt sorgu, `BETWEEN …::date`, JSON anlık görüntüsü okuma)
    // ve bir sözdizimi/alias hatası yalnız çalışma anında görünür — `tsc`
    // hepsini yeşil geçirir.

    await test("sipariş → anlaşma köprüsü kartı (parti n/m)", async () => {
      const card = await loadOrderFrameworkCard(paidOrderId);
      assert.ok(card, "ödenmiş partinin kartı yok");
      assert.equal(card!.frameworkId, frameworkId);
      assert.match(card!.frameworkNumber, /^C-\d{6,}$/, card!.frameworkNumber);
      assert.equal(card!.batchPosition, 1, "parti sırası");
      assert.ok(card!.batchCount >= 1, `parti sayısı: ${card!.batchCount}`);
      assert.equal(card!.units, 50, "partinin adedi");
      // Parti OLMAYAN sipariş → null. Sorgu YİNE koşuyor: asıl risk
      // korelasyonlu alt sorgunun alias'ıydı ve bir hata burada 42P01 verir.
      assert.equal(await loadOrderFrameworkCard(randomUUID()), null);
    });

    await test("pencere, ileriye dönük yük, denetim izi ve tercihler", async () => {
      const [shop] = await db
        .insert(manufacturers)
        .values({
          companyName: "QA Çapa Atölyesi",
          email: `mfg-anchor-${randomUUID()}@example.test`,
          passwordHash: "x",
          contactPerson: "QA Yetkili",
          phone: "+905321234599",
          status: "active",
          maxConcurrentOrders: 50,
        })
        .returning({ id: manufacturers.id });
      const o = await makeUser();
      const qq = await makeQuote(o.id, [{ name: "Panel", quantity: 60 }]);
      const st = await computeOf(qq.id);
      const lead = st.computed.totals.leadDays ?? 5;
      const created = await createFrameworkFromQuote({
        quoteId: qq.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        priceLockedUntil: LOCK_UNTIL,
        shippingAddress: address,
        preferredManufacturerId: shop.id,
      });
      assert.equal(created.ok, true, JSON.stringify(created));
      if (!created.ok) return;
      await activateFramework({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
      });

      // Penceresi AÇIK parti: tarihi TAM olarak en erken gün (bugün bıraksan
      // ancak yetişir). Penceresi KAPALI parti: iki ay ileri.
      const near = shipDate(lead, 0);
      const far = shipDate(lead, 60);
      const before = await releasableBatchCount();
      const planned = await planBatches({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        batches: [
          { plannedShipDate: near, lines: [{ partId: qq.partIds[0], quantity: 20 }] },
          { plannedShipDate: far, lines: [{ partId: qq.partIds[0], quantity: 20 }] },
        ],
      });
      assert.equal(planned.ok, true, JSON.stringify(planned));
      const after = await releasableBatchCount();
      assert.equal(
        after - before,
        1,
        `yalnız penceresi açılmış parti sayılmalı (önce ${before}, sonra ${after})`
      );

      const detail = (await loadFrameworkDetail(created.id))!;
      assert.equal(detail.leadDays, lead, "teslim günü donmuş anlık görüntüden");
      const nearBatch = detail.batches.find((b) => b.plannedShipDate === near)!;
      const farBatch = detail.batches.find((b) => b.plannedShipDate === far)!;
      assert.equal(nearBatch.releaseWindowOpen, true, "yakın partinin penceresi kapalı");
      assert.equal(farBatch.releaseWindowOpen, false, "uzak partinin penceresi açık");

      // İLERİYE DÖNÜK YÜK: 30 günlük pencere YALNIZ yakın partiyi görür.
      const load = await loadFrameworkForwardLoad({
        manufacturerId: shop.id,
        windowDays: 30,
      });
      assert.equal(load.batchCount, 1, "30 günlük pencerede bir parti");
      assert.equal(load.units, 20);
      assert.equal(load.loadUnits, 2, "1 + floor(20/20)");
      const wide = await loadFrameworkForwardLoad({
        manufacturerId: shop.id,
        windowDays: 120,
      });
      assert.equal(wide.batchCount, 2, "120 günlük pencerede iki parti");
      assert.equal(wide.units, 40);

      // DENETİM İZİ: kaynağın altında, en yenisi başta.
      const audit = await loadFrameworkAudit(qq.id);
      assert.deepEqual(
        [...audit].map((a) => a.action).sort(),
        ["framework_activate", "framework_batch_plan", "framework_create"],
        JSON.stringify(audit.map((a) => a.action))
      );

      // TERCİHLER: çapa kaldırılır, not yazılır — PARA DEĞİŞMEZ.
      await setFrameworkPreferences({
        frameworkId: created.id,
        adminEmail: "qa-admin@example.test",
        reason: REASON,
        preferredManufacturerId: null,
        adminNote: "QA notu",
      });
      const cleared = (await loadFrameworkDetail(created.id))!;
      assert.equal(cleared.preferredManufacturerId, null, "çapa kalkmadı");
      assert.equal(cleared.adminNote, "QA notu");
      assert.equal(
        cleared.committedTotalKurus,
        detail.committedTotalKurus,
        "tercih değişikliği TAAHHÜT TOPLAMINA dokundu"
      );
      assert.equal(
        cleared.batchesTotalKurus,
        detail.batchesTotalKurus,
        "tercih değişikliği Σ parti tutarına dokundu"
      );
      // Çapa kalktıysa ileriye dönük yük de düşer (anlaşma o atölyeye
      // planlanmış sayılmaz).
      const dropped = await loadFrameworkForwardLoad({
        manufacturerId: shop.id,
        windowDays: 120,
      });
      assert.equal(dropped.batchCount, 0, "çapa kalktı ama yük hâlâ sayılıyor");

      // DENETİM SATIRI YAZILMADI — BİLEREK: `quote_admin_actions.action`
      // kapalı CHECK kümesinde bu ucun karşılığı yok ve bu tur migration
      // üretmiyor. Var olan bir eylemin adıyla satır yazmak izi yalanlamaktı.
      const auditAfter = await loadFrameworkAudit(qq.id);
      assert.equal(auditAfter.length, audit.length, "PATCH denetim satırı yazdı");

      // Olmayan bir atölye ÇAPA OLAMAZ: yazılsaydı her partide sessizce
      // sıralamaya düşen bir "çapa" kalırdı.
      const bad = await refusal(() =>
        setFrameworkPreferences({
          frameworkId: created.id,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
          preferredManufacturerId: randomUUID(),
        })
      );
      assert.equal(bad.code, "manufacturer_unavailable", bad.message);
      assert.equal(bad.status, 409);
    });

    await test("giriş kapısı: fiyatlı teklif uygun, anlaşması olan teklif DEĞİL", async () => {
      const o2 = await makeUser();
      const fresh = await makeQuote(o2.id, [{ name: "Taban", quantity: 25 }]);
      const entry = await loadFrameworkEntry(fresh.id);
      assert.equal(entry.eligible, true, JSON.stringify(entry.refusals));
      assert.deepEqual(entry.refusals, []);
      assert.equal(entry.existingFramework, null);
      assert.ok(entry.manufacturers.length >= 1, "çapa seçicisinin listesi boş");

      // Anlaşması OLAN teklif: düğme yerine anlaşmaya bağlantı.
      const taken = await loadFrameworkEntry(sourceQuote.id);
      assert.equal(taken.eligible, false);
      assert.ok(taken.existingFramework, "var olan anlaşma bildirilmiyor");
      assert.equal(taken.existingFramework!.id, frameworkId);
      assert.ok(
        taken.refusals.some((r) => /zaten bir çerçeve anlaşma/.test(r)),
        JSON.stringify(taken.refusals)
      );

      // TASLAK teklif: kapı UCUN verdiği cevabı aynen yazıyor.
      const draftQuote = await makeQuote(o2.id, [{ name: "Taslak", quantity: 25 }], {
        status: "draft",
      });
      const draftEntry = await loadFrameworkEntry(draftQuote.id);
      assert.equal(draftEntry.eligible, false);
      assert.ok(
        draftEntry.refusals.some((r) => /fiyatlandırılmış/.test(r)),
        JSON.stringify(draftEntry.refusals)
      );
      const ret = await refusal(() =>
        createFrameworkFromQuote({
          quoteId: draftQuote.id,
          adminEmail: "qa-admin@example.test",
          reason: REASON,
          priceLockedUntil: LOCK_UNTIL,
          shippingAddress: address,
        })
      );
      assert.equal(ret.code, "quote_not_quoted", "ekran ile uç AYNI kapıyı okumuyor");
    });

    console.log(`${checks} quote framework DB checks passed`);
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
