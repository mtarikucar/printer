/**
 * Print-readiness gate — the crux of the auto-3D pipeline.
 *
 * The first Meshy attempt was abandoned in July 2026 because "çıkan model
 * baskıya uygun olmuyordu". This module is the answer: a pure, deterministic
 * verdict over a numeric mesh report, with every threshold traceable to a
 * measurement rather than an intuition.
 *
 * Two inputs, one ruling:
 *   - Meshy's own free `print/analyze` is a CROSS-CHECK ONLY. It never passes a
 *     mesh on its own: a measured sample came back `is_watertight: true` with
 *     33,314 degenerate faces and Meshy still graded it merely "warning".
 *   - `scripts/process_mesh.py` runs on the mesh we will ACTUALLY PRINT — after
 *     orientation, merge, scale to real millimetres and base. That is the judge.
 *
 * There is deliberately NO automatic thickening stage. Both implementations
 * available in this stack were measured and both made the mesh worse:
 * pymeshlab resampling returned a non-watertight 17-component shell, and voxel
 * dilation took 29-118 s, produced 560k-1.25M faces and moved the surface by
 * 0.44 mm on average — visibly away from the 2D image the customer approved.
 * Thin-but-printable is a WARNING for a human, not a robot's repair job.
 *
 * NOTE: no `import "server-only"` — the BullMQ worker reaches this module.
 */

export type PrintGateVerdict = "pass" | "warn" | "fail";

export type GateMode = "shadow" | "enforce";

/** Default is shadow: the gate reports but does not block until it is calibrated. */
export function gateMode(): GateMode {
  return process.env.PRINT_GATE_MODE === "enforce" ? "enforce" : "shadow";
}

export const PRINT_ENVELOPE_MM = { x: 220, y: 220, z: 250 } as const;

/**
 * Below HARD the feature cannot survive the printer. Between HARD and SAFE it
 * prints but is fragile — a human decides.
 *
 * Measured reference: a real meshy-7 order at 150 mm came out at
 * p1 = 0.64 mm, p5 = 1.27 mm. Setting HARD at resin's real floor keeps that
 * order sellable; setting it at 0.9 would have rejected a printable figure.
 */
export const MIN_WALL_HARD_MM = { resin: 0.5, filament: 0.9 } as const;
export const MIN_WALL_SAFE_MM = { resin: 0.9, filament: 1.4 } as const;

export const MIN_FACES = 15_000;
export const MAX_FACES = 400_000;
export const MIN_FILL_RATIO = 0.02;
export const MAX_DEGENERATE_RATIO = 0.25;
export const MAX_HEIGHT_DEVIATION = 0.05;

export interface MeshReport {
  isWatertight: boolean;
  isVolume: boolean;
  vertexCount: number;
  faceCount: number;
  componentCount: number;
  boundingBox: { size: [number, number, number] };
  volumeCm3: number;
  fillRatio: number;
  baseAdded: boolean;
  repairsApplied: string[];
  droppedSignificantComponent: boolean;
  mergedComponentCount: number;
  minWallP1Mm: number | null;
  minWallP5Mm: number | null;
  targetHeightMm: number;
  measuredHeightMm: number;
  material: "resin" | "filament";
}

export interface MeshyPrintabilitySummary {
  status: "healthy" | "warning" | "error" | "unknown";
  volume: number | null;
  degenerateFaces: number | null;
}

export interface GateResult {
  verdict: PrintGateVerdict;
  /** Machine codes, stable across locales. */
  failures: string[];
  warnings: string[];
  /** Turkish, admin-facing. */
  reasonsTr: string[];
}

const TR: Record<string, string> = {
  not_watertight: "Mesh su geçirmez değil",
  not_volume: "Kapalı hacim değil",
  dropped_significant_component: "Modelin bir parçası atıldı (kopmuş uzuv/aksesuar)",
  multiple_components: "Birden fazla ayrık parça",
  too_few_faces: "Yetersiz detay (blob)",
  too_many_faces: "Aşırı yoğun mesh (slicer'ı boğar)",
  exceeds_envelope: "Baskı zarfını aşıyor",
  hollow_shell: "İçi boş kabuk (doluluk oranı çok düşük)",
  no_base: "Kaide eklenemedi",
  meshy_zero_volume: "Meshy: sıfır hacim",
  too_many_degenerate: "Aşırı bozuk yüzey oranı",
  wall_too_thin: "Duvar kalınlığı baskı sınırının altında",
  wall_thin_warning: "İnce duvar — kırılgan olabilir",
  wall_widespread_thin: "İncelik yaygın (tek kıymık değil)",
  meshy_warning: "Meshy analizinde uyarı var",
  base_concatenated: "Kaide birleştirilemedi, üst üste bindirildi",
  components_merged: "Aksesuarlar birleştirildi (kurtarıldı)",
  height_deviation: "Ölçülen yükseklik hedeften sapıyor",
  wall_unmeasured: "Duvar kalınlığı ölçülemedi",
};

