import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();
const _projected = new THREE.Vector3();

/**
 * Scrape brush: flattens only vertices ABOVE the reference plane.
 * Leaves valleys untouched.
 */
export class ScrapeBrush extends Brush {
  readonly type: BrushType = "scrape";
  readonly name = "Scrape";

  apply(ctx: BrushContext): void {
    const { positionAttr, hitPoint, hitNormal, affectedVertices, brushRadius, brushStrength, maskValues } = ctx;

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);

      // Signed distance to reference plane
      const dot = _pos.clone().sub(hitPoint).dot(hitNormal);

      // Only scrape vertices above the plane
      if (dot <= 0) continue;

      const dist = _pos.distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight <= 0) continue;

      // Project onto plane
      _projected.copy(_pos).addScaledVector(hitNormal, -dot);

      positionAttr.setXYZ(
        vi,
        x + (_projected.x - x) * weight,
        y + (_projected.y - y) * weight,
        z + (_projected.z - z) * weight
      );
    }
  }
}
