import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/site-header";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { STYLE_LANDING, STYLE_SLUGS, type StyleSlug } from "@/lib/styles/landing-content";

// Pre-render all 5 style pages at build time so they're statically cached
// (good for SEO + CDN; no DB lookup needed).
export function generateStaticParams() {
  return STYLE_SLUGS.map((slug) => ({ slug }));
}

function isStyleSlug(s: string): s is StyleSlug {
  return (STYLE_SLUGS as string[]).includes(s);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isStyleSlug(slug)) return {};
  const locale = await getLocale();
  const content = STYLE_LANDING[slug].copy[locale];
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
  return {
    title: content.pageTitle,
    description: content.metaDescription,
    alternates: { canonical: `${baseUrl}/styles/${slug}` },
    openGraph: {
      title: content.pageTitle,
      description: content.metaDescription,
      url: `${baseUrl}/styles/${slug}`,
      images: [
        {
          url: `${baseUrl}${STYLE_LANDING[slug].heroImage}`,
          width: 800,
          height: 800,
          alt: content.heroTitle,
        },
      ],
    },
  };
}

export default async function StyleLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isStyleSlug(slug)) notFound();

  const locale = await getLocale();
  const d = getDictionary(locale);
  const entry = STYLE_LANDING[slug];
  const content = entry.copy[locale];

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <div className="max-w-5xl mx-auto px-4 py-12">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-text-muted mb-6">
          <Link href="/" className="hover:text-green-500 transition-colors">
            {d["nav.home"]}
          </Link>
          <span>/</span>
          <Link
            href="/gallery"
            className="hover:text-green-500 transition-colors"
          >
            {d["nav.gallery"]}
          </Link>
          <span>/</span>
          <span className="text-text-primary font-medium">
            {content.heroTitle}
          </span>
        </nav>

        {/* Hero */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center mb-16">
          <div className="order-2 md:order-1">
            <h1 className="text-4xl md:text-5xl font-serif text-text-primary leading-tight">
              {content.heroTitle}
            </h1>
            <p className="mt-4 text-lg text-text-secondary leading-relaxed">
              {content.heroSubtitle}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={`/create?style=${entry.slug}`}
                className="btn-primary text-sm"
              >
                {content.ctaPrimary}
              </Link>
              <Link href="/gallery" className="btn-secondary text-sm">
                {content.ctaSecondary}
              </Link>
            </div>
          </div>
          <div className="order-1 md:order-2 relative aspect-square rounded-2xl overflow-hidden shadow-elevated bg-bg-elevated">
            <Image
              src={entry.heroImage}
              alt={content.heroTitle}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority
            />
          </div>
        </section>

        {/* Features */}
        <section className="mb-16">
          <h2 className="text-2xl md:text-3xl font-serif text-text-primary mb-8 text-center">
            {content.featuresHeading}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {content.features.map((f) => (
              <div key={f.title} className="card p-6">
                <h3 className="text-base font-semibold text-text-primary mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Perfect for */}
        <section className="mb-16">
          <h2 className="text-2xl md:text-3xl font-serif text-text-primary mb-6 text-center">
            {content.perfectForHeading}
          </h2>
          <div className="card p-6 max-w-2xl mx-auto">
            <ul className="space-y-3">
              {content.perfectForItems.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 text-text-secondary"
                >
                  <svg
                    className="w-5 h-5 text-green-500 shrink-0 mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span className="text-sm">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="text-center py-12 card">
          <h2 className="text-3xl md:text-4xl font-serif text-text-primary">
            {content.heroTitle}
          </h2>
          <p className="mt-3 text-text-secondary max-w-xl mx-auto">
            {content.heroSubtitle}
          </p>
          <div className="mt-6">
            <Link
              href={`/create?style=${entry.slug}`}
              className="btn-primary"
            >
              {content.ctaPrimary}
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
