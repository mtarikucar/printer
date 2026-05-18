"use client";

import { useEffect, useState } from "react";
import type { FigurunicaDict } from "./dict";
import {
  HeroIntro,
  StyleGallery,
  HowItWorks,
  TrustSignals,
  CtaBand,
  FigFooter,
  FloatingCta,
} from "./sections";
import { ScrollJourney } from "./journey";
import { FaqSection } from "./faq";
import styles from "./figurunica.module.css";

const s = (key: string) => (styles as Record<string, string>)[key] ?? "";

export function FigurunicaLanding({ d }: { d: FigurunicaDict }) {
  const [showFloat, setShowFloat] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const vh = window.innerHeight;
      const docH = document.body.scrollHeight;
      setShowFloat(y > vh * 0.6 && y < docH - vh * 1.2);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={s("root")}>
      <HeroIntro d={d} />
      <ScrollJourney d={d} />
      <StyleGallery d={d} />
      <HowItWorks d={d} />
      <TrustSignals d={d} />
      <FaqSection d={d} />
      <CtaBand d={d} />
      <FigFooter d={d} />
      <FloatingCta show={showFloat} d={d} />
    </div>
  );
}
