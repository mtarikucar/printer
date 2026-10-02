/**
 * V2 — kişiye özel figürünün `Product`/`Offer` şeması ile `FAQPage`/`HowTo`
 * yayıcılarının SÖZLEŞMESİ.
 *
 * Buradaki her iddia Google'ın bir kuralı ya da belgelenmiş bir kısıt; biçim
 * tercihi değil. Tek ve en önemli kural: **yapısal verideki her değer, sayfada
 * GÖRÜNEN değerin birebir aynısıdır.** Ayrışırsa Google yapısal veriyi yok
 * sayar ("structured data mismatch") ve sayfayı zengin sonuçlardan düşürür —
 * yani bu dosya "şema geçerli mi" değil, "şema sayfanın söylediğini mi
 * söylüyor" sınavıdır. Şemanın sayfada GÖRÜNDÜĞÜNÜN kanıtı
 * `scripts/test-quote-ui.ts`te: orada aynı düğümler render edilen HTML'le
 * karşılaştırılıyor. Burası türetmenin kendisini pinler.
 *
 * Çalıştırma: npx tsx scripts/test-seo-jsonld.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FIGURINE_PRICE_KURUS } from "../src/lib/config/prices";
import { SIZE_PRESETS } from "../src/lib/config/sizes";
import {
  FIGURINE_HEIGHT_LABEL,
  FIGURINE_LEAD_DAYS,
  FIGURINE_PRICE_LABEL,
  figurinePriceLabel,
} from "../src/lib/config/product-facts";
import {
  buildFigurineProductJsonLd,
  figurineProductId,
} from "../src/lib/seo/figurine";
import { buildFaqPageJsonLd } from "../src/lib/seo/faq";
import { buildHowToJsonLd } from "../src/lib/seo/howto";
import { getAppUrl } from "../src/lib/seo/organization";
import { serializeJsonLd } from "../src/lib/seo/jsonld";
import { HOW_IT_WORKS_STEPS, stepBodyText } from "../src/app/nasil-calisir/steps";
import tr from "../src/lib/i18n/dictionaries/tr";
import en from "../src/lib/i18n/dictionaries/en";

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

/** Sabit saat: `priceValidUntil` yuvarlanan bir tarih, iddia edilebilir olmalı. */
const NOW = Date.UTC(2026, 9, 2);
const APP = "https://figurunica.com";
const node = () => buildFigurineProductJsonLd(tr, APP, NOW);
const offer = () => node().offers as Record<string, unknown>;

// ─── Fiyat etiketi: DEĞERLE sınanabilir saf fonksiyon ───────────────────────

check("fiyat etiketi saf bir fonksiyon — iki dalı da DEĞERLE sınanıyor", () => {
  // Tam liraya oturan fiyat tam lira yazılır (yayımlanan dört cümlenin
  // on beş aydır yazdığı biçim), kuruş taşıyan fiyat KURUŞU KAYBETMEZ:
  // "₺3.499,50" sessizce "₺3.500"e yuvarlanırsa yayımlanan rakam tahsil
  // edilen rakamdan sapar.
  assert.equal(figurinePriceLabel(349900), "₺3.499");
  assert.equal(figurinePriceLabel(349950), "₺3.499,50");
  assert.equal(figurinePriceLabel(100), "₺1");
  assert.equal(figurinePriceLabel(1), "₺0,01");
  // Yayımlanan etiket aynı fonksiyondan gelir, ikinci bir biçim yok.
  assert.equal(FIGURINE_PRICE_LABEL, figurinePriceLabel(FIGURINE_PRICE_KURUS));
});

// ─── Product / Offer ────────────────────────────────────────────────────────

check("şema geçerli JSON ve tek bir Product düğümü", () => {
  const n = node();
  assert.equal(n["@context"], "https://schema.org");
  assert.equal(n["@type"], "Product");
  const s = serializeJsonLd(n);
  assert.doesNotThrow(() => JSON.parse(s));
  assert.ok(!s.includes("undefined"), "undefined sızmış");
  // `<` kaçırılmadan `</script>` taşıyan bir metin bloğu kapatır.
  assert.ok(!s.includes("<"), "serileştirme `<` kaçırmıyor");
});

