/**
 * BAYRAK GÜDÜMLÜ GEÇİŞ (Faz 7.1) testleri.
 *
 * Sorulan soru tek: `instant_quote_enabled` çevrildiği anda müşteri NE görür?
 *
 *  - Eski yükleme akışı (`/create?path=upload`) kendini kapatıp `/3d-baski`'ya
 *    yönlendiriyor mu, bayrak kapalıyken eskisi gibi mi duruyor?
 *  - Yol seçici kartı hangi adrese gidiyor?
 *  - Bayrak kapalıyken müşteriye 404 olan sayfaların bağlantısı gösteriliyor mu
 *    (menü, kullanıcı menüsü, mobil menü, footer)?
 *  - Tüm bu yüzeyler TEK bir sonda paylaşıyor mu — yoksa her bileşen kendi
 *    isteğini atar ve bir sayfa açılışı dört `/api/quotes/catalog` çağrısı olur.
 *
 * Çalıştırma: npx tsx scripts/test-quote-cutover.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { LocaleProvider } from "../src/lib/i18n/locale-context";
import {
  instantQuoteProbeResult,
  probeInstantQuoteEnabled,
  resetInstantQuoteProbe,
} from "../src/lib/quote/instant-quote-flag";
import { QuoteAccountLinks } from "../src/components/quote/account-links";
import { UploadModelFlow } from "../src/components/create/upload-model-flow";
import { CreatePathSelector } from "../src/components/create/path-selector";
import { SiteHeader } from "../src/components/site-header";
import { pickFigurunicaDict } from "../src/components/figurunica/dict";
import tr from "../src/lib/i18n/dictionaries/tr";

// Footer bir CSS modülü import ediyor; Node onu okuyamaz. Sınıf adları bu
// testin konusu değil, o yüzden her anahtarı kendine eşleyen bir vekil yeter.
// (Kayıt, `sections.tsx` DİNAMİK import edilmeden önce yapılmalı.)
const extensions = (Module as unknown as {
  _extensions: Record<string, (module: { exports: unknown }, filename: string) => void>;
})._extensions;
extensions[".css"] = (module) => {
  module.exports = new Proxy(
    {},
    { get: (_t, key) => (key === "__esModule" || key === "default" ? undefined : String(key)) }
  );
};

// ─── Sonda ──────────────────────────────────────────────────────────────────

interface FetchCall {
  url: string;
}

/** `/api/quotes/catalog` yerine geçen sahte uç; kaç kez çağrıldığını sayar. */
function stubFetch(
  reply: () => Promise<Response> | Response
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push({ url: String(input) });
    return reply();
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function catalogResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Sondayı bilinen bir cevaba göre doldurur (bileşen testleri bunu okur). */
async function primeProbe(enabled: boolean): Promise<void> {
  resetInstantQuoteProbe();
  const fetchStub = stubFetch(() => catalogResponse({ enabled, catalog: null }));
  try {
    await probeInstantQuoteEnabled();
  } finally {
    fetchStub.restore();
  }
  assert.equal(instantQuoteProbeResult(), enabled, "sonda beklendiği gibi dolmadı");
}

test("sonda açık bayrağı okur, kapalıyı kapalı bırakır", async () => {
  await primeProbe(true);
  assert.equal(await probeInstantQuoteEnabled(), true);
  await primeProbe(false);
  assert.equal(await probeInstantQuoteEnabled(), false);
});

test("aynı sayfadaki tüm yüzeyler TEK istek atar", async () => {
  resetInstantQuoteProbe();
  const fetchStub = stubFetch(() => catalogResponse({ enabled: true, catalog: null }));
  try {
    // Üstteki menü, footer, yol seçici ve akış aynı anda mount olur.
    const answers = await Promise.all([
      probeInstantQuoteEnabled(),
      probeInstantQuoteEnabled(),
      probeInstantQuoteEnabled(),
      probeInstantQuoteEnabled(),
    ]);
    assert.deepEqual(answers, [true, true, true, true]);
    // Cevap geldikten SONRA mount olan bileşen de istek atmamalı.
    assert.equal(await probeInstantQuoteEnabled(), true);
    assert.equal(fetchStub.calls.length, 1, `sonda ${fetchStub.calls.length} kez çağrıldı`);
    assert.match(fetchStub.calls[0].url, /\/api\/quotes\/catalog/);
  } finally {
    fetchStub.restore();
  }
});

test("bozuk gövde ya da hata cevabı ÖZELLİĞİ AÇMAZ", async () => {
  for (const body of [{}, { enabled: "true" }, { enabled: 1 }, null]) {
    resetInstantQuoteProbe();
    const fetchStub = stubFetch(() => catalogResponse(body));
    try {
      assert.equal(await probeInstantQuoteEnabled(), false, `gövde açtı: ${JSON.stringify(body)}`);
    } finally {
      fetchStub.restore();
    }
  }

  resetInstantQuoteProbe();
  const failing = stubFetch(() => catalogResponse({ error: "Bir şeyler ters gitti." }, 500));
  try {
    assert.equal(await probeInstantQuoteEnabled(), false);
  } finally {
    failing.restore();
  }
});

test("ağ hatası kalıcı olarak önbelleğe YAZILMAZ", async () => {
  // Tek bir kopuk istek, bayrak açıkken müşteriyi sayfa yenilenene kadar eski
  // akışta bırakmamalı: cevapsız sonda "kapalı" değil "bilinmiyor"dur.
  resetInstantQuoteProbe();
  const offline = stubFetch(() => Promise.reject(new TypeError("network")));
  try {
    assert.equal(await probeInstantQuoteEnabled(), false);
  } finally {
    offline.restore();
  }
  assert.equal(instantQuoteProbeResult(), null, "hata önbelleğe yazıldı");

  const online = stubFetch(() => catalogResponse({ enabled: true, catalog: null }));
  try {
    assert.equal(await probeInstantQuoteEnabled(), true, "sonda yeniden denemedi");
  } finally {
    online.restore();
  }
});

// ─── Bileşenler ─────────────────────────────────────────────────────────────

const noop = () => {};
const router = {
  back: noop, forward: noop, push: noop, replace: noop,
  refresh: noop, prefetch: noop, hmrRefresh: noop,
};

const Locale = LocaleProvider as unknown as FunctionComponent<{ locale: "tr" }>;

/** Bileşeni "sonda cevabı gelmiş" hâliyle çizer (efekt çalışmaz, önbellek okunur). */
function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(
        PathnameContext.Provider,
        { value: "/create" },
        createElement(Locale, { locale: "tr" }, node)
      )
    )
  );
}

