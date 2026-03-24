import type { BrushContext, BrushType } from "./types";

// ─── Falloff Math ────────────────────────────────────────────

/** Smooth hermite interpolation: 0 at edges, 1 at center */
export function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** Compute brush weight for a vertex at given distance from brush center */
export function brushFalloff(
  distance: number,
  radius: number,
  strength: number,
  maskValue: number
): number {
  if (distance >= radius) return 0;
  return smoothstep(1 - distance / radius) * strength * maskValue;
}

// ─── Neighbor Map Builder ────────────────────────────────────

/**
 * Builds a vertex adjacency map from the index buffer.
 * neighbors[i] = set of vertex indices sharing an edge with vertex i
 */
export function buildNeighborMap(
  indexArray: ArrayLike<number>,
  vertexCount: number
): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();

  for (let i = 0; i < vertexCount; i++) {
    map.set(i, new Set());
  }

  for (let i = 0; i < indexArray.length; i += 3) {
    const a = indexArray[i];
    const b = indexArray[i + 1];
    const c = indexArray[i + 2];
    map.get(a)!.add(b).add(c);
    map.get(b)!.add(a).add(c);
    map.get(c)!.add(a).add(b);
  }

  return map;
}

// ─── Abstract Brush ──────────────────────────────────────────

export abstract class Brush {
  abstract readonly type: BrushType;
  abstract readonly name: string;

  /** Called once at stroke start (optional) */
  onStrokeStart(_ctx: BrushContext): void {}

  /** Called for each pointer move during a stroke */
  abstract apply(ctx: BrushContext): void;

  /** Called once at stroke end (optional) */
  onStrokeEnd(_ctx: BrushContext): void {}
}
