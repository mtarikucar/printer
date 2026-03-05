"use client";

import { useRef, useEffect, useState } from "react";
import { motion, useInView, animate } from "motion/react";

export interface CommunityStat {
  value: number;
  suffix: string;
  label: string;
  display?: string | null;
}

function AnimatedNumber({ value, suffix }: { value: number; suffix: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });

  useEffect(() => {
    if (!isInView) return;
    const controls = animate(0, value, {
      duration: 1.5,
      ease: [0.22, 1, 0.36, 1],
      onUpdate(v) {
        // Show one decimal for non-integer values like 4.9
        setDisplay(Number.isInteger(value) ? Math.round(v) : parseFloat(v.toFixed(1)));
      },
    });
    return () => controls.stop();
  }, [isInView, value]);

  return (
    <span ref={ref} className="text-3xl md:text-4xl font-bold text-green-500 font-mono">
      {display}
      {suffix}
    </span>
  );
}

export function CommunityCounter({ stats }: { stats: CommunityStat[] }) {
  return (
    <section className="py-10 border-y border-bg-subtle/50 bg-bg-surface/50">
      <div className="max-w-5xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              className="text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              {stat.display ? (
                <span className="text-3xl md:text-4xl font-bold text-green-500">
                  {stat.display === "Free" ? "✓" : stat.display}
                </span>
              ) : (
                <AnimatedNumber value={stat.value} suffix={stat.suffix} />
              )}
              <p className="mt-1 text-sm text-text-muted">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
