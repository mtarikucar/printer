import * as THREE from "three";

// ─── Brush Types ─────────────────────────────────────────────

export type BrushType =
  | "draw"
  | "clay_strips"
  | "smooth"
  | "flatten"
  | "inflate"
  | "grab"
  | "pinch"
  | "crease"
  | "scrape"
  | "fill"
  | "snake_hook"
  | "thumb"
  | "layer"
  | "elastic_deform"
  | "pose"
  | "mask";

export interface BrushSettings {
  size: number; // radius in world units
  strength: number; // 0..1
  invert: boolean; // Ctrl held
  smoothOverride: boolean; // Shift held — forces smooth brush
}

export interface BrushContext {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  positionAttr: THREE.BufferAttribute;
  normalAttr: THREE.BufferAttribute;
  indexAttr: THREE.BufferAttribute | null;
  hitPoint: THREE.Vector3;
  hitNormal: THREE.Vector3;
  hitFaceIndex: number;
  affectedVertices: number[]; // vertex indices within brush radius
  brushRadius: number;
  brushStrength: number;
  invert: boolean;
  smoothOverride: boolean;
  strokeDirection: THREE.Vector3; // normalized direction of mouse movement on surface
  previousHitPoint: THREE.Vector3 | null;
  deltaTime: number;
  maskValues: Float32Array; // per-vertex (0=masked, 1=exposed)
  // Neighbor lookup for smooth/laplacian operations
  getNeighbors: (vertexIndex: number) => number[];
}

// ─── Symmetry ────────────────────────────────────────────────

export interface SymmetrySettings {
  x: boolean;
  y: boolean;
  z: boolean;
}

// ─── Undo ────────────────────────────────────────────────────

export interface UndoSnapshot {
  positions: Float32Array;
  maskValues: Float32Array;
}

// ─── Engine Config ───────────────────────────────────────────

export interface SculptEngineConfig {
  maxUndoSteps: number;
  defaultBrushSize: number;
  defaultBrushStrength: number;
}

export const DEFAULT_CONFIG: SculptEngineConfig = {
  maxUndoSteps: 50,
  defaultBrushSize: 0.15,
  defaultBrushStrength: 0.5,
};

// ─── Callbacks for React UI ──────────────────────────────────

export interface SculptEngineCallbacks {
  onBrushChanged?: (brush: BrushType) => void;
  onUndoStackChanged?: (undoCount: number, redoCount: number) => void;
  onMeshStatsChanged?: (vertexCount: number, faceCount: number) => void;
  onLoadingChanged?: (loading: boolean) => void;
}

// ─── Matcap ──────────────────────────────────────────────────

export type MatcapId = "clay" | "skin" | "metal" | "jade" | "red_wax" | "white";
