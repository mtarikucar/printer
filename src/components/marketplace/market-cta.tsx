"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

export function MarketCta() {
  const d = useDictionary();

  return (
    <section className="bg-bg-base">
      <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="card relative overflow-hidden p-10 text-center md:p-16">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-green-400/12 blur-[100px]"
          />
          <h2
            className="relative text-3xl text-text-primary md:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {d["landing.market.cta.title"]}
          </h2>
          <p className="relative mt-3 text-text-secondary">{d["landing.market.cta.sub"]}</p>
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/shop"
              className="inline-flex w-full items-center justify-center rounded-full bg-green-600 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 sm:w-auto"
            >
              {d["landing.market.cta.shop"]}
            </Link>
            <Link
              href="/create"
              className="inline-flex w-full items-center justify-center rounded-full border border-border-default bg-white px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated sm:w-auto"
            >
              {d["landing.market.cta.custom"]}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