check("offers.price SAYFADA GÖRÜNEN fiyatla aynı sabitten türer", () => {
  // MUTASYON SINAVI: şemadaki fiyatı 100 kuruş kaydır → bu iddia KIRMIZI.
  const o = offer();
  assert.equal(o.priceCurrency, "TRY");
  assert.equal(o.price, (FIGURINE_PRICE_KURUS / 100).toFixed(2));
  // Şemadaki rakamdan müşteriye GÖSTERİLEN etiket yeniden üretilebiliyor:
  // ayrışma burada yakalanır, çünkü `/figur` ve `/create` tam bu dizeyi basar.
  assert.equal(
    figurinePriceLabel(Math.round(Number(o.price) * 100)),
    FIGURINE_PRICE_LABEL
  );
  assert.equal(o.valueAddedTaxIncluded, true, "KDV dahil beyanı yok");
});

check("ölçü sabitten gelir — satılan tek boy", () => {
  const n = node();
  const h = n.height as Record<string, unknown>;
  assert.equal(h.value, SIZE_PRESETS[0].heightMm);
  assert.equal(h.unitCode, "MMT", "schema.org UN/CEFACT kodu bekler");
  // 150 mm → "15 cm": sayfanın bastığı etiketle aynı değer.
  assert.equal(FIGURINE_HEIGHT_LABEL, "15 cm");
});

check("üretim ve kargo süresi tek sabitten, elle yazılmadan", () => {
  const d = (offer().shippingDetails as Record<string, unknown>)
    .deliveryTime as Record<string, unknown>;
  const handling = d.handlingTime as Record<string, number>;
  const transit = d.transitTime as Record<string, number>;
  assert.equal(handling.minValue, FIGURINE_LEAD_DAYS.productionMin);
  assert.equal(handling.maxValue, FIGURINE_LEAD_DAYS.productionMax);
  assert.equal(transit.minValue, FIGURINE_LEAD_DAYS.transitMin);
  assert.equal(transit.maxValue, FIGURINE_LEAD_DAYS.transitMax);
  assert.equal(handling.unitCode, "DAY");
  assert.equal(transit.unitCode, "DAY");
});

check("iş günü sabiti YAYIMLANAN cümlelerle bire bir aynı", () => {
  // Deponun teslim süresi sabiti YOKTU: rakam dört cümlenin içinde elle
  // yazılıydı. Şema artık tek sabitten türüyor; aşağıdaki pinler o sabiti
  // yayımlanan her yüzeye bağlar, yani biri değişip diğeri kalırsa KIRMIZI.
  const production = `${FIGURINE_LEAD_DAYS.productionMin}-${FIGURINE_LEAD_DAYS.productionMax}`;
  const transit = `${FIGURINE_LEAD_DAYS.transitMin}-${FIGURINE_LEAD_DAYS.transitMax}`;
  // `/figur` kahraman şeridi: "5-7 gün".
  assert.equal((tr as Record<string, string>)["landing.fig.hero.stat2.v"], production);
  assert.equal((en as Record<string, string>)["landing.fig.hero.stat2.v"], production);
  // `/create` bandı + ürün kartı: "… 5-7 iş günü içinde üretilir, kargo 2-3 iş günü."
  for (const dict of [tr, en] as Array<Record<string, string>>) {
    const included = dict["create.product.included"];
    assert.ok(included.includes(production), `create.product.included ${production} yazmıyor`);
    assert.ok(included.includes(transit), `create.product.included ${transit} yazmıyor`);
  }
  // `/figur` SSS: "Kargo yurtiçinde ek 2-3 gün sürer."
  assert.ok(
    (tr as Record<string, string>)["landing.faq.a1"].includes(production),
    "landing.faq.a1 üretim süresini yazmıyor"
  );
  assert.ok(
    (tr as Record<string, string>)["landing.faq.a1"].includes(transit),
    "landing.faq.a1 kargo süresini yazmıyor"
  );
  // `/nasil-calisir` adımları (şemanın türediği aynı kaynak).
  const steps = HOW_IT_WORKS_STEPS.tr.steps.map(stepBodyText).join(" ");
  assert.ok(steps.includes(production), "/nasil-calisir adımları üretim süresini yazmıyor");
  assert.ok(steps.includes(transit), "/nasil-calisir adımları kargo süresini yazmıyor");
});

