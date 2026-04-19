import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { FigurunicaLanding } from "@/components/figurunica/landing";
import { pickFigurunicaDict } from "@/components/figurunica/dict";

export const revalidate = 60;

export default async function HomePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <FigurunicaLanding d={pickFigurunicaDict(d)} />
    </main>
  );
}
