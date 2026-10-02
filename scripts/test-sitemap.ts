/**
 * Sitemap sözleşmesi.
 *
 * `lastModified` iddiaları sitemap'i GERÇEKTEN çağırır, bu yüzden dosya bir
 * veritabanı bağlantısı kurmayı dener (`sitemap.ts` aktif ürünleri okuyor).
 * Bağlantı BİLEREK ölü bir adrese çivilendi: testin işi tarih üretmek, ürün
 * satırı okumak değil — ve `DATABASE_URL` verilmezse `pg` varsayılan olarak
 * `localhost:5432`e, yani geliştiricinin kendi veritabanına uzanırdı. Ölü
 * adres aynı zamanda `sitemap.ts`in "veritabanı tıksırsa statik rotalara düş"
 * dalını da sınar.
 */
process.env.DATABASE_URL = "postgres://nobody:nobody@127.0.0.1:1/none";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pageUpdatedAt } from "../src/lib/config/page-updated";
import { formatDateLong } from "../src/lib/i18n/format";

type SitemapModule = typeof import("../src/app/sitemap");

/** `DATABASE_URL` ayarlandıktan SONRA yüklenmeli (havuz yapılandırmayı o an okur). */
async function loadSitemap(): Promise<SitemapModule> {
  return (await import("../src/app/sitemap")) as SitemapModule;
}

let passed = 0;
const cases: Array<[string, () => void | Promise<void>]> = [];
function test(name: string, fn: () => void | Promise<void>) {
  cases.push([name, fn]);
}

let paths: string[] = [];

test("her herkese açık sayfa sitemap'te", () => {
  // Denetimde eksik bulunan 11 route. Sitemap'te olmayan sayfa keşfedilmez.
  const required = [
    "",
    "/shop",
    "/create",
    "/3d-baski",
    "/3d-baski/malzemeler",
    "/figur",
    "/urunler",
    "/nasil-calisir",
    // V3'ün altı özel gün sayfası. Liste BİLEREK elle yazılı: sitemap girişleri
    // `lib/config/occasions.ts`ten TÜRÜYOR, yani kayıttan okuyan bir iddia
    // kendi kendini onaylardı. Kayıttan bir özel gün düşerse bu satırlar
    // kırmızı döner — keşfedilmeyen bir sayfa demek olurdu.
    "/hediye/dogum-gunu",
    "/hediye/sevgiliye",
    "/hediye/evcil-hayvan",
    "/hediye/oyun-karakteri",
    "/hediye/aile-hatirasi",
    "/hediye/mezuniyet",
    "/toplu-siparis",
    "/anahtarlik-kutusu",
    "/atolye",
    "/kargo",
    "/iade",
    "/cerez",
    "/mesafeli-satis",
    "/on-bilgilendirme",
    "/ticari-ileti",
    "/contact",
    "/privacy",
    "/terms",
  ];
  for (const p of required) {
    assert.ok(paths.includes(p), `${p || "/"} sitemap'te yok`);
  }
});

test("robots'ta engellenen hiçbir yol sitemap'te değil", () => {
  // Sitemap ile robots çelişirse Search Console uyarı üretir.
  const blocked = ["/admin", "/api", "/manufacturer", "/painter", "/cart", "/checkout"];
  for (const p of paths) {
    for (const b of blocked) {
      assert.ok(!p.startsWith(b), `${p} robots'ta engelli bir prefix altında`);
    }
  }
});

test("priority ve changeFrequency geçerli aralıkta", async () => {
  const { STATIC_ROUTES } = await loadSitemap();
  const valid = new Set([
    "always", "hourly", "daily", "weekly", "monthly", "yearly", "never",
  ]);
  for (const r of STATIC_ROUTES) {
    assert.ok(r.priority >= 0 && r.priority <= 1, `${r.path} priority aralık dışı`);
    assert.ok(valid.has(String(r.changeFrequency)), `${r.path} changeFrequency geçersiz`);
  }
});

test("yol tekrarı yok", () => {
  assert.equal(new Set(paths).size, paths.length, "sitemap'te tekrarlanan yol var");
});

// ─── V2/T6: `lastModified` gerçek bir tarih ─────────────────────────────────

