import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();

/**
 * Grab brush: captures affected vertices on stroke start,
 * then displaces them along mouse delta each frame.
 */
export class GrabBrush extends Brush {
  readonly type: BrushType = "grab";
  readonly name = "Grab";

  private capturedVertices: { vi: number; origX: number; origY: number; origZ: number; weight: number }[] = [];
  private startHitPoint = new THREE.Vector3();

  onStrokeStart(ctx: BrushContext): void {
    const { positionAttr, affectedVertices, brushRadius, brushStrength, maskValues, hitPoint } = ctx;
    this.startHitPoint.copy(hitPoint);
    this.capturedVertices = [];

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      const dist = _pos.distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight > 0) {
        this.capturedVertices.push({ vi, origX: x, origY: y, origZ: z, weight });
      }
    }
  }

  apply(ctx: BrushContext): void {
    const { positionAttr, hitPoint } = ctx;

    // Delta from initial grab point
    const dx = hitPoint.x - this.startHitPoint.x;
    const dy = hitPoint.y - this.startHitPoint.y;
    const dz = hitPoint.z - this.startHitPoint.z;

    for (const v of this.capturedVertices) {
      positionAttr.setXYZ(
        v.vi,
        v.origX + dx * v.weight,
        v.origY + dy * v.weight,
        v.origZ + dz * v.weight
      );
    }
  }

  onStrokeEnd(): void {
    this.capturedVertices = [];
  }
}
