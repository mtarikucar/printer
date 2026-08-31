/**
 * Product / Offer / BreadcrumbList JSON-LD contract.
 *
 * Every assertion here is a Google requirement or a documented limitation, not
 * a style preference — an invalid or rotten value silently drops the offer out
 * of rich results with no error anywhere.
 */
import assert from "node:assert/strict";
import {
  buildProductJsonLd,
  buildProductBreadcrumbJsonLd,
} from "../src/lib/seo/product";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

const BASE = {
  slug: "mini-ejderha",
  title: "Mini Ejderha",
  description: "Reçine baskı mini ejderha figürü.",
  priceKurus: 24900,
  images: ["https://figurunica.com/media/products/a.webp"],
  sellerName: "Atölye X",
  material: "resin",
  leadTimeDays: 5,
  ratingAvg: 4.7,
  ratingCount: 12,
  categoryName: "Figürler",
  categoryPath: "figurler",
};

// Deterministic clock so priceValidUntil is assertable.
const NOW = Date.UTC(2026, 0, 15);

check("temel Product alanları var", () => {
  const n = buildProductJsonLd(BASE, NOW);
  assert.equal(n["@type"], "Product");
  assert.equal(n.name, BASE.title);
  assert.equal(n.description, BASE.description);
  assert.deepEqual(n.image, BASE.images);
});

check("fiyat kuruştan ondalık dizgiye çevriliyor", () => {
  const offer = buildProductJsonLd(BASE, NOW).offers as Record<string, unknown>;
  assert.equal(offer.price, "249.00");
  assert.equal(offer.priceCurrency, "TRY");
});

check("priceValidUntil YUVARLANIYOR — sabit tarih markup'ı çürütür", () => {
  const a = buildProductJsonLd(BASE, NOW).offers as Record<string, string>;
  const later = Date.UTC(2026, 5, 15);
  const b = buildProductJsonLd(BASE, later).offers as Record<string, string>;
  assert.notEqual(a.priceValidUntil, b.priceValidUntil);
  assert.ok(a.priceValidUntil > "2026-01-15", "geçmiş tarih olmamalı");
  assert.match(a.priceValidUntil, /^\d{4}-\d{2}-\d{2}$/);
});

check("availability InStock — MadeToOrder'ı Google desteklemiyor", () => {
  const offer = buildProductJsonLd(BASE, NOW).offers as Record<string, string>;
  assert.equal(offer.availability, "https://schema.org/InStock");
  assert.ok(
    !JSON.stringify(offer).includes("MadeToOrder"),
    "MadeToOrder teklifi tümüyle uygunsuz hale getirir"
  );
});

check("üretim süresi teslimat süresinde dürüstçe beyan ediliyor", () => {
  const offer = buildProductJsonLd(BASE, NOW).offers as Record<string, unknown>;
  const shipping = offer.shippingDetails as Record<string, unknown>;
  const delivery = shipping.deliveryTime as Record<string, unknown>;
  const handling = delivery.handlingTime as Record<string, number>;
  assert.equal(handling.maxValue, BASE.leadTimeDays);
});

check("iade politikası 14 gün (hazır ürün, kişiye özel figür DEĞİL)", () => {
  const offer = buildProductJsonLd(BASE, NOW).offers as Record<string, unknown>;
  const policy = offer.hasMerchantReturnPolicy as Record<string, unknown>;
  assert.equal(policy.merchantReturnDays, 14);
  assert.equal(policy.applicableCountry, "TR");
});

check("aggregateRating yalnız gerçek yorum varken yayınlanıyor", () => {
  const withReviews = buildProductJsonLd(BASE, NOW);
  assert.ok(withReviews.aggregateRating, "12 yorum varken rating olmalı");

  const none = buildProductJsonLd({ ...BASE, ratingAvg: 0, ratingCount: 0 }, NOW);
  assert.equal(
    none.aggregateRating,
    undefined,
    "yorum yokken rating yayınlamak sayfada görünmeyen bir iddiadır"
  );
});

check("rating değerleri Google'ın beklediği şekilde", () => {
  const r = buildProductJsonLd(BASE, NOW).aggregateRating as Record<string, unknown>;
  assert.equal(r.ratingValue, "4.7");
  assert.equal(r.reviewCount, 12);
  assert.equal(r.bestRating, 5);
});

check("satıcı adı yoksa markaya işletme adı düşüyor", () => {
  const n = buildProductJsonLd({ ...BASE, sellerName: null }, NOW);
  const brand = n.brand as Record<string, string>;
  assert.ok(brand.name && brand.name.length > 0);
});

check("breadcrumb mağaza → kategori → ürün sırasını kuruyor", () => {
  const b = buildProductBreadcrumbJsonLd(BASE);
  const items = b.itemListElement as Array<Record<string, unknown>>;
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.position), [1, 2, 3]);
  assert.equal(items[2].name, BASE.title);
});

check("kategorisiz ürün breadcrumb'ı yine geçerli", () => {
  const b = buildProductBreadcrumbJsonLd({ ...BASE, categoryName: null, categoryPath: null });
  const items = b.itemListElement as Array<Record<string, unknown>>;
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.position), [1, 2]);
});

check("çıktı serileştirilebilir (döngü yok, undefined sızmıyor)", () => {
  const s = JSON.stringify(buildProductJsonLd(BASE, NOW));
  assert.ok(!s.includes("undefined"));
  assert.doesNotThrow(() => JSON.parse(s));
});

console.log(
  failures === 0
    ? `\n✅ product-jsonld: tüm kontroller geçti`
    : `\n❌ product-jsonld: ${failures} başarısız`
);
process.exit(failures === 0 ? 0 : 1);
