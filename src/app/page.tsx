import Link from "next/link";
import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { GalleryPreview } from "./gallery-preview";

const GALLERY_STATUSES = [
  "approved",
  "printing",
  "shipped",
  "delivered",
] as const;

export default async function HomePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  // Fetch up to 6 featured gallery items
  const featuredOrders = await db.query.orders.findMany({
    where: and(
      eq(orders.isPublic, true),
      inArray(orders.status, [...GALLERY_STATUSES])
    ),
    orderBy: [desc(orders.publishedAt)],
    limit: 6,
    columns: {
      id: true,
      publicDisplayName: true,
      figurineSize: true,
      publishedAt: true,
    },
    with: {
      photos: {
        columns: { originalUrl: true },
        limit: 1,
      },
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputGlbUrl: true },
        orderBy: [desc(generationAttempts.createdAt)],
        limit: 1,
      },
    },
  });

  const galleryItems = featuredOrders.map((order) => ({
    id: order.id,
    publicDisplayName: order.publicDisplayName,
    figurineSize: order.figurineSize,
    publishedAt: order.publishedAt?.toISOString() ?? null,
    glbUrl: order.generationAttempts[0]?.outputGlbUrl ?? null,
    thumbnailUrl: order.photos[0]?.originalUrl ?? null,
  }));

  const steps = [
    {
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      title: d["landing.howItWorks.step1.title"],
      description: d["landing.howItWorks.step1.description"],
    },
    {
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      title: d["landing.howItWorks.step2.title"],
      description: d["landing.howItWorks.step2.description"],
    },
    {
      icon: (
        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
      title: d["landing.howItWorks.step3.title"],
      description: d["landing.howItWorks.step3.description"],
    },
  ];

  const sizes = [
    { key: "kucuk", label: d["sizes.kucuk"], price: "1.199", height: "~60mm", popular: false },
    { key: "orta", label: d["sizes.orta"], price: "1.799", height: "~80mm", popular: true },
    { key: "buyuk", label: d["sizes.buyuk"], price: "1.999", height: "~120mm", popular: false },
  ];

  const features = [
    d["landing.pricing.feature1"],
    d["landing.pricing.feature2"],
    d["landing.pricing.feature3"],
    d["landing.pricing.feature4"],
    d["landing.pricing.feature5"],
    d["landing.pricing.feature6"],
  ];

  const faqs = [
    { q: d["landing.faq.q1"], a: d["landing.faq.a1"] },
    { q: d["landing.faq.q2"], a: d["landing.faq.a2"] },
    { q: d["landing.faq.q3"], a: d["landing.faq.a3"] },
    { q: d["landing.faq.q4"], a: d["landing.faq.a4"] },
    { q: d["landing.faq.q5"], a: d["landing.faq.a5"] },
    { q: d["landing.faq.q6"], a: d["landing.faq.a6"] },
  ];

  const testimonials = [
    { quote: d["landing.testimonials.quote1"], name: d["landing.testimonials.name1"], location: d["landing.testimonials.location1"] },
    { quote: d["landing.testimonials.quote2"], name: d["landing.testimonials.name2"], location: d["landing.testimonials.location2"] },
    { quote: d["landing.testimonials.quote3"], name: d["landing.testimonials.name3"], location: d["landing.testimonials.location3"] },
  ];

  return (
    <main className="min-h-screen">
      <SiteHeader />

      {/* Hero */}
      <section className="relative mesh-gradient overflow-hidden">
        <div className="absolute inset-0 dot-grid -z-0" />
        <div className="relative max-w-6xl mx-auto px-4 py-24 md:py-32">
          <div className="md:grid md:grid-cols-2 md:gap-12 md:items-center">
            <div className="text-center md:text-left">
              <div className="animate-fade-in-up">
                <span className="inline-flex items-center gap-2 bg-primary-50 text-primary-700 text-sm font-medium px-4 py-1.5 rounded-full border border-primary-100">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  {d["landing.hero.trustBadge"]}
                </span>
              </div>
              <h1 className="mt-6 text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-gradient animate-fade-in-up delay-100">
                {d["landing.hero.title"]}
              </h1>
              <p className="mt-6 text-lg md:text-xl text-gray-600 max-w-xl leading-relaxed animate-fade-in-up delay-200">
                {d["landing.hero.subtitle"]}
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center gap-4 md:justify-start justify-center animate-fade-in-up delay-300">
                <Link href="/create" className="btn-primary text-lg !px-8 !py-3.5 animate-pulse-glow">
                  {d["landing.nav.getStarted"]}
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                <Link href="/gallery" className="btn-secondary text-base">
                  {d["landing.gallery.viewAll"]}
                </Link>
              </div>
              <p className="mt-4 text-sm text-gray-500 animate-fade-in-up delay-400">
                {d["landing.hero.tagline"]}
              </p>
            </div>
            {/* Decorative right side */}
            <div className="hidden md:flex items-center justify-center">
              <div className="relative w-80 h-80 animate-fade-in-up delay-300">
                <div className="absolute inset-0 bg-gradient-to-br from-primary-200/40 to-accent-200/40 rounded-3xl rotate-6" />
                <div className="absolute inset-0 bg-gradient-to-tr from-accent-200/40 to-pink-200/40 rounded-3xl -rotate-6" />
                <div className="absolute inset-4 bg-white/60 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                  <svg className="w-32 h-32 text-primary-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={0.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="section-spacing border-b border-surface-200">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: "500+", label: d["landing.stats.figurines"] },
              { value: "100+", label: d["landing.stats.reviews"] },
              { value: d["landing.stats.processingValue"], label: d["landing.stats.processing"] },
              { value: "\u2713", label: d["landing.stats.shipping"] },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={`text-center animate-fade-in-up delay-${(i + 1) * 100}`}
              >
                <p className="text-3xl md:text-4xl font-bold text-gradient">
                  {stat.value}
                </p>
                <p className="mt-1 text-sm text-gray-500 font-medium">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="section-spacing bg-gradient-to-b from-surface-50 to-white">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center">
            <span className="inline-block text-xs font-semibold tracking-wider text-primary-600 bg-primary-50 px-3 py-1 rounded-full">
              {d["section.howItWorks"]}
            </span>
            <h2 className="mt-4 text-3xl md:text-4xl font-bold text-gray-900">
              {d["landing.howItWorks.title"]}
            </h2>
          </div>
          <div className="mt-14 grid md:grid-cols-3 gap-8 relative">
            {/* Connector line (desktop) */}
            <div className="hidden md:block absolute top-16 left-[20%] right-[20%] h-px border-t-2 border-dashed border-surface-300" />
            {steps.map((step, i) => (
              <div
                key={i}
                className={`card p-8 text-center hover:-translate-y-1 transition-all animate-fade-in-up delay-${(i + 1) * 100} relative`}
              >
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 text-white text-sm font-bold flex items-center justify-center shadow-sm">
                  {i + 1}
                </div>
                <div className="w-16 h-16 bg-gradient-to-br from-primary-50 to-accent-50 text-primary-600 rounded-2xl flex items-center justify-center mx-auto mt-2">
                  {step.icon}
                </div>
                <h3 className="mt-5 text-xl font-semibold text-gray-900">
                  {step.title}
                </h3>
                <p className="mt-2 text-gray-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery Preview */}
      {galleryItems.length > 0 && (
        <section className="section-spacing">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center">
              <span className="inline-block text-xs font-semibold tracking-wider text-primary-600 bg-primary-50 px-3 py-1 rounded-full">
                {d["section.gallery"]}
              </span>
              <h2 className="mt-4 text-3xl md:text-4xl font-bold text-gray-900">
                {d["landing.gallery.title"]}
              </h2>
              <p className="mt-2 text-gray-600">
                {d["landing.gallery.subtitle"]}
              </p>
            </div>
            <div className="mt-10">
              <GalleryPreview items={galleryItems} />
            </div>
            <div className="mt-8 text-center">
              <Link href="/gallery" className="btn-secondary">
                {d["landing.gallery.viewAll"]}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Testimonials */}
      <section className="section-spacing bg-gradient-to-b from-white to-surface-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center">
            <span className="inline-block text-xs font-semibold tracking-wider text-primary-600 bg-primary-50 px-3 py-1 rounded-full">
              {d["section.testimonials"]}
            </span>
            <h2 className="mt-4 text-3xl md:text-4xl font-bold text-gray-900">
              {d["landing.testimonials.title"]}
            </h2>
            <p className="mt-2 text-gray-600">
              {d["landing.testimonials.subtitle"]}
            </p>
          </div>
          <div className="mt-12 grid md:grid-cols-3 gap-8">
            {testimonials.map((t, i) => (
              <div
                key={i}
                className={`card p-8 relative animate-fade-in-up delay-${(i + 1) * 100}`}
              >
                <span className="absolute top-4 left-6 text-6xl text-primary-100 font-serif leading-none">&ldquo;</span>
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, j) => (
                    <svg key={j} className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="text-gray-700 leading-relaxed relative z-10">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="mt-5 pt-4 border-t border-surface-200">
                  <p className="font-semibold text-gray-900">{t.name}</p>
                  <p className="text-sm text-gray-500">{t.location}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="section-spacing">
        <div className="max-w-4xl mx-auto px-4">
          <div className="text-center">
            <span className="inline-block text-xs font-semibold tracking-wider text-primary-600 bg-primary-50 px-3 py-1 rounded-full">
              {d["section.pricing"]}
            </span>
            <h2 className="mt-4 text-3xl md:text-4xl font-bold text-gray-900">
              {d["landing.pricing.title"]}
            </h2>
            <p className="mt-2 text-gray-600">
              {d["landing.pricing.subtitle"]}
            </p>
          </div>
          <div className="mt-12 grid sm:grid-cols-3 gap-6 items-start">
            {sizes.map((size) => (
              <div
                key={size.key}
                className={`relative text-center transition-all duration-200 ${
                  size.popular ? "md:scale-105 z-10" : ""
                }`}
              >
                {size.popular && (
                  <div className="absolute -inset-[2px] bg-gradient-to-br from-primary-500 to-accent-500 rounded-2xl" />
                )}
                <div
                  className={`relative bg-white rounded-2xl p-6 ${
                    size.popular
                      ? "shadow-elevated"
                      : "card"
                  }`}
                >
                  {size.popular && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary-600 to-accent-600 text-white text-xs font-bold px-4 py-1 rounded-full shadow-sm">
                      MOST POPULAR
                    </span>
                  )}
                  <p className="text-lg font-semibold text-gray-900">
                    {size.label}
                  </p>
                  <p className="text-sm text-gray-500">{size.height}</p>
                  <p className="mt-3 text-4xl font-bold text-gradient">
                    ₺{size.price}
                  </p>
                  <ul className="mt-5 space-y-2.5 text-sm text-left">
                    {features.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <span className="flex-shrink-0 w-5 h-5 bg-primary-50 rounded-full flex items-center justify-center mt-0.5">
                          <svg className="w-3 h-3 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                        <span className="text-gray-700">{item}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/create"
                    className={`mt-6 block w-full text-center py-2.5 rounded-xl font-semibold transition-all ${
                      size.popular
                        ? "btn-primary !block"
                        : "btn-secondary !block"
                    }`}
                  >
                    {d["landing.pricing.select"]}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section-spacing bg-gradient-to-b from-surface-50 to-white">
        <div className="max-w-3xl mx-auto px-4">
          <div className="text-center">
            <span className="inline-block text-xs font-semibold tracking-wider text-primary-600 bg-primary-50 px-3 py-1 rounded-full">
              {d["section.faq"]}
            </span>
            <h2 className="mt-4 text-3xl md:text-4xl font-bold text-gray-900">
              {d["landing.faq.title"]}
            </h2>
          </div>
          <div className="mt-10 space-y-3">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group card overflow-hidden"
              >
                <summary className="flex items-center justify-between cursor-pointer p-5 font-semibold text-gray-900 select-none hover:bg-surface-50 transition-colors">
                  {faq.q}
                  <svg
                    className="w-5 h-5 text-gray-400 shrink-0 transition-transform duration-300 group-open:rotate-180"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="accordion-content">
                  <div>
                    <p className="px-5 pb-5 text-gray-600 leading-relaxed">
                      {faq.a}
                    </p>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-20" style={{ background: "var(--gradient-cta)" }}>
        <div className="max-w-4xl mx-auto px-4 text-center relative overflow-hidden">
          {/* Decorative shapes */}
          <div className="absolute top-0 left-0 w-64 h-64 rounded-full bg-white/5 -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full bg-white/5 translate-x-1/3 translate-y-1/3" />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold text-white animate-fade-in-up">
              {d["landing.cta.title"]}
            </h2>
            <p className="mt-4 text-lg text-white/80 max-w-2xl mx-auto animate-fade-in-up delay-100">
              {d["landing.cta.subtitle"]}
            </p>
            <div className="mt-8 animate-fade-in-up delay-200">
              <Link
                href="/create"
                className="inline-flex items-center gap-2 bg-white text-primary-700 font-bold px-8 py-3.5 rounded-xl text-lg hover:bg-surface-50 transition-colors shadow-lg"
              >
                {d["landing.cta.button"]}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 text-white font-bold text-lg">
                <svg className="w-6 h-6 text-primary-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                </svg>
                Figurine Studio
              </div>
              <p className="mt-3 text-sm text-gray-400">
                {d["landing.footer.description"]}
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-sm font-semibold text-white uppercase tracking-wider">
                {d["landing.footer.product"]}
              </h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><Link href="/gallery" className="text-gray-400 hover:text-white transition-colors">{d["nav.gallery"]}</Link></li>
                <li><Link href="/create" className="text-gray-400 hover:text-white transition-colors">{d["nav.create"]}</Link></li>
                <li><a href="#pricing" className="text-gray-400 hover:text-white transition-colors">{d["landing.pricing.title"]}</a></li>
              </ul>
            </div>

            {/* Support */}
            <div>
              <h4 className="text-sm font-semibold text-white uppercase tracking-wider">
                {d["landing.footer.support"]}
              </h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><a href="#faq" className="text-gray-400 hover:text-white transition-colors">{d["landing.footer.faq"]}</a></li>
                <li><Link href="/login" className="text-gray-400 hover:text-white transition-colors">{d["landing.footer.contact"]}</Link></li>
                <li><Link href="/login" className="text-gray-400 hover:text-white transition-colors">{d["landing.footer.trackOrder"]}</Link></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-sm font-semibold text-white uppercase tracking-wider">
                {d["landing.footer.legal"]}
              </h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">{d["landing.footer.privacy"]}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">{d["landing.footer.terms"]}</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              &copy; {new Date().getFullYear()} Figurine Studio. {d["landing.footer.rights"]}
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
