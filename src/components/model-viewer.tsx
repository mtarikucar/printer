"use client";

import { Suspense, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, Center, Stage } from "@react-three/drei";
import * as THREE from "three";
import { useDictionary } from "@/lib/i18n/locale-context";

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
      <meshStandardMaterial color="#10B981" wireframe />
    </mesh>
  );
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

  const resetView = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
      setKey((k) => k + 1);
    }
  };

  const defaultClass = previewMode
    ? "w-full h-[300px] sm:h-[400px] md:h-[500px] rounded-2xl overflow-hidden"
    : "w-full h-96 rounded-lg";

  return (
    <div className="relative h-full">
      {previewMode && (
        <div className="h-1 bg-gradient-to-r from-green-500 to-green-800 rounded-t-2xl" />
      )}
      <div className={className || defaultClass}>
        <Canvas camera={{ position: [0, 2, 5], fov: 45 }}>
          {/* Warm dark background */}
          <color attach="background" args={["#F3F4F6"]} />
          <ambientLight intensity={previewMode ? 0.4 : 0.3} />
          {/* Emerald key light */}
          <directionalLight position={[5, 5, 5]} intensity={1} color="#10B981" />
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
      </div>
      {previewMode && (
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
