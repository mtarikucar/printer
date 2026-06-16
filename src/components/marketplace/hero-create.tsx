"use client";

import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Production-led homepage hero. The brand's defining feature — turn a photo into
 * a 3D-printed figurine — leads the page. The before→after strip's three nodes
 * ARE the three steps (upload photo → AI designs → printed & shipped), so the
 * value prop reads in one glance. The marketplace lives below.
 */

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

function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.visibility = "hidden";
}

// One node of the transformation strip: an image (photo/figurine) or the AI
// badge, with a numbered step caption underneath.
function StepNode({
  n,
  caption,
  children,
}: {
  n: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-24 shrink-0 flex-col items-center gap-2 sm:w-32 md:w-40">
      {children}
      <div className="flex items-center gap-1.5 text-center">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-[11px] font-bold text-white">
          {n}
        </span>
        <span className="text-[11px] leading-tight text-text-secondary sm:text-xs">
          {caption}
        </span>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <svg
      aria-hidden
      className="h-5 w-5 shrink-0 self-start text-green-500/70 sm:h-6 sm:w-6 sm:mt-12 md:mt-16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 12h15" />
    </svg>
  );
}

export function HeroCreate() {
  const d = useDictionary();
  const t = (k: string, fb: string) => (d[k as keyof typeof d] as string) || fb;

  return (
    <section className="relative overflow-hidden border-b border-border-default bg-gradient-to-b from-green-500/[0.07] to-transparent">
      {/* brand atmosphere */}
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-green-400/15 blur-[90px]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(8,145,178,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(8,145,178,0.05) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(110% 90% at 50% 0%, black 35%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(110% 90% at 50% 0%, black 35%, transparent 80%)",
        }}
      />
      <Voxel className="left-[12%] top-16 hidden h-3 w-3 bg-green-400/50 lg:block" duration="4s" />
      <Voxel className="right-[14%] top-24 hidden h-2.5 w-2.5 bg-accent/50 lg:block" duration="5s" delay="0.8s" />
      <Voxel className="left-[20%] bottom-20 hidden h-2 w-2 bg-green-500/40 md:block" duration="4.6s" delay="1.2s" />

      <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-10 text-center md:pt-16 md:pb-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-green-600">
          {t("hero.create.eyebrow", "FOTOĞRAFTAN FİGÜRE")}
        </p>
        <h1
          className="mx-auto mt-3 max-w-2xl text-3xl leading-[1.1] text-text-primary sm:text-4xl md:text-5xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("hero.create.title", "Fotoğrafından kendi 3D figürünü oluştur")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-text-secondary md:text-lg">
          {t(
            "hero.create.sub",
            "Yükle — yapay zekâ saniyeler içinde tasarlasın; biz reçineyle basıp boyama kitiyle kapına gönderelim."
          )}
        </p>

        {/* before → AI → after — the three nodes ARE the three steps */}
        <div className="mt-9 flex items-start justify-center gap-2 sm:gap-3 md:gap-4">
          <StepNode n="1" caption={t("hero.create.step1", "Fotoğrafını yükle")}>
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border-default bg-bg-elevated shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero-before.webp"
                alt={t("hero.create.beforeAlt", "Yüklenen fotoğraf")}
                onError={hideOnError}
                className="h-full w-full object-cover"
              />
            </div>
          </StepNode>

          <Arrow />

          <StepNode n="2" caption={t("hero.create.step2", "AI figürünü tasarlar")}>
            <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-green-500/30 bg-gradient-to-br from-green-500 to-green-700 shadow-sm">
              <span aria-hidden className="absolute inset-0 animate-pulse bg-white/5" />
              <svg className="relative h-1/2 w-1/2 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
              </svg>
              <span className="absolute bottom-1.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-white/90 sm:text-[10px]">
                {t("hero.create.aiBadge", "Yapay Zekâ")}
              </span>
            </div>
          </StepNode>

          <Arrow />

          <StepNode n="3" caption={t("hero.create.step3", "Baskı + boyama kiti kapında")}>
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border-default bg-bg-elevated shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero-after.webp"
                alt={t("hero.create.afterAlt", "3D baskı figür")}
                onError={hideOnError}
                className="h-full w-full object-cover"
              />
            </div>
          </StepNode>
        </div>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/create"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-green-600 px-8 py-3.5 text-base font-semibold text-white shadow-[0_8px_24px_rgba(6,38,47,0.22)] transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            {t("hero.create.cta", "Kendi Figürünü Oluştur")}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
          <Link
            href="/shop"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full px-6 py-3.5 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary sm:w-auto"
          >
            {t("hero.create.browse", "Hazır ürünlere göz at")}
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
