"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Homepage hero. The brand's defining feature — turn a photo into a 3D-printed
 * figurine — leads as one illustrated İstiklal-street workshop scene, with a
 * device-tailored image at each breakpoint.
 *
 * - Phones: a full-bleed portrait cover that fills the screen below the category
 *   ribbon, with the headline + CTA over a scrim.
 * - Tablet / desktop: a framed rounded card sized to sit above the fold; on
 *   desktop the card tilts under the cursor and three glowing hotspots trace the
 *   journey (photo → resin print → figurine).
 */

// Story-beat markers over the DESKTOP art (% of the frame): the photo you
// shoot → the resin print → the finished figurine. Each links into /create.
const HOTSPOTS = [
  { k: "photo", x: 22, y: 60, n: "1", label: "Fotoğrafın", side: "right", delay: "0s" },
  { k: "print", x: 55, y: 42, n: "2", label: "Reçine baskı", side: "right", delay: "0.5s" },
  { k: "figur", x: 77, y: 70, n: "3", label: "Figürün", side: "left", delay: "1s" },
] as const;

const SCENE_ALT = "Figurunica atölyesi — fotoğraftan reçine 3D figürine";

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

export function HeroCreate() {
  const d = useDictionary();
  const t = (k: string, fb: string) => (d[k as keyof typeof d] as string) || fb;

  const eyebrow = t("hero.create.eyebrow", "FOTOĞRAFTAN FİGÜRE");
  const title = t("hero.create.title", "Fotoğrafından kendi 3D figürünü oluştur");
  const cta = t("hero.create.cta", "Kendi Figürünü Oluştur");
  const browse = t("hero.create.browse", "Hazır ürünlere göz at");

  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [spot, setSpot] = useState({ x: 50, y: 45 });
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    setSpot({ x: px * 100, y: py * 100 });
    if (!reduced) setTilt({ x: px - 0.5, y: py - 0.5 });
  }
  const resetTilt = () => setTilt({ x: 0, y: 0 });

  const cardTransform = reduced
    ? undefined
    : `rotateX(${tilt.y * -2.4}deg) rotateY(${tilt.x * 3.2}deg)`;

  return (
    <section className="relative overflow-hidden border-b border-border-default bg-gradient-to-b from-green-500/[0.08] via-green-500/[0.02] to-transparent">
      {/* brand atmosphere (behind the framed card on tablet/desktop) */}
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 hidden h-72 w-[42rem] max-w-full -translate-x-1/2 rounded-full bg-green-400/15 blur-[90px] md:block" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden md:block"
        style={{
          backgroundImage:
            "linear-gradient(rgba(8,145,178,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(8,145,178,0.05) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(120% 90% at 50% 0%, black 35%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(120% 90% at 50% 0%, black 35%, transparent 80%)",
        }}
      />
      <Voxel className="left-[8%] top-24 hidden h-3 w-3 bg-green-400/50 lg:block" duration="4s" />
      <Voxel className="right-[10%] top-32 hidden h-2.5 w-2.5 bg-accent/50 lg:block" duration="5s" delay="0.8s" />

      {/* ───────── Phones: full-bleed cover filling below the category ribbon ───────── */}
      <div
        className="relative w-full overflow-hidden md:hidden"
        style={{ height: "calc(100svh - 172px)", minHeight: "420px" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hero/hero-mobile.webp"
          alt={t("hero.create.sceneAlt", SCENE_ALT)}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/35 to-transparent"
        />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center px-5 pb-8 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-green-300">
            {eyebrow}
          </p>
          <h1
            className="mt-2 max-w-xs text-2xl leading-tight text-white drop-shadow"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </h1>
          <div className="mt-5 flex w-full max-w-xs flex-col gap-2.5">
            <Link
              href="/create"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-green-600 px-6 py-3.5 text-base font-semibold text-white shadow-[0_8px_24px_rgba(6,38,47,0.35)]"
            >
              {cta}
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link
              href="/shop"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-white/25 bg-white/5 px-6 py-3 text-sm font-semibold text-white/90 backdrop-blur-sm"
            >
              {browse}
            </Link>
          </div>
        </div>
      </div>

      {/* ───────── Tablet / desktop: framed interactive card ───────── */}
      <div className="relative mx-auto hidden max-w-6xl px-4 pt-7 pb-10 text-center md:block md:pt-9 md:pb-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-green-600">
          {eyebrow}
        </p>
        <h1
          className="mx-auto mt-3 max-w-2xl text-3xl leading-[1.08] text-text-primary sm:text-4xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-text-secondary md:text-base">
          {t(
            "hero.create.sub",
            "Yükle — yapay zekâ saniyeler içinde tasarlasın; biz reçineyle basıp boyama kitiyle kapına gönderelim."
          )}
        </p>

        <div className="mt-7 [perspective:1600px]">
          <div
            ref={cardRef}
            onMouseMove={onMove}
            onMouseLeave={resetTilt}
            className="group relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-black shadow-[0_28px_70px_-28px_rgba(6,38,47,0.55)] ring-1 ring-black/5 transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none"
            style={{ transform: cardTransform }}
          >
            {/* Tablet (4:3) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/hero/hero-tablet.webp"
              alt=""
              aria-hidden
              className="block w-full lg:hidden"
            />
            {/* Desktop (16:9) — interactive with hotspots + spotlight */}
            <div className="relative hidden lg:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero/hero-desktop.webp"
                alt=""
                aria-hidden
                width={1672}
                height={941}
                className="block w-full select-none"
                draggable={false}
              />

              {!reduced && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 mix-blend-screen transition-opacity duration-300 group-hover:opacity-70"
                  style={{
                    left: `${spot.x}%`,
                    top: `${spot.y}%`,
                    background: "radial-gradient(circle, rgba(255,186,105,0.30), transparent 60%)",
                  }}
                />
              )}

              {HOTSPOTS.map((h) => (
                <Link
                  key={h.k}
                  href="/create"
                  aria-label={`${h.label} — hemen başla`}
                  className="group/hs absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-400"
                  style={{ left: `${h.x}%`, top: `${h.y}%` }}
                >
                  <span className="relative flex h-3.5 w-3.5">
                    <span
                      aria-hidden
                      className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75 motion-reduce:animate-none"
                      style={{ animationDelay: h.delay }}
                    />
                    <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-green-500 shadow ring-2 ring-white/80" />
                  </span>
                  <span
                    className={`pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-white/15 bg-black/85 px-2.5 py-1 text-[11px] font-semibold text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-150 group-hover/hs:opacity-100 group-focus-visible/hs:opacity-100 ${
                      h.side === "right" ? "left-6" : "right-6"
                    }`}
                  >
                    <b className="mr-1 text-green-400">{h.n}</b>
                    {h.label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/create"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-green-600 px-8 py-3.5 text-base font-semibold text-white shadow-[0_8px_24px_rgba(6,38,47,0.22)] transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            {cta}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
          <Link
            href="/shop"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full px-6 py-3.5 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary sm:w-auto"
          >
            {browse}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
