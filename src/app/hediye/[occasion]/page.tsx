import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { LastUpdated } from "@/components/last-updated";
import { OCCASIONS, occasionPath } from "@/lib/config/occasions";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { JsonLd } from "@/lib/seo/jsonld";
import { getAppUrl } from "@/lib/seo/organization";
import {
  OccasionArticle,
  occasionJsonLd,
  occasionMetadata,
  occasionOrNotFound,
} from "./occasion-page";

/**
 * `/hediye/<slug>` — altı özel gün sayfası, TEK rota.
 *
 * NİÇİN DİNAMİK ROTA + `generateStaticParams`, altı ayrı klasör değil: altı
 * sayfanın tek farkı özel günün sözlükten gelen adı ve açıklaması. Altı
 * `page.tsx` kopyası, yedincisi eklendiğinde yedi yerde güncellenecek yedi
 * kopya demekti; bu rotada yeni bir özel gün = kayda bir satır. `OCCASIONS`
 * sitemap'i, iç bağlantı bloğunu ve bu rota tablosunu birlikte besliyor, yani
 * üçü ayrışamaz.
 *
 * BUGÜN DİNAMİK (`ƒ`) ve prerender'ın önünde İKİ AYRI ENGEL var. Sayfanın
 * girdisi saf: veritabanı okuması, arama parametresi, kişiye özel veri
 * geçmiyor; tek girdi slug'ın kendisi ve sözlük. Ama saf girdi tek başına
 * prerender ettirmiyor:
 *  (1) Kök düzen `headers()` + `getLocale()` okuyor (`x-pathname` → kanonik +
 *      noindex; `app/layout.tsx:56,68,98`) ve bu, sitedeki app rotalarının
 *      TAMAMINI dinamiğe çeviriyor (`/figur`, `/nasil-calisir`, `/kargo`
 *      dâhil; 2026-10-02 build listesinde `○` olan ÜÇ şey var ve hiçbiri bir
 *      sayfa değil: `/opengraph-image`, `/robots.txt`, `/sitemap.xml`).
 *      Yani bu sayfaya özel bir durum değil.
 *  (2) BU dosyanın kendisi de `getLocale()`i iki kez çağırıyor (aşağıda
 *      `generateMetadata` ve sayfa gövdesi) ve `getLocale()` bir `cookies()`
 *      okumasıdır (`lib/i18n/get-locale.ts`) — `cookies()` Dynamic API olduğu
 *      için rota, kök düzen bir gün temizlense bile KENDİLİĞİNDEN prerender
 *      OLMAZ. `next.config.ts`te ne PPR ne `dynamicIO` açık; kaçış yolu yok.
 * İkinci engelin çözümü hazır ama bilerek uygulanmadı: `enabledLocales =
 * ["tr"]` olduğu sürece `getLocale()` yerine `defaultLocale` kullanmak çıktıyı
 * değiştirmezdi (aynı gerekçe `last-updated.tsx`in `locale` prop'unda yazılı),
 * yalnız `en` yeniden açıldığında bu altı sayfa Türkçeye çivilenirdi. (1)
 * dururken kazancı sıfır, bedeli gerçek olduğu için yapılmadı — prerender
 * gerçekten istenirse İKİSİ BİRLİKTE kaldırılmalı.
 * `generateStaticParams` buna rağmen boşa yazılmış değil: rota tablosunun
 * KAPALI kümesini ilan ediyor ve `dynamicParams = false`un dayanağı o.
 *
 * `dynamicParams = false` + sayfanın kendi `occasionOrNotFound` kapısı:
 * `generateStaticParams`in saymadığı bir slug 404 döner. İki kapı BİRLİKTE
 * duruyor çünkü rota prerender edilmediğinde `dynamicParams`ın tek başına
 * yeteceğine güvenilemez; ölçüm (üretim derlemesi, 2026-10-02):
 * `/hediye/yilbasi` → 404, `/hediye/Dogum-Gunu` → 404, altı kayıtlı slug → 200.
 *
 * NOINDEX DEĞİL: `/hediye` BİLEREK `NOINDEX_PREFIXES`te yok — bu sayfaların
 * indekslenmesi tam olarak amaç. `scripts/test-occasions.ts` listeyi çiviliyor.
 */
export const dynamicParams = false;

export function generateStaticParams(): Array<{ occasion: string }> {
  return OCCASIONS.map((o) => ({ occasion: o.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ occasion: string }>;
}): Promise<Metadata> {
  const { occasion: slug } = await params;
  const occasion = occasionOrNotFound(slug);
  const locale = await getLocale();
  // Başlık + açıklama tek kaynaktan: açıklamada FİYAT ve BOYUT geçiyor
  // (emsal `/nasil-calisir`), çünkü bu cümle bir asistanın sayfayı hiç
  // açmadan okuduğu tek metin olabilir.
  return occasionMetadata(occasion, getDictionary(locale), locale);
}

export default async function OccasionPage({
  params,
}: {
  params: Promise<{ occasion: string }>;
}) {
  const { occasion: slug } = await params;
  const occasion = occasionOrNotFound(slug);
  const locale = await getLocale();
  const d = getDictionary(locale);
  const appUrl = getAppUrl();
  const { product, faq, howTo } = occasionJsonLd(occasion, d, appUrl, locale);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      {/* Figürün makine okunur künyesi. `@id` `/figur`, `/nasil-calisir` ve
          `/create` ile AYNI — tek ürünün yüzeyleri, altı ayrı ürün değil. */}
      <JsonLd data={product} />
      {/* Soru/adım listesi boşsa builder `null` döner ve hiç `<script>`
          basılmaz: `mainEntity: []` taşıyan bir `FAQPage` geçersiz markup. */}
      {faq ? <JsonLd data={faq} /> : null}
      {howTo ? <JsonLd data={howTo} /> : null}
      <OccasionArticle occasion={occasion} d={d} locale={locale} />
      <LastUpdated path={occasionPath(occasion.slug)} locale={locale} />
    </main>
  );
}