test("bayrak AÇIKKEN eski yükleme akışı kendini kapatır", async () => {
  await primeProbe(true);
  const html = render(createElement(UploadModelFlow));
  assert.match(html, /href="\/3d-baski"/, "anlık teklif sayfasına bağlantı yok");
  assert.ok(
    html.includes(tr["instantQuote.cutover.title"]),
    "yönlendirme cümlesi yok"
  );
  // Eski akışın HİÇBİR parçası kalmamalı: dosya seçici, ölçü/malzeme
  // düğmeleri, gönder düğmesi. Aksi hâlde müşteri yönlendirme gecikirken
  // eski yola dosya yükleyebilir.
  assert.doesNotMatch(html, /type="file"/, "eski dosya seçici duruyor");
  assert.ok(!html.includes(tr["upload.dropzone"]), "eski yükleme kutusu duruyor");
  assert.ok(!html.includes(tr["upload.submit"]), "eski gönder düğmesi duruyor");
});

test("bayrak KAPALIYKEN eski yükleme akışı aynen çalışır", async () => {
  await primeProbe(false);
  const html = render(createElement(UploadModelFlow));
  assert.ok(html.includes(tr["upload.dropzone"]), "eski yükleme kutusu kayboldu");
  assert.ok(html.includes(tr["upload.submit"]), "eski gönder düğmesi kayboldu");
  assert.match(html, /type="file"/);
  assert.ok(!html.includes(tr["instantQuote.cutover.title"]), "kapalıyken yönlendiriyor");
});

test("yol seçicideki yükleme kartı bayrağa göre adres değiştirir", async () => {
  await primeProbe(true);
  const open = render(createElement(CreatePathSelector));
  assert.match(open, /href="\/3d-baski"/, "açıkken kart eski akışa gidiyor");
  assert.doesNotMatch(open, /href="\/create\?path=upload"/);

  await primeProbe(false);
  const closed = render(createElement(CreatePathSelector));
  assert.match(closed, /href="\/create\?path=upload"/, "kapalıyken kart eski akışa gitmiyor");
  assert.doesNotMatch(closed, /href="\/3d-baski"/);

  // Diğer iki yol her iki durumda da yerinde durur.
  for (const html of [open, closed]) {
    assert.match(html, /href="\/create\?path=photo"/);
    assert.match(html, /href="\/create\?path=design"/);
  }
});

