import * as THREE from "three";
import { Brush } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();

/**
 * Cubic falloff for smooth elastic deformation
 */
function elasticFalloff(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return t * t * t; // cubic — smoother, wider falloff than smoothstep
}

/**
 * Elastic Deform brush: like Grab but with a smoother, more elastic falloff.
 * Creates organic, fleshy deformations.
 */
export class ElasticDeformBrush extends Brush {
  readonly type: BrushType = "elastic_deform";
  readonly name = "Elastic Deform";

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
      // Use cubic falloff within the brush radius for smoother elastic feel
      const weight = elasticFalloff(dist, brushRadius) * brushStrength * maskValues[vi];
      if (weight > 0) {
        this.capturedVertices.push({ vi, origX: x, origY: y, origZ: z, weight });
      }
    }
  }

  apply(ctx: BrushContext): void {
    const { positionAttr, hitPoint } = ctx;

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
