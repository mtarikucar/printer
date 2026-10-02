import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX } from "react";
import {
  FIGURINE_HEIGHT_LABEL,
  FIGURINE_LEAD_DAYS,
  FIGURINE_PRICE_LABEL,
  layerHeightLabel,
} from "@/lib/config/product-facts";
import { FIGURINE_PRICE_KURUS } from "@/lib/config/prices";
import {
  OCCASIONS,
  findOccasion,
  occasionPath,
  type Occasion,
  type OccasionDict,
} from "@/lib/config/occasions";
import type { Locale } from "@/lib/i18n/types";
import { buildFaqPageJsonLd, type FaqPair } from "@/lib/seo/faq";
import {
  buildFigurineProductJsonLd,
  type FigurineSchemaDict,
} from "@/lib/seo/figurine";
import { buildHowToJsonLd } from "@/lib/seo/howto";
import { getAppUrl } from "@/lib/seo/organization";
import {
  HOW_IT_WORKS_STEPS,
  HowItWorksSteps,
  stepBodyText,
} from "@/app/nasil-calisir/steps";

/**
 * ALTI ÖZEL GÜN SAYFASININ TEK GÖVDESİ.
 *
 * Altı dosya kopyalanmadı: kayıt (`lib/config/occasions.ts`) + bu bileşen +
 * tek bir dinamik rota. Sayfa başına değişen tek şey özel günün SÖZLÜKTEN
 * gelen adı ve açıklaması; ürün gerçekleri, adım listesi ve soruların iki
 * tanesi altı sayfada AYNI, çünkü satılan ürün de aynı.
 *
 * HİÇBİR RAKAM ELLE YAZILMAZ. Fiyat `FIGURINE_PRICE_LABEL`den (kaynağı
 * `FIGURINE_PRICE_KURUS`), ölçü `FIGURINE_HEIGHT_LABEL`den, katman yüksekliği
 * sözlükten (`layerHeightLabel`, `/figur` kahraman şeridiyle aynı anahtar),
 * teslim süreleri `FIGURINE_LEAD_DAYS`ten gelir. Bir kopya, bir gün sabitten
 * ayrışacak ve müşteriye yanlış rakam söyleyecek bir cümle demektir;
 * `scripts/test-occasions.ts` bu dosyada elle yazılmış rakam ARAR.
 *
 * GERÇEKLER SAYFANIN İLK %30'UNDA: ölçüm (2026-10-02) bir asistanın
 * atıflarının %44,2'sinin dokümanın ilk %30'undan geldiğini söylüyor, bu
 * yüzden fiyat/ölçü/katman/teslim süresi h1'in hemen altında, adım listesinden
 * ve SSS'den ÖNCE duruyor. Konum testle çivili.
 *
 * METİN NEREDEN GELİYOR:
 *  - Özel günün adı ve açıklaması: SÖZLÜK (`landing.useCases.*`), zaten
 *    yazılıydı ve hiçbir yer render etmiyordu.
 *  - Üçüncü soru-cevap: `/figur`in SSS'sinde ZATEN yayımlanan, doğrulanmış
 *    çift (`landing.faq.q2`/`a2`).
 *  - Künye cümleleri ve ilk iki soru: BURADA, `/nasil-calisir` emsaliyle aynı
 *    biçimde satır içi iki dilli yazılı. Her yeni cümle ya bir sabitten rakam
 *    taşır ya da başka bir yüzeyde zaten doğrulanmış bir gerçeği tekrar eder;
 *    uydurma bir iddia (ödül, müşteri sayısı, "en iyi") YOK.
 *
 * Adım listesi `/nasil-calisir`ın VERİ modülünden okunur — ikinci bir kopya
 * yazılmadı. Böylece ekrandaki altı adım, oradaki altı adım ve üç sayfanın
 * `HowTo` şeması tek kaynaktan türüyor.
 */

