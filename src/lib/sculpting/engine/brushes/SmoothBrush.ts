import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();
const _avg = new THREE.Vector3();

export class SmoothBrush extends Brush {
  readonly type: BrushType = "smooth";
  readonly name = "Smooth";

  apply(ctx: BrushContext): void {
    const { positionAttr, affectedVertices, brushRadius, brushStrength, maskValues, hitPoint, getNeighbors } = ctx;

    // Collect target positions first (Jacobi-style: read old, write new)
    const targets: { vi: number; x: number; y: number; z: number; w: number }[] = [];

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      const dist = _pos.set(x, y, z).distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength * 2, maskValues[vi]);
      if (weight <= 0) continue;

      // Average neighbor positions (Laplacian)
      const neighbors = getNeighbors(vi);
      if (neighbors.length === 0) continue;

      _avg.set(0, 0, 0);
      for (const ni of neighbors) {
        _avg.x += positionAttr.getX(ni);
        _avg.y += positionAttr.getY(ni);
        _avg.z += positionAttr.getZ(ni);
      }
      _avg.divideScalar(neighbors.length);

      targets.push({
        vi,
        x: x + (_avg.x - x) * weight,
        y: y + (_avg.y - y) * weight,
        z: z + (_avg.z - z) * weight,
        w: weight,
      });
    }

    // Apply
    for (const t of targets) {
      positionAttr.setXYZ(t.vi, t.x, t.y, t.z);
    }
  }
}
