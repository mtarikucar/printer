"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

// Compact storefront banner row (not a tall marketing hero): a primary
// shop-the-marketplace card + a secondary make-your-own card.
export function PromoBanner() {
  const d = useDictionary();

  return (
    <section className="mx-auto max-w-6xl px-4 pt-6">
      <div className="grid gap-4 md:grid-cols-3">
        {/* Primary — shop */}
        <div className="relative flex min-h-[210px] flex-col justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-green-500 to-green-700 p-8 md:col-span-2 md:p-10">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-20 right-24 h-48 w-48 rounded-full bg-accent/20 blur-2xl" />
          <h1
            className="relative max-w-md text-3xl leading-tight text-white md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {d["store.promo.title"]}
          </h1>
          <p className="relative mt-3 max-w-sm text-sm text-white/90 md:text-base">
            {d["store.promo.sub"]}
          </p>
          <Link
            href="/shop"
            className="relative mt-6 inline-flex w-fit items-center justify-center rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-green-700 transition-transform hover:-translate-y-0.5"
          >
            {d["store.promo.cta"]}
          </Link>
        </div>

        {/* Secondary — custom */}
        <div className="relative flex min-h-[210px] flex-col justify-center overflow-hidden rounded-2xl border border-border-default bg-bg-elevated p-8">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-green-400/15 blur-2xl" />
          <p className="relative font-mono text-[11px] uppercase tracking-[0.2em] text-green-600">
            {d["landing.market.produce.eyebrow"]}
          </p>
          <h2 className="relative mt-2 font-serif text-2xl text-text-primary">
            {d["store.promo.custom.title"]}
          </h2>
          <p className="relative mt-2 text-sm text-text-secondary">
            {d["store.promo.custom.sub"]}
          </p>
          <Link
            href="/create"
            className="relative mt-5 inline-flex w-fit items-center justify-center rounded-full bg-green-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
          >
            {d["store.promo.custom.cta"]}
          </Link>
        </div>
      </div>
    </section>
  );
}
