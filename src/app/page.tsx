import Link from "next/link";
import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { GalleryPreview } from "./gallery-preview";
import { LandingClient } from "./landing-client";

const GALLERY_STATUSES = [
  "approved",
  "printing",
  "shipped",
  "delivered",
] as const;

export default async function HomePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  // Fetch up to 8 featured gallery items
  const featuredOrders = await db.query.orders.findMany({
    where: and(
      eq(orders.isPublic, true),
      inArray(orders.status, [...GALLERY_STATUSES])
    ),
    orderBy: [desc(orders.publishedAt)],
    limit: 8,
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

  // Find first gallery item that has both photo + GLB for hero showcase
  const heroItem = galleryItems.find((item) => item.thumbnailUrl && item.glbUrl) ?? null;

  const steps = [
    {
      number: "01",
      title: d["landing.howItWorks.step1.title"],
      description: d["landing.howItWorks.step1.description"],
      icon: (
        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      number: "02",
      title: d["landing.howItWorks.step2.title"],
      description: d["landing.howItWorks.step2.description"],
      icon: (
        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      number: "03",
      title: d["landing.howItWorks.step3.title"],
      description: d["landing.howItWorks.step3.description"],
      icon: (
        <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
    },
  ];

  const sizes = [
    { key: "kucuk", label: d["sizes.kucuk"], price: "999", height: "~60mm", popular: false },
    { key: "orta", label: d["sizes.orta"], price: "1.399", height: "~80mm", popular: true },
    { key: "buyuk", label: d["sizes.buyuk"], price: "1.799", height: "~120mm", popular: false },
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

  const marqueeItems = galleryItems
    .filter((item) => item.thumbnailUrl)
    .map((item) => ({
      src: item.thumbnailUrl!,
      alt: item.publicDisplayName || "Figurine",
      hasModel: !!item.glbUrl,
    }));

  const testimonials = [
    {
      quote: d["landing.testimonials.quote1"],
      name: d["landing.testimonials.name1"],
      location: d["landing.testimonials.location1"],
    },
    {
      quote: d["landing.testimonials.quote2"],
      name: d["landing.testimonials.name2"],
      location: d["landing.testimonials.location2"],
    },
    {
      quote: d["landing.testimonials.quote3"],
      name: d["landing.testimonials.name3"],
      location: d["landing.testimonials.location3"],
    },
  ];

  const communityStats = [
    { value: 500, suffix: "+", label: d["landing.stats.figurines"], display: null },
    { value: 4.9, suffix: "/5", label: d["landing.stats.reviews"], display: null },
    { value: 48, suffix: d["landing.stats.processingValue"] === "48h" ? "h" : "s", label: d["landing.stats.processing"], display: null },
    { value: 0, suffix: "", label: d["landing.stats.shipping"], display: d["landing.stats.processingValue"] === "48h" ? "Free" : d["landing.stats.shipping"] },
  ];

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <LandingClient
        d={{
          heroTitle: d["landing.hero.title"],
          heroSubtitle: d["landing.hero.subtitle"],
          getStarted: d["landing.nav.getStarted"],
          viewGallery: d["landing.gallery.viewAll"],
          heroTagline: d["landing.hero.tagline"],
          sectionGallery: d["section.gallery"],
          galleryTitle: d["landing.gallery.title"],
          gallerySubtitle: d["landing.gallery.subtitle"],
          pricingTitle: d["landing.pricing.title"],
          pricingSubtitle: d["landing.pricing.subtitle"],
          pricingSelect: d["landing.pricing.select"],
          faqTitle: d["landing.faq.title"],
          ctaTitle: d["landing.cta.title"],
          ctaSubtitle: d["landing.cta.subtitle"],
          ctaButton: d["landing.cta.button"],
          footerDescription: d["landing.footer.description"],
          footerProduct: d["landing.footer.product"],
          footerSupport: d["landing.footer.support"],
          footerLegal: d["landing.footer.legal"],
          footerFaq: d["landing.footer.faq"],
          footerContact: d["landing.footer.contact"],
          footerTrackOrder: d["landing.footer.trackOrder"],
          footerPrivacy: d["landing.footer.privacy"],
          footerTerms: d["landing.footer.terms"],
          footerRights: d["landing.footer.rights"],
          navGallery: d["nav.gallery"],
          navCreate: d["nav.create"],
          pricingTitle2: d["landing.pricing.title"],
          heroShowcasePhoto: d["landing.hero.showcase.photo"],
          heroShowcaseFigurine: d["landing.hero.showcase.figurine"],
          testimonialsTitle: d["landing.testimonials.title"],
          testimonialsSubtitle: d["landing.testimonials.subtitle"],
        }}
        steps={steps}
        sizes={sizes}
        features={features}
        faqs={faqs}
        marqueeItems={marqueeItems}
        galleryItems={galleryItems}
        heroItem={heroItem}
        testimonials={testimonials}
        communityStats={communityStats}
      />
    </main>
  );
}
