"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { SiteHeader } from "@/components/site-header";

// figure + object are live (photo→figurine / photo→object); upload (your own
// STL/OBJ) and design (2D→product) are Phase 2/3 and flagged "soon".
const PATHS = [
  {
    key: "figure",
    href: "/create?path=figure",
    soon: false,
    icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
  },
  {
    key: "object",
    href: "/create?path=object",
    soon: false,
    icon: "M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9",
  },
  {
    key: "upload",
    href: "/create?path=upload",
    soon: true,
    icon: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3",
  },
  {
    key: "design",
    href: "/create?path=design",
    soon: true,
    icon: "M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42",
  },
] as const;

export function CreatePathSelector() {
  const d = useDictionary();

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <section className="mx-auto max-w-5xl px-5 py-16 md:py-24">
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-green-600">
            {d["landing.market.produce.eyebrow"]}
          </p>
          <h1
            className="mt-3 text-3xl text-text-primary md:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {d["create.path.title"]}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-text-secondary">
            {d["create.path.sub"]}
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {PATHS.map((p) => (
            <Link
              key={p.key}
              href={p.href}
              className="group card relative flex flex-col p-7 transition-transform hover:-translate-y-1"
            >
              {p.soon && (
                <span className="absolute right-5 top-5 rounded-full bg-text-primary/[0.06] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                  {d["landing.market.produce.soon"]}
                </span>
              )}
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-600 ring-1 ring-green-500/15">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={p.icon} />
                </svg>
              </span>
              <h2 className="mt-5 font-serif text-xl text-text-primary">
                {d[`landing.market.produce.${p.key}.title` as keyof typeof d]}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {d[`landing.market.produce.${p.key}.desc` as keyof typeof d]}
              </p>
              <span
                className={`mt-5 inline-flex items-center gap-1 text-sm font-semibold ${
                  p.soon ? "text-text-muted" : "text-green-600"
                }`}
              >
                {p.soon ? (
                  d["landing.market.produce.soon"]
                ) : (
                  <>
                    {d["landing.market.path.custom.cta"]}
                    <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </>
                )}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