check("Türkiye içi kargo ÜCRETSİZ olarak beyan ediliyor", () => {
  const shipping = offer().shippingDetails as Record<string, unknown>;
  const rate = shipping.shippingRate as Record<string, unknown>;
  assert.equal(rate.value, "0");
  assert.equal(rate.currency, "TRY");
  const dest = shipping.shippingDestination as Record<string, unknown>;
  assert.equal(dest.addressCountry, "TR");
});

check("iade: kişiye özel üründe 14 gün YOK — sayfanın kendi beyanı", () => {
  // `/iade` (m.15/1-(b)) ve `landing.faq.a7`: kişiselleştirilmiş figürin
  // standart 14 günlük cayma hakkı KAPSAMI DIŞINDA. Pazaryeri ürününün
  // şeması 14 gün yazar (`seo/product.ts`), figürin YAZAMAZ.
  const policy = offer().hasMerchantReturnPolicy as Record<string, unknown>;
  assert.equal(
    policy.returnPolicyCategory,
    "https://schema.org/MerchantReturnNotPermitted"
  );
  assert.equal(policy.applicableCountry, "TR");
  assert.equal(
    policy.merchantReturnDays,
    undefined,
    "kişiye özel üründe gün sayısı yazmak sayfanın beyanını yalanlar"
  );
  assert.ok(
    (tr as Record<string, string>)["landing.faq.a7"].includes(
      "cayma hakkı geçerli değildir"
    ),
    "sayfanın beyanı değişmiş — şemanın gerekçesi kalmadı"
  );
});

check("availability InStock — MadeToOrder'ı Google desteklemiyor", () => {
  const o = offer();
  assert.equal(o.availability, "https://schema.org/InStock");
  assert.equal(o.itemCondition, "https://schema.org/NewCondition");
  assert.ok(!JSON.stringify(o).includes("MadeToOrder"));
});

