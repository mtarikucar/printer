import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();
const _toCenter = new THREE.Vector3();

export class PinchBrush extends Brush {
  readonly type: BrushType = "pinch";
  readonly name = "Pinch";

  apply(ctx: BrushContext): void {
    const { positionAttr, hitPoint, hitNormal, affectedVertices, brushRadius, brushStrength, invert, maskValues } = ctx;
    const direction = invert ? -1 : 1;

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      const dist = _pos.distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight <= 0) continue;

      // Direction toward brush center, projected onto surface tangent plane
      _toCenter.subVectors(hitPoint, _pos);
      // Remove normal component to keep displacement on surface
      const normalComp = _toCenter.dot(hitNormal);
      _toCenter.addScaledVector(hitNormal, -normalComp);
      _toCenter.normalize();

      const offset = weight * direction * 0.05;
      positionAttr.setXYZ(
        vi,
        x + _toCenter.x * offset,
        y + _toCenter.y * offset,
        z + _toCenter.z * offset
      );
    }
  }
}