function tr(code: string, extra?: string): string {
  const base = TR[code] ?? code;
  return extra ? `${base} (${extra})` : base;
}

export function evaluatePrintGate(
  report: MeshReport,
  meshy: MeshyPrintabilitySummary | null
): GateResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const reasonsTr: string[] = [];

  const fail = (code: string, extra?: string) => {
    failures.push(code);
    reasonsTr.push(tr(code, extra));
  };
  const warn = (code: string, extra?: string) => {
    warnings.push(code);
    reasonsTr.push(tr(code, extra));
  };

  if (!report.isWatertight) fail("not_watertight");
  if (!report.isVolume) fail("not_volume");

  // The single most valuable check here. keep_largest_component() silently
  // deletes a detached arm/bow/sword and the result stays PERFECTLY watertight,
  // so every naive check passes and a one-armed figure ships in the box.
  if (report.droppedSignificantComponent) fail("dropped_significant_component");

  if (report.componentCount !== 1) fail("multiple_components", String(report.componentCount));
  if (report.faceCount < MIN_FACES) fail("too_few_faces", String(report.faceCount));
  if (report.faceCount > MAX_FACES) fail("too_many_faces", String(report.faceCount));

  const [sx, sy, sz] = report.boundingBox.size;
  if (sx > PRINT_ENVELOPE_MM.x || sy > PRINT_ENVELOPE_MM.y || sz > PRINT_ENVELOPE_MM.z) {
    fail("exceeds_envelope", `${sx.toFixed(0)}×${sy.toFixed(0)}×${sz.toFixed(0)} mm`);
  }

  if (report.fillRatio < MIN_FILL_RATIO) fail("hollow_shell", report.fillRatio.toFixed(3));
  if (!report.baseAdded) fail("no_base");

  if (meshy) {
    if (meshy.volume !== null && meshy.volume <= 0) fail("meshy_zero_volume");
    if (meshy.degenerateFaces !== null && report.faceCount > 0) {
      const ratio = meshy.degenerateFaces / report.faceCount;
      if (ratio > MAX_DEGENERATE_RATIO) fail("too_many_degenerate", `%${(ratio * 100).toFixed(0)}`);
    }
    if (meshy.status === "warning") warn("meshy_warning");
  }

  const hard = MIN_WALL_HARD_MM[report.material];
  const safe = MIN_WALL_SAFE_MM[report.material];
  if (report.minWallP1Mm === null) {
    warn("wall_unmeasured");
  } else if (report.minWallP1Mm < hard) {
    fail("wall_too_thin", `${report.minWallP1Mm.toFixed(2)} mm`);
  } else if (report.minWallP1Mm < safe) {
    warn("wall_thin_warning", `${report.minWallP1Mm.toFixed(2)} mm`);
  }
  if (report.minWallP5Mm !== null && report.minWallP5Mm < safe) {
    warn("wall_widespread_thin", `${report.minWallP5Mm.toFixed(2)} mm`);
  }

  if (report.repairsApplied.includes("base_added_concatenate")) warn("base_concatenated");
  if (report.mergedComponentCount > 1) warn("components_merged", String(report.mergedComponentCount));

  if (report.targetHeightMm > 0) {
    const deviation = Math.abs(report.measuredHeightMm - report.targetHeightMm) / report.targetHeightMm;
    if (deviation > MAX_HEIGHT_DEVIATION) {
      warn("height_deviation", `${report.measuredHeightMm.toFixed(1)} mm`);
    }
  }

  const verdict: PrintGateVerdict =
    failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";
  return { verdict, failures, warnings, reasonsTr };
}

/**
 * Whether a verdict blocks the one-click admin approval. In shadow mode nothing
 * blocks — the gate only paints a badge while its thresholds are being
 * calibrated against real orders.
 */
export function requiresOverride(verdict: PrintGateVerdict): boolean {
  return verdict === "fail" && gateMode() === "enforce";
}
