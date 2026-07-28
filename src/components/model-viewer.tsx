"use client";

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useDictionary } from "@/lib/i18n/locale-context";
import { isWebGLAvailable } from "./webgl-support";

// Camera framing is fixed because every model is normalized to a unit bounding
// sphere below — so these numbers hold for a 15 mm keychain and a 300 mm
// figurine alike. Previously the camera sat at a hard-coded distance with hard
// -coded min/max clamps while <Stage> tried to fit the camera to the raw model:
// for anything not authored at ~1 unit, drei wanted a distance far outside the
// clamps and OrbitControls yanked it back every frame — the "zooms in then
// moves around weirdly" symptom.
const CAM_POS: [number, number, number] = [0, 0.55, 3.1];
const MIN_DISTANCE = 1.35;
const MAX_DISTANCE = 8;

/**
 * Loads the GLB and normalizes it: re-centered on its bounding-sphere centre
 * and scaled to radius 1. The scene is cloned because useGLTF caches one
 * object3d per URL — mutating it directly would corrupt every other viewer
 * showing the same model (and re-apply the scaling on each mount).
 */
function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);

  const object = useMemo(() => {
    const clone = scene.clone(true);
    const sphere = new THREE.Box3()
      .setFromObject(clone)
      .getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius > 0 ? sphere.radius : 1;
    clone.position.sub(sphere.center);
    const holder = new THREE.Group();
    holder.add(clone);
    holder.scale.setScalar(1 / radius);
    return holder;
  }, [scene]);

  return <primitive object={object} />;
}

function LoadingSpinner() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.x += delta * 0.5;
      ref.current.rotation.y += delta * 0.8;
    }
  });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#00D4FF" wireframe />
    </mesh>
  );
}

/**
 * Contains WebGL failures to the viewer. If <Canvas> (or anything under it)
 * throws — most importantly `Error creating WebGL context` during renderer
 * init on a browser where WebGL slipped past the pre-check but still fails —
 * we render the fallback instead of letting the error bubble to the root
 * boundary and blank the whole page.
 */
class WebGLBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(
      "[ModelViewer] 3D preview disabled — WebGL unavailable:",
      error
    );
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ModelViewer({
  url,
  className,
  autoRotate,
  previewMode = false,
}: {
  url: string;
  className?: string;
  autoRotate?: boolean;
  previewMode?: boolean;
}) {
  const d = useDictionary();
  const controlsRef = useRef<any>(null);
  const [, setKey] = useState(0);
  // Auto-rotation is a marketing flourish. On the inspection surfaces
  // (manufacturer, admin, /track) it fights whoever is trying to look at a
  // detail, so it is opt-in there and on by default only for previews.
  const rotate = autoRotate ?? previewMode;

  // Probe WebGL after mount only — running it during render would return
  // false on the server and mismatch hydration. `null` = not yet probed.
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => {
    setWebgl(isWebGLAvailable());
  }, []);

  const resetView = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
      setKey((k) => k + 1);
    }
  };

  const defaultClass = previewMode
    ? "w-full h-[300px] sm:h-[400px] md:h-[500px] rounded-2xl overflow-hidden"
    : "w-full h-96 rounded-lg";

  const fallback = (
    <div className="flex h-full w-full items-center justify-center bg-[#F3F2EC] p-6 text-center">
      <p className="text-sm text-gray-500">
        {d["model.viewer.webglUnavailable"]}
      </p>
    </div>
  );

  return (
    <div className="relative h-full">
      {previewMode && (
        <div className="h-1 bg-gradient-to-r from-green-500 to-green-800 rounded-t-2xl" />
      )}
      <div className={className || defaultClass}>
        {webgl === null ? (
          // Pre-probe placeholder — identical on server + first client render.
          <div className="h-full w-full bg-[#F3F2EC]" />
        ) : webgl ? (
          <WebGLBoundary fallback={fallback}>
            <Canvas
              camera={{ position: CAM_POS, fov: 45, near: 0.05, far: 100 }}
            >
              {/* Warm dark background */}
              <color attach="background" args={["#F3F2EC"]} />
              <ambientLight intensity={previewMode ? 0.4 : 0.3} />
              {/* Emerald key light */}
              <directionalLight position={[5, 5, 5]} intensity={1} color="#00D4FF" />
              {/* Cool fill light */}
              <directionalLight position={[-5, 3, -5]} intensity={0.5} color="#1E293B" />
              {previewMode && (
                <directionalLight position={[0, -3, 5]} intensity={0.3} color="#0A0A0B" />
              )}
              {/* No <Stage>: it fitted the camera on its own (fighting
                  OrbitControls' distance clamps) and its environment map is a
                  cross-origin HDR that this app's CSP blocks, so it only ever
                  contributed the camera fight. The lights above are the ones
                  that were actually lighting the scene. */}
              <Suspense fallback={<LoadingSpinner />}>
                <Model url={url} />
              </Suspense>
              <OrbitControls
                ref={controlsRef}
                autoRotate={rotate}
                autoRotateSpeed={1.2}
                enablePan={false}
                minDistance={MIN_DISTANCE}
                maxDistance={MAX_DISTANCE}
              />
            </Canvas>
          </WebGLBoundary>
        ) : (
          fallback
        )}
      </div>
      {!previewMode && webgl && (
        // Inspection surfaces get a reset affordance too — after zooming into a
        // detail there was previously no way back to the framed view.
        <button
          type="button"
          onClick={resetView}
          className="absolute bottom-3 right-3 rounded-lg bg-black/50 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/70"
        >
          {d["model.viewer.resetView"]}
        </button>
      )}
      {previewMode && webgl && (
        <>
          {/* Hint overlay */}
          <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-sm text-white rounded-full px-3 py-1 text-xs">
            {d["create.preview.dragToRotate"]}
          </div>
          {/* Reset button */}
          <div className="absolute bottom-4 right-4 flex gap-2">
            <button
              type="button"
              onClick={resetView}
              className="bg-black/50 backdrop-blur-sm text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-black/70 transition-colors"
            >
              {d["model.viewer.resetView"]}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