const HEIGHT = FIGURINE_HEIGHT_LABEL;
const PRICE_EN = (FIGURINE_PRICE_KURUS / 100).toLocaleString("en-US");
const PRODUCTION = `${FIGURINE_LEAD_DAYS.productionMin}-${FIGURINE_LEAD_DAYS.productionMax}`;
const TRANSIT = `${FIGURINE_LEAD_DAYS.transitMin}-${FIGURINE_LEAD_DAYS.transitMax}`;
/** Kapıdan kapıya: beşinci bir sabit değil, iki ucun toplamı (`steps.tsx` ile aynı hesap). */
const DOOR = `${FIGURINE_LEAD_DAYS.productionMin + FIGURINE_LEAD_DAYS.transitMin}-${
  FIGURINE_LEAD_DAYS.productionMax + FIGURINE_LEAD_DAYS.transitMax
}`;

/**
 * Sayfanın sözlükten okuduğu alanlar — YAPISAL tip.
 *
 * `Dictionary` ithal EDİLMİYOR (ev deseni: `seo/figurine.ts`,
 * `config/product-facts.ts`): çağıran hangi dilin sözlüğünü verdiyse sayfa o
 * dilde çıkar. Gerçek bir `Dictionary` bu şekli yapısal olarak karşılar, yani
 * anahtarlardan biri sözlükte yoksa çağrı yeri DERLENMEZ — tip kapısı tam
 * burada.
 */
export type OccasionPageDict = OccasionDict &
  FigurineSchemaDict & {
    /** "Sıkça Sorulan Sorular" — SSS bölümünün başlığı, `/figur` ile aynı. */
    "landing.faq.title": string;
    /** `/figur`de ZATEN yayımlanan doğrulanmış soru-cevap. */
    "landing.faq.q2": string;
    "landing.faq.a2": string;
    /** Katman yüksekliği ("25" + "µm") — `layerHeightLabel`in okuduğu çift. */
    "landing.fig.hero.stat1.v": string;
    "landing.fig.hero.stat1.u": string;
  };

/**
 * Slug kayıtta yoksa 404.
 *
 * `dynamicParams = false` zaten yönlendirme katmanında kapatıyor, ama bu kapı
 * da duruyor: iki savunma farklı şeyleri yakalar (biri rota tablosunu, diğeri
 * sayfanın kendi varsayımını) ve kayıt dışı bir slug'ın SESSİZCE boş bir sayfa
 * çizmesi en kötü sonuç olurdu — tarayıcı onu ince içerik sayar.
 */
export function occasionOrNotFound(slug: string): Occasion {
  const occasion = findOccasion(slug);
  if (!occasion) notFound();
  return occasion;
}

/**
 * Arama sonucunda görünen başlık + açıklama.
 *
 * Açıklamada FİYAT ve BOYUT geçer; emsal `/nasil-calisir`in kendi açıklaması.
 * Bu, bir asistanın sayfayı hiç açmadan okuduğu tek cümle olabilir, bu yüzden
 * rakamlar oraya da giriyor.
 */
export function occasionMetadata(
  occasion: Occasion,
  d: OccasionPageDict,
  locale: Locale
): { title: string; description: string } {
  const title = d[occasion.titleKey];
  const desc = d[occasion.descKey];
  if (locale === "tr") {
    return {
      title: `${title} — Figurunica`,
      description: `${desc} ${HEIGHT} SLA reçine figür, profesyonel el boyamalı, ${FIGURINE_PRICE_LABEL} (KDV dahil), Türkiye içi kargo ücretsiz. Üretim ${PRODUCTION}, kargo ${TRANSIT} iş günü.`,
    };
  }
  return {
    title: `${title} — Figurunica`,
    description: `${desc} A ${HEIGHT} SLA resin figurine, professionally hand-painted, ${PRICE_EN} TL (VAT included), free shipping within Türkiye. ${PRODUCTION} business days to produce, ${TRANSIT} to ship.`,
  };
}

/**
 * Sayfanın SSS'si — üç soru.
 *
 * İlk ikisi özel günün ADINI taşır (altı sayfanın SSS'si birbirinin kopyası
 * olmasın) ve cevapları tamamen sabitlerden türüyor. Üçüncüsü `/figur`de zaten
 * yayımlanan doğrulanmış çift: fotoğraf kalitesi sorusu her özel gün için aynı
 * şekilde geçerli ve ikinci bir cevap yazmak o cevabı bir gün ayrıştırırdı.
 */
