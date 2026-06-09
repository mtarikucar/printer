"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FigurunicaDict } from "./dict";
import styles from "./figurunica.module.css";
import {
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_HREF,
  CONTACT_EMAIL,
  CONTACT_EMAIL_HREF,
  CONTACT_ADDRESS_FULL,
  CONTACT_MAPS_URL,
} from "@/lib/config/contact";

const s = (key: string) => (styles as Record<string, string>)[key] ?? "";
const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).map((n) => s(n as string)).filter(Boolean).join(" ");

const ArrowIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

export function HeroIntro({ d }: { d: FigurunicaDict }) {
  const [t, setT] = useState(0);
  const [layer, setLayer] = useState(0);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const heroRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = ((now - start) / 14000) % 1;
      setT(elapsed);
      setLayer(Math.floor(elapsed * 420));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!heroRef.current) return;
      const r = heroRef.current.getBoundingClientRect();
      setMouse({
        x: (e.clientX - r.left) / r.width - 0.5,
        y: (e.clientY - r.top) / r.height - 0.5,
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const headX = Math.sin(t * Math.PI * 6) * 120;
  const buildH = t;

  return (
    <section className={s("hero")} ref={heroRef}>
      <div className={s("hero-bg")}>
        <div className={s("hero-grid")} />
        <div
          className={s("hero-halo")}
          style={{ transform: `translate(${mouse.x * 40}px, ${mouse.y * 40}px)` }}
        />
        <div className={s("hero-vignette")} />
      </div>

      <div
        className={s("hero-printer")}
        aria-hidden="true"
        style={{
          transform: `translate(-50%, -50%) rotateX(${mouse.y * -3}deg) rotateY(${
            mouse.x * 4
          }deg)`,
        }}
      >
        <div className={s("gantry")}>
          <div className={s("gantry-rail")} />
          <div className={cx("gantry-rail", "bottom")} />
          <div className={cx("gantry-strut", "left")} />
          <div className={cx("gantry-strut", "right")} />
          <div
            className={s("printhead")}
            style={{ transform: `translateX(calc(-50% + ${headX}px))` }}
          >
            <div className={s("printhead-body")} />
            <div className={s("printhead-nozzle")} />
            <div className={s("printhead-laser")} />
          </div>
        </div>

        <div className={cx("z-column", "left")} />
        <div className={cx("z-column", "right")} />

        <div className={s("vat")}>
          <div className={s("vat-liquid")} />
          <div className={s("vat-uv")} />
          <div className={cx("vat-ring", "top")} />
          <div className={cx("vat-ring", "bottom")} />

          <div className={s("build-plate")}>
            <div className={cx("plate-ring", "r1")} />
            <div className={cx("plate-ring", "r2")} />
            <div className={cx("plate-ring", "r3")} />
          </div>

          <div className={s("hero-figurine")}>
            <div
              className={s("hero-figurine-clip")}
              style={{
                clipPath: `inset(${(1 - buildH) * 100}% 0 0 0)`,
                WebkitClipPath: `inset(${(1 - buildH) * 100}% 0 0 0)`,
              }}
            >
              <svg viewBox="0 0 140 280" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="hero-figGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#FFFFFF" />
                    <stop offset="100%" stopColor="#B9DDE8" />
                  </linearGradient>
                </defs>
                <ellipse cx="70" cy="268" rx="48" ry="6" fill="#9FC7D2" />
                <rect x="28" y="256" width="84" height="14" rx="2" fill="#D4E8EE" />
                <path
                  d="M 44 256 L 48 200 Q 50 180 58 170 L 66 170 L 70 256 Z"
                  fill="url(#hero-figGrad)"
                />
                <path
                  d="M 96 256 L 92 200 Q 90 180 82 170 L 74 170 L 70 256 Z"
                  fill="url(#hero-figGrad)"
                />
                <path
                  d="M 40 170 Q 38 178 40 185 L 100 185 Q 102 178 100 170 Z"
                  fill="#C8E2E8"
                />
                <path
                  d="M 38 170 Q 30 130 36 95 Q 42 70 58 65 Q 70 62 82 65 Q 98 70 104 95 Q 110 130 102 170 Z"
                  fill="url(#hero-figGrad)"
                />
                <path d="M 58 65 Q 70 80 82 65 L 82 170 L 58 170 Z" fill="#EDF6F8" />
                <path
                  d="M 32 100 Q 22 130 26 160 L 36 168 Q 44 140 42 110 Z"
                  fill="url(#hero-figGrad)"
                />
                <path
                  d="M 108 100 Q 118 130 114 160 L 104 168 Q 96 140 98 110 Z"
                  fill="url(#hero-figGrad)"
                />
                <ellipse cx="70" cy="40" rx="24" ry="26" fill="url(#hero-figGrad)" />
                <path
                  d="M 46 38 Q 44 16 58 8 Q 70 2 82 8 Q 96 16 94 38 Q 94 50 88 52 Q 92 30 82 24 Q 70 18 58 24 Q 48 30 52 52 Q 46 50 46 38 Z"
                  fill="#89A4AD"
                />
              </svg>
            </div>
            {buildH > 0.02 && buildH < 0.98 && (
              <div
                className={s("hero-scanline")}
                style={{ bottom: `${buildH * 280 - 8}px` }}
              />
            )}
          </div>

          {Array.from({ length: 5 }).map((_, i) => {
            const dt = (t * 6 + i * 0.18) % 1;
            return (
              <div
                key={i}
                className={s("hero-droplet")}
                style={{
                  left: `calc(50% + ${Math.sin(t * Math.PI * 6 + i * 0.9) * 120}px)`,
                  top: `${60 + dt * 240}px`,
                  opacity: dt < 0.85 ? 0.7 - dt * 0.3 : 0,
                }}
              />
            );
          })}
        </div>

        <div className={s("printer-base")}>
          <div className={s("base-screen")}>
            <div className={s("base-screen-row")}>
              <span className={s("k")}>layer</span>
              <span className={s("v")}>{String(layer).padStart(3, "0")}/420</span>
            </div>
            <div className={s("base-screen-row")}>
              <span className={s("k")}>temp</span>
              <span className={s("v")}>27.4°C</span>
            </div>
            <div className={s("base-screen-row")}>
              <span className={s("k")}>uv</span>
              <span className={s("v")}>405nm</span>
            </div>
            <div className={s("base-bar")}>
              <div
                className={s("base-bar-fill")}
                style={{ width: `${buildH * 100}%` }}
              />
            </div>
          </div>
          <div className={s("base-leds")}>
            <span className={cx("led", "on")} />
            <span className={cx("led", "on")} />
            <span className={s("led")} />
          </div>
        </div>

        <div
          className={cx("hud-chip", "chip-1")}
          style={{ transform: `translate(${mouse.x * -10}px, ${mouse.y * -10}px)` }}
        >
          <span className={s("chip-dot")} />
          <div>
            <div className={s("chip-k")}>{d["landing.fig.hero.chip.subject.k"]}</div>
            <div className={s("chip-v")}>{d["landing.fig.hero.chip.subject.v"]}</div>
          </div>
        </div>
        <div
          className={cx("hud-chip", "chip-2")}
          style={{ transform: `translate(${mouse.x * 14}px, ${mouse.y * -6}px)` }}
        >
          <div className={s("chip-mini-bars")}>
            <span style={{ height: "40%" }} />
            <span style={{ height: "70%" }} />
            <span style={{ height: "55%" }} />
            <span style={{ height: "85%" }} />
            <span style={{ height: "60%" }} />
          </div>
          <div>
            <div className={s("chip-k")}>{d["landing.fig.hero.chip.verts.k"]}</div>
            <div className={s("chip-v")}>12,480</div>
          </div>
        </div>
        <div
          className={cx("hud-chip", "chip-3")}
          style={{ transform: `translate(${mouse.x * 10}px, ${mouse.y * 12}px)` }}
        >
          <span className={s("chip-ring")}>
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="var(--rule-strong)" strokeWidth="2" />
              <circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeDasharray={`${buildH * 62.8} 62.8`}
                transform="rotate(-90 12 12)"
              />
            </svg>
          </span>
          <div>
            <div className={s("chip-k")}>{d["landing.fig.hero.chip.build.k"]}</div>
            <div className={s("chip-v")}>{Math.floor(buildH * 100)}%</div>
          </div>
        </div>
        <div
          className={cx("hud-chip", "chip-4")}
          style={{ transform: `translate(${mouse.x * -14}px, ${mouse.y * 8}px)` }}
        >
          <span className={cx("chip-dot", "green")} />
          <div>
            <div className={s("chip-k")}>{d["landing.fig.hero.chip.queue.k"]}</div>
            <div className={s("chip-v")}>{d["landing.fig.hero.chip.queue.v"]}</div>
          </div>
        </div>
      </div>

      <div className={s("hero-content")}>
        <div className={s("eyebrow")}>
          <span className={s("dot")} />
          {d["landing.fig.hero.eyebrow"]}
        </div>
        <h1 className={s("hero-title")}>
          {d["landing.fig.hero.titleLead"]}
          <br />
          <span className={s("italic")}>{d["landing.fig.hero.titleItalic"]} </span>
          <span className={s("accent")}>{d["landing.fig.hero.titleAccent"]}</span>
        </h1>
        <p className={s("hero-sub")}>
          {d["landing.fig.hero.sub"]} <em>{d["landing.fig.hero.subEm"]}</em>
        </p>
        <div className={s("hero-ctas")}>
          <Link href="/create" className={s("btn-primary")}>
            {d["landing.fig.hero.ctaPrimary"]}
            <ArrowIcon />
          </Link>
          <Link href="/gallery" className={s("btn-ghost")}>
            {d["landing.fig.hero.ctaGhost"]}
          </Link>
        </div>

        <div className={s("hero-stats")}>
          <div className={s("stat")}>
            <div className={s("stat-v")}>
              {d["landing.fig.hero.stat1.v"]}
              <span className={s("u")}>{d["landing.fig.hero.stat1.u"]}</span>
            </div>
            <div className={s("stat-k")}>{d["landing.fig.hero.stat1.k"]}</div>
          </div>
          <div className={s("stat")}>
            <div className={s("stat-v")}>
              {d["landing.fig.hero.stat2.v"]}
              <span className={s("u")}>{d["landing.fig.hero.stat2.u"]}</span>
            </div>
            <div className={s("stat-k")}>{d["landing.fig.hero.stat2.k"]}</div>
          </div>
          <div className={s("stat")}>
            <div className={s("stat-v")}>
              {d["landing.fig.hero.stat3.v"]}
              <span className={s("u")}>{d["landing.fig.hero.stat3.u"]}</span>
            </div>
            <div className={s("stat-k")}>{d["landing.fig.hero.stat3.k"]}</div>
          </div>
          <div className={s("stat")}>
            <div className={s("stat-v")}>{d["landing.fig.hero.stat4.v"]}</div>
            <div className={s("stat-k")}>{d["landing.fig.hero.stat4.k"]}</div>
          </div>
        </div>
      </div>

      <div className={s("hero-ticker")}>
        <div className={s("ticker-track")}>
          {Array.from({ length: 2 }).map((_, k) => (
            <span key={k} className={s("ticker-chunk")}>
              <span className={s("t-dot")} /> printing · ege, istanbul · chibi ·
              <span className={s("t-dot")} /> shipped · mei, singapore · realistic ·
              <span className={s("t-dot")} /> sculpting · juno, berlin · anime ·
              <span className={s("t-dot")} /> packed · raúl, madrid · storybook ·
              <span className={s("t-dot")} /> printing · ana, lisbon · chibi ·
              <span className={s("t-dot")} /> printing · theo, paris · realistic ·
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function StyleGallery({ d }: { d: FigurunicaDict }) {
  const items = [
    { src: "/examples/realistic.png", name: d["landing.fig.styles.realistic"], tag: "R-01" },
    { src: "/examples/chibi.png", name: d["landing.fig.styles.chibi"], tag: "C-02" },
    { src: "/examples/anime.png", name: d["landing.fig.styles.anime"], tag: "A-03" },
    { src: "/examples/storybook.png", name: d["landing.fig.styles.storybook"], tag: "S-04" },
  ];

  return (
    <section className={s("section")} id="styles">
      <div className={s("section-head")}>
        <div className={s("section-eyebrow")}>{d["landing.fig.styles.eyebrow"]}</div>
        <h2 className={s("section-title")}>
          {d["landing.fig.styles.titleLead"]}{" "}
          <span className={s("italic")}>{d["landing.fig.styles.titleItalic"]}</span>
        </h2>
        <p className={s("section-sub")}>{d["landing.fig.styles.sub"]}</p>
      </div>
      <div className={s("styles-grid")}>
        {items.map((it, i) => (
          <div className={s("style-card")} key={i}>
            <img src={it.src} alt={it.name} />
            <div className={s("style-card-cap")}>
              <span className={s("name")}>{it.name}</span>
              <span className={s("tag")}>{it.tag}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HowItWorks({ d }: { d: FigurunicaDict }) {
  const steps = [
    { n: "01", t: d["landing.fig.how.s1.title"], desc: d["landing.fig.how.s1.desc"], time: d["landing.fig.how.s1.time"] },
    { n: "02", t: d["landing.fig.how.s2.title"], desc: d["landing.fig.how.s2.desc"], time: d["landing.fig.how.s2.time"] },
    { n: "03", t: d["landing.fig.how.s3.title"], desc: d["landing.fig.how.s3.desc"], time: d["landing.fig.how.s3.time"] },
    { n: "04", t: d["landing.fig.how.s4.title"], desc: d["landing.fig.how.s4.desc"], time: d["landing.fig.how.s4.time"] },
  ];
  return (
    <section className={s("section")} id="how">
      <div className={s("section-head")}>
        <div className={s("section-eyebrow")}>{d["landing.fig.how.eyebrow"]}</div>
        <h2 className={s("section-title")}>
          {d["landing.fig.how.titleLead"]}{" "}
          <span className={s("italic")}>{d["landing.fig.how.titleItalic"]}</span>
        </h2>
      </div>
      <div className={s("steps")}>
        {steps.map((st) => (
          <div className={s("step")} key={st.n}>
            <div className={s("step-num")}>{st.n}</div>
            <div className={s("step-title")}>{st.t}</div>
            <div className={s("step-desc")}>{st.desc}</div>
            <div className={s("step-time")}>⏱ {st.time}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Trust signals — testimonials + stats + payment badges.
 *
 * Lives between FAQ and CtaBand on the landing page. Built with plain
 * Tailwind (not the module.css design system of the rest of figurunica/)
 * because the cards reuse the shared `.card` / `.trust-pill` classes from
 * globals.css and the stat row is essentially a `.btn-amber`-style block —
 * keeping it portable lets us drop the same TrustSignals on per-style
 * landing pages later (Q2) without redesign.
 *
 * Note on copy: the testimonials are placeholders pending real customer
 * permission to use names + photos. Names/cities are realistic Turkish but
 * intentionally not tied to actual orders. Replace before any growth push
 * (TR consumer-protection law prefers attributed reviews).
 */
export function TrustSignals({ d }: { d: FigurunicaDict }) {
  const testimonials = [
    {
      quote: d["landing.fig.trust.t1.quote"],
      name: d["landing.fig.trust.t1.name"],
      location: d["landing.fig.trust.t1.location"],
    },
    {
      quote: d["landing.fig.trust.t2.quote"],
      name: d["landing.fig.trust.t2.name"],
      location: d["landing.fig.trust.t2.location"],
    },
    {
      quote: d["landing.fig.trust.t3.quote"],
      name: d["landing.fig.trust.t3.name"],
      location: d["landing.fig.trust.t3.location"],
    },
  ];

  const stats = [
    {
      v: d["landing.fig.trust.statOrders"],
      l: d["landing.fig.trust.statOrdersLabel"],
    },
    {
      v: d["landing.fig.trust.statRating"],
      l: d["landing.fig.trust.statRatingLabel"],
    },
    {
      v: d["landing.fig.trust.statShipping"],
      l: d["landing.fig.trust.statShippingLabel"],
    },
  ];

  const badges = [
    {
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 11c-1.105 0-2 .9-2 2v3a2 2 0 002 2 2 2 0 002-2v-3c0-1.1-.895-2-2-2zm6-2V8a6 6 0 10-12 0v1a3 3 0 00-3 3v8a3 3 0 003 3h12a3 3 0 003-3v-8a3 3 0 00-3-3z"
          />
        </svg>
      ),
      label: d["landing.fig.trust.badge.ssl"],
    },
    {
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 10h18M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"
          />
        </svg>
      ),
      label: d["landing.fig.trust.badge.payment"],
    },
    {
      icon: (
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
          />
        </svg>
      ),
      label: d["landing.fig.trust.badge.refund"],
    },
  ];

  return (
    <section className="px-4 sm:px-6 py-16 sm:py-24 bg-bg-base">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold tracking-[0.2em] text-green-500 mb-2">
            {d["landing.fig.trust.eyebrow"]}
          </p>
          <h2 className="text-2xl sm:text-3xl font-serif text-text-primary">
            {d["landing.fig.trust.title"]}
          </h2>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
          {stats.map((s) => (
            <div
              key={s.l}
              className="card p-6 text-center"
            >
              <p className="text-3xl font-mono font-bold text-green-500">{s.v}</p>
              <p className="text-sm text-text-muted mt-1">{s.l}</p>
            </div>
          ))}
        </div>

        {/* Testimonials */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          {testimonials.map((t) => (
            <figure key={t.name} className="card p-6">
              <svg
                className="w-6 h-6 text-green-500/60 mb-3"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M9.4 7C5.9 7 3 9.9 3 13.4v3.5h6.4V13.4H5.9c0-1.9 1.5-3.5 3.5-3.5V7zm9 0c-3.5 0-6.4 2.9-6.4 6.4v3.5h6.4V13.4h-3.5c0-1.9 1.5-3.5 3.5-3.5V7z" />
              </svg>
              <blockquote className="text-sm text-text-secondary leading-relaxed">
                {t.quote}
              </blockquote>
              <figcaption className="mt-4 pt-4 border-t border-bg-subtle">
                <p className="text-sm font-semibold text-text-primary">
                  {t.name}
                </p>
                <p className="text-xs text-text-muted">{t.location}</p>
              </figcaption>
            </figure>
          ))}
        </div>

        {/* Badge strip */}
        <div className="flex flex-wrap justify-center gap-3">
          {badges.map((b) => (
            <span
              key={b.label}
              className="trust-pill"
            >
              {b.icon}
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaBand({ d }: { d: FigurunicaDict }) {
  return (
    <section className={s("cta-band")}>
      <h2>
        {d["landing.fig.ctaBand.titleLead"]}
        <br />
        <span className={s("italic")}>{d["landing.fig.ctaBand.titleItalic"]} </span>
        <span className={s("accent")}>{d["landing.fig.ctaBand.titleAccent"]}</span>
      </h2>
      <p>{d["landing.fig.ctaBand.sub"]}</p>
      <Link href="/create" className={s("btn-primary")}>
        {d["landing.fig.ctaBand.button"]}
        <ArrowIcon />
      </Link>
    </section>
  );
}

export function FigFooter({ d }: { d: FigurunicaDict }) {
  return (
    <footer className={s("footer")}>
      <div className={s("footer-top")}>
        <span>{d["landing.fig.footer.copyright"]}</span>
        <span>{d["landing.fig.footer.tagline"]}</span>
      </div>
      <div className={s("footer-bottom")}>
        <a href={CONTACT_PHONE_HREF} className={s("footer-link")}>
          <span className={s("footer-label")}>
            {d["landing.fig.footer.phoneLabel"]}
          </span>
          {CONTACT_PHONE_DISPLAY}
        </a>
        <a
          href={CONTACT_MAPS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={s("footer-link")}
        >
          <span className={s("footer-label")}>
            {d["landing.fig.footer.addressLabel"]}
          </span>
          {CONTACT_ADDRESS_FULL}
        </a>
        <a href={CONTACT_EMAIL_HREF} className={s("footer-link")}>
          <span className={s("footer-label")}>
            {d["landing.fig.footer.emailLabel"]}
          </span>
          {CONTACT_EMAIL}
        </a>
        <Link href="/contact" className={s("footer-link")}>
          {d["landing.fig.footer.contactLink"]}
        </Link>
      </div>
      <div className={s("footer-bottom")}>
        <Link href="/mesafeli-satis" className={s("footer-link")}>
          {d["landing.fig.footer.legal.distance"]}
        </Link>
        <Link href="/on-bilgilendirme" className={s("footer-link")}>
          {d["landing.fig.footer.legal.preinfo"]}
        </Link>
        <Link href="/iade" className={s("footer-link")}>
          {d["landing.fig.footer.legal.returns"]}
        </Link>
        <Link href="/kargo" className={s("footer-link")}>
          {d["landing.fig.footer.legal.shipping"]}
        </Link>
        <Link href="/cerez" className={s("footer-link")}>
          {d["landing.fig.footer.legal.cookies"]}
        </Link>
        <Link href="/privacy" className={s("footer-link")}>
          {d["landing.fig.footer.legal.privacy"]}
        </Link>
        <Link href="/terms" className={s("footer-link")}>
          {d["landing.fig.footer.legal.terms"]}
        </Link>
      </div>
      <div className={s("footer-mfr")}>
        <span className={s("footer-mfr-prompt")}>
          {d["landing.fig.footer.mfrPrompt"]}
        </span>
        <div className={s("footer-mfr-actions")}>
          <Link
            href="/manufacturer/register"
            className={s("footer-mfr-apply")}
          >
            {d["landing.fig.footer.mfrApply"]} →
          </Link>
          <Link href="/manufacturer/login" className={s("footer-link")}>
            {d["landing.fig.footer.mfrLogin"]}
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function FloatingCta({ show, d }: { show: boolean; d: FigurunicaDict }) {
  return (
    <div className={cx("floating-cta", show && "show")}>
      <span className={s("dot")} />
      <span>{d["landing.fig.floating.text"]}</span>
      <Link href="/create" className={s("btn")}>
        {d["landing.fig.floating.button"]} →
      </Link>
    </div>
  );
}