test("menüdeki '3D baskı teklifi' bağlantısı bayrak kapalıyken gösterilmez", async () => {
  await primeProbe(false);
  assert.doesNotMatch(render(createElement(SiteHeader)), /href="\/3d-baski"/);
  await primeProbe(true);
  assert.match(render(createElement(SiteHeader)), /href="\/3d-baski"/);
});

test("footer bağlantısı bayrak kapalıyken gösterilmez", async () => {
  const { FigFooter } = await import("../src/components/figurunica/sections");
  const d = pickFigurunicaDict(tr);

  await primeProbe(false);
  const closed = render(createElement(FigFooter, { d }));
  assert.doesNotMatch(closed, /href="\/3d-baski"/);
  // Footer'ın geri kalanı yerinde: kapı yalnız tek bağlantıyı kaldırır.
  assert.match(closed, /href="\/nasil-calisir"/);

  await primeProbe(true);
  assert.match(render(createElement(FigFooter, { d })), /href="\/3d-baski"/);
});

test("hesap bağlantıları bayrak kapalıyken 404'e götürmez", async () => {
  // Kullanıcı menüsü (masaüstü) ve mobil menü aynı bileşeni çizer; kapı
  // burada tutulursa iki yüzey birden korunur.
  for (const variant of ["dropdown", "mobile"] as const) {
    await primeProbe(false);
    assert.equal(
      render(createElement(QuoteAccountLinks, { variant, onNavigate: noop })),
      "",
      `${variant}: kapalı bayrakta bağlantı çizildi`
    );

    await primeProbe(true);
    const html = render(createElement(QuoteAccountLinks, { variant, onNavigate: noop }));
    assert.match(html, /href="\/account\/teklifler"/, `${variant}: Tekliflerim yok`);
    assert.match(html, /href="\/account\/parcalar"/, `${variant}: Parça kütüphanem yok`);
    assert.ok(html.includes(tr["instantQuote.account.quotes.title"]));
    assert.ok(html.includes(tr["instantQuote.account.parts.title"]));
  }
});

// ─── `/api/uploads/chunk` misafir kapısı ────────────────────────────────────
//
// Bu uç dalın EN BÜYÜK geçiş riskidir. Dal öncesinde (5a46616) her fiil
// oturumsuz çağırana 401 dönüyordu; dal onu "misafir de sahneleyebilir"e
// çevirdi ama BAYRAĞA bağlamadı. Yani `instant_quote_enabled` hiç açılmadan,
// yalnız birleştirmeyle, canlı sitede kimliksiz bir "diske yaz" ucu doğardı.
//
// Gerçek istek kurmak burada pahalı (next-auth + üretici/boyacı çerezleri +
// Redis), bu yüzden kapı KAYNAKTAN pinlenir: üç misafir dalı da aynı bayrak
// kapısından geçmeli ve kapı zaman aşımında KAPALI saymalı.
const chunkRouteSource = readFileSync(
  join(import.meta.dirname, "..", "src/app/api/uploads/chunk/route.ts"),
  "utf8"
);

/** `async function <ad>(` gövdesini sütun-0 kapanışına kadar alır. */
function chunkRouteFn(name: string): string {
  const start = chunkRouteSource.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  const rest = chunkRouteSource.slice(start);
  const end = rest.indexOf("\n}");
  assert.ok(end > 0, `${name} gövdesi kapanmadı`);
  return rest.slice(0, end);
}

test("bayrak KAPALIYKEN misafir sahnelemesi 401 — üç fiil de kapıdan geçer", () => {
  assert.match(
    chunkRouteSource,
    /quoteApiEnabled[\s\S]*?from "@\/lib\/services\/quote-access"/,
    "kapı paylaşılan `quoteApiEnabled` yerine kendi kopyasını kullanıyor"
  );
  const gate = chunkRouteFn("guestSurfaceEnabled");
  assert.match(gate, /quoteApiEnabled/, "misafir kapısı bayrağa bakmıyor");
  assert.match(gate, /GUEST_GATE_CLOSED/, "zaman aşımı kapalı tarafa düşmüyor");
  assert.match(
    chunkRouteSource,
    /const GUEST_GATE_CLOSED = false;/,
    "kapının zaman aşımı tarafı `false` değil"
  );
  for (const handler of ["handlePUT", "handlePOST", "handleGET"]) {
    assert.match(
      chunkRouteFn(handler),
      /guestSurfaceEnabled\(\)\)\) return unauthorized\(\)/,
      `${handler}: misafir dalı bayrak kapısından geçmiyor`
    );
  }
});

