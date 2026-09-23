/**
 * ADMIN TEKLİF KUYRUĞU: sekme mantığı, manuel fiyat kapısı ve uçların oturum
 * kapısı.
 *
 * Dört soru sorar ve dördü de PARA sorusudur:
 *
 *  1. **Sekme mantığı** — kuyruk DURUMA bakar mı? `repriceQuote` teklifi
 *     `draft`a çeker ama `review_kind`/`review_note` kolonlarını temizlemez;
 *     sekme bu bayat kolona baksaydı cevaplanmış (hatta müşterisi tarafından
 *     yeniden düzenlenmiş) bir teklif sonsuza dek "inceleme bekliyor"
 *     görünürdü. Ayrıca `needs_review` olan HER satır üç inceleme sekmesinin
 *     TAM OLARAK birinde görünmeli: görünmeyen bir talep, cevaplanmayan bir
 *     taleptir.
 *  2. **Fiyat kapısı** — admin'in girdiği her tutar yazılmadan ÖNCE
 *     doğrulanıyor mu? `computeQuote` saklanan değere güvenir: negatif,
 *     ondalık ya da ₺2.000.000 üstü bir sayı doğrudan müşterinin ödediği
 *     tutara akar.
 *  3. **Manuel fiyat anahtarı** — `manual_price_key` GERÇEKTEN
 *     `partPricingKey(part, quote.leadTier)` mi? Yanlış bir anahtar hata
 *     vermez, fiyat SESSİZCE düşer ve teklif "manuel fiyat bekliyor"a döner.
 *  4. **Oturum kapısı** — her admin ucu, admin oturumu olmadan 401 döner ve
 *     hiçbir şey yazmaz.
 *
 * DB yok, ağ yok: çekirdek saftır, rotalarda yalnız `requireAdmin` taklit
 * edilir (kapı ilk satırdadır, arkasına geçilmez).
 *
 * Çalıştırma: npx tsx scripts/test-quote-admin.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

import { MAX_AMOUNT_KURUS } from "../src/lib/config/prices";
import { partPricingKey } from "../src/lib/config/quote-keys";
import { SEED_SNAPSHOT } from "../src/lib/config/quote-seed";
import {
  QUOTE_STATUSES,
  REVIEW_KINDS,
  type PartConfig,
  type QuoteStatus,
  type ReviewKind,
} from "../src/lib/config/quote-types";
import {
  ADMIN_QUOTE_TABS,
  ADMIN_QUOTE_TAB_LABELS,
  adminManualPriceKey,
  isStaleReviewKind,
  parseAdminQuoteTab,
  parseExtendDays,
  parseManualPriceRows,
  parseTargetCounters,
  quoteMatchesTab,
  requireReason,
  validateAdminUnitPrice,
  AdminQuoteError,
} from "../src/lib/services/quote-admin";
import {
  daysOrNaN,
  fromKurus,
  rowsOf,
  toKurus,
} from "../src/app/admin/teklifler/[id]/price-values";

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗   ${name}\n      ${(err as Error).message}`);
  }
}

/** Çağrı AdminQuoteError ile düşmeli; kodu da doğrulanır. */
function refuses(code: string, why: string, run: () => unknown) {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof AdminQuoteError, `${why}: beklenen hata türü değil (${String(err)})`);
    assert.equal(err.code, code, `${why}: hata kodu`);
    assert.ok(err.message.length > 10, `${why}: cümle kısa`);
    return;
  }
  assert.fail(`kabul edilmemeliydi: ${why}`);
}