export function occasionFaqItems(
  occasion: Occasion,
  d: OccasionPageDict,
  locale: Locale
): FaqPair[] {
  const title = d[occasion.titleKey];
  if (locale === "tr") {
    return [
      {
        q: `${title} için ne kadar önceden sipariş vermeliyim?`,
        a: `Önizlemeyi onayladıktan sonra üretim ${PRODUCTION} iş günü, kargo ${TRANSIT} iş günü sürer; kapıdan kapıya ${DOOR} iş günü. Türkiye içi kargo ücretsizdir.`,
      },
      {
        q: `${title} olarak ne gönderiyorsunuz; ölçü ve fiyat nedir?`,
        a: `Satılan tek ölçü ${HEIGHT}: SLA reçine baskı, ${layerHeightLabel(d)} katman yüksekliği, atölyemizde profesyonel el boyaması. Tek fiyat ${FIGURINE_PRICE_LABEL}, KDV dahil.`,
      },
      { q: d["landing.faq.q2"], a: d["landing.faq.a2"] },
    ];
  }
  return [
    {
      q: `How far ahead should I order a ${title}?`,
      a: `After you approve the preview, production takes ${PRODUCTION} business days and shipping ${TRANSIT}; door to door that is ${DOOR} business days. Shipping within Türkiye is free.`,
    },
    {
      q: `${title}: what size is it and what does it cost?`,
      a: `The only size we sell is ${HEIGHT}: SLA resin printed at a ${layerHeightLabel(d)} layer height and professionally hand-painted in our workshop. One price, ${PRICE_EN} TL, VAT included.`,
    },
    { q: d["landing.faq.q2"], a: d["landing.faq.a2"] },
  ];
}

/**
 * Sayfanın üç yapısal veri düğümü.
 *
 * `Product` düğümünün `@id`si `/figur`, `/nasil-calisir` ve `/create` ile
 * AYNI: satılan şey tek bir ürün ve altı özel gün sayfası onun altı yüzeyi.
 * Ayrı `@id`ler Google'a altı farklı ürün gibi görünürdü. `FAQPage` ve `HowTo`
 * ise SAYFA düğümleridir — soruların ve adımların GÖRÜNDÜĞÜ belgeye bağlanır,
 * bu yüzden `@id` sayfanın kendi adresinden türer.
 */
export function occasionJsonLd(
  occasion: Occasion,
  d: OccasionPageDict,
  appUrl: string = getAppUrl(),
  locale: Locale = "tr"
): {
  product: Record<string, unknown>;
  faq: Record<string, unknown> | null;
  howTo: Record<string, unknown> | null;
} {
  const url = `${appUrl}${occasionPath(occasion.slug)}`;
  const steps = HOW_IT_WORKS_STEPS[locale];
  return {
    product: buildFigurineProductJsonLd(d, appUrl),
    faq: buildFaqPageJsonLd({
      url,
      name: d["landing.faq.title"],
      items: occasionFaqItems(occasion, d, locale),
    }),
    howTo: buildHowToJsonLd({
      url,
      name: steps.title,
      steps: steps.steps.map((step) => ({
        name: step.name,
        text: stepBodyText(step),
      })),
    }),
  };
}

/** Diğer beş özel gün — kümenin kendi içinde bağlanması için. */
function siblings(occasion: Occasion) {
  return OCCASIONS.filter((o) => o.slug !== occasion.slug);
}

