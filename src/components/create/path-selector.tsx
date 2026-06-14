"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { SiteHeader } from "@/components/site-header";

// Three entry paths by INPUT type, all live:
//  - photo: a photo of a person/pet/object → 3D (the design template is chosen
//    inside the flow; "object" is just one template now)
//  - design: a flat 2D image/logo → 3D product
//  - upload: an existing STL/OBJ the user already owns → print
const PATHS = [
  {
    key: "photo",
    href: "/create?path=photo",
    icon: "M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z",
  },
  {
    key: "design",
    href: "/create?path=design",
    icon: "M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42",
  },
  {
    key: "upload",
    href: "/create?path=upload",
    icon: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3",
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

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {PATHS.map((p) => (
            <Link
              key={p.key}
              href={p.href}
              className="group card relative flex flex-col p-7 transition-transform hover:-translate-y-1"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-600 ring-1 ring-green-500/15">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d={p.icon} />
                </svg>
              </span>
              <h2 className="mt-5 font-serif text-xl text-text-primary">
                {d[`create.path.${p.key}.title` as keyof typeof d]}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                {d[`create.path.${p.key}.desc` as keyof typeof d]}
              </p>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-green-600">
                {d["landing.market.path.custom.cta"]}
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
