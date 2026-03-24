import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();
const _projected = new THREE.Vector3();

export class FlattenBrush extends Brush {
  readonly type: BrushType = "flatten";
  readonly name = "Flatten";

  apply(ctx: BrushContext): void {
    const { positionAttr, hitPoint, hitNormal, affectedVertices, brushRadius, brushStrength, maskValues } = ctx;

    // Reference plane: passes through hitPoint, perpendicular to hitNormal
    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      const dist = _pos.distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight <= 0) continue;

      // Project vertex onto the reference plane
      const dot = _pos.clone().sub(hitPoint).dot(hitNormal);
      _projected.copy(_pos).addScaledVector(hitNormal, -dot);

      // Lerp toward projected position
      positionAttr.setXYZ(
        vi,
        x + (_projected.x - x) * weight,
        y + (_projected.y - y) * weight,
        z + (_projected.z - z) * weight
      );
    }
  }
}
