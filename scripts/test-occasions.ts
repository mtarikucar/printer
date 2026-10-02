/**
 * V3 — ALTI ÖZEL GÜN SAYFASININ SÖZLEŞMESİ (`/hediye/<slug>`).
 *
 * Neden ayrı URL'ler: insanlar bir asistana "figürün üreticisi" diye sormuyor;
 * "sevgiliye ne hediye alabilirim", "doğum gününe özel hediye" diye soruyor.
 * Ölçümdeki kural açık — her özel gün için AYRI URL; tek bir sayfanın içindeki
 * altı paragraf altı ayrı giriş kapısı etmiyor.
 *
 * Buradaki nöbetçilerin hepsi "sayfa müşteriye/asistana HANGİ RAKAMI söylüyor"
 * sorusunu sorar, bir bileşenin var olup olmadığını değil. Üç şeyi birlikte
 * tutuyorlar:
 *   1. kayıt defteri (`src/lib/config/occasions.ts`) ile rotanın, sitemap'in
 *      ve iç bağlantıların AYNI altı slug'ı taşıması,
 *   2. her sayfanın ilk %30'unda fiyat/ölçü/katman/teslim süresinin DURMASI,
 *   3. yayımlanan her rakamın bir SABİTTEN türemesi (sayfa kaynağında elle
 *      yazılmış "3.499" yok).
 *
 * `DATABASE_URL` ÖLÜ bir adrese çivili: sitemap aktif ürünleri okuyor ve
 * verilmezse `pg` varsayılan olarak geliştiricinin kendi veritabanına
 * (localhost:5432) uzanırdı. Aynı gerekçe `scripts/test-sitemap.ts`te de yazılı.
 *
 * Çalıştırma: npx tsx scripts/test-occasions.ts
 */
process.env.DATABASE_URL = "postgres://nobody:nobody@127.0.0.1:1/none";

// CSS modülü import eden bir bileşene dolaylı olarak uzanırsak render
// edilebilir kalsın (ev deseni: bkz. stub'ın başlığı).
import "./support/stub-css-modules";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import tr from "../src/lib/i18n/dictionaries/tr";
import en from "../src/lib/i18n/dictionaries/en";
import { FIGURINE_PRICE_KURUS } from "../src/lib/config/prices";
import {
  FIGURINE_HEIGHT_LABEL,
  FIGURINE_LEAD_DAYS,
  FIGURINE_PRICE_LABEL,
  layerHeightLabel,
} from "../src/lib/config/product-facts";
import { pageUpdatedAt } from "../src/lib/config/page-updated";
import { NOINDEX_PREFIXES, isNoindexPath } from "../src/lib/seo/policy";
import { figurineProductId } from "../src/lib/seo/figurine";
import {
  OCCASIONS,
  OCCASION_SECTION_KEYS,
  findOccasion,
  occasionPath,
} from "../src/lib/config/occasions";
import {
  OccasionArticle,
  occasionFaqItems,
  occasionJsonLd,
  occasionMetadata,
  occasionOrNotFound,
} from "../src/app/hediye/[occasion]/occasion-page";
import { OccasionLinks } from "../src/components/occasion-links";
import { HOW_IT_WORKS_STEPS, stepBodyText } from "../src/app/nasil-calisir/steps";
import { generateStaticParams } from "../src/app/hediye/[occasion]/page";

let failures = 0;
function check(name: string, fn: () => void | Promise<void>) {
  cases.push([name, fn]);
}
const cases: Array<[string, () => void | Promise<void>]> = [];

const APP = "https://figurunica.com";
const LAYER = layerHeightLabel(tr);
const PRODUCTION = `${FIGURINE_LEAD_DAYS.productionMin}-${FIGURINE_LEAD_DAYS.productionMax}`;
const TRANSIT = `${FIGURINE_LEAD_DAYS.transitMin}-${FIGURINE_LEAD_DAYS.transitMax}`;

/** Brief'in verdiği altı URL. Kayıt bunlardan sapamaz. */
const EXPECTED_SLUGS = [
  "dogum-gunu",
  "sevgiliye",
  "evcil-hayvan",
  "oyun-karakteri",
  "aile-hatirasi",
  "mezuniyet",
] as const;

const noop = () => {};
const router = {
  back: noop, forward: noop, push: noop, replace: noop,
  refresh: noop, prefetch: noop, hmrRefresh: noop,
};

function render(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router }, node)
  );
}