async function main() {
  // ─── 1) Kuyruk sekmeleri ──────────────────────────────────────────────────

  console.log("1) Kuyruk sekmeleri");

  const NOW = new Date("2026-09-23T12:00:00.000Z");
  const FUTURE = new Date("2026-10-23T12:00:00.000Z");
  const PAST = new Date("2026-09-01T12:00:00.000Z");

  const row = (
    status: QuoteStatus,
    reviewKind: ReviewKind | null,
    expiresAt = FUTURE
  ) => ({ status, reviewKind, expiresAt });

  await test("sekme anahtarı yalnız bilinen değerleri kabul eder", () => {
    assert.equal(parseAdminQuoteTab("review"), "review");
    assert.equal(parseAdminQuoteTab(undefined), "review", "varsayılan sekme");
    assert.equal(parseAdminQuoteTab("hepsi"), null);
    assert.equal(parseAdminQuoteTab(["review"]), null, "dizi parametresi");
    for (const tab of ADMIN_QUOTE_TABS) {
      assert.equal(parseAdminQuoteTab(tab), tab);
      assert.ok(ADMIN_QUOTE_TAB_LABELS[tab].length > 0, `${tab}: etiket yok`);
    }
  });

  await test("bayat review_kind taşıyan TASLAK hiçbir inceleme sekmesine düşmez", () => {
    // `repriceQuote` tam olarak bu satırı bırakır: durum draft, tür hâlâ dolu.
    for (const kind of REVIEW_KINDS) {
      const stale = row("draft", kind);
      for (const tab of ["review", "target", "rfq"] as const) {
        assert.equal(
          quoteMatchesTab(stale, tab, NOW),
          false,
          `draft + ${kind} → ${tab} sekmesinde görünmemeli`
        );
      }
      assert.equal(quoteMatchesTab(stale, "all", NOW), true, "Tümü sekmesi her şeyi gösterir");
      assert.equal(isStaleReviewKind(stale), true, `draft + ${kind} bayat sayılmalı`);
    }
  });

  await test("inceleme bekleyen HER satır üç sekmenin tam olarak birinde", () => {
    const kinds: Array<ReviewKind | null> = [...REVIEW_KINDS, null];
    for (const kind of kinds) {
      const waiting = row("needs_review", kind);
      const hits = (["review", "target", "rfq"] as const).filter((tab) =>
        quoteMatchesTab(waiting, tab, NOW)
      );
      assert.deepEqual(
        hits.length,
        1,
        `needs_review + ${kind ?? "null"} → ${hits.length} sekme (${hits.join(", ")})`
      );
      assert.equal(isStaleReviewKind(waiting), false);
    }
  });

  await test("süresi dolan sekmesi cevaplanmış teklifleri gösterir, terk edilmiş taslakları değil", () => {
    assert.equal(quoteMatchesTab(row("quoted", null, PAST), "expired", NOW), true);
    assert.equal(quoteMatchesTab(row("needs_review", "manual", PAST), "expired", NOW), true);
    assert.equal(quoteMatchesTab(row("expired", null, PAST), "expired", NOW), true);
    // Girişsiz ziyaretçinin kendiliğinden sönen taslağı admin işi DEĞİLDİR.
    assert.equal(quoteMatchesTab(row("draft", null, PAST), "expired", NOW), false);
    // Siparişe dönmüş teklif "süresi dolan" olamaz: sipariş verilmiştir.
    assert.equal(quoteMatchesTab(row("ordered", null, PAST), "expired", NOW), false);
    assert.equal(quoteMatchesTab(row("ordered", null, PAST), "ordered", NOW), true);
  });

  await test("fiyatlandı sekmesi süresi dolanı göstermez (iki sekme ayrışır)", () => {
    assert.equal(quoteMatchesTab(row("quoted", null, FUTURE), "quoted", NOW), true);
    assert.equal(quoteMatchesTab(row("quoted", null, PAST), "quoted", NOW), false);
  });

  await test("her durum en az bir sekmede görünür (kaybolan satır yok)", () => {
    for (const status of QUOTE_STATUSES) {
      const hits = ADMIN_QUOTE_TABS.filter((tab) =>
        quoteMatchesTab(row(status, null, FUTURE), tab, NOW)
      );
      assert.ok(hits.length >= 1, `${status} hiçbir sekmede yok`);
    }
  });

  // ─── 2) Admin'in girdiği para ─────────────────────────────────────────────

  console.log("\n2) Admin'in girdiği para");

  await test("birim fiyat pozitif TAM SAYI kuruş olmalı", () => {
    assert.equal(validateAdminUnitPrice(1), 1);
    assert.equal(validateAdminUnitPrice(MAX_AMOUNT_KURUS), MAX_AMOUNT_KURUS);
    refuses("invalid_price", "sıfır", () => validateAdminUnitPrice(0));
    refuses("invalid_price", "negatif", () => validateAdminUnitPrice(-100));
    refuses("invalid_price", "ondalık", () => validateAdminUnitPrice(1250.5));
    refuses("invalid_price", "üst sınır aşımı", () => validateAdminUnitPrice(MAX_AMOUNT_KURUS + 1));
    refuses("invalid_price", "NaN", () => validateAdminUnitPrice(Number.NaN));
    refuses("invalid_price", "Infinity", () => validateAdminUnitPrice(Number.POSITIVE_INFINITY));
    refuses("invalid_price", "metin", () => validateAdminUnitPrice("1250"));
    refuses("invalid_price", "null", () => validateAdminUnitPrice(null));
  });

  await test("manuel fiyat satırları: null = fiyatı KALDIR, sayı = doğrulanır", () => {
    const rows = parseManualPriceRows([
      { partId: "p1", unitKurus: 7400 },
      { partId: "p2", unitKurus: null },
    ]);
    assert.deepEqual(rows, [
      { partId: "p1", unitKurus: 7400 },
      { partId: "p2", unitKurus: null },
    ]);
    refuses("invalid_body", "parça listesi boş", () => parseManualPriceRows([]));
    refuses("invalid_body", "dizi değil", () => parseManualPriceRows({ partId: "p1" }));
    refuses("invalid_body", "partId yok", () => parseManualPriceRows([{ unitKurus: 100 }]));
    refuses("invalid_body", "aynı parça iki kez", () =>
      parseManualPriceRows([
        { partId: "p1", unitKurus: 100 },
        { partId: "p1", unitKurus: 200 },
      ])
    );
    refuses("invalid_price", "negatif fiyat satırda da reddedilir", () =>
      parseManualPriceRows([{ partId: "p1", unitKurus: -5 }])
    );
  });

  await test("karşı teklif satırlarında null YOKTUR (fiyat vermek zorunludur)", () => {
    assert.deepEqual(parseTargetCounters([{ partId: "p1", unitKurus: 9000 }]), [
      { partId: "p1", unitKurus: 9000 },
    ]);
    refuses("invalid_body", "karşı teklifte boş fiyat", () =>
      parseTargetCounters([{ partId: "p1", unitKurus: null }])
    );
    refuses("invalid_body", "karşı teklif listesi boş", () => parseTargetCounters([]));
  });

  await test("gerekçe en az 10 karakter ve kırpılarak saklanır", () => {
    assert.equal(requireReason("  Müşteriyle telefonda görüşüldü.  "), "Müşteriyle telefonda görüşüldü.");
    refuses("reason_too_short", "kısa gerekçe", () => requireReason("ok"));
    refuses("reason_too_short", "yalnız boşluk", () => requireReason("           "));
    refuses("reason_too_short", "gerekçe yok", () => requireReason(undefined));
  });

  await test("geçerlilik süresi 1–365 gün arası tam sayı", () => {
    assert.equal(parseExtendDays(30), 30);
    refuses("invalid_body", "sıfır gün", () => parseExtendDays(0));
    refuses("invalid_body", "negatif gün", () => parseExtendDays(-1));
    refuses("invalid_body", "ondalık gün", () => parseExtendDays(1.5));
    refuses("invalid_body", "bir yıldan fazla", () => parseExtendDays(400));
  });

  // ─── 3) Manuel fiyat anahtarı ─────────────────────────────────────────────

  console.log("\n3) Manuel fiyat anahtarı");

  const CONFIG: PartConfig = {
    technologyKey: "fdm",
    materialKey: "pla",
    colorKey: "beyaz",
    finishKey: "none",
    layerUm: 200,
    infillPct: 20,
    quantity: 3,
    units: "mm",
    scale: 1,
    criticalTolerance: false,
  };
  const PART = { sourceSha256: "abc123", config: CONFIG };

  await test("anahtar partPricingKey ile BİREBİR aynı (yoksa fiyat sessizce düşer)", () => {
    for (const tier of ["economy", "standard", "express"] as const) {
      assert.equal(adminManualPriceKey(PART, tier), partPricingKey(PART, tier));
    }
  });

  await test("teslim kademesi anahtarın parçası: kademe değişince fiyat düşer", () => {
    assert.notEqual(adminManualPriceKey(PART, "standard"), adminManualPriceKey(PART, "express"));
  });

  await test("konfigürasyon değişince anahtar tutmaz", () => {
    const other = { ...PART, config: { ...CONFIG, quantity: 4 } };
    assert.notEqual(adminManualPriceKey(PART, "standard"), adminManualPriceKey(other, "standard"));
  });

  await test("motorun anahtarı, adminin yazdığı anahtarla eşleşiyor", () => {
    // Fiyat çekirdeği anahtarı `partPricingKey(part, tierKey)` ile üretir ve
    // EŞİT DEĞİLSE manuel fiyatı yok sayar; burada aynı girdiyle iki tarafın
    // aynı dizeyi ürettiği çivileniyor.
    const key = adminManualPriceKey(PART, "standard");
    const input = {
      id: "p1",
      analysisStatus: "ready" as const,
      geometry: null,
      sourceSha256: PART.sourceSha256,
      config: CONFIG,
      manualUnitPriceKurus: 7400,
      manualPriceKey: key,
      dfmAckKey: null,
    };
    assert.equal(partPricingKey(input, "standard"), key);
    assert.ok(SEED_SNAPSHOT.technologies.some((t) => t.key === CONFIG.technologyKey));
  });

  // ─── 4) Uçların oturum kapısı ─────────────────────────────────────────────

  console.log("\n4) Admin teklif uçlarının oturum kapısı");

  const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  let authorized = false;

  loader._load = function (name, ...args) {
    if (name === "@/lib/auth/require-admin") {
      return {
        requireAdmin: async () =>
          authorized
            ? { session: { user: { email: "sahip@test.invalid", role: "admin" } } }
            : {
                response: NextResponse.json(
                  { error: "Bu işlem için admin oturumu gerekiyor." },
                  { status: 401 }
                ),
              },
      };
    }
    return originalLoad.call(this, name, ...args);
  };

  type AnyHandler = (req: NextRequest, ctx?: unknown) => Promise<{ status: number }>;

  function req(method: string, body: unknown = {}): NextRequest {
    return new NextRequest("http://localhost/api/admin/quotes/x", {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
  }

  const idContext = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };

  try {
    const price = await import("../src/app/api/admin/quotes/[id]/price/route");
    const target = await import("../src/app/api/admin/quotes/[id]/target/route");
    const extend = await import("../src/app/api/admin/quotes/[id]/extend/route");
    const rejectReviewRoute = await import(
      "../src/app/api/admin/quotes/[id]/reject-review/route"
    );
    const reopen = await import("../src/app/api/admin/quotes/[id]/reopen/route");
    const messages = await import("../src/app/api/admin/quotes/[id]/messages/route");
    const messagesRead = await import("../src/app/api/admin/quotes/[id]/messages/read/route");

    const guarded: Array<[string, AnyHandler]> = [
      ["POST /price", price.POST as unknown as AnyHandler],
      ["POST /target", target.POST as unknown as AnyHandler],
      ["POST /extend", extend.POST as unknown as AnyHandler],
      ["POST /reject-review", rejectReviewRoute.POST as unknown as AnyHandler],
      ["POST /reopen", reopen.POST as unknown as AnyHandler],
      ["GET /messages", messages.GET as unknown as AnyHandler],
      ["POST /messages", messages.POST as unknown as AnyHandler],
      ["POST /messages/read", messagesRead.POST as unknown as AnyHandler],
    ];

    await test("admin oturumu olmayan her uç 401 döner", async () => {
      authorized = false;
      for (const [label, handler] of guarded) {
        const method = label.split(" ")[0]!;
        const response = await handler(req(method), idContext);
        assert.equal(response.status, 401, `${label} kapıyı geçti`);
      }
    });

    await test("uçların tamamı yazılı (GET/POST dışa aktarılmış)", () => {
      for (const [label, handler] of guarded) {
        assert.equal(typeof handler, "function", `${label} dışa aktarılmamış`);
      }
    });

    await test("admin oturumu varken bozuk gövde DB'ye gitmeden 400 döner", async () => {
      authorized = true;
      // Gövde doğrulaması kapının hemen arkasında: yanlış bir tutar ya da eksik
      // gerekçe için teklifi okumaya (DB) hiç gerek yok. Bu testin DB'si yok;
      // 400 gelmesi doğrulamanın okumadan ÖNCE olduğunun kanıtı.
      const cases: Array<[string, AnyHandler, unknown]> = [
        ["POST /price", price.POST as unknown as AnyHandler, { parts: [], reason: "kısa" }],
        [
          "POST /target",
          target.POST as unknown as AnyHandler,
          { decision: "kabul", reason: "Yeterince uzun bir gerekçe." },
        ],
        ["POST /extend", extend.POST as unknown as AnyHandler, { days: 0, reason: "x" }],
        ["POST /reject-review", rejectReviewRoute.POST as unknown as AnyHandler, { reason: "yok" }],
        ["POST /reopen", reopen.POST as unknown as AnyHandler, { reason: "yok" }],
      ];
      for (const [label, handler, body] of cases) {
        const response = await handler(req("POST", body), idContext);
        assert.equal(response.status, 400, `${label} bozuk gövdeyi geçirdi`);
      }
    });
  } finally {
    authorized = false;
    loader._load = originalLoad;
  }

  // ─── 5) Ekranın para katmanı ──────────────────────────────────────────────

  console.log("\n5) Ekranın para katmanı");

  const DRAFT_PARTS = [
    { id: "a", position: 1, name: "Gövde" },
    { id: "b", position: 2, name: "Kapak" },
  ];

  await test("boş alan 'fiyatı kaldır', OKUNAMAYAN alan hata — ikisi aynı şey DEĞİL", () => {
    // Bu ayrım para kaybını önler: `NaN` JSON'da `null`a düşer ve `null` bu
    // uçta "manuel fiyatı SİL" demektir; yani "12,5o" yazım hatası girilmiş
    // bir fiyatı sessizce silerdi.
    assert.equal(toKurus(""), null);
    assert.equal(toKurus("   "), null);
    assert.equal(toKurus("74,50"), 7450);
    assert.equal(toKurus("74.50"), 7450);
    assert.equal(toKurus("0"), 0, "sıfır OKUNUR; reddi sunucunun işi");
    for (const bad of ["12,5o", "abc", "1e3", "0x10", "-5", "7,505", "1,2,3", "7,"]) {
      assert.equal(toKurus(bad), "invalid", `${bad} okunamadı sayılmalı`);
    }
  });

  await test("okunamayan TEK alan bütün isteği durdurur (yarım kayıt yok)", () => {
    const good = rowsOf(DRAFT_PARTS, { a: "74,50", b: "" }, "all");
    assert.deepEqual(good, [
      { partId: "a", unitKurus: 7450 },
      { partId: "b", unitKurus: null },
    ]);
    const bad = rowsOf(DRAFT_PARTS, { a: "74,50", b: "12,5o" }, "all");
    assert.equal(typeof bad, "string", "hata cümlesi dönmeli");
    assert.match(bad as string, /P02 Kapak/, "hangi parça olduğu yazmalı");
  });

  await test("karşı teklifte boş alan ATLANIR, manuel fiyatta GÖNDERİLİR", () => {
    assert.deepEqual(rowsOf(DRAFT_PARTS, { a: "90", b: "" }, "filled"), [
      { partId: "a", unitKurus: 9000 },
    ]);
    assert.deepEqual(rowsOf(DRAFT_PARTS, { a: "90", b: "" }, "all"), [
      { partId: "a", unitKurus: 9000 },
      { partId: "b", unitKurus: null },
    ]);
  });

  await test("ekran ↔ kuruş çevrimi gidip gelir", () => {
    for (const kurus of [1, 99, 100, 7450, 123456]) {
      assert.equal(toKurus(fromKurus(kurus)), kurus, `${kurus} gidiş-dönüş`);
    }
    assert.equal(fromKurus(null), "");
  });

  await test("gün alanı yalnız tam sayı kabul eder, gerisi NaN olarak gider", () => {
    assert.equal(daysOrNaN("30"), 30);
    assert.ok(Number.isNaN(daysOrNaN("")));
    assert.ok(Number.isNaN(daysOrNaN("1,5")));
    assert.ok(Number.isNaN(daysOrNaN("otuz")));
    // NaN JSON'da null olur; sunucu kendi Türkçe cümlesiyle reddeder.
    refuses("invalid_body", "NaN gün", () => parseExtendDays(JSON.parse(JSON.stringify(Number.NaN))));
  });

  // ─── 6) Ekranın yapısal çivileri ──────────────────────────────────────────

  console.log("\n6) Ekranın yapısal çivileri");

  await test("kenar çubuğunda Teklifler grubu ve üç bağlantı var", () => {
    const sidebar = read("src/app/admin/sidebar.tsx");
    assert.match(sidebar, /\/admin\/teklifler/, "Anlık teklifler bağlantısı yok");
    assert.match(sidebar, /\/admin\/baski-katalogu/, "Baskı kataloğu bağlantısı yok");
    assert.match(sidebar, /\/admin\/ayarlar/, "Ayarlar bağlantısı yok");
    assert.match(sidebar, /Eski yükleme teklifleri/, "eski uçuş adlandırılmamış");
    assert.match(sidebar, /needsReviewCount/, "rozet propu yok");
  });

  await test("rozet sayısı KORUMALI okunuyor ve okunamazsa şeritte yazıyor", () => {
    const layout = read("src/app/admin/layout.tsx");
    const flat = layout.replace(/\s+/g, " ");
    assert.match(flat, /displayRead\( *"inceleme bekleyen teklifler"/, "displayRead ile sarılmamış");
    assert.match(flat, /quoteReviewRead === null &&/, "unreadableAreas satırı yok");
    assert.match(flat, /needsReviewCount=\{/, "sayı kenar çubuğuna verilmiyor");
  });

  await test("admin sohbeti mevcut OrderChat bileşenini kullanıyor", () => {
    const client = read("src/app/admin/teklifler/[id]/client.tsx");
    assert.match(client, /OrderChat/, "ikinci bir sohbet arayüzü yazılmış");
    assert.match(client, /\/api\/admin\/quotes\/\$\{[^}]+\}\/messages/, "basePath yanlış");
  });

  await test("ekran para çevrimini her tuşta DEĞİL, gönderimde yapıyor", () => {
    // Katalog ekranında düzeltilen hatanın nüksü: `onChange` içinde kuruşa
    // çevirmek "7," ara hâlini imkânsız kılar (imleç kayar, ondalık yazılamaz).
    const client = read("src/app/admin/teklifler/[id]/client.tsx");
    assert.doesNotMatch(client, /toKurus\(e\.target\.value\)/, "her tuşta çevirim var");
    assert.match(client, /draftRows\(prices, "all"\)/, "gönderimde satır kurulmuyor");
  });

  await test("liste sayfası sekmeyi doğrular ve sayfalamayı pageSize+1 ile okur", () => {
    const service = read("src/lib/services/quote-admin.ts");
    assert.match(service, /ADMIN_QUOTE_PAGE_SIZE \+ 1/, "hasNext için fazladan satır okunmuyor");
    const page = read("src/app/admin/teklifler/page.tsx");
    assert.match(page, /parseAdminQuoteTab/, "sekme doğrulanmıyor");
  });

  console.log(
    failures === 0
      ? "\n✅ quote-admin: tüm kontroller geçti"
      : `\n❌ quote-admin: ${failures} kontrol başarısız`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
