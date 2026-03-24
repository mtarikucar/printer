"use client";

import type { BrushType, SymmetrySettings } from "@/lib/sculpting/engine/types";

interface SculptToolbarProps {
  activeBrush: BrushType;
  symmetry: SymmetrySettings;
  wireframe: boolean;
  onBrushChange: (brush: BrushType) => void;
  onSymmetryToggle: (axis: "x" | "y" | "z") => void;
  onWireframeToggle: () => void;
  onFrame: () => void;
  onClose: () => void;
}

const BRUSH_GROUPS: { label: string; brushes: { type: BrushType; name: string; key?: string }[] }[] = [
  {
    label: "Add/Remove",
    brushes: [
      { type: "draw", name: "Draw", key: "1" },
      { type: "clay_strips", name: "Clay Strips", key: "8" },
      { type: "inflate", name: "Inflate", key: "4" },
      { type: "layer", name: "Layer" },
      { type: "fill", name: "Fill" },
    ],
  },
  {
    label: "Smooth/Flatten",
    brushes: [
      { type: "smooth", name: "Smooth", key: "2" },
      { type: "flatten", name: "Flatten", key: "3" },
      { type: "scrape", name: "Scrape" },
    ],
  },
  {
    label: "Deform",
    brushes: [
      { type: "grab", name: "Grab", key: "5" },
      { type: "snake_hook", name: "Snake Hook" },
      { type: "thumb", name: "Thumb" },
      { type: "elastic_deform", name: "Elastic" },
      { type: "pose", name: "Pose" },
    ],
  },
  {
    label: "Detail",
    brushes: [
      { type: "pinch", name: "Pinch", key: "6" },
      { type: "crease", name: "Crease", key: "7" },
    ],
  },
  {
    label: "Utility",
    brushes: [
      { type: "mask", name: "Mask", key: "9" },
    ],
  },
];

export function SculptToolbar({
  activeBrush,
  symmetry,
  wireframe,
  onBrushChange,
  onSymmetryToggle,
  onWireframeToggle,
  onFrame,
  onClose,
}: SculptToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-[#12121f] border-b border-white/10 overflow-x-auto shrink-0">
      {/* Brush groups */}
      {BRUSH_GROUPS.map((group) => (
        <div key={group.label} className="flex items-center gap-0.5">
          <span className="text-[10px] text-white/30 px-1 select-none">{group.label}</span>
          {group.brushes.map((b) => (
            <button
              key={b.type}
              onClick={() => onBrushChange(b.type)}
              title={`${b.name}${b.key ? ` (${b.key})` : ""}`}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                activeBrush === b.type
                  ? "bg-emerald-600 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              {b.name}
            </button>
          ))}
          <div className="w-px h-5 bg-white/10 mx-1" />
        </div>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Symmetry */}
      <div className="flex items-center gap-0.5">
        <span className="text-[10px] text-white/30 px-1 select-none">Symmetry</span>
        {(["x", "y", "z"] as const).map((axis) => (
          <button
            key={axis}
            onClick={() => onSymmetryToggle(axis)}
            title={`Mirror ${axis.toUpperCase()} (${axis})`}
            className={`w-6 h-6 text-xs font-bold rounded transition-colors ${
              symmetry[axis]
                ? "bg-blue-600 text-white"
                : "text-white/40 hover:bg-white/10 hover:text-white"
            }`}
          >
            {axis.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* Wireframe */}
      <button
        onClick={onWireframeToggle}
        title="Wireframe (W)"
        className={`px-2 py-1 text-xs rounded transition-colors ${
          wireframe
            ? "bg-purple-600 text-white"
            : "text-white/60 hover:bg-white/10 hover:text-white"
        }`}
      >
        Wire
      </button>

      {/* Frame */}
      <button
        onClick={onFrame}
        title="Frame model (F)"
        className="px-2 py-1 text-xs rounded text-white/60 hover:bg-white/10 hover:text-white transition-colors"
      >
        Frame
      </button>

      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* Close */}
      <button
        onClick={onClose}
        className="px-3 py-1 text-xs rounded bg-red-600/80 text-white hover:bg-red-600 transition-colors"
      >
        Close
      </button>
    </div>
  );
}
