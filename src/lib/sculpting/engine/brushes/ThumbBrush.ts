import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();

/**
 * Thumb brush: smears the surface in the stroke direction.
 * Similar to SnakeHook but projects the displacement onto the surface tangent plane.
 */
export class ThumbBrush extends Brush {
  readonly type: BrushType = "thumb";
  readonly name = "Thumb";

  apply(ctx: BrushContext): void {
    const {
      positionAttr, hitPoint, hitNormal, strokeDirection,
      affectedVertices, brushRadius, brushStrength, maskValues,
    } = ctx;

    if (strokeDirection.lengthSq() < 0.0001) return;

    // Project stroke direction onto the surface tangent plane
    const tangent = strokeDirection.clone();
    const normalComp = tangent.dot(hitNormal);
    tangent.addScaledVector(hitNormal, -normalComp).normalize();

    if (tangent.lengthSq() < 0.0001) return;

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      const dist = _pos.distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight <= 0) continue;

      const offset = weight * 0.05;
      positionAttr.setXYZ(
        vi,
        x + tangent.x * offset,
        y + tangent.y * offset,
        z + tangent.z * offset
      );
    }
  }
}
