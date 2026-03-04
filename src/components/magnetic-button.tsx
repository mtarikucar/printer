"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";

export function MagneticButton({
  children,
  className,
  onClick,
  href,
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    const x = (e.clientX - left - width / 2) * 0.15;
    const y = (e.clientY - top - height / 2) * 0.15;
    setPosition({ x, y });
  };

  const handleLeave = () => setPosition({ x: 0, y: 0 });

  const motionProps = {
    ref: ref as React.Ref<HTMLButtonElement>,
    className,
    onMouseMove: handleMouse,
    onMouseLeave: handleLeave,
    animate: { x: position.x, y: position.y },
    transition: { type: "spring" as const, stiffness: 200, damping: 15, mass: 0.5 },
  };

  if (href) {
    return (
      <motion.a
        {...motionProps}
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
      >
        {children}
      </motion.a>
    );
  }

  return (
    <motion.button
      {...motionProps}
      onClick={onClick}
      disabled={disabled}
      type={type}
    >
      {children}
    </motion.button>
  );
}
