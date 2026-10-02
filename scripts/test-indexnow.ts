/**
 * IndexNow submission contract. Nothing here hits the network — the payload
 * shaping and the refusal rules are what can silently break.
 *
 * V4 GENİŞLETMESİ — pazarlama/figürin sayfalarının gönderim yolu.
 *
 * `indexnow.ts`in başlığı amacı yazıyor: "ChatGPT'nin retrieval'ı Bing
 * indeksinde çalışır … IndexNow → Bing → ChatGPT". Ama 2026-10-02 denetimine
 * kadar depoda TEK çağrı yeri vardı (pazar yeri ürün onayı), yani `/`, `/figur`,
 * `/nasil-calisir`, `/3d-baski`, `/urunler` ve altı özel gün sayfası HİÇ
 * gönderilmiyordu: ChatGPT'ye girmek için kurulmuş tek araç, o sayfalar için hiç
 * çalışmıyordu.
 *
 * Buradaki sınav üç şey:
 *  1. gönderilen kümenin GERÇEKTEN o sayfaları içermesi,
 *  2. her turda her şeyi göndermemesi — IndexNow "bu URL DEĞİŞTİ" demek için
 *     var ve tarih değişmeyen sayfayı göndermek gürültüdür,
 *  3. anahtar yoksa admin yüzeyinin bunu AÇIKÇA söylemesi (sessizce `no_key`
 *     dönen bir fonksiyonun üstünde düğmeye basan kişi iş yaptığını sanır).
 *
 * AĞA ÇIKILMAZ: `fetch` her iddiada taklit edilir ve gerçek IndexNow uç
 * noktasına hiçbir istek gitmez. Sitemap karşılaştırması `src/app/sitemap.ts`i
 * yüklüyor ve o dosya bir veritabanı havuzu kuruyor; adres BİLEREK ölü bir
 * porta çivilendi (aksi hâlde `pg` geliştiricinin kendi Postgres'ine uzanırdı).
 */
process.env.DATABASE_URL = "postgres://nobody:nobody@127.0.0.1:1/none";

// İLK import olmak ZORUNDA değil (admin kartı CSS modülü kullanmıyor), ama
// react render'ı için stub zararsız ve ileride bir modül eklenirse kurtarır.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getIndexNowKey,
  submitToIndexNow,
  INDEXNOW_KEY_PATH,
} from "../src/lib/services/indexnow";
import {
  INDEXNOW_PAGE_PATHS,
  announceStaticPages,
  changedPagePaths,
  loadIndexNowPageStatus,
  pageAbsoluteUrl,
  type AnnouncedPageStore,
} from "../src/lib/services/indexnow-pages";
import { PAGE_UPDATED_AT } from "../src/lib/config/page-updated";
import { runSeoIndexNowJob } from "../src/lib/queue/workers/seo-indexnow.worker";
import { IndexNowCard } from "../src/app/admin/ayarlar/indexnow-client";

let failures = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((err) => {
      failures++;
      console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
    });
}

const APP_URL = "https://figurunica.com";

/** Hafızanın bellek içi karşılığı — Redis'e dokunmadan diff'i sınamak için. */
function memoryStore(seed: Record<string, string> = {}): AnnouncedPageStore & {
  entries: () => Record<string, string>;
  writes: number;
} {
  let state = { ...seed };
  const store = {
    writes: 0,
    read: async () => ({ ...state }),
    write: async (entries: Record<string, string>) => {
      state = { ...entries };
      store.writes++;
    },
    entries: () => ({ ...state }),
  };
  return store;
}

interface FetchCapture {
  calls: Array<{ url: string; body: Record<string, unknown> }>;
  restore: () => void;
}

