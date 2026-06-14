"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Storefront banner row: a primary shop-the-marketplace card (mascot
 * presenting a 3D-printed figurine, /maskot-market.png) + a secondary
 * make-your-own card (mascot turning a photo into a figure,
 * /maskot-create.png). The voxel language (pixel grid, floating cubes,
 * stepped platform) is decorative CSS — if a mascot file is absent the
 * cards still read as finished.
 */

// Small axis-aligned "voxel" square. Sizes/positions are passed per-instance;
// each floats on its own rhythm so the cluster feels alive, not animated-in-sync.
function Voxel({
  className,
  duration,
  delay,
}: {
  className: string;
  duration: string;
  delay?: string;
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute rounded-[3px] animate-float ${className}`}
      style={{ animationDuration: duration, animationDelay: delay }}
    />
  );
}

// Faint pixel-grid texture tying the cards to the mascot's voxel world.
function PixelGrid({ light }: { light?: boolean }) {
  const line = light ? "rgba(255,255,255,0.07)" : "rgba(8,145,178,0.07)";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        backgroundSize: "22px 22px",
        maskImage: "radial-gradient(120% 120% at 70% 40%, black 30%, transparent 75%)",
        WebkitMaskImage:
          "radial-gradient(120% 120% at 70% 40%, black 30%, transparent 75%)",
      }}
    />
  );
}

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = "none";
}

export function PromoBanner() {
  const d = useDictionary();

  return (
    <section className="mx-auto max-w-6xl px-4 pt-6">
      <div className="grid gap-4 md:grid-cols-3">
        {/* ── Primary — shop the marketplace ───────────────────────────── */}
        <div className="group relative flex min-h-[230px] flex-col justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-green-500 to-green-700 p-6 sm:p-8 md:col-span-2 md:min-h-[260px] md:p-10">
          {/* atmosphere */}
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-20 right-24 h-48 w-48 rounded-full bg-accent/25 blur-2xl" />
          <PixelGrid light />

          {/* mascot — anchored bottom-right, floating above a voxel "step" stack */}
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-1 right-2 w-[7.5rem] select-none sm:right-4 sm:w-36 md:right-8 md:w-44 lg:w-48"
          >
            {/* stepped voxel platform under the mascot's feet */}
            <span className="absolute -left-5 bottom-3 h-4 w-4 rounded-[3px] bg-white/15" />
            <span className="absolute -left-1 bottom-1 h-5 w-5 rounded-[3px] bg-white/25" />
            <span className="absolute bottom-0 left-1/2 h-3 w-[88%] -translate-x-1/2 rounded-full bg-green-900/45 blur-md" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/maskot-market.png"
              alt=""
              width={832}
              height={1248}
              onError={hideOnError}
              className="animate-float relative drop-shadow-[0_14px_18px_rgba(6,38,47,0.45)] transition-transform duration-300 group-hover:-translate-y-1.5"
              style={{ animationDuration: "4.5s" }}
            />
          </div>

          {/* floating voxels echoing the mascot's cubes */}
          <Voxel className="right-[34%] top-8 hidden h-3 w-3 bg-accent/50 sm:block" duration="3.4s" />
          <Voxel className="right-[26%] top-16 h-2 w-2 bg-white/40" duration="4.2s" delay="0.6s" />
          <Voxel className="bottom-10 right-[38%] hidden h-4 w-4 bg-white/20 md:block" duration="5s" delay="1.1s" />

          {/* copy — right padding keeps it clear of the mascot at every width */}
          {/* width ladder tracks the card: full-width when stacked, tighter when
              the 2/3 grid column + mascot kick in at md, loosening as it grows */}
          <div className="relative z-10 max-w-[15.5rem] min-[420px]:max-w-[17rem] sm:max-w-sm md:max-w-[15.5rem] lg:max-w-[20rem] xl:max-w-[26rem]">
            <h1
              className="text-[1.7rem] leading-tight text-white sm:text-3xl md:text-4xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {d["store.promo.title"]}
            </h1>
            <p className="mt-3 text-sm text-white/90 md:text-base">
              {d["store.promo.sub"]}
            </p>
            <Link
              href="/shop"
              className="mt-6 inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-green-700 shadow-[0_6px_18px_rgba(6,38,47,0.25)] transition-transform hover:-translate-y-0.5"
            >
              {d["store.promo.cta"]}
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>

        {/* ── Secondary — make your own ────────────────────────────────── */}
        <div className="group relative flex min-h-[230px] flex-col justify-center overflow-hidden rounded-2xl border border-border-default bg-bg-elevated p-6 sm:p-8 md:min-h-[260px]">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-green-400/15 blur-2xl" />
          <PixelGrid />

          {/* voxel step cluster, top-right — "being built" */}
          <Voxel className="right-6 top-6 h-3.5 w-3.5 bg-green-300/70" duration="3.8s" />
          <Voxel className="right-11 top-10 h-2.5 w-2.5 bg-green-500/50" duration="4.6s" delay="0.5s" />
          <Voxel className="right-5 top-14 h-2 w-2 bg-accent/60" duration="3.2s" delay="1s" />

          {/* mascot peeking from the corner, flipped to face the copy */}
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-4 -right-2 w-24 select-none sm:w-28 md:w-24 lg:-bottom-5 lg:w-32"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/maskot-create.png"
              alt=""
              width={832}
              height={1248}
              onError={hideOnError}
              className="drop-shadow-[0_10px_14px_rgba(6,38,47,0.2)] transition-transform duration-300 group-hover:-translate-y-1"
            />
          </div>

          <div className="relative z-10 max-w-[calc(100%-5.5rem)] sm:max-w-[calc(100%-6.5rem)] md:max-w-[calc(100%-4.5rem)] lg:max-w-[calc(100%-6.5rem)]">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-green-600">
              {d["landing.market.produce.eyebrow"]}
            </p>
            <h2 className="mt-2 font-serif text-2xl text-text-primary">
              {d["store.promo.custom.title"]}
            </h2>
            <p className="mt-2 text-sm text-text-secondary">
              {d["store.promo.custom.sub"]}
            </p>
            <Link
              href="/create"
              className="mt-5 inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-full bg-green-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
            >
              {d["store.promo.custom.cta"]}
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
