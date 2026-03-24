"use client";

import type { BrushType } from "@/lib/sculpting/engine/types";

interface SculptStatusBarProps {
  activeBrush: BrushType;
  vertexCount: number;
  faceCount: number;
}

const BRUSH_LABELS: Record<BrushType, string> = {
  draw: "Draw",
  clay_strips: "Clay Strips",
  smooth: "Smooth",
  flatten: "Flatten",
  inflate: "Inflate",
  grab: "Grab",
  pinch: "Pinch",
  crease: "Crease",
  scrape: "Scrape",
  fill: "Fill",
  snake_hook: "Snake Hook",
  thumb: "Thumb",
  layer: "Layer",
  elastic_deform: "Elastic Deform",
  pose: "Pose",
  mask: "Mask",
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

export function SculptStatusBar({
  activeBrush,
  vertexCount,
  faceCount,
}: SculptStatusBarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-1 bg-[#12121f] border-t border-white/10 text-[11px] text-white/40 shrink-0">
      <div className="flex items-center gap-4">
        <span>
          Brush: <span className="text-white/70">{BRUSH_LABELS[activeBrush]}</span>
        </span>
        <span>
          Vertices: <span className="text-white/70">{formatNumber(vertexCount)}</span>
        </span>
        <span>
          Faces: <span className="text-white/70">{formatNumber(faceCount)}</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span>LMB: Sculpt</span>
        <span>MMB: Rotate</span>
        <span>Scroll: Zoom</span>
        <span>Shift: Smooth</span>
        <span>Ctrl: Invert</span>
      </div>
    </div>
  );
}