check("priceValidUntil YUVARLANIYOR — sabit tarih markup'ı çürütür", () => {
  const a = offer().priceValidUntil as string;
  const b = (buildFigurineProductJsonLd(tr, APP, NOW + 90 * 86_400_000)
    .offers as Record<string, string>).priceValidUntil;
  assert.match(a, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(a, b, "tarih sabit — bir gün geçmişte kalır ve teklif düşer");
  assert.ok(a > "2026-10-02");
});

check("aggregateRating YOK — uydurma puan yazılmıyor", () => {
  const s = JSON.stringify(node());
  assert.ok(!s.includes("aggregateRating"), "gerçek yorum verimiz yok");
  assert.ok(!s.includes("ratingValue"));
  assert.ok(!s.includes("Review"));
});

check("brand/seller mevcut #organization düğümüne BAĞLANIR", () => {
  const n = node();
  const orgId = `${APP}/#organization`;
  assert.deepEqual(n.brand, { "@id": orgId });
  assert.deepEqual((n.offers as Record<string, unknown>).seller, { "@id": orgId });
  // İkinci bir organizasyon düğümü yaratılmadı: düğümde `Organization`
  // tipinde bir alt nesne yok.
  assert.ok(
    !JSON.stringify(n).includes('"@type":"Organization"'),
    "ikinci bir Organization düğümü yaratılmış"
  );
});

check("üç sayfa AYNI @id'yi taşır — tek ürün, üç yüzey", () => {
  // Farklı `@id`ler üç ayrı ürün demek olurdu.
  assert.equal(node()["@id"], figurineProductId(APP));
  assert.equal(figurineProductId(APP), `${APP}/figur#figurine`);
  // `@id` sayfaya göre DEĞİŞMEZ: builder sayfa adı almıyor, üç çağrı yeri de
  // aynı dizeyi basıyor.
  for (const file of [
    "src/app/figur/page.tsx",
    "src/app/nasil-calisir/page.tsx",
    "src/app/create/page.tsx",
  ]) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.match(
      source,
      /buildFigurineProductJsonLd\(/,
      `${file}: figürin şemasını yayınlamıyor`
    );
  }
  // Varsayılan appUrl de aynı biçimde kurulur.
  assert.equal(figurineProductId(), `${getAppUrl()}/figur#figurine`);
});

// ─── FAQPage ────────────────────────────────────────────────────────────────

check("FAQPage her soru-cevabı OLDUĞU GİBİ taşır", () => {
  const items = [
    { q: "Soru bir?", a: "Cevap bir." },
    { q: "Soru iki?", a: "Cevap iki." },
  ];
  const n = buildFaqPageJsonLd({ url: `${APP}/figur`, name: "SSS", items });
  assert.ok(n, "soru varken FAQPage üretilmiyor");
  assert.equal(n["@type"], "FAQPage");
  assert.equal(n["@id"], `${APP}/figur#faq`);
  assert.equal(n.name, "SSS");
  const entities = n.mainEntity as Array<Record<string, unknown>>;
  assert.equal(entities.length, 2);
  for (const [i, item] of items.entries()) {
    assert.equal(entities[i]["@type"], "Question");
    assert.equal(entities[i].name, item.q);
    const answer = entities[i].acceptedAnswer as Record<string, unknown>;
    assert.equal(answer["@type"], "Answer");
    // Birebir: şemaya sayfada OLMAYAN bir cevap yazmak Google'ın "yapısal
    // veri uyuşmazlığı" cezası.
    assert.equal(answer.text, item.a);
  }
});

check("FAQPage boş listede HİÇ yayımlanmaz", () => {
  assert.equal(
    buildFaqPageJsonLd({ url: `${APP}/figur`, name: "SSS", items: [] }),
    null,
    "soru yoksa boş bir FAQPage yayınlamak geçersiz markup"
  );
});

// ─── HowTo ──────────────────────────────────────────────────────────────────

check("HowTo adımları sıralı ve metinleri birebir", () => {
  const steps = [
    { name: "Birinci.", text: "Birinci adımın gövdesi." },
    { name: "İkinci.", text: "İkinci adımın gövdesi." },
  ];
  const n = buildHowToJsonLd({ url: `${APP}/nasil-calisir`, name: "Adımlar", steps });
  assert.ok(n, "adımlı HowTo üretilmiyor");
  assert.equal(n["@type"], "HowTo");
  assert.equal(n["@id"], `${APP}/nasil-calisir#howto`);
  assert.equal(n.name, "Adımlar");
  const list = n.step as Array<Record<string, unknown>>;
  assert.deepEqual(list.map((s) => s.position), [1, 2]);
  assert.deepEqual(list.map((s) => s.name), ["Birinci.", "İkinci."]);
  assert.deepEqual(list.map((s) => s.text), [
    "Birinci adımın gövdesi.",
    "İkinci adımın gövdesi.",
  ]);
  assert.equal(list[0]["@type"], "HowToStep");
});

check("HowTo boş listede HİÇ yayımlanmaz", () => {
  assert.equal(
    buildHowToJsonLd({ url: `${APP}/nasil-calisir`, name: "Adımlar", steps: [] }),
    null
  );
});

check("/nasil-calisir adımları İKİ DİLDE de kayıpsız metne çevrilir", () => {
  for (const locale of ["tr", "en"] as const) {
    const section = HOW_IT_WORKS_STEPS[locale];
    assert.equal(section.steps.length, 6, `${locale}: altı adım bekleniyor`);
    assert.ok(section.title.length > 0, `${locale}: bölüm başlığı yok`);
    for (const step of section.steps) {
      assert.ok(step.name.length > 0);
      const text = stepBodyText(step);
      assert.ok(text.length > 20, `${locale}: ${step.name} gövdesi çok kısa`);
      // Kalın parçalar metne DAHİL: şemanın metni ekrandaki metnin aynısı
      // olmalı, kalın yazılan rakamlar ("5-7 iş günü") düşmemeli.
      assert.doesNotMatch(text, /\s{2,}/, `${locale}: ${step.name} çift boşluk taşıyor`);
      assert.doesNotMatch(text, /^\s|\s$/, `${locale}: ${step.name} kenar boşluğu taşıyor`);
    }
  }
});

console.log(
  failures === 0
    ? `\n✅ seo-jsonld: tüm kontroller geçti`
    : `\n❌ seo-jsonld: ${failures} başarısız`
);
process.exit(failures === 0 ? 0 : 1);
