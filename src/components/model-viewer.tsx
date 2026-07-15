"use client";

import {
  Component,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, Center, Stage } from "@react-three/drei";
import * as THREE from "three";
import { useDictionary } from "@/lib/i18n/locale-context";
import { isWebGLAvailable } from "./webgl-support";

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const ref = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.3;
    }
  });

  return (
    <Center>
      <group ref={ref}>
        <primitive object={scene} />
      </group>
    </Center>
  );
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
  autoRotate = true,
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
            <Canvas camera={{ position: [0, 2, 5], fov: 45 }}>
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
              <Suspense fallback={<LoadingSpinner />}>
                <Stage environment="city" intensity={0.5}>
                  <Model url={url} />
                </Stage>
              </Suspense>
              <OrbitControls
                ref={controlsRef}
                autoRotate={autoRotate}
                autoRotateSpeed={2}
                enablePan={false}
                minDistance={2}
                maxDistance={10}
              />
            </Canvas>
          </WebGLBoundary>
        ) : (
          fallback
        )}
      </div>
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
