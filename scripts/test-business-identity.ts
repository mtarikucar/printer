/**
 * İşletme kimliği tek kaynağı + Organization/WebSite JSON-LD testleri.
 *
 * Bu dosyanın koruduğu şeyler:
 *  - VKN/adres/sosyal profil verilerinin biçimsel geçerliliği (yasal sayfalar ve
 *    schema.org `sameAs` bunlardan türetiliyor),
 *  - NAP bloğunun EKSİKSİZLİĞİ: footer ve `/contact` adresi, yasal sayfalardaki
 *    adresle AYNI dizgidir (posta kodu dâhil). Bir harita/işletme eşleştiricisi
 *    iki farklı adres gördüğünde site ile kaydı aynı varlık saymıyor,
 *  - Google'ın iki bağlayıcı kuralı: Organization altında `aggregateRating`
 *    (self-serving review) ve `WebSite` altında `potentialAction`/`SearchAction`
 *    (2024-11-21'de kapatıldı) OLMAYACAK,
 *  - `JsonLd` emitter'ının `<` kaçışı. Pazaryeri satıcı metinleri ve müşteri
 *    yorumları ileride bu emitter'dan geçecek; kaçırılmayan bir `</script>`
 *    stored XSS'tir.
 */
// İLK import olmak ZORUNDA: footer bir CSS modülü import ediyor ve `tsx` onu
// TypeScript sanıp derlemeye kalkıyor. Gerekçe stub'ın başlığında.
import "./support/stub-css-modules";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BUSINESS_ADDRESS_LINES,
  BUSINESS_LEGAL_NAME,
  BUSINESS_MAPS_URL,
  BUSINESS_TAX_ID,
  BUSINESS_ADDRESS,
  BUSINESS_ADDRESS_FULL,
  SOCIAL_PROFILES,
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
} from "../src/lib/config/business-identity";
import { buildOrganizationJsonLd, getAppUrl } from "../src/lib/seo/organization";
import { JsonLd, serializeJsonLd } from "../src/lib/seo/jsonld";
import { FigFooter } from "../src/components/figurunica/sections";
import { pickFigurunicaDict } from "../src/components/figurunica/dict";
import tr from "../src/lib/i18n/dictionaries/tr";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

const APP_URL = "https://figurunica.com";
const graph = buildOrganizationJsonLd(APP_URL);
const nodes = graph["@graph"];
const [org, website] = nodes;

/** Nesne ağacında bir anahtarın herhangi bir derinlikte geçip geçmediği. */
function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, key));
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rec, key)) return true;
    return Object.values(rec).some((v) => hasKeyDeep(v, key));
  }
  return false;
}

// ---------------------------------------------------------------- kimlik verisi

test("VKN 10 haneli ve yalnızca rakam", () => {
  assert.match(BUSINESS_TAX_ID, /^\d{10}$/, `geçersiz VKN: ${BUSINESS_TAX_ID}`);
});

test("ticari unvan dolu", () => {
  assert.ok(BUSINESS_LEGAL_NAME.trim().length > 0, "ticari unvan boş");
});

test("adresin beş alanı da dolu", () => {
  for (const field of [
    "streetAddress",
    "addressLocality",
    "addressRegion",
    "postalCode",
    "addressCountry",
  ] as const) {
    const v = BUSINESS_ADDRESS[field];
    assert.ok(
      typeof v === "string" && v.trim().length > 0,
      `adres alanı boş: ${field}`
    );
  }
});

test("posta kodu 5 hane, ülke kodu ISO 3166-1 alpha-2", () => {
  assert.match(BUSINESS_ADDRESS.postalCode, /^\d{5}$/);
  assert.match(BUSINESS_ADDRESS.addressCountry, /^[A-Z]{2}$/);
});

