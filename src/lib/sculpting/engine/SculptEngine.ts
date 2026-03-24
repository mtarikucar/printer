import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { Brush } from "./BrushSystem";
import { SmoothBrush } from "./brushes/SmoothBrush";
import { UndoManager } from "./UndoManager";
import type {
  BrushContext,
  BrushSettings,
  BrushType,
  SculptEngineCallbacks,
  SymmetrySettings,
} from "./types";

// ─── SculptEngine ────────────────────────────────────────────

export class SculptEngine {
  mesh: THREE.Mesh | null = null;
  private neighborMap: Map<number, Set<number>> = new Map();
  private maskValues: Float32Array = new Float32Array(0);

  // Brush state
  private brushRegistry = new Map<BrushType, Brush>();
  private activeBrush: Brush | null = null;
  private smoothBrush: SmoothBrush = new SmoothBrush();
  brushSettings: BrushSettings = {
    size: 0.15,
    strength: 0.5,
    invert: false,
    smoothOverride: false,
  };

  symmetry: SymmetrySettings = { x: false, y: false, z: false };

  // Stroke state
  private stroking = false;
  private previousHitPoint: THREE.Vector3 | null = null;

  // Undo
  undoManager = new UndoManager(50);

  // Callbacks
  callbacks: SculptEngineCallbacks = {};

  // Raycasting helpers
  private _raycaster = new THREE.Raycaster();
  private _mouse = new THREE.Vector2();
  private _hitPoint = new THREE.Vector3();
  private _hitNormal = new THREE.Vector3();
  private _sphere = new THREE.Sphere();
  private _tempVec = new THREE.Vector3();

  registerBrush(brush: Brush): void {
    this.brushRegistry.set(brush.type, brush);
    if (!this.activeBrush) {
      this.activeBrush = brush;
    }
  }

  setActiveBrush(type: BrushType): void {
    const brush = this.brushRegistry.get(type);
    if (brush) {
      this.activeBrush = brush;
      this.callbacks.onBrushChanged?.(type);
    }
  }

  getActiveBrushType(): BrushType | null {
    return this.activeBrush?.type ?? null;
  }

  setMesh(
    mesh: THREE.Mesh,
    neighborMap: Map<number, Set<number>>
  ): void {
    this.mesh = mesh;
    this.neighborMap = neighborMap;
    const vertexCount = mesh.geometry.attributes.position.count;
    this.maskValues = new Float32Array(vertexCount).fill(1);
    this.undoManager.clear();
    this.notifyMeshStats();
  }

  // ─── Pointer Events (called by SculptCanvas) ──────────────

  /**
   * Returns true if the stroke hit the mesh (caller should disable orbit).
   */
  pointerDown(
    ndcX: number,
    ndcY: number,
    camera: THREE.Camera
  ): boolean {
    if (!this.mesh || !this.activeBrush) return false;

    this._mouse.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._mouse, camera);

    const bvh = (this.mesh.geometry as any).boundsTree as MeshBVH;
    if (!bvh) return false;

    const hit = bvh.raycastFirst(this._raycaster.ray, THREE.DoubleSide);
    if (!hit) return false;

    // Push undo snapshot
    const posAttr = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    this.undoManager.pushUndo(
      posAttr.array as Float32Array,
      this.maskValues
    );
    this.notifyUndoStack();

    this.stroking = true;
    this.previousHitPoint = null;

    // Notify active brush of stroke start BEFORE first apply
    // (GrabBrush, PoseBrush, LayerBrush, ElasticDeformBrush capture
    // vertices in onStrokeStart — must run before apply)
    const currentBrush = this.brushSettings.smoothOverride
      ? this.smoothBrush
      : this.activeBrush;
    const ctx = this.buildContext(hit);
    if (ctx) currentBrush.onStrokeStart(ctx);

    // Apply first stroke point
    this.applyBrushAt(hit, camera);

