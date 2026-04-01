export const revalidate = 60;

import Link from "next/link";
import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
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

  // Fetch up to 8 featured gallery items to find one with both photo + GLB
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
      style: true,
      galleryCategory: true,
      galleryTags: true,
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
    style: order.style,
    category: order.galleryCategory,
    tags: order.galleryTags ?? [],
    publishedAt: order.publishedAt?.toISOString() ?? null,
    glbUrl: order.generationAttempts[0]?.outputGlbUrl ?? null,
    thumbnailUrl: order.photos[0]?.originalUrl ?? null,
  }));

  // Find first gallery item that has both photo + GLB for hero showcase
  const found = galleryItems.find((item) => item.thumbnailUrl && item.glbUrl);
  const heroItem = found && found.glbUrl && found.thumbnailUrl
    ? { id: found.id, publicDisplayName: found.publicDisplayName, figurineSize: found.figurineSize, style: found.style, category: found.category, tags: found.tags, publishedAt: found.publishedAt, glbUrl: found.glbUrl, thumbnailUrl: found.thumbnailUrl }
    : null;

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

  const styles = [
    { key: "object", name: d["landing.styles.object"], description: d["landing.styles.object.desc"], image: "/examples/object.png" },
    { key: "anime", name: d["landing.styles.anime"], description: d["landing.styles.anime.desc"], image: "/examples/anime.png" },
    { key: "disney", name: d["landing.styles.disney"], description: d["landing.styles.disney.desc"], image: "/examples/disney.png" },
    { key: "chibi", name: d["landing.styles.chibi"], description: d["landing.styles.chibi.desc"], image: "/examples/chibi.png" },
  ];

  const boxItems = [
    {
      title: d["landing.box.figurine"],
      description: d["landing.box.figurine.desc"],
      highlighted: true,
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: d["landing.box.paints"],
      description: d["landing.box.paints.desc"],
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      ),
    },
    {
      title: d["landing.box.brushes"],
      description: d["landing.box.brushes.desc"],
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      ),
    },
    {
      title: d["landing.box.guide"],
      description: d["landing.box.guide.desc"],
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
    },
    {
      title: d["landing.box.packaging"],
      description: d["landing.box.packaging.desc"],
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
    },
    {
      title: d["landing.box.shipping"],
      description: d["landing.box.shipping.desc"],
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      ),
    },
  ];

  const useCasesList = [
    { icon: "\u{1F382}", title: d["landing.useCases.birthday"], description: d["landing.useCases.birthday.desc"] },
    { icon: "\u{1F48D}", title: d["landing.useCases.love"], description: d["landing.useCases.love.desc"] },
    { icon: "\u{1F43E}", title: d["landing.useCases.pet"], description: d["landing.useCases.pet.desc"] },
    { icon: "\u{1F3AE}", title: d["landing.useCases.gaming"], description: d["landing.useCases.gaming.desc"] },
    { icon: "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}", title: d["landing.useCases.family"], description: d["landing.useCases.family.desc"] },
    { icon: "\u{1F393}", title: d["landing.useCases.graduation"], description: d["landing.useCases.graduation.desc"] },
  ];

  const faqItems = [
    { question: d["landing.faq.q1"], answer: d["landing.faq.a1"] },
    { question: d["landing.faq.q2"], answer: d["landing.faq.a2"] },
    { question: d["landing.faq.q3"], answer: d["landing.faq.a3"] },
    { question: d["landing.faq.q4"], answer: d["landing.faq.a4"] },
    { question: d["landing.faq.q5"], answer: d["landing.faq.a5"] },
    { question: d["landing.faq.q6"], answer: d["landing.faq.a6"] },
    { question: d["landing.faq.q7"], answer: d["landing.faq.a7"] },
    { question: d["landing.faq.q8"], answer: d["landing.faq.a8"] },
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
          howItWorksTitle: d["landing.howItWorks.title"],
          pricingTitle: d["landing.pricing.title"],
          pricingSubtitle: d["landing.pricing.subtitle"],
          pricingSelect: d["landing.pricing.select"],
          footerDescription: d["landing.footer.description"],
          footerProduct: d["landing.footer.product"],
          footerSupport: d["landing.footer.support"],
          footerLegal: d["landing.footer.legal"],
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
          heroTrust1: d["landing.hero.trust1"],
          heroTrust2: d["landing.hero.trust2"],
          heroTrust3: d["landing.hero.trust3"],
          heroTrust4: d["landing.hero.trust4"],
          stylesTitle: d["landing.styles.title"],
          stylesSubtitle: d["landing.styles.subtitle"],
          boxTitle: d["landing.box.title"],
          boxSubtitle: d["landing.box.subtitle"],
          useCasesTitle: d["landing.useCases.title"],
          useCasesSubtitle: d["landing.useCases.subtitle"],
          faqTitle: d["landing.faq.title"],
          ctaTitle: d["landing.cta.title"],
          ctaSubtitle: d["landing.cta.subtitle"],
          ctaButton: d["landing.cta.button"],
        }}
        steps={steps}
        sizes={sizes}
        features={features}
        styles={styles}
        boxItems={boxItems}
        useCases={useCasesList}
        faqItems={faqItems}
        heroItem={heroItem}
      />
    </main>
  );
}
