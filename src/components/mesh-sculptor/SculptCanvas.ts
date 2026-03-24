import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SculptEngine } from "@/lib/sculpting/engine/SculptEngine";
import { loadMeshForSculpting } from "@/lib/sculpting/engine/MeshLoader";
import { buildNeighborMap } from "@/lib/sculpting/engine/BrushSystem";
import { createAllBrushes } from "@/lib/sculpting/engine/brushes";
import type {
  BrushType,
  SculptEngineCallbacks,
  SymmetrySettings,
} from "@/lib/sculpting/engine/types";

export class SculptCanvas {
  // Three.js core
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private canvas: HTMLCanvasElement;

  // Engine
  engine: SculptEngine;

  // State
  private animationId: number = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  // Brush cursor preview
  private cursorHelper: THREE.Mesh;
  private cursorVisible = false;

  // Wireframe
  private wireframeMaterial: THREE.MeshBasicMaterial;
  private originalMaterial: THREE.Material | null = null;
  private isWireframe = false;

  // Pointer capture
  private activePointerId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a1a2e);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Scene
    this.scene = new THREE.Scene();

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(5, 8, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8888cc, 0.4);
    fillLight.position.set(-5, 3, -5);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, -3, 5);
    this.scene.add(rimLight);

    // Grid helper
    const grid = new THREE.GridHelper(4, 20, 0x333355, 0x222244);
    this.scene.add(grid);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(0, 1.5, 3);

    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.target.set(0, 0.5, 0);
    this.controls.update();

    // Cursor helper (sphere outline)
    const cursorGeo = new THREE.SphereGeometry(1, 32, 16);
    const cursorMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
      depthTest: false,
    });
    this.cursorHelper = new THREE.Mesh(cursorGeo, cursorMat);
    this.cursorHelper.visible = false;
    this.cursorHelper.renderOrder = 999;
    this.scene.add(this.cursorHelper);

    // Wireframe material
    this.wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      wireframe: true,
    });

    // Engine
    this.engine = new SculptEngine();
    for (const brush of createAllBrushes()) {
      this.engine.registerBrush(brush);
    }
    this.engine.setActiveBrush("draw");

    // Events
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerUp);

    // Resize
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.handleResize();

    // Start render loop
    this.animate();
  }

  // ─── Public API ────────────────────────────────────────────

  async loadMesh(glbUrl: string): Promise<void> {
    this.engine.callbacks.onLoadingChanged?.(true);
    try {
      const { mesh } = await loadMeshForSculpting(glbUrl);

      // Center and scale the mesh
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2 / maxDim;
      mesh.scale.setScalar(scale);
      mesh.position.sub(center.multiplyScalar(scale));
      // Shift up so model sits on the grid
      const scaledBox = new THREE.Box3().setFromObject(mesh);
      mesh.position.y -= scaledBox.min.y;

      // BAKE transforms into geometry so local space = world space.
      // This is critical: BVH raycast operates in local space, but the
      // raycaster fires in world space. Without baking, brush strokes
      // hit at the bounding box projection instead of the mouse position.
      mesh.updateMatrixWorld(true);
      mesh.geometry.applyMatrix4(mesh.matrixWorld);
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      mesh.updateMatrixWorld(true);

      // Recompute normals and rebuild BVH after baking
      mesh.geometry.computeVertexNormals();
      const bvh = new MeshBVH(mesh.geometry);
      (mesh.geometry as any).boundsTree = bvh;

      // Rebuild neighbor map with baked geometry
      const neighborMap = buildNeighborMap(
        mesh.geometry.index!.array,
        mesh.geometry.attributes.position.count
      );

      this.scene.add(mesh);
      this.engine.setMesh(mesh, neighborMap);

      // Fit camera to baked geometry
      const finalBox = new THREE.Box3().setFromObject(mesh);
      const finalCenter = finalBox.getCenter(new THREE.Vector3());
      const finalSize = finalBox.getSize(new THREE.Vector3());
      this.controls.target.copy(finalCenter);
      const maxFinalDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
      this.camera.position.set(
        finalCenter.x,
        finalCenter.y,
        finalCenter.z + maxFinalDim * 1.5
      );
      this.controls.update();
    } finally {
      this.engine.callbacks.onLoadingChanged?.(false);
    }
  }

  setCallbacks(callbacks: SculptEngineCallbacks): void {
    this.engine.callbacks = callbacks;
  }

  setBrush(type: BrushType): void {
    this.engine.setActiveBrush(type);
  }

  setBrushSize(size: number): void {
    this.engine.brushSettings.size = size;
  }

  setBrushStrength(strength: number): void {
    this.engine.brushSettings.strength = strength;
  }

  setSymmetry(settings: SymmetrySettings): void {
    this.engine.symmetry = { ...settings };
  }

  toggleWireframe(): boolean {
    if (!this.engine.mesh) return this.isWireframe;

    this.isWireframe = !this.isWireframe;
    if (this.isWireframe) {
      this.originalMaterial = this.engine.mesh.material as THREE.Material;
      this.engine.mesh.material = this.wireframeMaterial;
    } else if (this.originalMaterial) {
      this.engine.mesh.material = this.originalMaterial;
    }
    return this.isWireframe;
  }

  setMatcapColor(color: number): void {
    if (!this.engine.mesh) return;
    const mat = this.engine.mesh.material;
    if (mat instanceof THREE.MeshMatcapMaterial) {
      mat.color.setHex(color);
    }
  }

  undo(): void {
    this.engine.undo();
  }

  redo(): void {
    this.engine.redo();
  }

  frameModel(): void {
    if (!this.engine.mesh) return;
    const box = new THREE.Box3().setFromObject(this.engine.mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.controls.target.copy(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    this.camera.position.copy(center);
    this.camera.position.z += maxDim * 2;
    this.controls.update();
  }

  getMesh(): THREE.Mesh | null {
    return this.engine.mesh;
  }

  registerBrushInstance(brush: import("@/lib/sculpting/engine/BrushSystem").Brush): void {
    this.engine.registerBrush(brush);
  }

  // ─── Pointer Events ────────────────────────────────────────

  private getNDC(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    return [x, y];
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // Left button only
    e.preventDefault();

    const [nx, ny] = this.getNDC(e);
    const hit = this.engine.pointerDown(nx, ny, this.camera);

    if (hit) {
      // Disable orbit during sculpt stroke
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
      this.activePointerId = e.pointerId;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const [nx, ny] = this.getNDC(e);

    if (this.engine.isStroking) {
      this.engine.pointerMove(nx, ny, this.camera);
      // Skip hover raycast during active stroke (avoid 2x BVH cost)
      return;
    }

    // Update cursor helper (only when not stroking)
    const hitPoint = this.engine.raycastHover(nx, ny, this.camera);
    if (hitPoint) {
      this.cursorHelper.position.copy(hitPoint);
      this.cursorHelper.scale.setScalar(this.engine.brushSettings.size);
      this.cursorHelper.visible = true;
      this.cursorVisible = true;
      this.canvas.style.cursor = "none";
    } else {
      this.cursorHelper.visible = false;
      this.cursorVisible = false;
      this.canvas.style.cursor = "default";
    }
  };

  private onPointerUp = (_e: PointerEvent): void => {
    if (this.engine.isStroking) {
      this.engine.pointerUp();
      this.controls.enabled = true;
      // Release pointer capture
      if (this.activePointerId !== null) {
        try { this.canvas.releasePointerCapture(this.activePointerId); } catch {}
        this.activePointerId = null;
      }
    }
  };

  // ─── Render Loop ───────────────────────────────────────────

  private animate = (): void => {
    if (this.disposed) return;
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private handleResize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    // Guard against 0 dimensions (DOM not yet painted)
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ─── Cleanup ───────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationId);

    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);

    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.wireframeMaterial.dispose();

    // Dispose geometry/materials
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          m.material?.dispose();
        }
      }
    });
  }
}
