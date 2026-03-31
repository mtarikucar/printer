"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { ScrollReveal } from "@/components/scroll-reveal";
import { MagneticButton } from "@/components/magnetic-button";

const HeroShowcase = dynamic(
  () => import("@/components/hero-showcase").then((m) => m.HeroShowcase),
  { ssr: false }
);

interface Step { number: string; title: string; description: string; icon: React.ReactNode; }
interface Size { key: string; label: string; price: string; height: string; popular: boolean; }
interface StyleItem { key: string; name: string; description: string; image: string; }
interface BoxItem { icon: React.ReactNode; title: string; description: string; highlighted?: boolean; }
interface UseCase { icon: string; title: string; description: string; }
interface FaqItem { question: string; answer: string; }

interface LandingTexts {
  heroTitle: string; heroSubtitle: string; getStarted: string; viewGallery: string;
  heroTagline: string; howItWorksTitle: string; pricingTitle: string; pricingSubtitle: string;
  pricingSelect: string; footerDescription: string; footerProduct: string; footerSupport: string;
  footerLegal: string; footerContact: string; footerTrackOrder: string; footerPrivacy: string;
  footerTerms: string; footerRights: string; navGallery: string; navCreate: string;
  pricingTitle2: string; heroShowcasePhoto: string; heroShowcaseFigurine: string;
  stylesTitle: string; stylesSubtitle: string; boxTitle: string; boxSubtitle: string;
  useCasesTitle: string; useCasesSubtitle: string; faqTitle: string;
  ctaTitle: string; ctaSubtitle: string; ctaButton: string;
  heroTrust1: string; heroTrust2: string; heroTrust3: string; heroTrust4: string;
}

function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <ScrollReveal key={i} delay={i * 0.05}>
            <div className="faq-card-warm overflow-hidden">
              <button
                onClick={() => setOpenIndex(isOpen ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left cursor-pointer"
              >
                <span className="text-base font-medium text-text-primary pr-4">{item.question}</span>
                <svg className={`w-5 h-5 text-text-muted shrink-0 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div className={`grid transition-all duration-300 ease-in-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-sm text-text-secondary leading-relaxed">{item.answer}</p>
                </div>
              </div>
            </div>
          </ScrollReveal>
        );
      })}
    </div>
  );
}

