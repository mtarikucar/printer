import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { FigurunicaLanding } from "@/components/figurunica/landing";
import { pickFigurunicaDict } from "@/components/figurunica/dict";
import { figurineFaqItems } from "@/components/figurunica/faq-items";
import { LastUpdated } from "@/components/last-updated";
import { JsonLd } from "@/lib/seo/jsonld";
import { buildFigurineProductJsonLd } from "@/lib/seo/figurine";
import { buildFaqPageJsonLd } from "@/lib/seo/faq";
import { getAppUrl } from "@/lib/seo/organization";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const d = getDictionary(locale);
  return { title: `${d["landing.market.produce.figure.title"]} — Figurunica` };
}

// The full figurine storytelling landing (the scroll-journey) now lives here,
// reachable from nav/footer, while the homepage leads with the marketplace.
export default async function FigurinePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);
  const figurunica = pickFigurunicaDict(d);
  const appUrl = getAppUrl();
  // SSS şeması ekrandaki akordeonun AYNI listesinden türer (`figurineFaqItems`):
  // şemaya sayfada olmayan bir cevap yazmak "yapısal veri uyuşmazlığı"dır.
  const faq = buildFaqPageJsonLd({
    url: `${appUrl}/figur`,
    name: figurunica["landing.faq.title"],
    items: figurineFaqItems(figurunica),
  });

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      {/* Figürün makine okunur künyesi — fiyat, ölçü, üretim/kargo süresi.
          `@id` `/nasil-calisir` ve `/create` ile AYNI: tek ürün, üç yüzey. */}
      <JsonLd data={buildFigurineProductJsonLd(d, appUrl)} />
      {faq ? <JsonLd data={faq} /> : null}
      <FigurunicaLanding d={figurunica} />
      <LastUpdated path="/figur" locale={locale} />
    </main>
  );
}
