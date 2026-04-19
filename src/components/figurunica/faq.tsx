"use client";

import { useState } from "react";
import type { FigurunicaDict } from "./dict";
import styles from "./figurunica.module.css";

const s = (key: string) => (styles as Record<string, string>)[key] ?? "";
const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).map((n) => s(n as string)).filter(Boolean).join(" ");

export function FaqSection({ d }: { d: FigurunicaDict }) {
  const [open, setOpen] = useState<number | null>(0);

  const items = [
    { q: d["landing.faq.q1"], a: d["landing.faq.a1"] },
    { q: d["landing.faq.q2"], a: d["landing.faq.a2"] },
    { q: d["landing.faq.q3"], a: d["landing.faq.a3"] },
    { q: d["landing.faq.q4"], a: d["landing.faq.a4"] },
    { q: d["landing.faq.q5"], a: d["landing.faq.a5"] },
    { q: d["landing.faq.q6"], a: d["landing.faq.a6"] },
    { q: d["landing.faq.q7"], a: d["landing.faq.a7"] },
    { q: d["landing.faq.q8"], a: d["landing.faq.a8"] },
  ];

  return (
    <section className={s("faq-section")} id="faq">
      <div className={s("section-head")}>
        <div className={s("section-eyebrow")}>FAQ · {String(items.length).padStart(2, "0")}</div>
        <h2 className={s("section-title")}>{d["landing.faq.title"]}</h2>
      </div>

      <div className={s("faq-list")}>
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className={cx("faq-item", isOpen && "open")}>
              <button
                type="button"
                className={s("faq-question")}
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
              >
                <span className={s("faq-question-idx")}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={s("faq-question-text")}>{item.q}</span>
                <span className={s("faq-chevron")} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
              </button>
              <div className={s("faq-answer-wrap")}>
                <div className={s("faq-answer-inner")}>
                  <p className={s("faq-answer")}>{item.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
