import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();
const _toCenter = new THREE.Vector3();

/**
 * Crease brush: combines Pinch (horizontal toward center) + Draw (vertical along normal).
 * Creates sharp ridges and valleys.
 */
export class CreaseBrush extends Brush {
  readonly type: BrushType = "crease";
  readonly name = "Crease";

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

      // Pinch component: move toward center on tangent plane
      _toCenter.subVectors(hitPoint, _pos);
      const normalComp = _toCenter.dot(hitNormal);
      _toCenter.addScaledVector(hitNormal, -normalComp);
      _toCenter.normalize();

      const pinchAmount = weight * 0.03;
      const drawAmount = weight * direction * 0.05;

      positionAttr.setXYZ(
        vi,
        x + _toCenter.x * pinchAmount + hitNormal.x * drawAmount,
        y + _toCenter.y * pinchAmount + hitNormal.y * drawAmount,
        z + _toCenter.z * pinchAmount + hitNormal.z * drawAmount
      );
    }
  }
}
