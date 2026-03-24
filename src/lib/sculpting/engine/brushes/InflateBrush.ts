import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();
const _normal = new THREE.Vector3();

export class InflateBrush extends Brush {
  readonly type: BrushType = "inflate";
  readonly name = "Inflate";

  apply(ctx: BrushContext): void {
    const { positionAttr, normalAttr, affectedVertices, brushRadius, brushStrength, invert, maskValues, hitPoint } = ctx;
    const direction = invert ? -1 : 1;

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      const dist = _pos.distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight <= 0) continue;

      // Per-vertex normal (unlike Draw which uses hit normal)
      _normal.set(
        normalAttr.getX(vi),
        normalAttr.getY(vi),
        normalAttr.getZ(vi)
      ).normalize();

      positionAttr.setXYZ(
        vi,
        x + _normal.x * weight * direction * 0.1,
        y + _normal.y * weight * direction * 0.1,
        z + _normal.z * weight * direction * 0.1
      );
    }
  }
}
