"use client";

import { useDictionary } from "@/lib/i18n/locale-context";
import { type ImageAdjustments, DEFAULT_ADJUSTMENTS } from "./types";

interface EditorAdjustmentsProps {
  adjustments: ImageAdjustments;
  onChange: (adjustments: ImageAdjustments) => void;
}

export function EditorAdjustments({ adjustments, onChange }: EditorAdjustmentsProps) {
  const d = useDictionary();

  const sliders: { key: keyof ImageAdjustments; label: string }[] = [
    { key: "brightness", label: d["editor.adjust.brightness"] },
    { key: "contrast", label: d["editor.adjust.contrast"] },
    { key: "saturation", label: d["editor.adjust.saturation"] },
  ];

  const isDefault =
    adjustments.brightness === 100 &&
    adjustments.contrast === 100 &&
    adjustments.saturation === 100;

  return (
    <div className="space-y-3">
      {sliders.map((slider) => (
        <div key={slider.key} className="flex items-center gap-3">
          <label className="text-xs text-text-muted w-20 shrink-0">{slider.label}</label>
          <input
            type="range"
            min={0}
            max={200}
            value={adjustments[slider.key]}
            onChange={(e) =>
              onChange({
                ...adjustments,
                [slider.key]: parseInt(e.target.value),
              })
            }
            className="flex-1 h-1.5 accent-green-500 cursor-pointer"
          />
          <span className="text-xs text-text-muted w-8 text-right font-mono">
            {adjustments[slider.key]}
          </span>
        </div>
      ))}

      {!isDefault && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_ADJUSTMENTS)}
          className="text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          {d["editor.adjust.reset"]}
        </button>
      )}
    </div>
  );
}
