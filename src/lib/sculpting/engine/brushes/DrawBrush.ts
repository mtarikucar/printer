import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _offset = new THREE.Vector3();

export class DrawBrush extends Brush {
  readonly type: BrushType = "draw";
  readonly name = "Draw";

  apply(ctx: BrushContext): void {
    const { positionAttr, hitNormal, affectedVertices, brushRadius, brushStrength, invert, maskValues, hitPoint } = ctx;
    const direction = invert ? -1 : 1;

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      const dist = _offset.set(x, y, z).distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight <= 0) continue;

      positionAttr.setXYZ(
        vi,
        x + hitNormal.x * weight * direction * 0.1,
        y + hitNormal.y * weight * direction * 0.1,
        z + hitNormal.z * weight * direction * 0.1
      );
    }
  }
}
