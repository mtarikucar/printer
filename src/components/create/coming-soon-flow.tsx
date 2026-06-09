"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { SiteHeader } from "@/components/site-header";

// Placeholder screens for the two production paths still in development
// (upload-your-own-model = Phase 3, 2D-design→product = Phase 2). They keep the
// path reachable from nav/homepage and route visitors to a live flow meanwhile.
function ComingSoon({ pathKey }: { pathKey: "upload" | "design" }) {
  const d = useDictionary();

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <section className="mx-auto max-w-2xl px-5 py-20 text-center md:py-28">
        <span className="inline-block rounded-full bg-text-primary/[0.06] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {d["landing.market.produce.soon"]}
        </span>
        <h1
          className="mt-5 text-3xl text-text-primary md:text-4xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {d[`landing.market.produce.${pathKey}.title` as keyof typeof d]}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-text-secondary">
          {d[`landing.market.produce.${pathKey}.desc` as keyof typeof d]}
        </p>

        <div className="card mt-8 p-6 text-left">
          <h2 className="font-serif text-lg text-text-primary">
            {d["create.soon.title"]}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {d["create.soon.body"]}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/create?path=figure"
              className="inline-flex items-center justify-center rounded-full bg-green-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
            >
              {d["landing.market.produce.figure.title"]}
            </Link>
            <Link
              href="/create?path=object"
              className="inline-flex items-center justify-center rounded-full border border-border-default bg-white px-6 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated"
            >
              {d["landing.market.produce.object.title"]}
            </Link>
          </div>
        </div>

        <Link
          href="/create"
          className="mt-6 inline-block text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          ← {d["create.soon.back"]}
        </Link>
      </section>
    </main>
  );
}

export function UploadModelFlow() {
  return <ComingSoon pathKey="upload" />;
}

export function DesignToProductFlow() {
  return <ComingSoon pathKey="design" />;
}
