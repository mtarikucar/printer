"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { SiteHeader } from "@/components/site-header";

// Three entry paths by INPUT type, all live:
//  - photo: a photo of a person/pet/object → 3D (the design template is chosen
//    inside the flow; "object" is just one template now)
//  - design: a flat 2D image/logo → 3D product
//  - upload: an existing STL/OBJ the user already owns → print
// Three entry paths by INPUT type, all live. Each has a descriptive preview
// image (/examples/path-<key>.png); if the file is missing the card still reads.
const PATHS = [
  { key: "photo", href: "/create?path=photo", image: "/examples/path-photo.png" },
  { key: "design", href: "/create?path=design", image: "/examples/path-design.png" },
  { key: "upload", href: "/create?path=upload", image: "/examples/path-upload.png" },
] as const;

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.visibility = "hidden";
}

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

        <div className="mt-12 grid gap-5 sm:grid-cols-3">
          {PATHS.map((p) => (
            <Link
              key={p.key}
              href={p.href}
              className="group card relative flex flex-col overflow-hidden p-0 transition-transform hover:-translate-y-1"
            >
              <div className="aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-green-50 to-bg-elevated">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.image}
                  alt=""
                  onError={hideOnError}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h2 className="font-serif text-xl text-text-primary">
                  {d[`create.path.${p.key}.title` as keyof typeof d]}
                </h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-text-secondary">
                  {d[`create.path.${p.key}.desc` as keyof typeof d]}
                </p>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-green-600">
                  {d["landing.market.path.custom.cta"]}
                  <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
