import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

/**
 * Export a mesh as GLB (binary glTF)
 */
export async function exportGLB(mesh: THREE.Mesh): Promise<ArrayBuffer> {
  // Clone mesh with a standard material for compatibility
  const exportMesh = mesh.clone();
  exportMesh.material = new THREE.MeshStandardMaterial({ color: 0xcccccc });

  // Remove sculpting-specific attributes
  exportMesh.geometry = mesh.geometry.clone();
  exportMesh.geometry.deleteAttribute("color");

  // Reset transforms for export (apply scale/position into geometry)
  exportMesh.updateMatrixWorld(true);
  exportMesh.geometry.applyMatrix4(exportMesh.matrixWorld);
  exportMesh.position.set(0, 0, 0);
  exportMesh.rotation.set(0, 0, 0);
  exportMesh.scale.set(1, 1, 1);
  exportMesh.updateMatrix();
  exportMesh.updateMatrixWorld(true);

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(exportMesh, { binary: true });

  // Cleanup
  exportMesh.geometry.dispose();
  (exportMesh.material as THREE.Material).dispose();

  return result as ArrayBuffer;
}

/**
 * Export a mesh as binary STL
 */
export function exportSTL(mesh: THREE.Mesh): ArrayBuffer {
  const exportMesh = mesh.clone();
  exportMesh.material = new THREE.MeshStandardMaterial({ color: 0xcccccc });

  exportMesh.geometry = mesh.geometry.clone();
  exportMesh.geometry.deleteAttribute("color");

  exportMesh.updateMatrixWorld(true);
  exportMesh.geometry.applyMatrix4(exportMesh.matrixWorld);
  exportMesh.position.set(0, 0, 0);
  exportMesh.rotation.set(0, 0, 0);
  exportMesh.scale.set(1, 1, 1);
  exportMesh.updateMatrix();
  exportMesh.updateMatrixWorld(true);

  const exporter = new STLExporter();
  const result = exporter.parse(exportMesh, { binary: true });

  exportMesh.geometry.dispose();
  (exportMesh.material as THREE.Material).dispose();

  return result as unknown as ArrayBuffer;
}