test("statik rotaların lastModified'ı İKİ ARDIŞIK ÇAĞRIDA AYNI", async () => {
  // MUTASYON SINAVI: `lastModified: new Date()`e geri dön → bu iddia KIRMIZI
  // (ölçüm: iki çağrı arası 8 ms, yani iki farklı damga).
  //
  // Her render'da "şimdi" diyen bir sitemap tazelik SİNYALİ değil GÜRÜLTÜDÜR:
  // arama motorları sürekli değişen `lastmod` değerlerini yok saymayı öğrenir
  // ve o noktadan sonra gerçek bir güncelleme de duyulmaz.
  const { default: sitemap, STATIC_ROUTES } = await loadSitemap();
  const first = await sitemap();
  const second = await sitemap();
  const statics = STATIC_ROUTES.length;
  assert.ok(first.length >= statics, "statik rotalar sitemap'te yok");
  // MİLİSANİYE ÇÖZÜNÜRLÜĞÜNDE: `String(new Date())` saniyeye yuvarlar ve iki
  // çağrı arasındaki 8 ms'yi yutar — yani kaba karşılaştırma mutasyonu
  // YAKALAMAZDI. (Aynı milisaniyeye düşen iki çağrı teorik olarak mümkün;
  // mutasyonu kesin yakalayan nöbetçi aşağıdaki kaynak pini.)
  const stamp = (v: Date | string | undefined) =>
    v === undefined ? "yok" : new Date(v).toISOString();
  for (let i = 0; i < statics; i++) {
    assert.equal(
      stamp(first[i].lastModified),
      stamp(second[i].lastModified),
      `${first[i].url} lastModified iki çağrıda farklı — "şimdi" damgası`
    );
  }
});

test("lastModified T3'ün TEK tarih kaynağından okunuyor", async () => {
  const { default: sitemap, STATIC_ROUTES } = await loadSitemap();
  const entries = await sitemap();
  for (const [i, route] of STATIC_ROUTES.entries()) {
    const iso = pageUpdatedAt(route.path);
    assert.ok(iso, `${route.path || "/"}: tarihi PAGE_UPDATED_AT'te kayıtlı değil`);
    const got = entries[i].lastModified;
    assert.ok(got, `${route.path || "/"}: lastModified yok`);
    assert.equal(
      new Date(String(got)).toISOString().slice(0, 10),
      iso,
      `${route.path || "/"}: sitemap tarihi sayfanın tarihinden farklı`
    );
  }
  // İkinci bir tarih listesi doğmasın: sitemap kendi tarihini YAZMAZ.
  const source = fs
    .readFileSync(path.resolve("src/app/sitemap.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  assert.doesNotMatch(
    source,
    /new Date\(\s*\)/,
    "sitemap tarihi saatten okuyor — her render'da 'şimdi'"
  );
  assert.doesNotMatch(source, /Date\.now\(\)/, "sitemap tarihi saatten okuyor");
  assert.match(source, /pageUpdatedAt\(/, "sitemap tek tarih kaynağını okumuyor");
});

test("hukuki sayfalarda YAZILI tarih ile kayıtlı tarih aynı", async () => {
  // Bu sayfalar "Son güncelleme" satırını elle yazıyor (ticari sayfalar
  // `<LastUpdated/>` ile kayıttan okuyor). İki yazım ayrışırsa sitemap
  // okuyucuya göründüğünden farklı bir tarih söyler — tam da T6'nın
  // engellemeye çalıştığı gürültü. Pin, ayrışmayı KIRMIZIYA çevirir.
  const legal: Array<[string, string]> = [
    ["/kargo", "src/app/kargo/page.tsx"],
    ["/iade", "src/app/iade/page.tsx"],
    ["/terms", "src/app/terms/page.tsx"],
    ["/cerez", "src/app/cerez/page.tsx"],
    ["/mesafeli-satis", "src/app/mesafeli-satis/page.tsx"],
    ["/on-bilgilendirme", "src/app/on-bilgilendirme/page.tsx"],
    ["/privacy", "src/app/privacy/page.tsx"],
    ["/ticari-ileti", "src/app/ticari-ileti/page.tsx"],
  ];
  for (const [route, file] of legal) {
    const iso = pageUpdatedAt(route);
    assert.ok(iso, `${route}: tarihi kayıtlı değil`);
    const source = fs.readFileSync(path.resolve(file), "utf8");
    const written = source.match(/Son güncelleme: ([^"]+)"/);
    assert.ok(written, `${route}: sayfada yazılı "Son güncelleme" satırı yok`);
    assert.equal(
      written[1],
      formatDateLong(new Date(`${iso}T12:00:00Z`), "tr"),
      `${route}: sayfada yazılı tarih kayıttaki tarihten farklı`
    );
  }
});

async function run() {
  paths = (await loadSitemap()).STATIC_ROUTES.map((r) => r.path);
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (err) {
      console.error(`  FAIL  ${name}`);
      console.error(err);
      process.exit(1);
    }
  }
  console.log(`\n${passed}/${cases.length} sitemap testi geçti`);
  process.exit(0);
}

void run();