test("tam adres metni posta kodunu ve mahalleyi içerir", () => {
  assert.ok(BUSINESS_ADDRESS_FULL.includes(BUSINESS_ADDRESS.postalCode));
  assert.ok(BUSINESS_ADDRESS_FULL.includes(BUSINESS_ADDRESS.streetAddress));
  assert.ok(BUSINESS_ADDRESS_FULL.includes(BUSINESS_ADDRESS.addressLocality));
});

// ------------------------------------------------------------------ NAP bloğu

/** Footer her ticari sayfanın altında duruyor; NAP bloğu orada okunuyor. */
const footerHtml = renderToStaticMarkup(
  createElement(FigFooter, { d: pickFigurunicaDict(tr) })
);

/**
 * Footer'ın GÖRÜNEN metni — etiketler (ve dolayısıyla `href` nitelikleri)
 * atılmış hâli.
 *
 * Ham HTML üzerinde arama yapmak YANILTICI: harita bağlantısının `href`i adresi
 * URL-kodlu taşıyor, yani `06820` orada da geçiyor. Ölçüm sırasında bunu
 * gördüm — footer görünür metninde posta kodu olmasa bile ham HTML iddiası
 * YEŞİL kalıyordu. Bir tarayıcı/eşleştirici NAP bloğunu metinden okur.
 */
const footerText = footerHtml.replace(/<[^>]*>/g, " ");

test("footer'da render edilen adres posta kodunu taşıyor", () => {
  assert.ok(
    footerText.includes(BUSINESS_ADDRESS.postalCode),
    `footer adresinde posta kodu yok (${BUSINESS_ADDRESS.postalCode})`
  );
});

test("footer adresi yasal sayfalardaki adresle AYNI dizgi", () => {
  // Yasal sayfalar `BUSINESS_ADDRESS_FULL`ı doğrudan basıyor (aşağıdaki kaynak
  // pini). Footer'ın BİREBİR aynı dizgiyi basması, eşleştiricinin iki ayrı
  // adres görmemesi demek.
  assert.ok(
    footerText.includes(BUSINESS_ADDRESS_FULL),
    `footer adresi yasal adresten farklı: beklenen "${BUSINESS_ADDRESS_FULL}"`
  );
});

test("yasal sayfalar ve belgeler adresi aynı sabitten okuyor", () => {
  // Bu bir KAYNAK pini: yukarıdaki iddianın "aynı dizgi" demesi, ancak yasal
  // tarafın da bu sabiti okuduğu doğruysa bir şey ifade eder.
  for (const file of [
    "src/app/mesafeli-satis/page.tsx",
    "src/app/on-bilgilendirme/page.tsx",
    "src/app/ticari-ileti/page.tsx",
    "src/app/teklif/[number]/belge/quote-document.tsx",
  ]) {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    assert.ok(
      source.includes("BUSINESS_ADDRESS_FULL"),
      `${file} adresi tek kaynaktan okumuyor`
    );
  }
});

test("adres metni yalnız bilinen iki dosyada yazılı", () => {
  // İkinci bir elle yazılmış adres, bir gün ayrışacak iki NAP bloğu demek —
  // posta kodu eksik olan `CONTACT_ADDRESS_FULL` tam olarak böyle doğmuştu.
  //
  // Listedeki İKİNCİ dosya bir SÖZLEŞME METNİ: üretici ortaklık sözleşmesi
  // ("Sürüm 3.1 — Yürürlük tarihi 20 Eylül 2026") tebligat adresini kendi
  // gövdesinde posta kodsuz yazıyor. Bilerek DOKUNULMADI: ortakların kabul
  // ettiği bir belgenin metnini sürüm numarası değişmeden düzenlemek, imzalanan
  // şeyi sessizce değiştirmek olurdu. NAP açısından da bir kaybı yok —
  // `/manufacturer/**` robots'ta engelli (`scripts/test-sitemap.ts`), yani o
  // adresi hiçbir tarayıcı okumuyor. ÜÇÜNCÜ bir kopya yine kırmızı döner.
  const needle = "Akın 688";
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        if (fs.readFileSync(full, "utf8").includes(needle)) hits.push(full);
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  assert.deepEqual(
    hits.map((h) => path.relative(process.cwd(), h)).sort(),
    [
      "src/lib/config/business-identity.ts",
      "src/lib/content/manufacturer-onboarding.ts",
    ],
    `adres metni beklenmeyen bir dosyada yazılı: ${hits.join(", ")}`
  );
});