export function OccasionArticle({
  occasion,
  d,
  locale,
}: {
  occasion: Occasion;
  d: OccasionPageDict;
  locale: Locale;
}): JSX.Element {
  const isTr = locale === "tr";
  const LAYER = layerHeightLabel(d);
  const steps = HOW_IT_WORKS_STEPS[locale];
  const faq = occasionFaqItems(occasion, d, locale);

  return (
    <>
      <section className="relative overflow-hidden border-b border-border-default">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-green-400/12 blur-[120px]"
        />
        <div className="relative mx-auto max-w-3xl px-5 pt-16 pb-12 md:pt-24 md:pb-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-green-600">
            {d["landing.useCases.title"]}
          </p>
          <h1
            className="mt-3 text-4xl text-text-primary md:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {d[occasion.titleKey]}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-text-secondary">
            {d[occasion.descKey]}{" "}
            {isTr
              ? `Fotoğrafından üretilen ${HEIGHT} boyunda, SLA reçine baskı, profesyonel el boyamalı kişiye özel figür. Tek fiyat ${FIGURINE_PRICE_LABEL} (KDV dahil), Türkiye içi kargo ücretsiz.`
              : `A custom figurine made from your photo: ${HEIGHT} tall, SLA resin printed, professionally hand-painted. One price, ${PRICE_EN} TL (VAT included), free shipping within Türkiye.`}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-5 py-14 md:py-20">
        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h2]:first:mt-0 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary [&_ol]:text-text-secondary [&_ol]:mb-4 [&_ol]:ml-6 [&_ol]:list-decimal">
          {/* ÜRÜN GERÇEKLERİ — adım listesinden ve SSS'den ÖNCE. Rakamların
              hepsi sabitten; emsal `/nasil-calisir`in aynı maddeleri. */}
          <h2>{isTr ? "Tek ürün, tek fiyat" : "One product, one price"}</h2>
          <ul>
            <li>
              <strong>{isTr ? "Fiyat:" : "Price:"}</strong>{" "}
              {isTr
                ? `${FIGURINE_PRICE_LABEL}, KDV dahil. Tek fiyat — boyuta, malzemeye veya bitişe göre değişmez.`
                : `${PRICE_EN} TL, VAT included. One price — it does not change with size, material, or finish.`}
            </li>
            <li>
              <strong>{isTr ? "Boyut:" : "Size:"}</strong>{" "}
              {isTr
                ? `${HEIGHT} yükseklik — satılan tek ölçü.`
                : `${HEIGHT} tall — the only size we sell.`}
            </li>
            <li>
              <strong>{isTr ? "Baskı:" : "Printing:"}</strong>{" "}
              {isTr
                ? `SLA reçine, ${LAYER} katman yüksekliği. Katman izi görünmeyecek kadar ince çözünürlük.`
                : `SLA resin at a ${LAYER} layer height, a resolution fine enough to hide layer lines.`}
            </li>
            <li>
              <strong>{isTr ? "Boyama:" : "Painting:"}</strong>{" "}
              {isTr
                ? "Figür atölyemizde tek tek elle boyanır; kutudan sergilemeye hazır çıkar."
                : "Each figurine is painted by hand in our workshop; it arrives display-ready."}
            </li>
            <li>
              <strong>{isTr ? "Teslim:" : "Delivery:"}</strong>{" "}
              {isTr
                ? `Önizleme onayından sonra üretim ${PRODUCTION} iş günü, kargo ${TRANSIT} iş günü. Türkiye içi kargo ücretsiz.`
                : `${PRODUCTION} business days to produce after preview approval, ${TRANSIT} to ship. Shipping within Türkiye is free.`}
            </li>
          </ul>

          <div className="not-prose my-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/create"
              className="inline-flex items-center justify-center rounded-full bg-green-600 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
            >
              {isTr ? "Figürünü oluştur" : "Create your figurine"}
            </Link>
            <Link
              href="/nasil-calisir"
              className="inline-flex items-center justify-center rounded-full border border-border-default bg-white px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated"
            >
              {isTr ? "Nasıl çalışır" : "How it works"}
            </Link>
          </div>

          {/* Adımlar `/nasil-calisir`ın veri modülünden: ekrandaki liste,
              oradaki liste ve `HowTo` şeması tek kaynaktan türüyor. */}
          <h2>{steps.title}</h2>
          <HowItWorksSteps steps={steps.steps} />

          <h2>{d["landing.faq.title"]}</h2>
          {faq.map((item) => (
            <div key={item.q}>
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </div>
          ))}

          <h2>{isTr ? "Diğer hediye fikirleri" : "Other gift ideas"}</h2>
          <ul>
            {siblings(occasion).map((other) => (
              <li key={other.slug}>
                <Link href={occasionPath(other.slug)}>{d[other.titleKey]}</Link>
                {" — "}
                {d[other.descKey]}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
