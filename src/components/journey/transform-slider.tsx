"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The signature moment of the journey page: the customer drags across their own
 * photograph and watches it become the character that was sculpted from it.
 *
 * Built on a clipped overlay rather than an opacity crossfade, because the point
 * is a hard edge you can put your thumb on — you are meant to see both truths at
 * once, meeting at a line you control. Keyboard-operable via a real range input
 * so this is not a mouse-only party trick.
 */
export function TransformSlider({
  beforeUrl,
  afterUrl,
  beforeLabel,
  afterLabel,
  hint,
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel: string;
  afterLabel: string;
  hint: string;
}) {
  const [pct, setPct] = useState(50);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  const setFromClientX = useCallback((clientX: number) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.max(0, Math.min(100, next)));
  }, []);

  // Pointer events are tracked on the window while dragging so the handle keeps
  // following even when the finger leaves the frame — otherwise the reveal
  // sticks halfway the moment you overshoot the edge.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => setFromClientX(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, setFromClientX]);

  return (
    <figure className="m-0">
      {/* Labelled by the visible tags below, so the images themselves are
          decorative: meaningful alt text would be read twice, and would spill
          across the frame as raw text if a file ever fails to load. */}
      <div
        ref={frameRef}
        onPointerDown={(e) => {
          setDragging(true);
          setFromClientX(e.clientX);
        }}
        className="j-frame relative aspect-square w-full touch-none select-none overflow-hidden rounded-[28px]"
      >
        {/* After (the design) sits underneath; the photo is clipped over it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={afterUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={beforeUrl}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
          />
        </div>

        {/* The seam. */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-white/90 shadow-[0_0_18px_rgba(255,255,255,0.55)]"
          style={{ left: `${pct}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-white/15 backdrop-blur-md"
          style={{ left: `${pct}%` }}
        >
          <span className="text-sm text-white">↔</span>
        </div>

        <span className="j-tag absolute bottom-3 left-3">{beforeLabel}</span>
        <span className="j-tag absolute bottom-3 right-3">{afterLabel}</span>

        {/* The real control: invisible, but focusable and arrow-key operable. */}
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(pct)}
          onChange={(e) => setPct(Number(e.target.value))}
          aria-label={`${beforeLabel} / ${afterLabel} karşılaştırması`}
          className="j-range absolute inset-x-0 bottom-0 h-11 w-full cursor-ew-resize opacity-0"
        />
      </div>
      <figcaption className="j-hint mt-3 text-center">{hint}</figcaption>
    </figure>
  );
}
