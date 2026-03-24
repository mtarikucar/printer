import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshBVH } from "three-mesh-bvh";
import { buildNeighborMap } from "./BrushSystem";

/**
 * Loads a GLB, merges all child meshes into a single BufferGeometry,
 * builds BVH for raycasting, and returns a sculpt-ready Mesh.
 */
export async function loadMeshForSculpting(
  glbUrl: string
): Promise<{
  mesh: THREE.Mesh;
  neighborMap: Map<number, Set<number>>;
}> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);

  // Collect all geometries from the scene
  const geometries: THREE.BufferGeometry[] = [];
  gltf.scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      // Apply world transforms before merging
      m.updateMatrixWorld(true);
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      geometries.push(geo);
    }
  });

  if (geometries.length === 0) {
    throw new Error("No meshes found in GLB");
  }

  // Merge into one geometry
  let geometry: THREE.BufferGeometry;
  if (geometries.length === 1) {
    geometry = geometries[0];
  } else {
    geometry = mergeGeometries(geometries);
  }

  // Ensure indexed geometry (required by BVH)
  if (!geometry.index) {
    const positions = geometry.attributes.position;
    const indices: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      indices.push(i);
    }
    geometry.setIndex(indices);
  }

  // Merge duplicate vertices for proper topology
  geometry = mergeVertices(geometry);

  // Ensure normals exist
  geometry.computeVertexNormals();

  // Build BVH
  const bvh = new MeshBVH(geometry);
  (geometry as any).boundsTree = bvh;

  // Build neighbor map for smooth/laplacian brushes
  const neighborMap = buildNeighborMap(
    geometry.index!.array,
    geometry.attributes.position.count
  );

  // Create mesh with a matcap-like material
  const material = new THREE.MeshMatcapMaterial({
    color: 0xcccccc,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "sculptMesh";

  return { mesh, neighborMap };
}

// ─── Geometry Utilities ──────────────────────────────────────

function mergeGeometries(
  geos: THREE.BufferGeometry[]
): THREE.BufferGeometry {
  // Simple merge: concatenate position, normal, index arrays
  let totalVertices = 0;
  let totalIndices = 0;

  for (const geo of geos) {
    totalVertices += geo.attributes.position.count;
    if (geo.index) {
      totalIndices += geo.index.count;
    } else {
      totalIndices += geo.attributes.position.count;
    }
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const indices: number[] = [];

  let vertexOffset = 0;

  for (const geo of geos) {
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;

    for (let i = 0; i < pos.count; i++) {
      positions[(vertexOffset + i) * 3] = pos.getX(i);
      positions[(vertexOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vertexOffset + i) * 3 + 2] = pos.getZ(i);

      if (nrm) {
        normals[(vertexOffset + i) * 3] = nrm.getX(i);
        normals[(vertexOffset + i) * 3 + 1] = nrm.getY(i);
        normals[(vertexOffset + i) * 3 + 2] = nrm.getZ(i);
      }
    }

    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) {
        indices.push(geo.index.getX(i) + vertexOffset);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices.push(i + vertexOffset);
      }
    }

    vertexOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setIndex(indices);

  return merged;
}

/**
 * Merge vertices that share the same position (within tolerance).
 * This is essential for proper topology and neighbor lookup.
 */
function mergeVertices(
  geometry: THREE.BufferGeometry,
  tolerance: number = 1e-4
): THREE.BufferGeometry {
  const posAttr = geometry.attributes.position;
  const index = geometry.index;
  if (!index) return geometry;

  const vertexCount = posAttr.count;
  const hashToIndex = new Map<string, number>();
  const remap = new Int32Array(vertexCount);
  const newPositions: number[] = [];
  let newCount = 0;

  const precision = Math.round(1 / tolerance);

  for (let i = 0; i < vertexCount; i++) {
    const x = Math.round(posAttr.getX(i) * precision);
    const y = Math.round(posAttr.getY(i) * precision);
    const z = Math.round(posAttr.getZ(i) * precision);
    const key = `${x}_${y}_${z}`;

    const existing = hashToIndex.get(key);
    if (existing !== undefined) {
      remap[i] = existing;
    } else {
      hashToIndex.set(key, newCount);
      remap[i] = newCount;
      newPositions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      newCount++;
    }
  }

  // Remap indices
  const oldIndices = index.array;
  const newIndices = new Uint32Array(oldIndices.length);
  for (let i = 0; i < oldIndices.length; i++) {
    newIndices[i] = remap[oldIndices[i]];
  }

  // Remove degenerate triangles
  const cleanIndices: number[] = [];
  for (let i = 0; i < newIndices.length; i += 3) {
    const a = newIndices[i];
    const b = newIndices[i + 1];
    const c = newIndices[i + 2];
    if (a !== b && b !== c && a !== c) {
      cleanIndices.push(a, b, c);
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(newPositions), 3)
  );
  merged.setIndex(cleanIndices);

  return merged;
}
