"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

// Secondary custom-production CTA — the dual identity stays visible without
// taking over the storefront. Deep dive lives on /create + /nasil-calisir.
export function CustomStrip() {
  const d = useDictionary();

  return (
    <section className="mx-auto max-w-6xl px-4 py-10">
      <div className="relative overflow-hidden rounded-2xl border border-border-default bg-bg-elevated p-8 text-center md:p-12">
        <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-green-400/12 blur-[90px]" />
        <h2
          className="relative text-2xl text-text-primary md:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {d["store.custom.title"]}
        </h2>
        <p className="relative mx-auto mt-3 max-w-xl text-text-secondary">
          {d["store.custom.sub"]}
        </p>
        <div className="relative mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/create"
            className="inline-flex w-full items-center justify-center rounded-full bg-green-600 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 sm:w-auto"
          >
            {d["store.custom.cta"]}
          </Link>
          <Link
            href="/nasil-calisir"
            className="inline-flex w-full items-center justify-center rounded-full border border-border-default bg-white px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated sm:w-auto"
          >
            {d["store.custom.cta2"]}
          </Link>
        </div>
      </div>
    </section>
  );
}
