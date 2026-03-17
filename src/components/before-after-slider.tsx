"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";

export function BeforeAfterSlider({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const updatePosition = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.max(5, Math.min(95, pct)));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      updatePosition(e.clientX);
    },
    [updatePosition]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      updatePosition(e.clientX);
    },
    [updatePosition]
  );

  const onPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full select-none overflow-hidden"
    >
      {/* After layer (3D model) — fully visible behind */}
      <div className="absolute inset-0">{after}</div>

      {/* Before layer (photo) — clipped to left portion */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {before}
      </div>

      {/* Labels */}
      {beforeLabel && position > 20 && (
        <span className="absolute top-3 left-3 pointer-events-none text-xs font-medium uppercase tracking-wider bg-black/50 text-white backdrop-blur-sm px-2.5 py-1 rounded-full">
          {beforeLabel}
        </span>
      )}
      {afterLabel && position < 80 && (
        <span className="absolute top-3 right-3 pointer-events-none text-xs font-medium uppercase tracking-wider bg-black/50 text-green-400 backdrop-blur-sm px-2.5 py-1 rounded-full">
          {afterLabel}
        </span>
      )}

      {/* Divider line + drag handle */}
      <div
        className="absolute top-0 bottom-0 z-10 cursor-ew-resize"
        style={{
          left: `${position}%`,
          transform: "translateX(-50%)",
          width: "40px",
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Vertical line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-white/70 shadow-[0_0_8px_rgba(0,0,0,0.3)]" />

        {/* Circle handle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center">
          <svg
            className="w-5 h-5 text-gray-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 5l-5 7 5 7" />
            <path d="M16 5l5 7-5 7" />
          </svg>
        </div>
      </div>
    </div>
  );
}
