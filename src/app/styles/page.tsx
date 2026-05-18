import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/site-header";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { STYLE_LANDING, STYLE_SLUGS } from "@/lib/styles/landing-content";

/**
 * Index page that lists all per-style landing cards. Acts as the internal
 * authority hub: every per-style detail page gets one inbound internal
 * link from here, which helps SEO weight flow vs. only being reachable
 * via the sitemap.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
  const title =
    locale === "tr"
      ? "Figürin Stilleri — Disney, Anime, Chibi, Gerçekçi, Nesne | Figurine Studio"
      : "Figurine Styles — Disney, Anime, Chibi, Realistic, Object | Figurine Studio";
  const description =
    locale === "tr"
      ? "5 farklı tarzda 3D figürin — Disney, anime, chibi, gerçekçi ve nesne. Her stilin detaylarını inceleyin ve sevdiklerinize en uygun olanı seçin."
      : "5 different 3D figurine styles — Disney, anime, chibi, realistic, and object. Compare each style and pick the right one for your gift.";
  return {
    title,
    description,
    alternates: { canonical: `${baseUrl}/styles` },
    openGraph: {
      title,
      description,
      url: `${baseUrl}/styles`,
    },
  };
}

export default async function StylesIndexPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <div className="max-w-5xl mx-auto px-4 py-12">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-text-muted mb-6">
          <Link href="/" className="hover:text-green-500">
            {d["nav.home"]}
          </Link>
          <span>/</span>
          <span className="text-text-primary font-medium">
            {d["nav.styles"]}
          </span>
        </nav>

        <header className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-serif text-text-primary">
            {d["styles.indexTitle"]}
          </h1>
          <p className="mt-4 text-lg text-text-secondary max-w-2xl mx-auto">
            {d["styles.indexSubtitle"]}
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {STYLE_SLUGS.map((slug) => {
            const entry = STYLE_LANDING[slug];
            const c = entry.copy[locale];
            return (
              <Link
                key={slug}
                href={`/styles/${slug}`}
                className="group card overflow-hidden hover:shadow-elevated transition-shadow"
              >
                <div className="relative aspect-square bg-bg-elevated">
                  <Image
                    src={entry.heroImage}
                    alt={c.heroTitle}
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                </div>
                <div className="p-4">
                  <h2 className="text-lg font-semibold text-text-primary group-hover:text-green-500 transition-colors">
                    {c.heroTitle}
                  </h2>
                  <p className="text-sm text-text-muted mt-1 line-clamp-2">
                    {c.heroSubtitle}
                  </p>
                  <span className="inline-flex items-center gap-1 mt-3 text-sm text-green-500 font-medium">
                    {d["styles.learnMore"]}
                    <svg
                      className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