test("/contact'ın satır satır adresi de posta kodunu taşıyor", () => {
  assert.ok(
    BUSINESS_ADDRESS_LINES.join(" ").includes(BUSINESS_ADDRESS.postalCode),
    "satırlara bölünmüş adreste posta kodu yok"
  );
  // Satırlar ile tek satırlık adres AYNI kaynaktan türüyor: birleştirilmiş
  // hâlleri birbirinin aynısı olmak zorunda, yoksa `/contact` ile footer iki
  // farklı adres söylerdi.
  assert.equal(BUSINESS_ADDRESS_LINES.join(", "), BUSINESS_ADDRESS_FULL);
});

test("harita bağlantısının sorgusu posta kodunu içeriyor", () => {
  const query = new URL(BUSINESS_MAPS_URL).searchParams.get("query");
  assert.ok(query, "harita bağlantısında query yok");
  assert.ok(
    query.includes(BUSINESS_ADDRESS.postalCode),
    `harita sorgusu posta kodu taşımıyor: ${query}`
  );
  assert.ok(query.includes(BUSINESS_ADDRESS.addressLocality));
});

test("sosyal profiller geçerli https URL", () => {
  assert.ok(SOCIAL_PROFILES.length > 0, "hiç sosyal profil yok");
  for (const raw of SOCIAL_PROFILES) {
    const u = new URL(raw); // geçersizse fırlatır
    assert.equal(u.protocol, "https:", `https değil: ${raw}`);
    assert.ok(u.hostname.length > 0, `host yok: ${raw}`);
    assert.ok(!raw.endsWith("/"), `sondaki eğik çizgi sameAs'i bozar: ${raw}`);
  }
  assert.equal(
    new Set(SOCIAL_PROFILES).size,
    SOCIAL_PROFILES.length,
    "tekrarlanan sosyal profil"
  );
});

// -------------------------------------------------------------------- JSON-LD

test("@context schema.org ve tek bir @graph var", () => {
  assert.equal(graph["@context"], "https://schema.org");
  assert.ok(Array.isArray(nodes) && nodes.length === 2);
});

test("kuruluş node'unun tipi OnlineStore (LocalBusiness DEĞİL)", () => {
  assert.ok(org, "OnlineStore node'u yok");
  assert.equal(org["@type"], "OnlineStore");
  const serialized = JSON.stringify(graph);
  assert.ok(
    !serialized.includes("LocalBusiness"),
    "LocalBusiness fiziksel şube gerektirir ve yıldız özelliğine uygun değil"
  );
});

test("Organization'da aggregateRating/review YOK (self-serving review politikası)", () => {
  assert.ok(
    !hasKeyDeep(graph, "aggregateRating"),
    "Google: kendi hakkındaki yorumları kontrol eden kuruluş yıldız özelliğine uygun değildir"
  );
  assert.ok(!hasKeyDeep(graph, "review"), "Organization'a review konmamalı");
});

test("WebSite node'unda potentialAction/SearchAction YOK", () => {
  assert.ok(website, "WebSite node'u yok");
  assert.equal(website["@type"], "WebSite");
  assert.ok(
    !hasKeyDeep(graph, "potentialAction"),
    "sitelinks searchbox 2024-11-21'de global olarak kapatıldı"
  );
  assert.ok(!JSON.stringify(graph).includes("SearchAction"));
});

