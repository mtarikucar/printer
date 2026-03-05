"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";

export function ScrollReveal({
  children,
  className,
  delay = 0,
  direction = "up",
  wobble = false,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
  wobble?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  const directionMap = {
    up: { y: 40 },
    down: { y: -40 },
    left: { x: 40 },
    right: { x: -40 },
    none: {},
  };

  const initial = {
    opacity: 0,
    ...directionMap[direction],
    ...(wobble ? { rotate: -2 } : {}),
  };

  const animateTo = isInView
    ? { opacity: 1, x: 0, y: 0, ...(wobble ? { rotate: 0 } : {}) }
    : undefined;

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={initial}
      animate={animateTo}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