/**
 * Render edilen markup'ın GÖRÜNÜR metni.
 *
 * Etiketler atılır, HTML varlıkları çözülür ve boşluk tek boşluğa indirilir —
 * yani "ilk %30" ölçümü müşterinin/asistanın GERÇEKTEN okuduğu metin üzerinden
 * yapılır, sınıf adları ve `aria-hidden` süsleri karakter saymaz.
 */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/\s+/g, " ")
    .trim();
}

function articleHtml(slug: string): string {
  const occasion = findOccasion(slug);
  assert.ok(occasion, `${slug} kayıtta yok`);
  return render(
    createElement(OccasionArticle, { occasion, d: tr, locale: "tr" as const })
  );
}

const PAGE_SOURCE = fs.readFileSync(
  path.resolve("src/app/hediye/[occasion]/page.tsx"),
  "utf8"
);
const ARTICLE_SOURCE = fs.readFileSync(
  path.resolve("src/app/hediye/[occasion]/occasion-page.tsx"),
  "utf8"
);

// ─── Kayıt defteri ──────────────────────────────────────────────────────────

check("altı özel gün kayıtta, slug'lar URL'e yazılabilir ve tekil", () => {
  const slugs = OCCASIONS.map((o) => o.slug);
  assert.deepEqual(slugs, [...EXPECTED_SLUGS], "kayıttaki altı slug brief'ten sapmış");
  assert.equal(new Set(slugs).size, slugs.length, "tekrarlanan slug var");
  for (const slug of slugs) {
    // Türkçe ve okunabilir, ama yüzde-kaçışa düşmeyecek kadar sade: Türkçe
    // karakterli bir slug URL'de `%C4%9F` olarak görünür ve paylaşılamaz.
    assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${slug} URL'e yazılabilir değil`);
    assert.equal(occasionPath(slug), `/hediye/${slug}`);
  }
});

check("sözlük anahtarları tr.ts VE en.ts'te dolu", () => {
  // `en.ts` hâlâ `Dictionary` tipinin KAYNAĞI (bugün render edilmiyor ama ölü
  // metin de değil): anahtar yalnız tr'de olursa tip kapısı kırmızı döner.
  // Bu iddia aynı şeyi DEĞERLE söyler, derleyici hatasından okunur bir mesajla.
  const keys = [
    ...OCCASIONS.flatMap((o) => [o.titleKey, o.descKey]),
    ...OCCASION_SECTION_KEYS,
  ];
  for (const key of keys) {
    for (const [name, dict] of [["tr", tr], ["en", en]] as Array<
      [string, Record<string, string>]
    >) {
      const value = dict[key];
      assert.ok(value, `${name}:${key} sözlükte yok`);
      assert.ok(value.trim().length > 0, `${name}:${key} boş`);
    }
  }
});