test("node'lar @id ile birbirini referanslıyor", () => {
  assert.equal(org["@id"], `${APP_URL}/#organization`);
  assert.equal(website["@id"], `${APP_URL}/#website`);
  assert.deepEqual(website.publisher, { "@id": `${APP_URL}/#organization` });
  assert.equal(website.inLanguage, "tr-TR");
});

test("kimlik alanları tek kaynaktan türetiliyor", () => {
  assert.equal(org.legalName, BUSINESS_LEGAL_NAME);
  assert.equal(org.vatID, BUSINESS_TAX_ID);
  assert.deepEqual(org.sameAs, [...SOCIAL_PROFILES]);
  assert.deepEqual(org.address, {
    "@type": "PostalAddress",
    ...BUSINESS_ADDRESS,
  });
  assert.equal(org.url, APP_URL);
  assert.equal(org.email, CONTACT_EMAIL);
  assert.equal(org.telephone, CONTACT_PHONE_DISPLAY);
});

test("uydurma alan yok (kuruluş yılı, çalışan sayısı, sicil no, logo)", () => {
  // NOT: `logo`/`image` burada "elimizde olmayan alan" olarak listeleniyor
  // çünkü şu an gerçek bir logo dosyamız yok (bkz. organization.ts başındaki
  // yorum). Gerçek bir logo dosyası eklenip `organization.ts`'e doğrulanmış
  // bir `logo` alanı eklendiğinde bu test kırmızıya döner — bu bir regresyon
  // DEĞİL: `logo`'yu bu listeden çıkarıp testi güncelle.
  for (const forbidden of [
    "foundingDate",
    "numberOfEmployees",
    "taxID",
    "identifier",
    "logo",
    "image",
    "duns",
    "leiCode",
  ]) {
    assert.ok(
      !hasKeyDeep(graph, forbidden),
      `doğrulanmamış alan JSON-LD'ye sızmış: ${forbidden} (logo/image için: gerçek bir dosya eklendiyse bu testi güncelle, bkz. yukarıdaki not)`
    );
  }
});

test("ETBİS/MERSİS numarası iddia edilmiyor", () => {
  const serialized = JSON.stringify(graph).toLocaleLowerCase("tr-TR");
  assert.ok(!serialized.includes("etbis"));
  assert.ok(!serialized.includes("mersis"));
});

test("appUrl parametresi verilmezse NEXT_PUBLIC_APP_URL'e düşer", () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com";
    const g = buildOrganizationJsonLd();
    assert.equal(g["@graph"][0]["@id"], "https://staging.example.com/#organization");
    delete process.env.NEXT_PUBLIC_APP_URL;
    const g2 = buildOrganizationJsonLd();
    assert.equal(g2["@graph"][0]["@id"], "https://figurunica.com/#organization");
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
  }
});

test("üretilen JSON-LD geçerli JSON olarak geri parse ediliyor", () => {
  const parsed = JSON.parse(serializeJsonLd(graph));
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(graph)));
});

// ------------------------------------------------------------------ XSS kaçışı

test("serializeJsonLd </script> dizisini kaçırır", () => {
  const payload = { name: '</script><script>alert(1)</script>' };
  const out = serializeJsonLd(payload);
  assert.ok(!out.includes("</script>"), `kaçırılmamış </script>: ${out}`);
  assert.ok(!out.includes("<"), `çıktıda ham '<' var: ${out}`);
  assert.ok(out.includes("\\u003c"), "'<' \\u003c olarak kaçırılmalı");
  // Kaçış anlamı bozmaz: geri parse edilince orijinal metin çıkar.
  assert.equal(JSON.parse(out).name, payload.name);
});

test("kaçış iç içe/dizi/anahtar konumlarında da çalışır", () => {
  const payload = {
    "<key>": "ok",
    nested: { list: ["<img src=x onerror=alert(1)>", { deep: "</SCRIPT >" }] },
  };
  const out = serializeJsonLd(payload);
  assert.ok(!out.includes("<"), `çıktıda ham '<' var: ${out}`);
  assert.deepEqual(JSON.parse(out), payload);
});

