import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { WorkshopForm } from "./workshop-form";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const d = getDictionary(locale);
  return {
    title: d["workshop.meta.title"],
    description: d["workshop.meta.description"],
  };
}

const HIGHLIGHTS: { title: string; body: string }[] = [
  {
    title: "Mekânınıza geliyoruz",
    body: "Kafe, okul, ofis, doğum günü ya da özel bir grup — tüm malzeme ve ekipmanı biz getiriyoruz.",
  },
  {
    title: "Herkese uygun",
    body: "Çocuklardan yetişkinlere, her yaş grubuna göre uyarlanabilen keyifli bir figür boyama & tasarım deneyimi.",
  },
  {
    title: "Anahtar teslim",
    body: "Katılımcı sayısı ve konsepte göre size özel bir program ve teklif hazırlıyoruz.",
  },
];

export default async function WorkshopRequestPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-4xl mx-auto px-5 py-14 md:py-20">
        <header className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-wider text-green-500 mb-3">
            {d["workshop.eyebrow"]}
          </p>
          <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
            {d["workshop.title"]}
          </h1>
          <p className="text-base md:text-lg text-text-secondary leading-relaxed">
            {d["workshop.subtitle"]}
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-3 mt-10 mb-12">
          {HIGHLIGHTS.map((h) => (
            <div
              key={h.title}
              className="rounded-2xl border border-bg-subtle bg-bg-elevated/40 p-5"
            >
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">
                {h.title}
              </h3>
              <p className="text-sm text-text-muted leading-relaxed">{h.body}</p>
            </div>
          ))}
        </div>

        <WorkshopForm />
      </div>
    </main>
  );
}
