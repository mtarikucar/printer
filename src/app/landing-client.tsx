"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ScrollReveal } from "@/components/scroll-reveal";
import { TextReveal } from "@/components/text-reveal";
import { MagneticButton } from "@/components/magnetic-button";
import { ProcessScrollytelling } from "@/components/process-scrollytelling";
import { Marquee } from "@/components/marquee";
import type { MarqueeItem } from "@/components/marquee";
import { SectionDivider } from "@/components/section-divider";
import { GalleryPreview } from "./gallery-preview";
import { SocialProofSection } from "@/components/social-proof";
import { CommunityCounter } from "@/components/community-counter";
import { GoldParticles } from "@/components/gold-particles";
import type { GalleryItem } from "@/components/gallery-card";

const HeroModel = dynamic(
  () => import("@/components/hero-model").then((m) => m.HeroModel),
  { ssr: false }
);

const HeroShowcase = dynamic(
  () => import("@/components/hero-showcase").then((m) => m.HeroShowcase),
  { ssr: false }
);

interface Step {
  number: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

interface Size {
  key: string;
  label: string;
  price: string;
  height: string;
  popular: boolean;
}

interface LandingTexts {
  heroTitle: string;
  heroSubtitle: string;
  getStarted: string;
  viewGallery: string;
  heroTagline: string;
  sectionGallery: string;
  galleryTitle: string;
  gallerySubtitle: string;
  pricingTitle: string;
  pricingSubtitle: string;
  pricingSelect: string;
  faqTitle: string;
  ctaTitle: string;
  ctaSubtitle: string;
  ctaButton: string;
  footerDescription: string;
  footerProduct: string;
  footerSupport: string;
  footerLegal: string;
  footerFaq: string;
  footerContact: string;
  footerTrackOrder: string;
  footerPrivacy: string;
  footerTerms: string;
  footerRights: string;
  navGallery: string;
  navCreate: string;
  pricingTitle2: string;
  heroShowcasePhoto: string;
  heroShowcaseFigurine: string;
  testimonialsTitle: string;
  testimonialsSubtitle: string;
}

interface Testimonial {
  quote: string;
  name: string;
  location: string;
}

interface CommunityStat {
  value: number;
  suffix: string;
  label: string;
}

export function LandingClient({
  d,
  steps,
  sizes,
  features,
  faqs,
  marqueeItems,
  galleryItems,
  heroItem,
  testimonials,
  communityStats,
}: {
  d: LandingTexts;
  steps: Step[];
  sizes: Size[];
  features: string[];
  faqs: { q: string; a: string }[];
  marqueeItems: MarqueeItem[];
  galleryItems: GalleryItem[];
  heroItem: GalleryItem | null;
  testimonials: Testimonial[];
  communityStats: CommunityStat[];
}) {
  const [ctaHover, setCtaHover] = useState(false);

  return (
    <>
      {/* Hero (100vh) */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 w-full">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="md:text-left text-center">
              <ScrollReveal>
                <h1 className="text-5xl md:text-6xl lg:text-7xl font-serif text-text-primary leading-[1.1]">
                  {d.heroTitle}
                </h1>
              </ScrollReveal>
              <ScrollReveal delay={0.15}>
                <p className="mt-6 text-lg md:text-xl text-text-secondary max-w-xl leading-relaxed">
                  {d.heroSubtitle}
                </p>
              </ScrollReveal>
              <ScrollReveal delay={0.3}>
                <div className="mt-8 flex flex-col sm:flex-row items-center gap-4 md:justify-start justify-center">
                  <MagneticButton href="/create" className="btn-primary text-lg !px-8 !py-3.5">
                    {d.getStarted}
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </MagneticButton>
                  <Link href="/gallery" className="btn-secondary text-base">
                    {d.viewGallery}
                  </Link>
                </div>
              </ScrollReveal>
              <ScrollReveal delay={0.4}>
                <p className="mt-4 text-sm text-text-muted">
                  {d.heroTagline}
                </p>
              </ScrollReveal>
            </div>
            {/* Hero right: showcase or fallback sphere */}
            <div className="hidden md:block">
              {heroItem ? (
                <HeroShowcase
                  item={heroItem}
                  photoLabel={d.heroShowcasePhoto}
                  figurineLabel={d.heroShowcaseFigurine}
                />
              ) : (
                <HeroModel className="w-full h-[500px]" />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Marquee */}
      {marqueeItems.length > 0 && (
        <section className="border-y border-bg-subtle/50">
          <Marquee items={marqueeItems} />
        </section>
      )}

      {/* Process Scrollytelling */}
      <ProcessScrollytelling steps={steps} />

      {/* Community Counter Stats */}
      <CommunityCounter stats={communityStats} />

      {/* Gallery Masonry */}
      {galleryItems.length > 0 && (
        <section className="section-spacing">
          <div className="max-w-6xl mx-auto px-4">
            <ScrollReveal>
              <TextReveal
                text={d.galleryTitle}
                as="h2"
                className="text-3xl md:text-5xl font-serif text-text-primary text-center"
              />
            </ScrollReveal>
            <ScrollReveal delay={0.1}>
              <p className="mt-4 text-text-secondary text-center max-w-xl mx-auto">
                {d.gallerySubtitle}
              </p>
            </ScrollReveal>
            <div className="mt-12">
              <GalleryPreview items={galleryItems} />
            </div>
            <div className="mt-8 text-center">
              <Link href="/gallery" className="btn-secondary">
                {d.viewGallery}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Social Proof: 3 Testimonials */}
      <SocialProofSection
        title={d.testimonialsTitle}
        subtitle={d.testimonialsSubtitle}
        testimonials={testimonials}
      />

      {/* Pricing (horizontal bars) */}
      <section className="section-spacing" id="pricing">
        <div className="max-w-4xl mx-auto px-4">
          <ScrollReveal>
            <TextReveal
              text={d.pricingTitle}
              as="h2"
              className="text-3xl md:text-5xl font-serif text-text-primary text-center"
            />
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <p className="mt-4 text-text-secondary text-center">
              {d.pricingSubtitle}
            </p>
          </ScrollReveal>
          <div className="mt-12 space-y-4">
            {sizes.map((size, i) => (
              <ScrollReveal key={size.key} delay={i * 0.1}>
                <div
                  className={`flex items-center justify-between p-6 rounded-xl border transition-colors ${
                    size.popular
                      ? "border-l-4 border-l-green-500 border-bg-subtle bg-bg-surface"
                      : "border-bg-subtle bg-bg-surface hover:bg-bg-elevated"
                  }`}
                >
                  <div className="flex items-center gap-6">
                    <div>
                      <p className="text-lg font-semibold text-text-primary">{size.label}</p>
                      <p className="text-sm text-text-muted">{size.height}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <span className="text-2xl font-mono font-bold text-green-500">
                      ₺{size.price}
                    </span>
                    <Link
                      href="/create"
                      className={size.popular ? "btn-primary text-sm !py-2 !px-5" : "btn-secondary text-sm !py-2 !px-5"}
                    >
                      {d.pricingSelect}
                    </Link>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
          {/* Feature list */}
          <ScrollReveal delay={0.3}>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {features.map((feature) => (
                <span key={feature} className="trust-pill text-xs">
                  <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                  {feature}
                </span>
              ))}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="section-spacing" id="faq">
        <div className="max-w-3xl mx-auto px-4">
          <ScrollReveal>
            <TextReveal
              text={d.faqTitle}
              as="h2"
              className="text-3xl md:text-5xl font-serif text-text-primary text-center"
            />
          </ScrollReveal>
          <div className="mt-10 space-y-3">
            {faqs.map((faq, i) => (
              <ScrollReveal key={faq.q} delay={i * 0.05}>
                <details className="group card overflow-hidden">
                  <summary className="flex items-center justify-between cursor-pointer p-5 font-semibold text-text-primary select-none hover:bg-bg-elevated transition-colors">
                    {faq.q}
                    <svg
                      className="w-5 h-5 text-text-muted shrink-0 transition-transform duration-300 group-open:rotate-180"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="accordion-content">
                    <div>
                      <p className="px-5 pb-5 text-text-secondary leading-relaxed">
                        {faq.a}
                      </p>
                    </div>
                  </div>
                </details>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA with confetti on hover */}
      <section className="py-20 relative">
        {ctaHover && <GoldParticles />}
        <div className="max-w-4xl mx-auto px-4 text-center">
          <ScrollReveal>
            <h2 className="text-3xl md:text-5xl font-serif text-text-primary">
              {d.ctaTitle}
            </h2>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <p className="mt-4 text-lg text-text-secondary max-w-2xl mx-auto">
              {d.ctaSubtitle}
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.2}>
            <div
              className="mt-8"
              onMouseEnter={() => setCtaHover(true)}
              onMouseLeave={() => setCtaHover(false)}
            >
              <MagneticButton href="/create" className="btn-primary text-lg !px-8 !py-3.5">
                {d.ctaButton}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </MagneticButton>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-bg-subtle bg-bg-base">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <span className="text-xl font-serif text-text-primary">
                Figurine Studio
              </span>
              <p className="mt-3 text-sm text-text-muted">
                {d.footerDescription}
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                {d.footerProduct}
              </h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><Link href="/gallery" className="text-text-muted hover:text-green-400 transition-colors">{d.navGallery}</Link></li>
                <li><Link href="/create" className="text-text-muted hover:text-green-400 transition-colors">{d.navCreate}</Link></li>
                <li><a href="#pricing" className="text-text-muted hover:text-green-400 transition-colors">{d.pricingTitle2}</a></li>
              </ul>
            </div>

            {/* Support */}
            <div>
              <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                {d.footerSupport}
              </h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><a href="#faq" className="text-text-muted hover:text-green-400 transition-colors">{d.footerFaq}</a></li>
                <li><Link href="/login" className="text-text-muted hover:text-green-400 transition-colors">{d.footerContact}</Link></li>
                <li><Link href="/login" className="text-text-muted hover:text-green-400 transition-colors">{d.footerTrackOrder}</Link></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                {d.footerLegal}
              </h4>
              <ul className="mt-4 space-y-2 text-sm">
                <li><a href="#" className="text-text-muted hover:text-green-400 transition-colors">{d.footerPrivacy}</a></li>
                <li><a href="#" className="text-text-muted hover:text-green-400 transition-colors">{d.footerTerms}</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-bg-subtle flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-text-muted">
              &copy; {new Date().getFullYear()} Figurine Studio. {d.footerRights}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
