import * as THREE from "three";
import { Brush, brushFalloff } from "../BrushSystem";
import type { BrushContext, BrushType } from "../types";

const _pos = new THREE.Vector3();

/**
 * Mask brush: paints per-vertex mask values.
 * Masked vertices are protected from other brushes.
 * Does NOT displace geometry.
 *
 * Normal mode: paints mask (darkens vertex, protects from editing)
 * Inverted (Ctrl): erases mask (restores vertex to editable)
 */
export class MaskBrush extends Brush {
  readonly type: BrushType = "mask";
  readonly name = "Mask";

  apply(ctx: BrushContext): void {
    const { positionAttr, affectedVertices, brushRadius, brushStrength, invert, maskValues, hitPoint, mesh } = ctx;

    // Get or create color attribute for mask visualization
    let colorAttr = mesh.geometry.getAttribute("color") as THREE.BufferAttribute | null;
    if (!colorAttr) {
      const count = positionAttr.count;
      const colors = new Float32Array(count * 3).fill(1); // white = unmasked
      colorAttr = new THREE.BufferAttribute(colors, 3);
      mesh.geometry.setAttribute("color", colorAttr);

      // Enable vertex colors on the material
      if ((mesh.material as THREE.MeshMatcapMaterial).vertexColors !== undefined) {
        (mesh.material as THREE.MeshMatcapMaterial).vertexColors = true;
        (mesh.material as THREE.MeshMatcapMaterial).needsUpdate = true;
      }
    }

    for (const vi of affectedVertices) {
      const x = positionAttr.getX(vi);
      const y = positionAttr.getY(vi);
      const z = positionAttr.getZ(vi);

      _pos.set(x, y, z);
      const dist = _pos.distanceTo(hitPoint);
      // Use mask value of 1 (so we can always paint mask, even on already-masked areas)
      const weight = brushFalloff(dist, brushRadius, brushStrength, 1);
      if (weight <= 0) continue;

      if (invert) {
        // Erase mask
        maskValues[vi] = Math.min(1, maskValues[vi] + weight);
      } else {
        // Paint mask
        maskValues[vi] = Math.max(0, maskValues[vi] - weight);
      }

      // Update visualization: darker = more masked
      const brightness = maskValues[vi];
      const r = 0.3 + brightness * 0.7;
      const g = 0.3 + brightness * 0.7;
      const b = 0.3 + brightness * 0.7;
      colorAttr.setXYZ(vi, r, g, b);
    }

    colorAttr.needsUpdate = true;
  }
}