check("kayıtta olmayan bir slug 404 verir", () => {
  // `generateStaticParams` yalnız altı slug üretiyor, ama bir `[occasion]`
  // segmenti kendiliğinden kapalı değil: kayıtta olmayan bir slug SESSİZCE
  // boş bir sayfa çizmemeli. İki kapı birlikte duruyor — `dynamicParams =
  // false` (yönlendirme katmanı) ve `notFound()` (sayfanın kendisi).
  assert.equal(findOccasion("yilbasi"), null);
  assert.equal(findOccasion(""), null);
  assert.equal(findOccasion("Dogum-Gunu"), null, "slug eşleşmesi büyük/küçük harf duyarsız");
  assert.equal(findOccasion("dogum-gunu/../../etc"), null);

  let thrown: unknown = null;
  try {
    occasionOrNotFound("yilbasi");
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, "kayıtta olmayan slug sessizce bir sayfa çiziyor — notFound() atılmadı");
  assert.equal(
    (thrown as { digest?: string }).digest,
    "NEXT_HTTP_ERROR_FALLBACK;404",
    "atılan hata Next'in 404'ü değil"
  );
  // Kayıtlı slug aynı kapıdan geçer.
  assert.equal(occasionOrNotFound("mezuniyet").slug, "mezuniyet");

  assert.match(
    PAGE_SOURCE,
    /export const dynamicParams = false;/,
    "/hediye/[occasion]: kayıt dışı slug yönlendirme katmanında kapatılmamış"
  );
  assert.match(
    PAGE_SOURCE,
    /occasionOrNotFound\(/,
    "/hediye/[occasion]: sayfa kaydı sormuyor"
  );
});

check("generateStaticParams kaydın TAMAMINI ve yalnız onu üretir", () => {
  const params = generateStaticParams();
  assert.deepEqual(
    params.map((p) => p.occasion),
    [...EXPECTED_SLUGS],
    "statik üretim listesi kayıttan sapmış"
  );
});

// ─── Sitemap + indeksleme ───────────────────────────────────────────────────

check("altı sayfa sitemap'te, öncelik 0.7 ve GERÇEK lastModified ile", async () => {
  // MUTASYON SINAVI: kayıttan bir özel günü çıkar → bu iddia KIRMIZI
  // (sitemap kaydı tek kaynak sayıyor, yani eksik giriş keşfedilmeyen bir
  // sayfa demek).
  const { STATIC_ROUTES } = await import("../src/app/sitemap");
  for (const slug of EXPECTED_SLUGS) {
    const route = STATIC_ROUTES.find((r) => r.path === `/hediye/${slug}`);
    assert.ok(route, `/hediye/${slug} sitemap'te yok`);
    assert.equal(route.priority, 0.7, `/hediye/${slug} önceliği 0.7 değil`);
    // Tarih `new Date()`ten TÜREMEZ: her render'da "şimdi" diyen bir `lastmod`
    // tazelik sinyali değil gürültüdür (bkz. sitemap.ts başlığı).
    const iso = pageUpdatedAt(`/hediye/${slug}`);
    assert.ok(iso, `/hediye/${slug}: tarihi PAGE_UPDATED_AT'te kayıtlı değil`);
    assert.match(iso, /^\d{4}-\d{2}-\d{2}$/, `/hediye/${slug}: tarih ISO değil`);
  }
});

check("/hediye NOINDEX değil — indekslenmesi tam olarak amaç", () => {
  for (const prefix of NOINDEX_PREFIXES) {
    assert.notEqual(prefix, "/hediye", "/hediye noindex listesine girmiş");
  }
  assert.equal(isNoindexPath("/hediye"), false);
  for (const slug of EXPECTED_SLUGS) {
    assert.equal(
      isNoindexPath(`/hediye/${slug}`),
      false,
      `/hediye/${slug} noindex — sayfanın bütün amacı indekslenmek`
    );
  }
});

// ─── Sayfanın söylediği rakamlar ────────────────────────────────────────────

check("her sayfa fiyatı, ölçüyü, katmanı ve teslim süresini İLK %30'da yayınlar", () => {
  // Ölçüm: bir asistanın atıflarının %44,2'si dokümanın ilk %30'undan geliyor.
  // MUTASYON SINAVI: gerçekler bandını adım listesinin ALTINA taşı → konum
  // iddiası KIRMIZI.
  for (const occasion of OCCASIONS) {
    const text = visibleText(articleHtml(occasion.slug));
    const where = (needle: string) => {
      const i = text.indexOf(needle);
      assert.notEqual(i, -1, `/hediye/${occasion.slug}: "${needle}" yayınlanmıyor`);
      return i;
    };
    const limit = Math.floor(text.length * 0.3);
    for (const needle of [
      FIGURINE_PRICE_LABEL,
      FIGURINE_HEIGHT_LABEL,
      LAYER,
      PRODUCTION,
      TRANSIT,
      // Künye cümlesinin niteliksel yarısı da orada: rakam tek başına "SLA
      // reçine, el boyamalı" demiyor.
      "SLA reçine",
      "el boyama",
      "ücretsiz",
      // O özel güne AİT kendi adı ve açıklaması — altı sayfa aynı metni
      // yayınlamıyor, yoksa altı URL tek bir sayfanın kopyası olurdu.
      tr[occasion.titleKey],
      tr[occasion.descKey],
    ]) {
      assert.ok(
        where(needle) < limit,
        `/hediye/${occasion.slug}: "${needle}" ilk %30'da değil (${where(needle)}/${limit})`
      );
    }
  }
});

check("sayfa kaynağında ELLE yazılmış rakam yok — hepsi sabitten", () => {
  // MUTASYON SINAVI: "₺3.499"u ya da "15 cm"i gövdeye elle yaz → KIRMIZI.
  // Bir kopya, bir gün `FIGURINE_PRICE_KURUS`tan ayrışacak bir rakam demek.
  const stripped = ARTICLE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(
    /(^|[^:])\/\/[^\n]*/g,
    "$1 "
  );
  for (const literal of ["3.499", "3,499", "15 cm", "25 µm", "5-7", "2-3"]) {
    assert.ok(
      !stripped.includes(literal),
      `occasion-page.tsx içinde elle yazılmış "${literal}" var`
    );
  }
  // Rakamların geldiği sabitler GERÇEKTEN okunuyor.
  for (const source of ["FIGURINE_PRICE_LABEL", "FIGURINE_HEIGHT_LABEL", "FIGURINE_LEAD_DAYS", "layerHeightLabel"]) {
    assert.ok(stripped.includes(source), `occasion-page.tsx ${source} okumuyor`);
  }
});

check("metadata açıklaması FİYAT ve BOYUT taşır (iki dilde)", () => {
  // Emsal `/nasil-calisir` (page.tsx): açıklamada fiyat, ölçü ve teslim süresi
  // geçiyor. Arama sonucunda görünen tek cümle burası.
  const priceEn = (FIGURINE_PRICE_KURUS / 100).toLocaleString("en-US");
  for (const occasion of OCCASIONS) {
    const metaTr = occasionMetadata(occasion, tr, "tr");
    assert.ok(metaTr.title.includes(tr[occasion.titleKey]), `${occasion.slug}: tr başlık`);
    assert.ok(metaTr.title.includes("Figurunica"), `${occasion.slug}: marka adı yok`);
    assert.ok(
      metaTr.description.includes(FIGURINE_PRICE_LABEL),
      `${occasion.slug}: tr açıklamada fiyat yok`
    );
    assert.ok(
      metaTr.description.includes(FIGURINE_HEIGHT_LABEL),
      `${occasion.slug}: tr açıklamada ölçü yok`
    );
    assert.ok(
      metaTr.description.includes(PRODUCTION),
      `${occasion.slug}: tr açıklamada üretim süresi yok`
    );

    const metaEn = occasionMetadata(occasion, en, "en");
    assert.ok(metaEn.title.includes(en[occasion.titleKey]), `${occasion.slug}: en başlık`);
    assert.ok(
      metaEn.description.includes(priceEn),
      `${occasion.slug}: en açıklamada fiyat yok`
    );
    assert.ok(
      metaEn.description.includes(FIGURINE_HEIGHT_LABEL),
      `${occasion.slug}: en açıklamada ölçü yok`
    );
  }
  assert.match(
    PAGE_SOURCE,
    /occasionMetadata\(/,
    "/hediye/[occasion]: generateMetadata paylaşılan kaynağı kullanmıyor"
  );
});

// ─── Yapısal veri ───────────────────────────────────────────────────────────

check("figürin şeması ÜÇ SAYFAYLA AYNI @id'yi taşır — tek ürün", () => {
  // Farklı `@id`ler altı AYRI ürün gibi görünürdü; oysa satılan şey hep aynı
  // tek fiyatlı, tek ölçülü figür.
  for (const occasion of OCCASIONS) {
    const { product } = occasionJsonLd(occasion, tr, APP);
    assert.equal(product["@id"], figurineProductId(APP));
    assert.equal(product["@id"], `${APP}/figur#figurine`);
    const offer = product.offers as Record<string, unknown>;
    assert.equal(offer.price, (FIGURINE_PRICE_KURUS / 100).toFixed(2));
  }
});

check("FAQPage ve HowTo sayfanın KENDİ adresine bağlanır", () => {
  for (const occasion of OCCASIONS) {
    const url = `${APP}${occasionPath(occasion.slug)}`;
    const { faq, howTo } = occasionJsonLd(occasion, tr, APP);
    assert.ok(faq, `${occasion.slug}: FAQPage yayımlanmıyor`);
    assert.equal(faq["@type"], "FAQPage");
    assert.equal(faq["@id"], `${url}#faq`);
    assert.ok(howTo, `${occasion.slug}: HowTo yayımlanmıyor`);
    assert.equal(howTo["@type"], "HowTo");
    assert.equal(howTo["@id"], `${url}#howto`);
  }
  assert.match(PAGE_SOURCE, /occasionJsonLd\(/, "sayfa şemayı yayınlamıyor");
  assert.match(PAGE_SOURCE, /<JsonLd/, "sayfa JSON-LD basmıyor");
});

check("SSS şeması sayfada GÖRÜNEN soru-cevapların aynısı", () => {
  // Şemaya sayfada OLMAYAN bir cevap yazmak Google'ın "yapısal veri
  // uyuşmazlığı" cezası; iki ayrı liste tutmak o ayrışmayı bir gün
  // kendiliğinden üretirdi.
  for (const occasion of OCCASIONS) {
    const text = visibleText(articleHtml(occasion.slug));
    const items = occasionFaqItems(occasion, tr, "tr");
    assert.ok(items.length >= 2 && items.length <= 3, `${occasion.slug}: 2-3 soru bekleniyor`);
    const { faq } = occasionJsonLd(occasion, tr, APP);
    const entities = faq!.mainEntity as Array<Record<string, unknown>>;
    assert.equal(entities.length, items.length);
    for (const [i, item] of items.entries()) {
      assert.equal(entities[i].name, item.q);
      assert.equal(
        (entities[i].acceptedAnswer as Record<string, unknown>).text,
        item.a
      );
      assert.ok(text.includes(item.q), `${occasion.slug}: "${item.q}" ekranda yok`);
      assert.ok(text.includes(item.a), `${occasion.slug}: cevabı ekranda yok`);
    }
    // En az bir soru O ÖZEL GÜNÜN adını taşır: altı sayfanın SSS'si birbirinin
    // kopyası değil.
    assert.ok(
      items.some((it) => it.q.includes(tr[occasion.titleKey])),
      `${occasion.slug}: hiçbir soru özel günün adını anmıyor`
    );
  }
});

check("adım listesi /nasil-calisir ile AYNI kaynaktan, ikinci kopya yok", () => {
  const section = HOW_IT_WORKS_STEPS.tr;
  for (const occasion of OCCASIONS) {
    const { howTo } = occasionJsonLd(occasion, tr, APP);
    const steps = howTo!.step as Array<Record<string, unknown>>;
    assert.equal(steps.length, section.steps.length);
    assert.deepEqual(
      steps.map((s) => s.text),
      section.steps.map(stepBodyText),
      `${occasion.slug}: şemadaki adımlar /nasil-calisir'ın adımları değil`
    );
    const text = visibleText(articleHtml(occasion.slug));
    for (const step of section.steps) {
      assert.ok(text.includes(step.name), `${occasion.slug}: "${step.name}" ekranda yok`);
    }
  }
  assert.match(
    ARTICLE_SOURCE,
    /from "@\/app\/nasil-calisir\/steps"|from "\.\.\/\.\.\/nasil-calisir\/steps"/,
    "adımlar /nasil-calisir'ın veri modülünden gelmiyor — ikinci kopya"
  );
});

// ─── İç bağlantılar ─────────────────────────────────────────────────────────

check("her özel gün sayfası /nasil-calisir ve /create'e bağlanır", () => {
  for (const occasion of OCCASIONS) {
    const html = articleHtml(occasion.slug);
    assert.match(html, /href="\/create"/, `${occasion.slug}: /create bağlantısı yok`);
    assert.match(
      html,
      /href="\/nasil-calisir"/,
      `${occasion.slug}: /nasil-calisir bağlantısı yok`
    );
  }
});

check("anasayfa ve /figur altı sayfanın HEPSİNE bağlanır", () => {
  // Yalnız sitemap'ten erişilen sayfa zayıftır: iç bağlantısı olmayan bir URL
  // keşfedilse de sitenin kendi ağırlığından pay almaz.
  const html = render(createElement(OccasionLinks, { d: tr }));
  for (const slug of EXPECTED_SLUGS) {
    assert.ok(
      html.includes(`href="/hediye/${slug}"`),
      `bağlantı bloğunda /hediye/${slug} yok`
    );
  }
  const text = visibleText(html);
  for (const occasion of OCCASIONS) {
    assert.ok(text.includes(tr[occasion.titleKey]), `${occasion.slug}: bağlantı metni yok`);
  }
  // Blok GERÇEKTEN iki yüzeyde çiziliyor.
  for (const file of [
    "src/components/marketplace/storefront.tsx",
    "src/app/figur/page.tsx",
  ]) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.match(source, /<OccasionLinks\b/, `${file}: özel gün bağlantıları çizilmiyor`);
  }
});

check("görünür Son güncelleme satırı sayfa başına kayıttan okunuyor", () => {
  assert.match(
    PAGE_SOURCE,
    /<LastUpdated\s+path=\{occasionPath\(/,
    "/hediye/[occasion]: Son güncelleme satırı sayfanın kendi yolundan okumuyor"
  );
});

async function run() {
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failures++;
      console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
    }
  }
  console.log(
    failures === 0
      ? `\n✅ occasions: ${cases.length} kontrol geçti`
      : `\n❌ occasions: ${failures} başarısız`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void run();
