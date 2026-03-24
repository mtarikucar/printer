import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();

/**
 * Layer brush: adds a uniform height layer per stroke.
 * Records original heights on stroke start, then clamps to a target height.
 */
export class LayerBrush extends Brush {
  readonly type: BrushType = "layer";
  readonly name = "Layer";

  private baseHeights = new Map<number, number>();
  private strokePlanePoint = new THREE.Vector3();
  private strokePlaneNormal = new THREE.Vector3();

  onStrokeStart(ctx: BrushContext): void {
    this.baseHeights.clear();
    this.strokePlanePoint.copy(ctx.hitPoint);
    this.strokePlaneNormal.copy(ctx.hitNormal);

    // Record base heights for all potentially affected vertices
    const { positionAttr, affectedVertices } = ctx;
    for (const vi of affectedVertices) {
      _pos.set(positionAttr.getX(vi), positionAttr.getY(vi), positionAttr.getZ(vi));
      const height = _pos.clone().sub(this.strokePlanePoint).dot(this.strokePlaneNormal);
      this.baseHeights.set(vi, height);
    }
  }

  apply(ctx: BrushContext): void {
    const { positionAttr, affectedVertices, brushRadius, brushStrength, invert, maskValues, hitPoint } = ctx;
    const direction = invert ? -1 : 1;
    const targetLayerHeight = brushStrength * direction * 0.1;

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      const dist = _pos.distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, 1, maskValues[vi]);
      if (weight <= 0) continue;

      // Record base height if not yet recorded
      if (!this.baseHeights.has(vi)) {
        const height = _pos.clone().sub(this.strokePlanePoint).dot(this.strokePlaneNormal);
        this.baseHeights.set(vi, height);
      }

      const baseHeight = this.baseHeights.get(vi)!;
      const currentHeight = _pos.clone().sub(this.strokePlanePoint).dot(this.strokePlaneNormal);
      const targetHeight = baseHeight + targetLayerHeight * weight;
      const delta = targetHeight - currentHeight;

      positionAttr.setXYZ(
        vi,
        x + this.strokePlaneNormal.x * delta,
        y + this.strokePlaneNormal.y * delta,
        z + this.strokePlaneNormal.z * delta
      );
    }
  }

  onStrokeEnd(): void {
    this.baseHeights.clear();
  }
}
