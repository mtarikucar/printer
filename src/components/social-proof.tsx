"use client";

import { ScrollReveal } from "@/components/scroll-reveal";

interface Testimonial {
  quote: string;
  name: string;
  location: string;
}

export function SocialProofSection({
  title,
  subtitle,
  testimonials,
}: {
  title: string;
  subtitle: string;
  testimonials: Testimonial[];
}) {
  return (
    <section className="section-spacing">
      <div className="max-w-6xl mx-auto px-4">
        <ScrollReveal>
          <h2 className="text-3xl md:text-5xl font-serif text-text-primary text-center">
            {title}
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.1}>
          <p className="mt-4 text-text-secondary text-center max-w-xl mx-auto">
            {subtitle}
          </p>
        </ScrollReveal>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => {
            const initials = t.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .toUpperCase()
              .slice(0, 2);

            return (
              <ScrollReveal key={t.name} delay={i * 0.15} direction="up">
                <div className="card p-6 h-full flex flex-col">
                  {/* Stars */}
                  <div className="flex gap-0.5 mb-4">
                    {Array.from({ length: 5 }).map((_, si) => (
                      <svg
                        key={si}
                        className="w-4 h-4 text-green-500"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>

                  {/* Quote */}
                  <blockquote className="text-text-primary leading-relaxed flex-1">
                    &ldquo;{t.quote}&rdquo;
                  </blockquote>

                  {/* Author */}
                  <div className="mt-5 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {initials}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {t.name}
                      </p>
                      <p className="text-xs text-text-muted">{t.location}</p>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