/** `fetch`i tutar: gönderilen gövde okunur, ağa HİÇBİR istek çıkmaz. */
function captureFetch(status = 200): FetchCapture {
  const calls: FetchCapture["calls"] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(status === 204 ? null : "{}", { status });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function main() {
  const savedKey = process.env.INDEXNOW_KEY;
  const savedAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;

  // ─── mevcut sözleşme ────────────────────────────────────────────────────

  await check("anahtar yokken hiçbir şey gönderilmez", async () => {
    delete process.env.INDEXNOW_KEY;
    const r = await submitToIndexNow(["/shop/x"]);
    assert.deepEqual(r, { ok: false, reason: "no_key" });
  });

  await check("çok kısa anahtar yapılandırma hatasıdır, gönderilmez", async () => {
    process.env.INDEXNOW_KEY = "abc";
    assert.equal(getIndexNowKey(), null);
    const r = await submitToIndexNow(["/shop/x"]);
    assert.deepEqual(r, { ok: false, reason: "no_key" });
  });

  await check("geçerli anahtar tanınır", () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    assert.equal(getIndexNowKey(), "a".repeat(32));
  });

  await check("yabancı host'lu URL'ler elenir — anahtarı iptal ettirir", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const r = await submitToIndexNow([
      "https://evil.example.com/x",
      "https://another.test/y",
    ]);
    assert.deepEqual(r, { ok: false, reason: "no_urls" }, "yalnız yabancı URL varsa gönderim olmamalı");
  });

  await check("anahtar dosyası yolu sabit ve spec'e uygun", () => {
    assert.equal(INDEXNOW_KEY_PATH, "/indexnow-key.txt");
    assert.ok(INDEXNOW_KEY_PATH.endsWith(".txt"));
  });

  // ─── gönderim kümesi ────────────────────────────────────────────────────

  /** Denetimde "hiç gönderilmiyor" diye bulunan sayfaların tamamı. */
  const MUST_SUBMIT = [
    "", // anasayfa
    "/figur",
    "/nasil-calisir",
    "/3d-baski",
    "/3d-baski/malzemeler",
    "/urunler",
    "/hediye/dogum-gunu",
    "/hediye/sevgiliye",
    "/hediye/evcil-hayvan",
    "/hediye/oyun-karakteri",
    "/hediye/aile-hatirasi",
    "/hediye/mezuniyet",
  ];

  await check("gönderim kümesi pazarlama ve ALTI özel gün sayfasını içerir", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const store = memoryStore({ "": "1900-01-01" });
    const fetchStub = captureFetch();
    try {
      const outcome = await announceStaticPages({ scope: "all", store, appUrl: APP_URL });
      assert.equal(outcome.ok, true, `gönderim reddedildi: ${JSON.stringify(outcome)}`);
      assert.equal(fetchStub.calls.length, 1, "tek bir gönderim beklenir");
      const urls = fetchStub.calls[0].body.urlList as string[];
      for (const path of MUST_SUBMIT) {
        assert.ok(
          urls.includes(pageAbsoluteUrl(path, APP_URL)),
          `${path || "/"} gönderilmiyor`
        );
      }
    } finally {
      fetchStub.restore();
    }
  });

  await check("gönderilen her URL kendi host'umuzda ve mutlak", () => {
    for (const path of INDEXNOW_PAGE_PATHS) {
      const url = pageAbsoluteUrl(path, APP_URL);
      assert.equal(new URL(url).host, new URL(APP_URL).host, `yabancı host: ${url}`);
      assert.ok(url.startsWith(`${APP_URL}`), `mutlak değil: ${url}`);
    }
    // Anasayfa sitemap ile AYNI yazımda: `sitemap.ts` `${baseUrl}${path}` yazıyor
    // ve "" için bu sondaki eğik çizgisiz apex demek. İki farklı yazım, aynı
    // sayfayı iki URL olarak duyurmak olurdu.
    assert.equal(pageAbsoluteUrl("", APP_URL), APP_URL);
  });

  await check("gönderim kümesi sitemap'in statik rotalarıyla AYNI", async () => {
    // Gönderilen ama taranmasına izin verilmeyen bir sayfa boşa gönderimdir;
    // sitemap'te olup gönderilmeyen bir sayfa ise bu sevkiyatın kapattığı
    // deliğin kendisi.
    const { STATIC_ROUTES } = await import("../src/app/sitemap");
    const sitemapPaths = STATIC_ROUTES.map((r) => r.path).sort();
    assert.deepEqual([...INDEXNOW_PAGE_PATHS].sort(), sitemapPaths);
  });

  // ─── tetikleyici: yalnız DEĞİŞEN sayfa ──────────────────────────────────

  await check("yalnız tarihi DEĞİŞEN sayfa gönderilir", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    // Hafıza bugünkü kayıtla aynı, YALNIZ `/figur`un tarihi eski.
    const announced = { ...PAGE_UPDATED_AT, "/figur": "2026-01-01" };
    const store = memoryStore(announced);
    const fetchStub = captureFetch();
    try {
      const outcome = await announceStaticPages({ scope: "changed", store, appUrl: APP_URL });
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
      assert.deepEqual(outcome.paths, ["/figur"]);
      const urls = fetchStub.calls[0].body.urlList as string[];
      assert.deepEqual(urls, [pageAbsoluteUrl("/figur", APP_URL)]);
      // Başarılı gönderimden sonra hafıza bugünkü kayda eşitlenir, yoksa aynı
      // sayfa her turda yeniden duyurulurdu.
      assert.deepEqual(store.entries(), { ...PAGE_UPDATED_AT });
    } finally {
      fetchStub.restore();
    }
  });

  await check("kayda YENİ giren sayfa da değişmiş sayılır", () => {
    const changed = changedPagePaths(
      { "/a": "2026-01-01", "/b": "2026-01-02" },
      { "/a": "2026-01-01" }
    );
    assert.deepEqual(changed, ["/b"]);
  });

  await check("hiçbir tarih değişmediyse AĞA ÇIKILMAZ", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const store = memoryStore({ ...PAGE_UPDATED_AT });
    const fetchStub = captureFetch();
    try {
      const outcome = await announceStaticPages({ scope: "changed", store, appUrl: APP_URL });
      assert.equal(outcome.kind, "no_change", JSON.stringify(outcome));
      assert.equal(fetchStub.calls.length, 0, "değişen yokken gönderim yapılmamalı");
      assert.equal(store.writes, 0, "değişen yokken hafızaya yazılmamalı");
    } finally {
      fetchStub.restore();
    }
  });

  await check("hafıza BOŞKEN temel alınır, gönderim yapılmaz", async () => {
    // İlk tur (ya da Redis kaybı sonrası): neyin değiştiğini bilmenin yolu yok.
    // Her şeyi göndermek, tam olarak kaçınılan gürültü olurdu; elle tetik bunun
    // için var.
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const store = memoryStore();
    const fetchStub = captureFetch();
    try {
      const outcome = await announceStaticPages({ scope: "changed", store, appUrl: APP_URL });
      assert.equal(outcome.kind, "baseline", JSON.stringify(outcome));
      assert.equal(fetchStub.calls.length, 0, "temel alma turunda ağa çıkılmaz");
      assert.deepEqual(store.entries(), { ...PAGE_UPDATED_AT }, "temel yazılmadı");
    } finally {
      fetchStub.restore();
    }
  });

  await check("gönderim BAŞARISIZ olursa hafıza güncellenmez (tur yeniden dener)", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const announced = { ...PAGE_UPDATED_AT, "/figur": "2026-01-01" };
    const store = memoryStore(announced);
    const fetchStub = captureFetch(500);
    try {
      const outcome = await announceStaticPages({ scope: "changed", store, appUrl: APP_URL });
      assert.equal(outcome.ok, false, JSON.stringify(outcome));
      assert.equal(outcome.ok === false && outcome.reason, "http_error");
      assert.deepEqual(store.entries(), announced, "başarısız gönderim hafızayı kirletmemeli");
    } finally {
      fetchStub.restore();
    }
  });

  await check("anahtar yokken tur ağa çıkmaz ve sebebini söyler", async () => {
    delete process.env.INDEXNOW_KEY;
    const store = memoryStore({ ...PAGE_UPDATED_AT, "/figur": "2026-01-01" });
    const fetchStub = captureFetch();
    try {
      const outcome = await announceStaticPages({ scope: "changed", store, appUrl: APP_URL });
      assert.equal(outcome.ok, false);
      assert.equal(outcome.ok === false && outcome.reason, "no_key");
      assert.equal(fetchStub.calls.length, 0);
      assert.equal(store.writes, 0, "anahtar yokken temel de alınmamalı");
    } finally {
      fetchStub.restore();
    }
  });

  await check("hafıza yoksa OTOMATİK tur gönderim yapmaz, ELLE tetik yapar", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const auto = await announceStaticPages({ scope: "changed", store: null, appUrl: APP_URL });
    assert.equal(auto.ok, false, JSON.stringify(auto));
    assert.equal(auto.ok === false && auto.reason, "no_store");

    const fetchStub = captureFetch();
    try {
      const manual = await announceStaticPages({ scope: "all", store: null, appUrl: APP_URL });
      assert.equal(manual.ok, true, JSON.stringify(manual));
      assert.equal(fetchStub.calls.length, 1, "elle tetik hafıza olmadan da göndermeli");
    } finally {
      fetchStub.restore();
    }
  });

  // ─── işçi gövdesi (GERÇEK koşum) ────────────────────────────────────────

  /** Turun günlük satırlarını toplar — `Pick<Job,"log">`in test karşılığı. */
  function jobLog() {
    const lines: string[] = [];
    // `Job.log` sayı döndürüyor (yeni satır sayısı); imza birebir uysun.
    return { lines, log: async (line: string) => lines.push(line) };
  }

  await check("işçi: anahtar yokken FIRLATMAZ, sebebi günlüğe yazar", async () => {
    // Yapılandırma durumu bir ARIZA değil: her turda bir `failed` satırı yazmak
    // gerçek hataları görünmez kılardı.
    delete process.env.INDEXNOW_KEY;
    const job = jobLog();
    await runSeoIndexNowJob(job, { store: memoryStore({ ...PAGE_UPDATED_AT }) });
    assert.match(job.lines.join("\n"), /no_key/);
  });

  await check("işçi: hafıza yokken FIRLATMAZ, gönderim de yapmaz", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const job = jobLog();
    const fetchStub = captureFetch();
    try {
      await runSeoIndexNowJob(job, { store: null });
      assert.match(job.lines.join("\n"), /no_store/);
      assert.equal(fetchStub.calls.length, 0);
    } finally {
      fetchStub.restore();
    }
  });

  await check("işçi: ağ hatasında FIRLATIR (bullmq yeniden denesin)", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const store = memoryStore({ ...PAGE_UPDATED_AT, "/figur": "2026-01-01" });
    const fetchStub = captureFetch(500);
    try {
      await assert.rejects(
        () => runSeoIndexNowJob(jobLog(), { store, appUrl: APP_URL }),
        /IndexNow duyurusu başarısız: http_error/
      );
    } finally {
      fetchStub.restore();
    }
  });

  await check("işçi: başarılı turda gönderilen sayfayı günlüğe yazar", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const store = memoryStore({ ...PAGE_UPDATED_AT, "/figur": "2026-01-01" });
    const job = jobLog();
    const fetchStub = captureFetch();
    try {
      await runSeoIndexNowJob(job, { store, appUrl: APP_URL });
      assert.match(job.lines.join("\n"), /1 sayfa duyuruldu: \/figur/);
    } finally {
      fetchStub.restore();
    }
  });

  await check("işçi otomatik turda kapsamı DEĞİŞENLER'de tutar", async () => {
    // Çağıran "all" geçse bile otomatik tur her şeyi göndermez: kapsam bir
    // karardır, bir varsayılan değil.
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const store = memoryStore({ ...PAGE_UPDATED_AT });
    const fetchStub = captureFetch();
    try {
      await runSeoIndexNowJob(jobLog(), { store, appUrl: APP_URL, scope: "all" });
      assert.equal(fetchStub.calls.length, 0, "otomatik tur tümünü göndermemeli");
    } finally {
      fetchStub.restore();
    }
  });

  // ─── admin yüzeyi ───────────────────────────────────────────────────────

  await check("durum okuması anahtarın yokluğunu bildiriyor", async () => {
    delete process.env.INDEXNOW_KEY;
    const absent = await loadIndexNowPageStatus({ store: memoryStore(), appUrl: APP_URL });
    assert.equal(absent.keyConfigured, false);

    process.env.INDEXNOW_KEY = "a".repeat(32);
    const present = await loadIndexNowPageStatus({
      store: memoryStore({ ...PAGE_UPDATED_AT }),
      appUrl: APP_URL,
    });
    assert.equal(present.keyConfigured, true);
    assert.equal(present.pendingCount, 0, "hafıza güncelken bekleyen sayfa olmamalı");
    assert.equal(present.rows.length, INDEXNOW_PAGE_PATHS.length);
  });

  await check("durum okuması bekleyen sayfaları işaretliyor", async () => {
    process.env.INDEXNOW_KEY = "a".repeat(32);
    const status = await loadIndexNowPageStatus({
      store: memoryStore({ ...PAGE_UPDATED_AT, "/figur": "2026-01-01" }),
      appUrl: APP_URL,
    });
    assert.equal(status.pendingCount, 1);
    const row = status.rows.find((r) => r.path === "/figur");
    assert.ok(row, "/figur satırı yok");
    assert.equal(row.pending, true);
    assert.equal(row.announcedFor, "2026-01-01");
    assert.equal(row.updatedAt, PAGE_UPDATED_AT["/figur"]);
  });

  await check("anahtar yokken admin kartı UYARI gösteriyor", () => {
    const html = renderToStaticMarkup(
      createElement(IndexNowCard, {
        status: {
          keyConfigured: false,
          keyLocation: `${APP_URL}/indexnow-key.txt`,
          storeAvailable: true,
          baseline: false,
          pendingCount: 0,
          rows: [],
        },
      })
    );
    // Sessizce `{ok:false, reason:"no_key"}` dönen bir fonksiyonun üstünde
    // düğmeye basan kişi iş yaptığını sanır; uyarı o yanılgıyı kapatıyor.
    assert.ok(html.includes("INDEXNOW_KEY"), "uyarı ortam değişkeninin adını söylemeli");
    assert.match(html, /gönderim yapılmıyor/, `uyarı metni yok: ${html.slice(0, 400)}`);
  });

  await check("anahtar varken aynı kart uyarıyı göstermiyor", () => {
    const html = renderToStaticMarkup(
      createElement(IndexNowCard, {
        status: {
          keyConfigured: true,
          keyLocation: `${APP_URL}/indexnow-key.txt`,
          storeAvailable: true,
          baseline: false,
          pendingCount: 0,
          rows: [],
        },
      })
    );
    assert.doesNotMatch(html, /gönderim yapılmıyor/);
  });

  if (savedKey === undefined) delete process.env.INDEXNOW_KEY;
  else process.env.INDEXNOW_KEY = savedKey;
  if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl;

  console.log(
    failures === 0 ? "\n✅ indexnow: tüm kontroller geçti" : `\n❌ indexnow: ${failures} başarısız`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
