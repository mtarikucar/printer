import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { FigurunicaLanding } from "@/components/figurunica/landing";
import { pickFigurunicaDict } from "@/components/figurunica/dict";

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

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <FigurunicaLanding d={pickFigurunicaDict(d)} />
    </main>
  );
}
