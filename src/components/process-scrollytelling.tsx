"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";

interface Step {
  number: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

export function ProcessScrollytelling({ steps }: { steps: Step[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  return (
    <div ref={containerRef} style={{ height: `${steps.length * 100}vh` }} className="relative">
      <div className="sticky top-0 h-screen flex items-center overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 w-full">
          {steps.map((step, i) => (
            <StepSlide
              key={step.number}
              step={step}
              index={i}
              total={steps.length}
              progress={scrollYProgress}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StepSlide({
  step,
  index,
  total,
  progress,
}: {
  step: Step;
  index: number;
  total: number;
  progress: ReturnType<typeof useScroll>["scrollYProgress"];
}) {
  const segmentSize = 1 / total;
  const start = index * segmentSize;
  const end = start + segmentSize;

  const opacity = useTransform(progress, [
    start,
    start + segmentSize * 0.15,
    end - segmentSize * 0.15,
    end,
  ], [0, 1, 1, 0]);

  const y = useTransform(progress, [start, start + segmentSize * 0.2], [60, 0]);

  return (
    <motion.div
      className="absolute inset-0 flex items-center"
      style={{ opacity, y }}
    >
      <div className="max-w-6xl mx-auto px-4 w-full grid md:grid-cols-2 gap-12 items-center">
        {/* Large watermark number */}
        <div className="relative flex items-center justify-center">
          <span className="text-[12rem] md:text-[16rem] font-serif font-bold text-bg-subtle/50 select-none leading-none">
            {step.number}
          </span>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-24 h-24 rounded-2xl bg-bg-surface border border-bg-subtle shadow-elevated flex items-center justify-center text-green-500">
              {step.icon}
            </div>
          </div>
        </div>
        {/* Text content */}
        <div>
          <span className="text-green-500 font-mono text-sm tracking-wider">
            STEP {step.number}
          </span>
          <h3 className="mt-3 text-4xl md:text-5xl font-serif text-text-primary leading-tight">
            {step.title}
          </h3>
          <p className="mt-4 text-lg text-text-secondary leading-relaxed max-w-md">
            {step.description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