// Aynı gerekçe teknik çizim ucunda: `partId` depolama yoluna giriyor, ve bir
// istek gövdesi (20 MB PDF) kurup çalıştırmak buradaki en pahalı iş olurdu.
// Ucun İKİ kapısı kaynaktan pinlenir — biçim kontrolü gövdeden ÖNCE, ve POST'un
// kardeşi (`parts/route.ts`) gibi bir oran limiti var.
test("teknik çizim ucu parça kimliğini GÖVDEDEN ÖNCE doğrular", () => {
  const drawingRoute = readFileSync(
    join(import.meta.dirname, "..", "src/app/api/quotes/[id]/parts/[partId]/drawing/route.ts"),
    "utf8"
  );
  assert.match(
    drawingRoute,
    /UUID_RE[\s\S]*?from "@\/lib\/services\/quote-access"/,
    "uç kendi uuid kopyasını taşıyor"
  );
  const guard = "if (!UUID_RE.test(partId)) return quoteNotFound();";
  assert.equal(
    drawingRoute.split(guard).length - 1,
    3,
    "POST/DELETE/GET üçünde de kimlik kapısı yok"
  );
  // Kapı `formData()` çağrısından ÖNCE gelmeli.
  assert.ok(
    drawingRoute.indexOf(guard) < drawingRoute.indexOf("request.formData()"),
    "kimlik kapısı gövde okunduktan sonra"
  );
  assert.match(drawingRoute, /rateLimitAsync\(\s*`quote:drawing:ip:/, "POST'ta oran limiti yok");
});

test("sahneleme sahipliği oturum TÜRÜNE göre atlanmaz", () => {
  // Karşılaştırmayı `if (anonymousId && …)` içine koymak, elinde bir yükleme
  // kimliği olan HERHANGİ bir girişli çağıranı başkasının sahnelemesine
  // yazabilir hâle getirir. Kimlik 24 karakterlik bir nanoid olduğu için bugün
  // erişilemiyor; asimetriyi kaynakta kapatmak bir refactor uzaklıkta.
  for (const handler of ["handlePOST", "handleGET"]) {
    const body = chunkRouteFn(handler);
    assert.match(body, /const expected = owner \?\?/, `${handler}: beklenen sahip hesaplanmıyor`);
    assert.match(
      body,
      /ownedStagedUpload\(uploadId, expected, owner !== null\)/,
      `${handler}: sahiplik karşılaştırması yok`
    );
    assert.match(body, /if \(!staged\.ok\) return notOwner\(\);/, `${handler}: karar uygulanmıyor`);
    assert.doesNotMatch(
      body,
      /if \(anonymousId[^\n]*\b(meta|staged)\b/,
      `${handler}: sahiplik kontrolü hâlâ misafir koşulunun içinde`
    );
  }
  // Karar SAF bir gövdededir (`chunked-upload.ts`), üç ekseni de orada test
  // edilir; uç yalnız onu çağırır ve "defter cevap vermedi" hâlini uydurmaz.
  assert.match(
    chunkRouteFn("ownedStagedUpload"),
    /stagedUploadOwnershipAllowed\(read, expected, authenticated\)/,
    "uç sahiplik kararını kendi yeniden yazıyor"
  );
});

// Sahnelemeyi KAYDEDEN uç ile onu teklife BAĞLAYAN erişim çözümü aynı sahiplik
// anahtarlarını üretmek zorunda: bir tarayıcı hem panel çerezi hem müşteri
// oturumu taşıyabilir ve dosya panel anahtarıyla kaydedilir. İki ayrı kopya,
// bir gün yalnız birinin değiştiği (ve her bağlamanın 403 aldığı) gün demek.
test("sahiplik anahtarları TEK gövdeden çıkar", () => {
  assert.match(
    chunkRouteSource,
    /resolveAuthenticatedUploadOwner[\s\S]*?from "@\/lib\/services\/chunked-upload"/,
    "uç sahiplik anahtarını paylaşılan gövdeden almıyor"
  );
  assert.doesNotMatch(
    chunkRouteSource,
    /role: "(admin|manufacturer|painter)"/,
    "uç kendi rol anahtarını üretiyor"
  );
  const access = readFileSync(
    join(import.meta.dirname, "..", "src/lib/services/quote-access.ts"),
    "utf8"
  );
  assert.match(
    access,
    /resolveAuthenticatedUploadOwner\(\{/,
    "erişim çözümü aynı gövdeyi kullanmıyor"
  );
  assert.doesNotMatch(access, /uploadOwnerKey\(\{ role:/, "erişim çözümü kendi kopyasını taşıyor");
  assert.match(access, /uploadOwnerKeys: keys/, "aday kümesi erişime taşınmıyor");
});

// ─── Uç: bayrak kapalıyken katalog OKUNMAZ ──────────────────────────────────

/**
 * `SiteHeader` her sayfada mount olur, yani bu uç bayrak kapalıyken de HER
 * genel sayfa açılışında çağrılır. Cevabın yalnız `enabled` alanı okunur; o
 * hâlde katalog sorgulanmamalıdır — beş `select` ve (max 5 olan) havuzdan beş
 * bağlantı, gövdesi atılacak bir cevap için. Üstelik son aktif teknoloji
 * pasifleştirilirse okuma FIRLATIR ve her genel sayfa açılışı 500 günlüğü
 * üretirdi.
 */
test("bayrak kapalıyken uç kataloğu hiç okumaz ve cevabı yalnız tarayıcıya önbelletir", async () => {
  const requireModule = createRequire(import.meta.url);
  const saved = new Map<string, NodeJS.Module | undefined>();
  const stub = (request: string, exports: unknown): void => {
    const id = requireModule.resolve(request);
    saved.set(id, requireModule.cache[id]);
    requireModule.cache[id] = { id, filename: id, loaded: true, exports } as NodeJS.Module;
  };

  let catalogReads = 0;
  try {
    stub("../src/lib/services/quote-access", { quoteApiEnabled: async () => false });
    stub("../src/lib/services/quote-catalog", {
      loadActiveSnapshot: async () => {
        catalogReads++;
        throw new Error("katalog okundu");
      },
    });

    const route = await import("../src/app/api/quotes/catalog/route");
    const response = await route.GET();

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false, catalog: null });
    assert.equal(catalogReads, 0, "bayrak kapalıyken katalog sorgulandı");

    // `private`: cevap ÇEREZE göre değişir (admin oturumunda bayrak kapalıyken
    // de `enabled: true` gelir). Paylaşılan bir vekil `public` bir
    // "enabled:false" gövdesini saklarsa bayrak açıldığında müşteriyi eski
    // akışta tutar, admine de yanlış cevabı verir.
    const cacheControl = response.headers.get("cache-control") ?? "";
    assert.match(cacheControl, /private/, "cevap paylaşılan vekile açık bırakılmış");
    assert.doesNotMatch(cacheControl, /public/);
  } finally {
    for (const [id, module] of saved) {
      if (module) requireModule.cache[id] = module;
      else delete requireModule.cache[id];
    }
  }
});

// ─── TAKIM BAYRAĞI KAPALI YOLU (0072 · T-2) ─────────────────────────────────
//
// Değişmez: **bayrak KAPALIYKEN erişim çözümü üyelik SORGUSUNU HİÇ YAPMAZ.**
// İki ayrı sebeple sözleşme:
//   · KAPALI BİR ÖZELLİĞİN BEDELİ SIFIR OLMALI — takımsız müşterinin her teklif
//     açılışına bir sorgu eklemek, kapatılmış bir özelliğin faturasını canlıya
//     ödetmek olurdu.
//   · GERİ DÖNÜŞ PLANI BU — bayrağı kapatmak takım dalını ULAŞILAMAZ yapar
//     (`teamRole` daima `null` → `team_id` dolu satırlar bile bugünkü matrise
//     düşer).
//
// Kanıt bir SORGU SAYACIdır, bir yorum değil: `stubFetch`in DB karşılığı olarak
// `pg.Pool.prototype.query` sarılır, her SQL metni kaydedilir ve boş satır
// kümesiyle cevaplanır (`{ rows: [] }` hem nesne hem dizi kipinde geçerli tek
// cevap şeklidir). `platform_flags` satırı gelmediği için bayrak DERLENMİŞ
// varsayılanına düşer — `quote_teams_enabled: false`, yani üretimdeki hâli.

/** `stubFetch`in veritabanı karşılığı: her sorguyu sayar, boş cevap verir. */
function stubPoolQuery(): { texts: string[]; restore: () => void } {
  const texts: string[] = [];
  const original = pg.Pool.prototype.query;
  (pg.Pool.prototype as unknown as { query: unknown }).query = function stubbed(
    config: unknown
  ): Promise<unknown> {
    texts.push(
      typeof config === "string" ? config : String((config as { text?: string })?.text ?? "")
    );
    return Promise.resolve({ rows: [], rowCount: 0, command: "SELECT", fields: [] });
  };
  return {
    texts,
    restore: () => {
      pg.Pool.prototype.query = original;
    },
  };
}

const TEAM_QUOTE = { teamId: "55555555-5555-4555-8555-555555555555" };
const MEMBER_ID = "66666666-6666-4666-8666-666666666666";
const QUOTE_OWNER_ID = "77777777-7777-4777-8777-777777777777";

test("bayrak kapalıyken üyelik sorgusu HİÇ yapılmaz (sorgu sayacı)", async () => {
  // Redis KAPALI tutulur: açık olsa bayrak okuması önbellekten dönebilir ve
  // sayaç "sorgu yok" derken aslında soruyu hiç ölçmemiş olurdu.
  const savedRedis = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const { resolveQuoteTeam, resolveQuoteViewer } = await import(
    "../src/lib/services/quote-access"
  );
  const membershipReads = (texts: string[]) =>
    texts.filter((t) => t.includes("customer_team_members")).length;
  const flagReads = (texts: string[]) => texts.filter((t) => t.includes("platform_flags")).length;

  const db = stubPoolQuery();
  try {
    // 1. TAKIMSIZ teklif: TEK bir sorgu bile yok — bayrak okuması DAHİL.
    //    Kısa devrenin sırası budur: `teamId === null` en başta.
    assert.equal(await resolveQuoteTeam({ teamId: null }, MEMBER_ID, null), null);
    assert.deepEqual(db.texts, [], "takımsız teklif bir sorgu üretti");

    // 2. Oturumsuz istek: rol ancak girişli kullanıcıya ait olabilir.
    assert.equal(await resolveQuoteTeam(TEAM_QUOTE, null, null), null);
    assert.deepEqual(db.texts, [], "oturumsuz istek bir sorgu üretti");

    // 3. Takım teklifi + GERÇEK bir üye oturumu, bayrak KAPALI: bayrak okunur,
    //    ÜYELİK OKUNMAZ.
    assert.equal(await resolveQuoteTeam(TEAM_QUOTE, MEMBER_ID, null), null);
    assert.equal(membershipReads(db.texts), 0, "bayrak kapalıyken üyelik sorgulandı");
    assert.equal(flagReads(db.texts), 1, "bayrak tam bir kez okunmalı");

    // 4. …ve dönen izleyici bugünkü matrisle BİT BİT aynı: teklifi AÇMAYAN bir
    //    üye 404 alır, yani "bayrağı kapatmak bugünküne döner" sözü tutuyor.
    const afterFlagOff = db.texts.length;
    assert.equal(
      resolveQuoteViewer(
        { userId: QUOTE_OWNER_ID, anonymousId: null, shareToken: null, ...TEAM_QUOTE },
        {
          sessionUserId: MEMBER_ID,
          anonymousId: null,
          shareToken: null,
          isAdmin: false,
          teamRole: null,
        }
      ),
      null
    );
    assert.equal(db.texts.length, afterFlagOff, "saf çekirdek bir sorgu yaptı");

    // 5. İÇ TEST KAPISI: bayrak kapalı ama ADMIN oturumu var → üyelik SORULUR.
    //    (Satır gelmediği için cevap yine `null`; ölçülen şey sorunun SORULMASI.)
    assert.equal(await resolveQuoteTeam(TEAM_QUOTE, MEMBER_ID, { email: "yonetici@test" }), null);
    assert.equal(membershipReads(db.texts), 1, "admin iç test kapısı üyeliği sormadı");
  } finally {
    db.restore();
    if (savedRedis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = savedRedis;
  }
});
