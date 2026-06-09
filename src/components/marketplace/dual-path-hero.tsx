"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m0 0l-6-6m6 6l-6 6" />
    </svg>
  );
}

// Two equal entry points: the marketplace (browse & buy) and custom production
// (photo→figurine/object, your-own-model, 2D→product). Same card treatment so
// neither dominates — the "dengeli çift yol".
const PATHS = [
  {
    key: "shop",
    href: "/shop",
    icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z",
  },
  {
    key: "custom",
    href: "/create",
    icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.456-2.456L14.25 6l1.035-.259a3.375 3.375 0 002.456-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z",
  },
] as const;

export function DualPathHero() {
  const d = useDictionary();

  return (
    <section className="relative overflow-hidden bg-bg-base">
      {/* Soft atmospheric glows — depth without busyness */}
      <div aria-hidden className="pointer-events-none absolute -top-32 right-[-12%] h-[460px] w-[460px] rounded-full bg-green-400/15 blur-[130px]" />
      <div aria-hidden className="pointer-events-none absolute top-1/2 left-[-14%] h-[380px] w-[380px] rounded-full bg-accent/10 blur-[130px]" />

      <div className="relative mx-auto max-w-6xl px-5 pt-16 pb-12 md:pt-24 md:pb-16">
        <p className="animate-fade-in-up font-mono text-[11px] uppercase tracking-[0.25em] text-green-600">
          {d["landing.market.hero.eyebrow"]}
        </p>
        <h1
          className="animate-fade-in-up delay-100 mt-4 max-w-3xl text-5xl leading-[0.95] text-text-primary sm:text-6xl md:text-7xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {d["landing.market.hero.titleLead"]}{" "}
          <span className="text-green-600">{d["landing.market.hero.titleAccent"]}</span>
        </h1>
        <p className="animate-fade-in-up delay-200 mt-6 max-w-xl text-base leading-relaxed text-text-secondary md:text-lg">
          {d["landing.market.hero.sub"]}
        </p>

        <div className="animate-fade-in-up delay-300 mt-10 grid gap-4 sm:grid-cols-2 sm:gap-5">
          {PATHS.map((p) => (
            <Link
              key={p.key}
              href={p.href}
              className="group card relative overflow-hidden p-6 transition-transform duration-200 hover:-translate-y-1 md:p-7"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-50 text-green-600 ring-1 ring-green-500/15">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={p.icon} />
                  </svg>
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
                  {d[`landing.market.path.${p.key}.kicker` as keyof typeof d]}
                </span>
              </div>
              <h2 className="mt-5 font-serif text-2xl text-text-primary">
                {d[`landing.market.path.${p.key}.title` as keyof typeof d]}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {d[`landing.market.path.${p.key}.desc` as keyof typeof d]}
              </p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-green-600">
                {d[`landing.market.path.${p.key}.cta` as keyof typeof d]}
                <Arrow className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-green-500/0 transition-colors duration-200 group-hover:bg-green-500/70" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