test("JsonLd bileşeni kaçırılmış metni script etiketine basar", () => {
  const el = JsonLd({ data: { name: "</script><script>alert(1)</script>" } }) as {
    type: string;
    props: {
      type: string;
      dangerouslySetInnerHTML: { __html: string };
    };
  };
  assert.equal(el.type, "script", "native <script> kullanılmalı (next/script değil)");
  assert.equal(el.props.type, "application/ld+json");
  const html = el.props.dangerouslySetInnerHTML.__html;
  assert.ok(!html.includes("</script>"), `kaçırılmamış </script>: ${html}`);
  assert.ok(!html.includes("<"), `çıktıda ham '<' var: ${html}`);
  assert.equal(html, serializeJsonLd({ name: "</script><script>alert(1)</script>" }));
});

// ------------------------------------------------------------ fail-safe koruma

test("serializeJsonLd undefined/null/döngüsel veride fırlatmaz, geçerli JSON döner", () => {
  assert.equal(serializeJsonLd(undefined), "{}", "undefined boş JSON-LD'ye düşmeli");
  assert.doesNotThrow(() => JSON.parse(serializeJsonLd(undefined)));

  assert.doesNotThrow(() => JSON.parse(serializeJsonLd(null)));
  assert.equal(JSON.parse(serializeJsonLd(null)), null);

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  let out = "";
  assert.doesNotThrow(() => {
    out = serializeJsonLd(circular);
  }, "döngüsel veri serializeJsonLd'yi fırlatmamalı");
  assert.doesNotThrow(() => JSON.parse(out), `döngüsel veri geçersiz JSON üretti: ${out}`);
  assert.equal(out, "{}", "döngüsel veri sessizce boş JSON-LD'ye düşmeli");
});

test("serializeJsonLd U+2028/U+2029'u kaçırır, round-trip orijinal metni verir", () => {
  const LS = "\u2028"; // LINE SEPARATOR
  const PS = "\u2029"; // PARAGRAPH SEPARATOR
  const payload = { text: `satır${LS}ayırıcı ve paragraf${PS}ayırıcı` };
  const out = serializeJsonLd(payload);
  assert.ok(!out.includes(LS), `çıktıda ham U+2028 var: ${out}`);
  assert.ok(!out.includes(PS), `çıktıda ham U+2029 var: ${out}`);
  assert.ok(out.includes("\\u2028"), "U+2028 \\u2028 olarak kaçırılmalı");
  assert.ok(out.includes("\\u2029"), "U+2029 \\u2029 olarak kaçırılmalı");
  assert.equal(JSON.parse(out).text, payload.text);
});

// -------------------------------------------------------------------- getAppUrl

test("getAppUrl: boş env apex alan adına düşer, sondaki '/' kırpılır, normal değer aynen geçer", () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = "";
    assert.equal(getAppUrl(), "https://figurunica.com", "boş env apex alan adına düşmeli");
    assert.equal(
      buildOrganizationJsonLd()["@graph"][0]["@id"],
      "https://figurunica.com/#organization",
      "boş env @id'yi bozmamalı"
    );

    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com/";
    assert.equal(getAppUrl(), "https://staging.example.com", "sondaki '/' kırpılmalı");
    assert.equal(
      buildOrganizationJsonLd()["@graph"][0]["@id"],
      "https://staging.example.com/#organization",
      "sondaki '/' @id'de çift eğik çizgi bırakmamalı"
    );

    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com///";
    assert.equal(
      getAppUrl(),
      "https://staging.example.com",
      "birden çok sondaki '/' de kırpılmalı"
    );

    process.env.NEXT_PUBLIC_APP_URL = "https://figurunica.com";
    assert.equal(getAppUrl(), "https://figurunica.com", "normal değer aynen geçmeli");
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
  }
});

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}
console.log(`\n${passed}/${cases.length} işletme kimliği testi geçti`);
