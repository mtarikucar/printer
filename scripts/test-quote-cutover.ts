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
import Module from "node:module";
import { join } from "node:path";
import { test } from "node:test";
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
    assert.match(body, /meta\?\.owner !== expected/, `${handler}: sahiplik karşılaştırması yok`);
    assert.doesNotMatch(
      body,
      /if \(anonymousId[^\n]*\bmeta\b/,
      `${handler}: sahiplik kontrolü hâlâ misafir koşulunun içinde`
    );
  }
});