    return true;
  }

  pointerMove(
    ndcX: number,
    ndcY: number,
    camera: THREE.Camera
  ): boolean {
    if (!this.stroking || !this.mesh) return false;

    this._mouse.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._mouse, camera);

    const bvh = (this.mesh.geometry as any).boundsTree as MeshBVH;
    if (!bvh) return false;

    const hit = bvh.raycastFirst(this._raycaster.ray, THREE.DoubleSide);
    if (!hit) return false;

    this.applyBrushAt(hit, camera);
    return true;
  }

  pointerUp(): void {
    if (!this.stroking || !this.mesh) return;

    const currentBrush = this.brushSettings.smoothOverride
      ? this.smoothBrush
      : this.activeBrush;

    if (currentBrush) {
      const geo = this.mesh.geometry;
      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      const normalAttr = geo.attributes.normal as THREE.BufferAttribute;
      const ctx: BrushContext = {
        mesh: this.mesh,
        geometry: geo,
        positionAttr: posAttr,
        normalAttr: normalAttr,
        indexAttr: geo.index as THREE.BufferAttribute | null,
        hitPoint: this._hitPoint.clone(),
        hitNormal: this._hitNormal.clone(),
        hitFaceIndex: 0,
        affectedVertices: [],
        brushRadius: this.brushSettings.size,
        brushStrength: this.brushSettings.strength,
        invert: this.brushSettings.invert,
        smoothOverride: this.brushSettings.smoothOverride,
        strokeDirection: new THREE.Vector3(),
        previousHitPoint: this.previousHitPoint,
        deltaTime: 0,
        maskValues: this.maskValues,
        getNeighbors: (vi) => Array.from(this.neighborMap.get(vi) ?? []),
      };
      currentBrush.onStrokeEnd(ctx);
    }

    this.stroking = false;
    this.previousHitPoint = null;
  }

  /**
   * Raycast for hover preview (returns hit point in world coords, or null)
   */
  raycastHover(
    ndcX: number,
    ndcY: number,
    camera: THREE.Camera
  ): THREE.Vector3 | null {
    if (!this.mesh) return null;

    this._mouse.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._mouse, camera);

    const bvh = (this.mesh.geometry as any).boundsTree as MeshBVH;
    if (!bvh) return null;

    const hit = bvh.raycastFirst(this._raycaster.ray, THREE.DoubleSide);
    if (!hit) return null;

    return hit.point.clone();
  }

  // ─── Internal ──────────────────────────────────────────────

  private applyBrushAt(
    hit: THREE.Intersection,
    _camera: THREE.Camera
  ): void {
    if (!this.mesh || !this.activeBrush) return;

    const ctx = this.buildContext(hit);
    if (!ctx) return;

    // Choose brush (smooth override if shift held)
    const brush = this.brushSettings.smoothOverride
      ? this.smoothBrush
      : this.activeBrush;

    // Apply on primary position
    brush.apply(ctx);

    // Apply symmetry
    this.applySymmetry(brush, hit);

    // Update geometry
    const geo = this.mesh.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geo.computeVertexNormals();
    (geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;

    // Refit BVH
    const bvh = (geo as any).boundsTree as MeshBVH;
    if (bvh) bvh.refit();

    // Update previous hit for stroke direction calculation
    this.previousHitPoint = hit.point.clone();
  }

  private buildContext(hit: THREE.Intersection): BrushContext | null {
    if (!this.mesh) return null;

    const geo = this.mesh.geometry;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const normalAttr = geo.attributes.normal as THREE.BufferAttribute;

    this._hitPoint.copy(hit.point);
    if (hit.face) {
      this._hitNormal.copy(hit.face.normal);
    } else {
      this._hitNormal.set(0, 1, 0);
    }

    // Find vertices within brush radius using BVH shapecast
    const affected = this.findAffectedVertices(hit.point, this.brushSettings.size);

    // Compute stroke direction
    const strokeDir = new THREE.Vector3();
    if (this.previousHitPoint) {
      strokeDir.subVectors(hit.point, this.previousHitPoint).normalize();
    }

    return {
      mesh: this.mesh,
      geometry: geo,
      positionAttr: posAttr,
      normalAttr: normalAttr,
      indexAttr: geo.index as THREE.BufferAttribute | null,
      hitPoint: this._hitPoint.clone(),
      hitNormal: this._hitNormal.clone(),
      hitFaceIndex: hit.faceIndex ?? 0,
      affectedVertices: affected,
      brushRadius: this.brushSettings.size,
      brushStrength: this.brushSettings.strength,
      invert: this.brushSettings.invert,
      smoothOverride: this.brushSettings.smoothOverride,
      strokeDirection: strokeDir,
      previousHitPoint: this.previousHitPoint ? this.previousHitPoint.clone() : null,
      deltaTime: 1 / 60,
      maskValues: this.maskValues,
      getNeighbors: (vi) => Array.from(this.neighborMap.get(vi) ?? []),
    };
  }

  private findAffectedVertices(
    center: THREE.Vector3,
    radius: number
  ): number[] {
    if (!this.mesh) return [];

    const geo = this.mesh.geometry;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const bvh = (geo as any).boundsTree as MeshBVH;
    if (!bvh) return [];

    const indices = new Set<number>();
    const indexAttr = geo.index;

    this._sphere.set(center, radius);

    bvh.shapecast({
      intersectsBounds: (box: THREE.Box3) => {
        return this._sphere.intersectsBox(box);
      },
      intersectsTriangle: (tri: any, triIndex: number) => {
        // Check each vertex of the triangle
        if (indexAttr) {
          for (let i = 0; i < 3; i++) {
            const vi = indexAttr.getX(triIndex * 3 + i);
            this._tempVec.set(
              posAttr.getX(vi),
              posAttr.getY(vi),
              posAttr.getZ(vi)
            );
            if (this._tempVec.distanceTo(center) <= radius) {
              indices.add(vi);
            }
          }
        }
        return false; // continue traversal
      },
    });

    return Array.from(indices);
  }

  private applySymmetry(brush: Brush, hit: THREE.Intersection): void {
    const axes: ("x" | "y" | "z")[] = [];
    if (this.symmetry.x) axes.push("x");
    if (this.symmetry.y) axes.push("y");
    if (this.symmetry.z) axes.push("z");

    if (axes.length === 0) return;

    // Generate all symmetry combinations (e.g., X+Y means 3 extra: mirrorX, mirrorY, mirrorXY)
    const combos = generateCombinations(axes);

    for (const combo of combos) {
      const mirrorPoint = hit.point.clone();
      const mirrorNormal = hit.face
        ? hit.face.normal.clone()
        : new THREE.Vector3(0, 1, 0);

      for (const axis of combo) {
        mirrorPoint[axis] = -mirrorPoint[axis];
        mirrorNormal[axis] = -mirrorNormal[axis];
      }

      const affected = this.findAffectedVertices(mirrorPoint, this.brushSettings.size);
      if (affected.length === 0) continue;

      const strokeDir = new THREE.Vector3();
      if (this.previousHitPoint) {
        const mirrorPrev = this.previousHitPoint.clone();
        for (const axis of combo) {
          mirrorPrev[axis] = -mirrorPrev[axis];
        }
        strokeDir.subVectors(mirrorPoint, mirrorPrev).normalize();
      }

      const ctx: BrushContext = {
        mesh: this.mesh!,
        geometry: this.mesh!.geometry,
        positionAttr: this.mesh!.geometry.attributes.position as THREE.BufferAttribute,
        normalAttr: this.mesh!.geometry.attributes.normal as THREE.BufferAttribute,
        indexAttr: this.mesh!.geometry.index as THREE.BufferAttribute | null,
        hitPoint: mirrorPoint,
        hitNormal: mirrorNormal,
        hitFaceIndex: 0,
        affectedVertices: affected,
        brushRadius: this.brushSettings.size,
        brushStrength: this.brushSettings.strength,
        invert: this.brushSettings.invert,
        smoothOverride: this.brushSettings.smoothOverride,
        strokeDirection: strokeDir,
        previousHitPoint: this.previousHitPoint
          ? (() => {
              const p = this.previousHitPoint!.clone();
              for (const axis of combo) p[axis] = -p[axis];
              return p;
            })()
          : null,
        deltaTime: 1 / 60,
        maskValues: this.maskValues,
        getNeighbors: (vi) => Array.from(this.neighborMap.get(vi) ?? []),
      };

      brush.apply(ctx);
    }
  }

  // ─── Undo / Redo ───────────────────────────────────────────

  undo(): void {
    if (!this.mesh) return;
    const posAttr = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const snapshot = this.undoManager.undo(
      posAttr.array as Float32Array,
      this.maskValues
    );
    if (!snapshot) return;
    this.restoreSnapshot(snapshot.positions, snapshot.maskValues);
  }

  redo(): void {
    if (!this.mesh) return;
    const posAttr = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const snapshot = this.undoManager.redo(
      posAttr.array as Float32Array,
      this.maskValues
    );
    if (!snapshot) return;
    this.restoreSnapshot(snapshot.positions, snapshot.maskValues);
  }

  private restoreSnapshot(
    positions: Float32Array,
    maskVals: Float32Array
  ): void {
    if (!this.mesh) return;
    const geo = this.mesh.geometry;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;

    (posAttr.array as Float32Array).set(positions);
    posAttr.needsUpdate = true;
    this.maskValues.set(maskVals);
    geo.computeVertexNormals();
    (geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;

    const bvh = (geo as any).boundsTree as MeshBVH;
    if (bvh) bvh.refit();

    this.notifyUndoStack();
  }

  // ─── Notifications ─────────────────────────────────────────

  private notifyUndoStack(): void {
    this.callbacks.onUndoStackChanged?.(
      this.undoManager.undoCount,
      this.undoManager.redoCount
    );
  }

  private notifyMeshStats(): void {
    if (!this.mesh) return;
    const geo = this.mesh.geometry;
    this.callbacks.onMeshStatsChanged?.(
      geo.attributes.position.count,
      geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3
    );
  }

  get isStroking(): boolean {
    return this.stroking;
  }
}

// ─── Utility ─────────────────────────────────────────────────

function generateCombinations<T>(items: T[]): T[][] {
  const result: T[][] = [];
  const n = items.length;
  // Generate all non-empty subsets
  for (let mask = 1; mask < (1 << n); mask++) {
    const combo: T[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) combo.push(items[i]);
    }
    result.push(combo);
  }
  return result;
}
