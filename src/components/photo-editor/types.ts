export interface ImageAdjustments {
  brightness: number; // 0-200, default 100
  contrast: number; // 0-200, default 100
  saturation: number; // 0-200, default 100
}

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
};

export interface AspectRatioOption {
  label: string;
  value: number | undefined; // undefined = free
}

export type EditorTool =
  | "crop"
  | "rotateLeft"
  | "rotateRight"
  | "flipH"
  | "flipV"
  | "zoomIn"
  | "zoomOut";

export function getFilterStyle(adjustments: ImageAdjustments): string {
  return `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturation}%)`;
}
