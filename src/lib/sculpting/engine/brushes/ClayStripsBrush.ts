import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();
const _offset = new THREE.Vector3();

/**
 * Clay Strips: directional clay buildup along the stroke direction.
 * Uses a squared falloff perpendicular to the stroke for a strip-like shape.
 */
export class ClayStripsBrush extends Brush {
  readonly type: BrushType = "clay_strips";
  readonly name = "Clay Strips";

  apply(ctx: BrushContext): void {
    const {
      positionAttr, hitPoint, hitNormal, strokeDirection,
      affectedVertices, brushRadius, brushStrength, invert, maskValues,
    } = ctx;
    const direction = invert ? -1 : 1;

    // If no stroke direction yet (first point), fall back to normal draw
    const hasDir = strokeDirection.lengthSq() > 0.001;

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      _offset.subVectors(_pos, hitPoint);

      const dist = _offset.length();
      let weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight <= 0) continue;

      // Tighten falloff perpendicular to stroke direction for strip effect
      if (hasDir) {
        const alongStroke = _offset.dot(strokeDirection);
        const perpDist = Math.sqrt(Math.max(0, dist * dist - alongStroke * alongStroke));
        const perpFactor = 1 - Math.min(1, perpDist / (brushRadius * 0.5));
        weight *= perpFactor * perpFactor;
      }

      if (weight <= 0) continue;

      // Raise surface above the hit plane
      const heightAbovePlane = _offset.dot(hitNormal);
      const targetHeight = weight * direction * 0.08;
      const delta = targetHeight - Math.max(0, heightAbovePlane * direction) * 0.5;

      if (delta * direction > 0) {
        positionAttr.setXYZ(
          vi,
          x + hitNormal.x * delta,
          y + hitNormal.y * delta,
          z + hitNormal.z * delta
        );
      }
    }
  }
}
