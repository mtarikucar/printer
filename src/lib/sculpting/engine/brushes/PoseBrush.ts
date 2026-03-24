import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();
const _offset = new THREE.Vector3();

/**
 * Pose brush: applies a rotation to affected vertices around the brush center.
 * Simulates posing a limb or rotating a body part.
 */
export class PoseBrush extends Brush {
  readonly type: BrushType = "pose";
  readonly name = "Pose";

  private capturedVertices: { vi: number; origPos: THREE.Vector3; weight: number }[] = [];
  private pivotPoint = new THREE.Vector3();
  private startHitPoint = new THREE.Vector3();
  private rotationAxis = new THREE.Vector3(0, 1, 0);

  onStrokeStart(ctx: BrushContext): void {
    const { positionAttr, affectedVertices, brushRadius, brushStrength, maskValues, hitPoint, hitNormal } = ctx;

    this.pivotPoint.copy(hitPoint);
    this.startHitPoint.copy(hitPoint);
    // Default rotation axis is the hit normal
    this.rotationAxis.copy(hitNormal).normalize();
    this.capturedVertices = [];

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      const dist = _pos.distanceTo(hitPoint);
      const weight = brushFalloff(dist, brushRadius, brushStrength, maskValues[vi]);
      if (weight > 0) {
        this.capturedVertices.push({
          vi,
          origPos: _pos.clone(),
          weight,
        });
      }
    }
  }

  apply(ctx: BrushContext): void {
    const { positionAttr, hitPoint } = ctx;

    // Compute rotation angle from mouse delta
    const delta = hitPoint.clone().sub(this.startHitPoint);
    // Use the perpendicular component (tangent to rotation axis) for rotation
    const perpComponent = delta.clone();
    const axisComp = perpComponent.dot(this.rotationAxis);
    perpComponent.addScaledVector(this.rotationAxis, -axisComp);
    const angle = perpComponent.length() * 2; // Scale for usability

    if (angle < 0.0001) return;

    // Determine rotation direction using the perpendicular delta direction.
    // We pick an arbitrary tangent vector to define the sign convention.
    const tangent = new THREE.Vector3();
    if (Math.abs(this.rotationAxis.x) < 0.9) {
      tangent.crossVectors(this.rotationAxis, new THREE.Vector3(1, 0, 0)).normalize();
    } else {
      tangent.crossVectors(this.rotationAxis, new THREE.Vector3(0, 1, 0)).normalize();
    }
    const sign = perpComponent.dot(tangent) >= 0 ? 1 : -1;

    const quaternion = new THREE.Quaternion().setFromAxisAngle(
      this.rotationAxis,
      angle * sign
    );

    for (const v of this.capturedVertices) {
      // Rotate around pivot
      _offset.copy(v.origPos).sub(this.pivotPoint);
      _offset.applyQuaternion(quaternion);

      const target = _offset.add(this.pivotPoint);

      // Blend by weight
      positionAttr.setXYZ(
        v.vi,
        v.origPos.x + (target.x - v.origPos.x) * v.weight,
        v.origPos.y + (target.y - v.origPos.y) * v.weight,
        v.origPos.z + (target.z - v.origPos.z) * v.weight
      );
    }
  }

  onStrokeEnd(): void {
    this.capturedVertices = [];
  }
}
