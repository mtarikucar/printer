import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();

/**
 * Snake Hook: displaces vertices by the frame-to-frame delta of the cursor.
 * Creates a trailing/pulling effect.
 */
export class SnakeHookBrush extends Brush {
  readonly type: BrushType = "snake_hook";
  readonly name = "Snake Hook";

  apply(ctx: BrushContext): void {
    const { positionAttr, hitPoint, previousHitPoint, affectedVertices, brushRadius, brushStrength, maskValues } = ctx;

    if (!previousHitPoint) return;

    // Frame-to-frame delta
    const dx = hitPoint.x - previousHitPoint.x;
    const dy = hitPoint.y - previousHitPoint.y;
    const dz = hitPoint.z - previousHitPoint.z;

    const deltaLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (deltaLen < 0.0001) return;

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      const dist = _pos.distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight <= 0) continue;

      positionAttr.setXYZ(
        vi,
        x + dx * weight,
        y + dy * weight,
        z + dz * weight
      );
    }
  }
}