export function LandingClient({
  d, steps, sizes, features, styles, boxItems, useCases, faqItems, heroItem,
}: {
  d: LandingTexts; steps: Step[]; sizes: Size[]; features: string[];
  styles: StyleItem[]; boxItems: BoxItem[]; useCases: UseCase[];
  faqItems: FaqItem[];
  heroItem: { id: string; publicDisplayName: string | null; figurineSize: string; style: string; category: string | null; tags: string[]; publishedAt: string | null; glbUrl: string; thumbnailUrl: string; } | null;
}) {
  return (
    <>
      {/* ================================================================
          HERO — Light, vibrant, tells the story immediately
          ================================================================ */}
      <section className="landing-hero">
        <div className="relative z-10 px-5 pt-16 pb-12 md:pt-24 md:pb-20">
          <div className="max-w-5xl mx-auto text-center">

            <ScrollReveal>
              <h1 className="font-display text-[2.75rem] sm:text-6xl md:text-7xl lg:text-8xl text-text-primary leading-[1.05] tracking-tight">
                {d.heroTitle}
              </h1>
            </ScrollReveal>

            <ScrollReveal delay={0.1}>
              <p className="mt-5 md:mt-6 text-base sm:text-lg md:text-xl text-text-secondary leading-relaxed max-w-2xl mx-auto">
                {d.heroSubtitle}
              </p>
            </ScrollReveal>

            <ScrollReveal delay={0.2}>
              <div className="mt-8 md:mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <MagneticButton href="/create" className="btn-primary text-lg !px-8 !py-3.5 !rounded-full">
                  {d.getStarted}
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </MagneticButton>
                <Link href="/gallery" className="btn-secondary text-base !rounded-full">
                  {d.viewGallery}
                </Link>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.3}>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                {[d.heroTrust1, d.heroTrust2, d.heroTrust3, d.heroTrust4].map((label) => (
                  <span key={label} className="inline-flex items-center gap-1.5 text-sm text-text-muted">
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {label}
                  </span>
                ))}
              </div>
            </ScrollReveal>
          </div>

          {/* Style cards */}
          <ScrollReveal delay={0.2}>
            <div className="mt-14 md:mt-16 max-w-5xl mx-auto">
              <p className="text-center text-xs font-semibold text-text-muted uppercase tracking-[0.2em] mb-5">
                {d.stylesTitle}
              </p>

              {/* Mobile: horizontal scroll */}
              <div className="md:hidden style-scroll px-1">
                {styles.map((style) => (
                  <Link key={style.key} href="/create" className="style-card w-[68vw] max-w-[280px]">
                    <div className="relative aspect-[3/4]">
                      <Image src={style.image} alt={style.name} fill className="object-cover object-top" sizes="70vw" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                      <div className="absolute bottom-0 inset-x-0 p-4">
                        <h3 className="text-base font-bold text-white">{style.name}</h3>
                        <p className="text-xs text-white/70 mt-1 leading-snug">{style.description}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Desktop: grid */}
              <div className="hidden md:grid grid-cols-4 gap-5">
                {styles.map((style) => (
                  <Link key={style.key} href="/create" className="style-card group">
                    <div className="relative aspect-[3/4]">
                      <Image src={style.image} alt={style.name} fill className="object-cover object-top transition-transform duration-700 group-hover:scale-110" sizes="25vw" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
                      <div className="absolute bottom-0 inset-x-0 p-5">
                        <h3 className="text-lg font-bold text-white">{style.name}</h3>
                        <p className="text-sm text-white/70 mt-1 leading-snug">{style.description}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </ScrollReveal>

          {/* Before/After showcase */}
          {heroItem && (
            <ScrollReveal delay={0.3}>
              <div className="mt-16 max-w-xl mx-auto">
                <HeroShowcase item={heroItem} photoLabel={d.heroShowcasePhoto} figurineLabel={d.heroShowcaseFigurine} />
              </div>
            </ScrollReveal>
          )}
        </div>
      </section>

      {/* ================================================================
          HOW IT WORKS
          ================================================================ */}
      <section className="section-alt py-20 md:py-28">
        <div className="max-w-5xl mx-auto px-5">
          <ScrollReveal>
            <h2 className="font-display text-3xl md:text-5xl text-text-primary text-center section-heading-line">
              {d.howItWorksTitle}
            </h2>
          </ScrollReveal>
          <div className="mt-16 grid md:grid-cols-3 gap-6">
            {steps.map((step, i) => (
              <ScrollReveal key={step.number} delay={i * 0.12}>
                <div className="step-card">
                  <div className="w-14 h-14 rounded-2xl bg-green-500/10 text-green-500 flex items-center justify-center mx-auto">
                    {step.icon}
                  </div>
                  <span className="mt-5 inline-block text-xs font-mono font-bold text-green-500 bg-green-500/10 rounded-full px-3 py-1">
                    {step.number}
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-text-primary">{step.title}</h3>
                  <p className="mt-2 text-sm text-text-secondary leading-relaxed">{step.description}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================
          WHAT'S IN THE BOX
          ================================================================ */}
      <section className="bg-white py-20 md:py-28">
        <div className="max-w-5xl mx-auto px-5">
          <ScrollReveal>
            <h2 className="font-display text-3xl md:text-5xl text-text-primary text-center section-heading-line">
              {d.boxTitle}
            </h2>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <p className="mt-8 text-text-secondary text-center text-lg max-w-xl mx-auto">
              {d.boxSubtitle}
            </p>
          </ScrollReveal>
          <div className="mt-14 grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-5">
            {boxItems.map((item, i) => (
              <ScrollReveal key={i} delay={i * 0.08}>
                <div className={`box-card ${item.highlighted ? "!border-2 !border-green-500/30 !bg-green-50" : ""}`}>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto ${
                    item.highlighted ? "bg-green-500/15 text-green-600" : "bg-bg-muted text-text-secondary"
                  }`}>
                    {item.icon}
                  </div>
                  <h3 className={`mt-3 text-sm font-semibold ${item.highlighted ? "text-green-700" : "text-text-primary"}`}>
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-xs text-text-muted leading-relaxed">{item.description}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================
          USE CASES
          ================================================================ */}
      <section className="section-alt py-20 md:py-28">
        <div className="max-w-5xl mx-auto px-5">
          <ScrollReveal>
            <h2 className="font-display text-3xl md:text-5xl text-text-primary text-center section-heading-line">
              {d.useCasesTitle}
            </h2>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <p className="mt-8 text-text-secondary text-center text-lg max-w-xl mx-auto">
              {d.useCasesSubtitle}
            </p>
          </ScrollReveal>
          <div className="mt-14 grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-5">
            {useCases.map((uc, i) => (
              <ScrollReveal key={i} delay={i * 0.08}>
                <div className="usecase-card">
                  <span className="text-3xl md:text-4xl">{uc.icon}</span>
                  <h3 className="mt-3 text-base font-semibold text-text-primary">{uc.title}</h3>
                  <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">{uc.description}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================
          PRICING
          ================================================================ */}
      <section className="bg-white py-20 md:py-28" id="pricing">
        <div className="max-w-3xl mx-auto px-5">
          <ScrollReveal>
            <h2 className="font-display text-3xl md:text-5xl text-text-primary text-center section-heading-line">
              {d.pricingTitle}
            </h2>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <p className="mt-8 text-text-secondary text-center">{d.pricingSubtitle}</p>
          </ScrollReveal>
          <div className="mt-12 space-y-3">
            {sizes.map((size, i) => (
              <ScrollReveal key={size.key} delay={i * 0.1}>
                <div className={`price-row ${size.popular ? "price-row-popular" : ""}`}>
                  <div>
                    <p className="text-base font-semibold text-text-primary">{size.label}</p>
                    <p className="text-xs text-text-muted mt-0.5">{size.height}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xl md:text-2xl font-mono font-bold text-green-600">₺{size.price}</span>
                    <Link href="/create" className={size.popular ? "btn-primary text-sm !py-2 !px-5 !rounded-full" : "btn-secondary text-sm !py-2 !px-5 !rounded-full"}>
                      {d.pricingSelect}
                    </Link>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
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

      {/* ================================================================
          FAQ
          ================================================================ */}
      <section className="section-alt py-20 md:py-28">
        <div className="max-w-3xl mx-auto px-5">
          <ScrollReveal>
            <h2 className="font-display text-3xl md:text-5xl text-text-primary text-center section-heading-line">
              {d.faqTitle}
            </h2>
          </ScrollReveal>
          <div className="mt-14">
            <FaqAccordion items={faqItems} />
          </div>
        </div>
      </section>

      {/* ================================================================
          FINAL CTA
          ================================================================ */}
      <section className="cta-section py-24 md:py-32">
        <div className="relative z-10 max-w-3xl mx-auto px-5 text-center">
          <ScrollReveal>
            <h2 className="font-display text-3xl md:text-5xl lg:text-6xl text-text-primary">
              {d.ctaTitle}
            </h2>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <p className="mt-5 text-lg text-text-secondary">{d.ctaSubtitle}</p>
          </ScrollReveal>
          <ScrollReveal delay={0.2}>
            <div className="mt-10">
              <MagneticButton href="/create" className="btn-primary text-lg !px-10 !py-4 !rounded-full">
                {d.ctaButton}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </MagneticButton>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ================================================================
          FOOTER
          ================================================================ */}
      <footer className="border-t border-bg-subtle bg-bg-base">
        <div className="max-w-5xl mx-auto px-5 py-16">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="col-span-2 md:col-span-1">
              <span className="font-display text-xl text-text-primary">Figurine Studio</span>
              <p className="mt-3 text-sm text-text-muted leading-relaxed">{d.footerDescription}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-widest">{d.footerProduct}</h4>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li><Link href="/gallery" className="text-text-secondary hover:text-green-500 transition-colors">{d.navGallery}</Link></li>
                <li><Link href="/create" className="text-text-secondary hover:text-green-500 transition-colors">{d.navCreate}</Link></li>
                <li><a href="#pricing" className="text-text-secondary hover:text-green-500 transition-colors">{d.pricingTitle2}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-widest">{d.footerSupport}</h4>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li><Link href="/login" className="text-text-secondary hover:text-green-500 transition-colors">{d.footerContact}</Link></li>
                <li><Link href="/login" className="text-text-secondary hover:text-green-500 transition-colors">{d.footerTrackOrder}</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-widest">{d.footerLegal}</h4>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li><Link href="/privacy" className="text-text-secondary hover:text-green-500 transition-colors">{d.footerPrivacy}</Link></li>
                <li><Link href="/terms" className="text-text-secondary hover:text-green-500 transition-colors">{d.footerTerms}</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-bg-subtle text-center">
            <p className="text-xs text-text-muted">&copy; {new Date().getFullYear()} Figurine Studio. {d.footerRights}</p>
          </div>
        </div>
      </footer>
    </>
  );
}
