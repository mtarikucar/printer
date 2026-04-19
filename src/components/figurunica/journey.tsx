"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FigurunicaDict } from "./dict";
import {
  StationUpload,
  StationScan,
  StationWire,
  StationPrinter,
  StationPolish,
  StationShipping,
  StationReveal,
} from "./stations";
import styles from "./figurunica.module.css";

const s = (key: string) => (styles as Record<string, string>)[key] ?? "";
const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).map((n) => s(n as string)).filter(Boolean).join(" ");

const STATION_COUNT = 7;

type StationComp = React.ComponentType<{ progress: number; d: FigurunicaDict }>;

interface StationCopy {
  idx: string;
  titleLead: string;
  titleItalic: string;
  titleTail?: string;
  desc: string;
  caption: string;
}

function buildCopy(d: FigurunicaDict): StationCopy[] {
  return [
    {
      idx: "01",
      titleLead: d["landing.fig.sta.01.titleLead"],
      titleItalic: d["landing.fig.sta.01.titleItalic"],
      desc: d["landing.fig.sta.01.desc"],
      caption: d["landing.fig.sta.01.caption"],
    },
    {
      idx: "02",
      titleLead: d["landing.fig.sta.02.titleLead"],
      titleItalic: d["landing.fig.sta.02.titleItalic"],
      titleTail: d["landing.fig.sta.02.titleTail"],
      desc: d["landing.fig.sta.02.desc"],
      caption: d["landing.fig.sta.02.caption"],
    },
    {
      idx: "03",
      titleLead: d["landing.fig.sta.03.titleLead"],
      titleItalic: d["landing.fig.sta.03.titleItalic"],
      desc: d["landing.fig.sta.03.desc"],
      caption: d["landing.fig.sta.03.caption"],
    },
    {
      idx: "04",
      titleLead: d["landing.fig.sta.04.titleLead"],
      titleItalic: d["landing.fig.sta.04.titleItalic"],
      desc: d["landing.fig.sta.04.desc"],
      caption: d["landing.fig.sta.04.caption"],
    },
    {
      idx: "05",
      titleLead: d["landing.fig.sta.05.titleLead"],
      titleItalic: d["landing.fig.sta.05.titleItalic"],
      desc: d["landing.fig.sta.05.desc"],
      caption: d["landing.fig.sta.05.caption"],
    },
    {
      idx: "06",
      titleLead: d["landing.fig.sta.06.titleLead"],
      titleItalic: d["landing.fig.sta.06.titleItalic"],
      desc: d["landing.fig.sta.06.desc"],
      caption: d["landing.fig.sta.06.caption"],
    },
    {
      idx: "07",
      titleLead: d["landing.fig.sta.07.titleLead"],
      titleItalic: d["landing.fig.sta.07.titleItalic"],
      desc: d["landing.fig.sta.07.desc"],
      caption: d["landing.fig.sta.07.caption"],
    },
  ];
}

function renderTitle(copy: StationCopy): ReactNode {
  return (
    <>
      {copy.titleLead}{" "}
      <span className={s("italic")}>{copy.titleItalic}</span>
      {copy.titleTail ? <> {copy.titleTail}</> : null}
    </>
  );
}

export function ScrollJourney({ d }: { d: FigurunicaDict }) {
  const wrapRef = useRef<HTMLElement | null>(null);
  const [scene, setScene] = useState(0);
  const [sceneProg, setSceneProg] = useState(0);
  const [tx, setTx] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      const scrolled = Math.max(0, Math.min(total, -rect.top));
      const p = total > 0 ? scrolled / total : 0;
      const sceneIdx = Math.min(STATION_COUNT - 1, Math.floor(p * STATION_COUNT));
      const withinScene = p * STATION_COUNT - sceneIdx;
      setScene(sceneIdx);
      setSceneProg(withinScene);
      setTx(-p * (STATION_COUNT - 1) * window.innerWidth);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const stations: StationComp[] = [
    StationUpload,
    StationScan,
    StationWire,
    StationPrinter,
    StationPolish,
    StationShipping,
    StationReveal,
  ];
  const copy = buildCopy(d);

  return (
    <section className={s("journey")} ref={wrapRef}>
      <div className={s("journey-stage")}>
        <div className={s("stage-bg")} />
        <div className={s("stage-grid")} />
        <div
          className={s("stations-track")}
          style={{
            width: `${STATION_COUNT * 100}vw`,
            transform: `translateX(${tx}px)`,
          }}
        >
          {stations.map((Comp, i) => {
            const active = i === scene;
            const prog = active ? sceneProg : i < scene ? 1 : 0;
            const c = copy[i];
            return (
              <div className={s("station")} key={i}>
                <div className={s("station-visual")}>
                  <Comp progress={prog} d={d} />
                </div>
                <div className={s("station-copy")}>
                  <div className={s("station-index")}>
                    <span className={s("bar")} />
                    <span className={s("num")}>{c.idx}</span>
                    <span>· {d["landing.fig.journey.of"]}</span>
                  </div>
                  <h2 className={s("station-title")}>{renderTitle(c)}</h2>
                  <p className={s("station-desc")}>{c.desc}</p>
                  <div className={s("station-caption")}>
                    <span className={s("dot")} />
                    {c.caption}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className={s("scene-counter")}>
          {Array.from({ length: STATION_COUNT }).map((_, i) => (
            <div
              key={i}
              className={cx("tick", i === scene && "active", i < scene && "past")}
            />
          ))}
        </div>
        <div className={s("scene-label")}>
          {d["landing.fig.journey.scene"]}{" "}
          <span className={s("val")}>{copy[scene].idx}</span>
        </div>
      </div>
    </section>
  );
}
